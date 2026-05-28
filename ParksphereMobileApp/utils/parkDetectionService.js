import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer, Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

console.log('***************************************************');
console.log('🚀 [ParkDetection] ENGINE FILE LOADED - LOGS ACTIVE');
console.log('***************************************************');

// Import the modified processLocationHMM which now returns belief
import { initMotionTracking, processLocationHMM, resetHMM, getHMMStatus, resetPGRHistory } from './parkDetection_HMM';
import { logTelemetry } from './telemetryService';
import { apiRequest } from './apiService';

// 🚀 Dynamic Import for Native Motion Activity (prevents crash in Expo Go)
let MotionActivityTracker = null;
try {
  MotionActivityTracker = require('react-native-motion-activity-tracker');
  console.log('[ParkDetection] MotionActivityTracker module successfully required.');
} catch (e) {
  console.log('[ParkDetection] MotionActivityTracker native module NOT available:', e.message);
}

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';
let isInitialized = false;

// 🚀 TIMEOUT WRAPPER
const withTimeout = (promise, ms, name = 'unnamed') => {
  let timeoutId;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`[Timeout] ${name} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) clearTimeout(timeoutId);
  });
};

// Sensor data cache
let currentAcceleration = 1.0;
let currentStepRate = 0;
let lastStepTimestamp = 0; // 🚀 Added to track Fast-Path steps
let lastReportedSteps = 0; // 🚀 ADD THIS NEW VARIABLE
let currentActivity = { state: 'unknown', automotive: false, walking: false, stationary: false, unknown: true, confidence: 0 };
let accelSubscription = null;
let pedometerSubscription = null; // 🚀 Added to keep listener alive
let isPedometerAvailable = null;

export function simulateMotionActivity(type, intensity = 'HIGH') {
  console.log(`[ParkDetection] Simulating activity: ${type} (${intensity})`);

  if (type === 'AUTOMOTIVE') {
    currentAcceleration = 1.1 + (intensity === 'HIGH' ? 0.4 : 0.1);
    currentStepRate = 0;
    currentActivity = { automotive: true, walking: false, stationary: false, unknown: false };
  } else if (type === 'WALKING') {
    currentAcceleration = 1.1 + (intensity === 'HIGH' ? 0.2 : 0.05);
    currentStepRate = intensity === 'HIGH' ? 2.0 : 1.2;
    currentActivity = { automotive: false, walking: true, stationary: false, unknown: false };
  } else if (type === 'STATIONARY' || type === 'IDLE') {
    currentAcceleration = 1.0;
    currentStepRate = 0;
    currentActivity = { automotive: false, walking: false, stationary: true, unknown: false };
  } else {
    currentAcceleration = 1.0;
    currentStepRate = 0;
    currentActivity = { automotive: false, walking: false, stationary: false, unknown: true };
  }
}

// ---------------- HELPERS ----------------
async function checkPedometer() {
  if (isPedometerAvailable !== null) return isPedometerAvailable;
  try {
    isPedometerAvailable = await withTimeout(Pedometer.isAvailableAsync(), 2000, 'Pedometer.isAvailable');
  } catch (e) {
    console.warn('[ParkDetection] Pedometer availability check failed:', e.message);
    isPedometerAvailable = false;
  }
  return isPedometerAvailable;
}

async function getRecentStepRate() {
  try {
    const available = await checkPedometer();
    if (!available) return 0;

    // Look at the last 8 seconds
    const end = new Date();
    const start = new Date();
    start.setSeconds(end.getSeconds() - 8);

    const result = await withTimeout(Pedometer.getStepCountAsync(start, end), 3000, 'Pedometer.getStepCount');
    return (result.steps || 0) / 8.0; // steps per second
  } catch (error) {
    console.error('[ParkDetection] Error fetching step count:', error.message);
    return 0;
  }
}

// ---------------- HELPERS ----------------
async function declareSpot(location) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const userId = await AsyncStorage.getItem('userId');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;

    if (!token || !userId) {
      console.warn('[ParkDetection] User token or ID missing, cannot declare spot.');
      return;
    }

    const response = await withTimeout(apiRequest(`${serverUrl}/api/declare-spot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: parseInt(userId, 10),
        latitude: location.latitude,
        longitude: location.longitude,
        timeToLeave: 60,
        costType: 'free',
        price: 0,
        declaredCarType: 'sedan',
        comments: 'Auto-detected parking spot (HMM)',
        isAutoDetected: true,
      }),
    }), 5000, 'fetch.declareSpot');

    if (response.ok) {
      const data = await response.json();
      notify('Spot successfully registered in the system!');
      console.log('[ParkDetection] Declared spot successfully, spotId:', data.spotId);
      return data.spotId;
    } else {
      const errorBody = await response.text();
      console.error('[ParkDetection] Failed to declare spot:', response.status, errorBody);
      notify(`Failed to declare spot: ${response.status}`);
    }
  } catch (error) {
    console.error('[ParkDetection] Error declaring spot:', error.message);
    notify('Error declaring parking spot.');
  }
}

async function updateSpotStatus(spotId, status) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;
    if (!token || !spotId) return;

    await withTimeout(apiRequest(`${serverUrl}/api/parkingspots/${spotId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    }), 5000, 'fetch.updateSpotStatus');
    console.log(`[ParkDetection] Updated spot ${spotId} status to: ${status}`);
  } catch (error) {
    console.error(`[ParkDetection] Failed to update spot ${spotId} status to ${status}:`, error.message);
  }
}

async function deleteSpot(spotId) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;
    if (!token || !spotId) return;

    await withTimeout(apiRequest(`${serverUrl}/api/parkingspots/${spotId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    }), 5000, 'fetch.deleteSpot');
    console.log(`[ParkDetection] Deleted spot ${spotId} from server.`);
  } catch (error) {
    console.error(`[ParkDetection] Error deleting spot ${spotId}:`, error.message);
  }
}

function notify(message, extraData = {}) {
  console.log(`[ParkDetection] ${message}`);
  DeviceEventEmitter.emit('parkDetectionUpdate', { message, ...extraData });
}

let lastVirtualUpdate = 0;
let isProcessing = false;

async function triggerVirtualUpdate() {
  if (!isInitialized || isProcessing) return;
  
  const now = Date.now();
  // 🚀 FIX: 2-second throttle to prevent AsyncStorage/Bridge flooding
  if (now - lastVirtualUpdate < 2000) return; 
  lastVirtualUpdate = now;
  isProcessing = true;

  try {
    // 🚀 Refresh step rate cache
    currentStepRate = await getRecentStepRate();

    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    const stateData = saved ? JSON.parse(saved) : {};
    
    if (stateData.lastLocation) {
      console.log('[ParkDetection] ⚡ Triggering virtual HMM update from sensor fast-path.');
      
      // 🚀 FIX: If the phone is perfectly still, we must ensure we aren't 
      // accidentally reusing "simulated" walking/driving flags from the past.
      const isActuallyStill = Math.abs(currentAcceleration - 1.0) < 0.015;
      const virtualLocation = {
        ...stateData.lastLocation,
        isFromSimulator: stateData.lastLocation.isFromSimulator && !isActuallyStill
      };

      await handleLocationUpdate(stateData, virtualLocation);
    }
  } catch (e) {
    console.error('[ParkDetection] Virtual update failed:', e.message);
  } finally {
    isProcessing = false;
  }
}

// ---------------- CORE ENGINE (HMM) ----------------
// 🚀 Store latest Bluetooth state as a module-level variable to be used in HMM calls
let lastBluetoothState = false;

export async function handleLocationUpdate(arg1, arg2, isBluetoothUpdate = false) {
  if (!isInitialized && !isBluetoothUpdate) {
    return arg2 ? arg1 : {}; 
  }

  // 🚀 If this is a Bluetooth event, just update the state variable
  if (isBluetoothUpdate) {
    lastBluetoothState = arg1.bluetoothConnected;
    console.log(`[ParkDetection] Bluetooth state updated to: ${lastBluetoothState}`);
    return;
  }

  let stateData, location;
  let isInternal = false;

  try {
    if (arg2) { 
      stateData = arg1;
      location = arg2;
      isInternal = true;
    } else { 
      location = arg1;
      // 🚀 Refresh step rate for foreground updates
      currentStepRate = await getRecentStepRate();
      const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'AsyncStorage.getItem');
      stateData = saved ? JSON.parse(saved) : {};
    }
  } catch (e) {
    console.error('[ParkDetection] handleLocationUpdate early failure:', e.message);
    return isInternal ? arg1 : {};
  }

  const prevState = stateData.state || 'IDLE';
  const currentLoc = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };

  const now = Date.now();
  const speed = (location.coords.speed || 0) * 3.6; 
  
  const currentHeading = location.coords.heading || 0;
  let headingChange = 0;
  if (stateData.lastHeading !== undefined) {
    let diff = Math.abs(currentHeading - stateData.lastHeading);
    headingChange = diff > 180 ? 360 - diff : diff;
  }
  stateData.lastHeading = currentHeading;

  if (speed < 3.0) { 
    if (!stateData.stopStartTime) stateData.stopStartTime = now;
    stateData.stopDuration = (now - stateData.stopStartTime) / 1000; 
  } else {
    stateData.stopStartTime = null;
    stateData.stopDuration = 0;
  }

  const acceleration = currentAcceleration;
  
  let stepRate = 0;
  if (!location.isFromSimulator) {
    const timeSinceLastStep = Date.now() - lastStepTimestamp;
    
    if (timeSinceLastStep < 4000) {
      stepRate = Math.max(1.2, currentStepRate); 
      console.log(`[ParkDetection] 👟 Fast-Path Step Active: ${stepRate.toFixed(2)}`);
    } else {
      stepRate = currentStepRate;
    }
  } else {
    stepRate = currentStepRate;
  }

  const hmmResult = processLocationHMM(location, stateData.parkedLocation, {
    acceleration_magnitude: acceleration,
    step_rate: stepRate,
    motion_activity: currentActivity,
    heading_change: headingChange,
    stop_duration: stateData.stopDuration,
    lastDistanceToCar: stateData.lastDistanceToCar,
    previousState: stateData.state,
    previousBelief: stateData.belief,
    isAway: stateData.isAway,
    isReturningIntentLocked: stateData.isReturningIntentLocked,
    minDistDuringReturn: stateData.minDistDuringReturn,
    accuracy: location.coords.accuracy,
    bluetoothConnected: lastBluetoothState, // 🛡️ NEW SIGNAL
    // Restore counters
    returnCounter: stateData.returnCounter,
    inCarCounter: stateData.inCarCounter,
    drivingCounter: stateData.drivingCounter,
    walkingCounter: stateData.walkingCounter,
    tripDrivingTime: stateData.tripDrivingTime,
    tripDrivingDistance: stateData.tripDrivingDistance,
    lastTripX: stateData.lastTripX,
    lastTripY: stateData.lastTripY,
    proximityCounter: stateData.proximityCounter
  });

  // 📡 Telemetry: Record snapshot for offline analysis
  logTelemetry({
    speed: location.coords.speed,
    stepRate: stepRate,
    accel: acceleration,
    accuracy: location.coords.accuracy,
    bluetoothConnected: lastBluetoothState
  }, hmmResult);

  let {
    state: hmmState,
    bestState,
    confidence,
    secondBestState,
    secondConfidence,
    belief: currentBelief,
    distToParked,
    parkedEvent,
    awayEvent,
    clearParkingEvent,
    isAway: hmmIsAway,
    isReturningIntentLocked: hmmIsReturningIntentLocked,
    minDistDuringReturn: hmmMinDistDuringReturn,
    // Get counters for persistence
    returnCounter,
    inCarCounter,
    drivingCounter,
    walkingCounter,
    tripDrivingTime,
    tripDrivingDistance,
    lastTripX,
    lastTripY,
    proximityCounter
  } = hmmResult;

  if (location.forcePark) {
    parkedEvent = true;
    hmmState = 'STOPPED'; 
  }

  stateData.lastDistanceToCar = distToParked;
  const isFirstUpdate = !stateData.lastUpdate;
  stateData.lastUpdate = now;
  stateData.lastLocation = location; // 🚀 Save for virtual updates
  stateData.state = hmmState;
  stateData.belief = currentBelief;
  stateData.isAway = hmmIsAway;
  stateData.isReturningIntentLocked = hmmIsReturningIntentLocked;
  stateData.minDistDuringReturn = hmmMinDistDuringReturn;
  
  // Persist counters
  stateData.returnCounter = returnCounter;
  stateData.inCarCounter = inCarCounter;
  stateData.drivingCounter = drivingCounter;
  stateData.walkingCounter = walkingCounter;
  stateData.tripDrivingTime = tripDrivingTime;
  stateData.tripDrivingDistance = tripDrivingDistance;
  stateData.lastTripX = lastTripX;
  stateData.lastTripY = lastTripY;
  stateData.proximityCounter = proximityCounter;

  if (awayEvent) {
    notify('🚶 You have left the vicinity of your car.');
  }

  if (parkedEvent && !stateData.parkingNotified) {
    const finalParkedLoc = stateData.stoppedCandidateLocation || currentLoc;

    const spotId = await declareSpot(finalParkedLoc);

    // Allow parking confirmation even if server declaration fails (offline-first)
    stateData.parkedLocation = finalParkedLoc;
    stateData.serverSpotId = spotId || `local-${Date.now()}`;
    stateData.parkingNotified = true;

    notify('🅿️ Parking confirmed!', { parkedLocation: finalParkedLoc });
  }
  if (clearParkingEvent) {
    stateData.parkingNotified = false;
    // 🚀 FIX: Don't orphan the server spot!
    if (stateData.serverSpotId && !stateData.serverSpotId.startsWith('local-')) {
      await updateSpotStatus(stateData.serverSpotId, 'free');
    }
    stateData.serverSpotId = null;

    stateData.parkedLocation = null;
    stateData.stoppedCandidateLocation = null;
    stateData.lastDistanceToCar = null;
    stateData.isAway = false;
    stateData._loggedParkedLoc = false;
    resetPGRHistory(); // 🚀 Clear stale position history for the new trip
    notify('🏁 Spot cleared. Ready for next parking.', { clearParkedLocation: true });
  }

  if (hmmState === 'DRIVING' && stateData.stoppedCandidateLocation) {
    stateData.stoppedCandidateLocation = null;
  }

  if (stateData.state === 'STOPPED' && !stateData.stoppedCandidateLocation) {
    stateData.stoppedCandidateLocation = { ...hmmResult.filteredCoords };
  }

  if (stateData.state !== prevState || isFirstUpdate) {
    const messages = {
      'DRIVING': '🚗 Driving detected...',
      'WALKING': '🚶 Walking detected...',
      'STOPPED': '⏱️ Vehicle stopped...',
      'RETURNING': '📍 Approaching vehicle...',
      'IN_CAR': '🚗 Back in car...',
      'IDLE': '💤 System Idle.'
    };

    let activityTag = '❓ Unknown';
    if (currentActivity.automotive) activityTag = '🚗 Automotive';
    else if (currentActivity.walking) activityTag = '🚶 Walking';
    else if (currentActivity.stationary) activityTag = '💤 Stationary';

    let debugInfo = ` ${Math.round(confidence * 100)}%`;
    notify((messages[stateData.state] || `System State: ${stateData.state}`) + debugInfo);

    if ((stateData.state === 'RETURNING' || stateData.state === 'IN_CAR') && stateData.serverSpotId) {
      await updateSpotStatus(stateData.serverSpotId, 'soon_free');
    }
  }

  DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
    state: stateData.state,
    bestState,
    confidence,
    secondBestState,
    secondConfidence,
    belief: currentBelief,
    location: currentLoc,
    metrics: {
      speed,
      acceleration,
      stepRate, // 🚀 Uses the boosted Fast-Path rate
      motionActivity: currentActivity,
      headingChange,
      stopDuration: stateData.stopDuration,
      distToParked
    }
  });

  if (!isInternal) {
    try {
      await withTimeout(AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData)), 2000, 'AsyncStorage.setItem');
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage:', e.message);
    }
  }

  return stateData; 
}

// ---------------- SENSORS ----------------
async function startSensors() {
  // 🚀 Increase frequency to 10Hz for snappier reaction to movement
  Accelerometer.setUpdateInterval(100); 
  accelSubscription = Accelerometer.addListener(data => {
    currentAcceleration = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
    
    // ⚡ FAST-PATH: If we see a sudden burst of movement while IDLE, trigger HMM check
    if (currentAcceleration > 1.6 && isInitialized && getHMMStatus().currentState === 'IDLE') {
       triggerVirtualUpdate();
    }
  });

  // ⚡ FAST-PATH: Direct Pedometer Listener
  try {
    const isPedometerAvailable = await Pedometer.isAvailableAsync();
    if (isPedometerAvailable) {
      console.log('[ParkDetection] Starting Pedometer Watch...');
      lastReportedSteps = 0; // Reset counter on start
      
      pedometerSubscription = Pedometer.watchStepCount(result => {
        // 🚀 FIX: The Foreground-Resume Guard
        // We only trigger if the cumulative step count actually went UP.
        // This ignores React Native's flush/resume pings when the phone is stationary.
        if (result.steps > lastReportedSteps && isInitialized) {
          lastReportedSteps = result.steps;
          console.log(`[ParkDetection] 👣 PHYSICAL STEP DETECTED! Total since start: ${result.steps}`);
          lastStepTimestamp = Date.now(); 
          triggerVirtualUpdate();
        } 
        // Catch OS resets (if Expo resets the watcher count to 0 in the background)
        else if (result.steps < lastReportedSteps) {
          lastReportedSteps = result.steps;
          if (result.steps > 0 && isInitialized) {
            lastStepTimestamp = Date.now();
            triggerVirtualUpdate();
          }
        }
      });
    }
  } catch (e) {
    console.warn('[ParkDetection] Pedometer watch failed:', e.message);
  }

  console.log('[ParkDetection] Initializing Motion Activity Tracker...');
  try {
    if (MotionActivityTracker) {
      console.log('[ParkDetection] MotionActivityTracker available. Methods:', Object.keys(MotionActivityTracker));
      
      // Robust authorization check
      if (typeof MotionActivityTracker.getPermissionStatusAsync === 'function') {
        const authStatus = await MotionActivityTracker.getPermissionStatusAsync();
        console.log('[ParkDetection] Motion Activity Authorization status:', authStatus);
      }
      
      console.log('[ParkDetection] Starting Motion Activity updates (via startTracking)...');
      if (typeof MotionActivityTracker.startTracking === 'function') {
        // This library uses addMotionStateChangeListener + startTracking
        if (typeof MotionActivityTracker.addMotionStateChangeListener === 'function') {
          MotionActivityTracker.addMotionStateChangeListener(async (activity) => {
            if (activity) {
              const state = activity.state || 'unknown';
              const confidence = activity.confidence !== undefined ? activity.confidence : 1;
              
              const prevState = currentActivity.state;
              
              currentActivity = {
                state: state,
                automotive: state === 'automotive',
                walking: state === 'walking' || state === 'running',
                stationary: state === 'stationary',
                unknown: state === 'unknown',
                confidence: confidence
              };

              console.log(`[ParkDetection] RECEIVED Activity: state=${state}, conf=${confidence}`);

              // 🚀 TRIGGER VIRTUAL UPDATE ON ACTIVITY CHANGE
              // If we change state (e.g. Still -> Walk), don't wait for GPS.
              if (state !== prevState && isInitialized) {
                console.log(`[ParkDetection] Activity changed from ${prevState} to ${state}.`);
                triggerVirtualUpdate();
              }
            }
          });
        }
        await MotionActivityTracker.startTracking();
      } else {
        console.warn('[ParkDetection] startTracking method NOT found on MotionActivityTracker.');
      }
    } else {
      console.warn('[ParkDetection] MotionActivityTracker native module is null/undefined.');
    }
  } catch (error) {
    console.error('[ParkDetection] CRITICAL Error starting MotionActivityTracker:', error);
  }
}

function stopSensors() {
  if (accelSubscription) accelSubscription.remove();
  accelSubscription = null;
  
  if (pedometerSubscription) pedometerSubscription.remove();
  pedometerSubscription = null;
  
  if (MotionActivityTracker && typeof MotionActivityTracker.stopTracking === 'function') {
    MotionActivityTracker.stopTracking();
  }
}

// ---------------- TASK ----------------
TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data, error }) => {
  if (error) {
    console.error(`[ParkDetection] Task Error: ${error.message}`);
    return;
  }
  if (!data || !data.locations) {
    console.warn('[ParkDetection] Received task data without locations.');
    return;
  }

  // 🚀 SHARED MUTEX: Prevent clobbering state if a virtual update is running
  if (isProcessing) {
    console.warn('[ParkDetection] TaskManager update skipped — processing in progress.');
    return;
  }
  isProcessing = true;

  try {
    // 🚀 OPTIMIZATION: Fetch step rate once for the entire batch
    currentStepRate = await getRecentStepRate();

    let stateData = {};
    try {
      const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'TaskManager.getItem');
      if (saved) stateData = JSON.parse(saved);
    } catch (e) {
      console.error('[ParkDetection] Failed to load state from storage in TaskManager:', e.message);
    }

    for (const loc of data.locations) {
      // Pass the current stateData to handleLocationUpdate for sequential processing
      stateData = await handleLocationUpdate(stateData, loc);
    }

    try {
      await withTimeout(AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData)), 2000, 'TaskManager.setItem');
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage in TaskManager:', e.message);
    }
  } finally {
    isProcessing = false;
  }
});

export const isDetectionEngineRunning = () => isInitialized;

// ---------------- START/STOP ----------------
export const startParkDetection = async () => {
  try {
    console.log('[ParkDetection] Attempting to start park detection...');
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      notify('Foreground location permission denied.');
      return false;
    }
    console.log('[ParkDetection] Foreground location permissions granted.');

    // We can consider the system "initialized" for simulation and foreground tracking
    // even before background permissions are fully resolved.
    isInitialized = true;

    try {
      console.log('[ParkDetection] Requesting background location permissions...');
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        notify('Background location permission denied. HMM will work only in foreground.');
        console.warn('[ParkDetection] Background location permission denied.');
      } else {
        console.log('[ParkDetection] Background location permissions granted.');
      }
    } catch (bgError) {
      console.error('[ParkDetection] Error requesting background permissions:', bgError);
    }

    console.log('[ParkDetection] Initializing HMM components...');
    const { shouldClearPersistedState } = resetHMM(); // Reset HMM state to IDLE
    await startSensors();

    // Clear persistent state on clean start to avoid immediate transitions from stale data
    if (shouldClearPersistedState) {
      console.log('[ParkDetection] Clearing persisted state from AsyncStorage...');
      await withTimeout(AsyncStorage.removeItem(STORAGE_KEY), 2000, 'startParkDetection.removeItem');
    }
    
    const { currentState } = getHMMStatus();

    try {
      console.log('[ParkDetection] Checking if background task is already running...');
      const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
      if (!started) {
        console.log('[ParkDetection] Starting background location updates...');
        await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
          accuracy: Location.Accuracy.Balanced, 
          timeInterval: 5000, 
          deferredUpdatesInterval: 5000, 
          showsBackgroundLocationIndicator: true,
        });
        notify(`Background HMM detection started. State: ${currentState}`);
        console.log('[ParkDetection] Location updates started for PARK_DETECTION_TASK.');
        return true;
      } else {
        console.log('[ParkDetection] PARK_DETECTION_TASK is already running.');
        notify(`Detection engine active. State: ${currentState}`);
        return true; // Return true as it is effectively running
      }
    } catch (taskError) {
      console.error('[ParkDetection] Error starting background task:', taskError);
      notify('Foreground-only detection active (background task failed).');
      return true;
    }
  } catch (error) {
    console.error('[ParkDetection] Critical error in startParkDetection:', error);
    return false;
  }
};

export const stopParkDetection = async () => {
  try {
    console.log('[ParkDetection] Stopping park detection...');
    isInitialized = false;
    stopSensors();
    const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
    if (started) {
      await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
      notify('Background HMM detection stopped.');
      console.log('[ParkDetection] Location updates stopped for PARK_DETECTION_TASK.');
    }
  } catch (error) {
    console.error('[ParkDetection] Error in stopParkDetection:', error);
  }
};

export const resetParkDetection = async () => {
  console.log('[ParkDetection] Resetting park detection engine...');
  isInitialized = true; // Ensure engine is ready to process updates after reset
  const { currentState, belief } = resetHMM();
  
  try {
    // 🚀 NEW: Try to delete the spot from the server before clearing local storage
    const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'resetParkDetection.getItem');
    if (saved) {
      const stateData = JSON.parse(saved);
      if (stateData.serverSpotId) {
        console.log(`[ParkDetection] Found existing spot ${stateData.serverSpotId}. Deleting...`);
        await deleteSpot(stateData.serverSpotId);
      }
    }

    await withTimeout(AsyncStorage.removeItem(STORAGE_KEY), 2000, 'resetParkDetection.removeItem');
    console.log('[ParkDetection] Persisted state cleared from AsyncStorage.');
    
    // Reset local sensor cache as well
    currentAcceleration = 1.0;
    currentStepRate = 0;
    lastStepTimestamp = 0;
    lastReportedSteps = 0;
    lastBluetoothState = false;

    // Emit a final "IDLE" update to clear UI
    DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
      state: 'IDLE',
      bestState: 'IDLE',
      confidence: 1.0,
      belief: belief,
      metrics: {
        speed: 0,
        distToParked: 0
      }
    });

    notify('Park detection engine reset.');
  } catch (e) {
    console.error('[ParkDetection] Failed to clear persisted state:', e.message);
    notify('Error resetting park detection engine.');
  }
};

