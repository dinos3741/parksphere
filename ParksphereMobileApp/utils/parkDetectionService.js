import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer, Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter, Platform, Alert, Linking } from 'react-native';
import RNBluetoothClassic from 'react-native-bluetooth-classic';

console.log('***************************************************');
console.log('🚀 [ParkDetection] ENGINE FILE LOADED - LOGS ACTIVE');
console.log('***************************************************');

import { initMotionTracking, processLocationHMM, resetHMM, getHMMStatus, resetPGRHistory } from './parkDetection_HMM';
import { logTelemetry, logHeartbeat, restoreTelemetryState } from './telemetryService';
import { apiRequest } from './apiService';
import { initAIEngine, predictReturning, resetAIBuffer } from './aiEngine';
import { extractSpectralFeatures } from './fftUtils'; // 🚀 NEW: Spectral Analysis
import { returnZone, commitThreshold, softThreshold, etaSeconds, ALERT_MAX_RANGE, COMMIT_HOLD_MS } from './returnBoundary'; // 🚀 NEW: 2D decision boundary

// 🚀 Dynamic Import for Native Motion Activity (prevents crash in Expo Go)
let MotionActivityTracker = null;
try {
  MotionActivityTracker = require('react-native-motion-activity-tracker');
  console.log('[ParkDetection] MotionActivityTracker module successfully required.');
} catch (e) {
  console.log('[ParkDetection] MotionActivityTracker native module NOT available:', e.message);
}

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';
export const PARK_GEOFENCE_TASK = 'PARK_GEOFENCE_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';
// Geofence radius around the parked car. Set OUTSIDE the 200m ALERT_MAX_RANGE so iOS wakes the
// suspended app on the user's approach BEFORE they reach the alert zone — giving the returning
// logic lead time to build confidence and fire the soft/commit alerts. Region monitoring is the
// only thing that reliably wakes a suspended/terminated app when nothing is moving (car parked,
// user away), which continuous location updates cannot do.
const GEOFENCE_RADIUS = 300;
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
let lastAccelTimestamp = 0; // 🚀 Track stale accel data in background
let currentStepRate = 0;
let lastStepTimestamp = 0; // 🚀 Added to track Fast-Path steps
let lastReportedSteps = 0; // 🚀 ADD THIS NEW VARIABLE
let currentActivity = { state: 'unknown', automotive: false, walking: false, stationary: false, unknown: true, confidence: 0 };
let accelSubscription = null;
let pedometerSubscription = null; // 🚀 Added to keep listener alive
let isPedometerAvailable = null;

// 🚀 NEW: Spectral (FFT) Window State
let spectralBuffer = [];
const SPECTRAL_WINDOW_SIZE = 128; // Power of 2 for FFT
const SAMPLE_RATE_HZ = 50;
let currentSpectralFeatures = {
  walkingEnergy: 0,
  vehicleEnergy: 0,
  spectralEntropy: 0,
  dominantFreq: 0
};

export function simulateMotionActivity(type, intensity = 'HIGH') {
  console.log(`[ParkDetection] Simulating activity: ${type} (${intensity})`);

  if (type === 'AUTOMOTIVE') {
    currentAcceleration = 1.1 + (intensity === 'HIGH' ? 0.4 : 0.1);
    currentStepRate = 0;
    currentActivity = { automotive: true, walking: false, stationary: false, unknown: false, confidence: 2 };
  } else if (type === 'WALKING') {
    currentAcceleration = 1.1 + (intensity === 'HIGH' ? 0.2 : 0.05);
    currentStepRate = intensity === 'HIGH' ? 2.0 : 1.2;
    currentActivity = { automotive: false, walking: true, stationary: false, unknown: false, confidence: 2 };
  } else if (type === 'STATIONARY' || type === 'IDLE') {
    currentAcceleration = 1.0;
    currentStepRate = 0;
    currentActivity = { automotive: false, walking: false, stationary: true, unknown: false, confidence: 2 };
  } else {
    currentAcceleration = 1.0;
    currentStepRate = 0;
    currentActivity = { automotive: false, walking: false, stationary: false, unknown: true, confidence: 0 };
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

async function updateSpotLocation(spotId, location) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;
    if (!token || !spotId) return;

    await withTimeout(apiRequest(`${serverUrl}/api/parkingspots/${spotId}/location`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      body: JSON.stringify({ latitude: location.latitude, longitude: location.longitude }),
    }), 5000, 'fetch.updateSpotLocation');
    console.log(`[ParkDetection] Refined spot ${spotId} location to (${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)})`);
  } catch (error) {
    console.error(`[ParkDetection] Failed to refine spot ${spotId} location:`, error.message);
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
        // Virtual updates are real-time (sensor fast-path), so stamp NOW — don't reuse the
        // stale timestamp of the last GPS fix, or the temporal-replay clock would jump back.
        timestamp: Date.now(),
        isFromSimulator: stateData.lastLocation.isFromSimulator && !isActuallyStill
      };

      const updatedStateData = await handleLocationUpdate(stateData, virtualLocation);
      if (updatedStateData) {
        await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(updatedStateData));
      }
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

// 🔒 SERIAL QUEUE: Prevents concurrent handleLocationUpdate calls from clobbering state
let updateQueue = Promise.resolve();

export async function handleLocationUpdate(arg1, arg2, isBluetoothUpdate = false, isLastInBatch = true) {
  return updateQueue = updateQueue.then(async () => {
    return _handleLocationUpdateInternal(arg1, arg2, isBluetoothUpdate, isLastInBatch);
  }).catch(e => {
    console.error('[ParkDetection] Queue Error:', e.message);
    return arg2 ? arg1 : {};
  });
}

async function _handleLocationUpdateInternal(arg1, arg2, isBluetoothUpdate = false, isLastInBatch = true) {
  if (!isInitialized && !isBluetoothUpdate) {
    return arg2 ? arg1 : {}; 
  }

  // 🚀 If this is a Bluetooth event, just update the state variable
  if (isBluetoothUpdate) {
    const prevState = lastBluetoothState;
    lastBluetoothState = arg1.bluetoothConnected;
    console.log(`[ParkDetection] Bluetooth state updated to: ${lastBluetoothState}`);
    
    // 🔔 Notify user on connection
    if (lastBluetoothState && !prevState) {
      notify('🚗 Connected to car Bluetooth');
      
      // 🚀 BLUETOOTH OVERRIDE: If we connected to our car, we are NOT away from it.
      // If we have a stale spot saved and we are moving, forcefully clear it.
      try {
        const saved = await AsyncStorage.getItem(STORAGE_KEY);
        if (saved) {
           let stateData = JSON.parse(saved);
           if (stateData.parkedLocation && ['DRIVING', 'STOPPED'].includes(stateData.state)) {
              console.log('[ParkDetection] 🔄 Bluetooth Veto: Connected to car while active spot exists. Clearing stale spot...');
              
              if (stateData.serverSpotId && !String(stateData.serverSpotId).startsWith('local-')) {
                deleteSpot(stateData.serverSpotId).catch(e => console.error('BT Veto delete failed', e));
              }

              stateData.parkingNotified = false;
              stateData.serverSpotId = null;
              stateData.parkedLocation = null;
              stateData.stoppedCandidateLocation = null;
              stateData.lastDistanceToCar = null;
              stateData.isAway = false; // We are definitively in our car
              stateData.vicinityNotified = false;
              stateData._loggedParkedLoc = false;
              stateData.smoothedReturningConfidence = 0;
              stateData.softAlertSent = false;
              stateData.commitAboveSince = null;
              stateData.commitAlertSent = false;
              stateData.publicBroadcast = false;
              stateData.vacatingSent = false;

              await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData));
              await stopParkGeofence(); // car reclaimed; tear down the return geofence
              notify('🏁 Spot cleared. Ready for next parking.', { clearParkedLocation: true });
              resetPGRHistory();
           }
        }
      } catch (e) {
        console.error('[ParkDetection] Bluetooth Veto check failed:', e.message);
      }
    }
    
    // 🚀 Emit UI update immediately so the blue dot appears without waiting for next GPS ping
    DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
      ...getHMMStatus(),
      metrics: {
        ...getHMMStatus().metrics,
        bluetoothConnected: lastBluetoothState
      }
    });
    
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

  // 🚀 TEMPORAL REPLAY: drive the engine clock from the GPS fix's own timestamp, not
  // Date.now(). When iOS delivers a batch of fixes buffered during background suspension,
  // using wall-clock time would collapse minutes of driving into milliseconds and wreck
  // every time-based decision (stop_duration, commit-hold window, refinement window).
  // location.timestamp is epoch-ms from CoreLocation; Date.now() is the foreground/virtual
  // fallback where the two are equivalent. NOTE: sensor-staleness checks below intentionally
  // keep Date.now() — they measure how fresh the live accel/step reading is in real time.
  const now = location.timestamp || Date.now();
  const speed = (location.coords.speed || 0) * 3.6;

  // 🚀 UI GATING: When iOS dumps a batch of buffered fixes on resume, every one would otherwise
  // fire a UI update — making the overlay/notifications fast-forward through minutes of history.
  // Detection still runs on every fix; we only surface the UI for the LIVE fix (the last in the
  // batch, or one whose timestamp is fresh). Stale replayed fixes are processed silently.
  const emitUI = isLastInBatch || (Date.now() - now < 10000);
  
  const currentHeading = location.coords.heading || 0;
  let headingChange = 0;
  if (stateData.lastHeading !== undefined) {
    let diff = Math.abs(currentHeading - stateData.lastHeading);
    headingChange = diff > 180 ? 360 - diff : diff;
  }
  stateData.lastHeading = currentHeading;

  if (speed < 3.0) {
    if (!stateData.stopStartTime) {
      stateData.stopStartTime = now;
    }
    stateData.stopDuration = (now - stateData.stopStartTime) / 1000;
  } else {
    stateData.stopStartTime = null;
    stateData.stopDuration = 0;
  }

  let acceleration = currentAcceleration;
  let spectralFeats = { ...currentSpectralFeatures };

  if (Date.now() - lastAccelTimestamp > 5000) {
    // 🚀 BACKGROUND DEGRADATION: Accel stops firing in the background. 
    // We must pass null so the HMM doesn't falsely assume the phone is perfectly still.
    acceleration = null;
    spectralFeats = null;
  }

  let stepRate = 0;
  if (!location.isFromSimulator) {
    const timeSinceLastStep = Date.now() - lastStepTimestamp;
    
    if (timeSinceLastStep < 4000) {
      // 🚀 RESTORED REALISM: Use the actual reported rate instead of forcing 1.2.
      // This prevents minor car vibrations from "hijacking" the system into a WALKING state.
      stepRate = currentStepRate; 
      console.log(`[ParkDetection] 👟 Physical Step Activity: ${stepRate.toFixed(2)}`);
    } else if (timeSinceLastStep > 5000) {
      // 🚀 ANTI-LAG: If it has been more than 5 seconds since a physical step,
      // force stepRate to 0 to override Apple's 8-second trailing average.
      stepRate = 0;
      currentStepRate = 0;
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
    bluetoothConnected: lastBluetoothState, 
    // 🚀 NEW: Spectral Features for Frequency Domain Analysis
    spectralFeatures: spectralFeats,
    // Restore counters
    returnCounter: stateData.returnCounter,
    drivingCounter: stateData.drivingCounter,
    walkingCounter: stateData.walkingCounter,
    tripDrivingTime: stateData.tripDrivingTime,
    tripDrivingDistance: stateData.tripDrivingDistance,
    lastTripX: stateData.lastTripX,
    lastTripY: stateData.lastTripY,
    proximityCounter: stateData.proximityCounter,
    smoothedDeltaRate: stateData.smoothedDeltaRate,
    smoothedStepRate: stateData.smoothedStepRate
  });

  // 📡 Telemetry snapshot moved below to include AI returning confidence

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
    drivingCounter,
    walkingCounter,
    tripDrivingTime,
    tripDrivingDistance,
    lastTripX,
    lastTripY,
    proximityCounter,
    smoothedDeltaRate,
    smoothedStepRate
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
  stateData.drivingCounter = drivingCounter;
  stateData.walkingCounter = walkingCounter;
  stateData.tripDrivingTime = tripDrivingTime;
  stateData.tripDrivingDistance = tripDrivingDistance;
  stateData.lastTripX = lastTripX;
  stateData.lastTripY = lastTripY;
  stateData.proximityCounter = proximityCounter;
  stateData.smoothedDeltaRate = smoothedDeltaRate;
  stateData.smoothedStepRate = smoothedStepRate;

  if (awayEvent && !stateData.vicinityNotified) {
    stateData.vicinityNotified = true;
    notify('🚶 You have left the vicinity of your car.');
  }

  // ✅ CLEAR BEFORE PARK: If both events fire in the same frame (e.g. GPS lock acquired at new
  // location while STOPPED→WALKING also transitions), the clear must run first so that stale
  // candidate locations from the previous session are nulled before finalParkedLoc is computed.
  if (clearParkingEvent) {
    const spotIdToClear = stateData.serverSpotId;

    // 1. CLEAR LOCAL STATE FIRST (Ensures the app doesn't stay 'Parked' if network is slow)
    stateData.parkingNotified = false;
    stateData.serverSpotId = null;
    stateData.parkedLocation = null;
    stateData.stoppedCandidateLocation = null;
    stateData.lastDistanceToCar = null;
    stateData.isAway = false;
    stateData.vicinityNotified = false;
    stateData._loggedParkedLoc = false;
    stateData.smoothedReturningConfidence = 0;
    stateData.softAlertSent = false;
    stateData.commitAboveSince = null;
    stateData.commitAlertSent = false;
    stateData.publicBroadcast = false;
    stateData.vacatingSent = false;
    stateData.parkRefinementExpiry = null;
    resetPGRHistory();
    await stopParkGeofence(); // car is gone; tear down the return geofence

    notify('🏁 Spot cleared. Ready for next parking.', { clearParkedLocation: true });

    // 2. TELL SERVER (Ordered await to ensure reliable sync). The owner has driven off, so the
    // spot is gone — remove the dot for everyone (deleteSpot emits spotDeleted) rather than mark free.
    if (spotIdToClear && !String(spotIdToClear).startsWith('local-')) {
      console.log(`[ParkDetection] Removing cleared spot ${spotIdToClear} on server...`);
      await deleteSpot(spotIdToClear).catch(e => {
        console.error('[ParkDetection] Background server sync failed:', e.message);
      });
    }
  }

  if (parkedEvent) {
    if (stateData.parkedLocation && stateData.serverSpotId && !stateData.parkingNotified) {
       // This means we had an old spot stored, but we are parking AGAIN.
       // This happens if the app missed the departure (indoor GPS blackout).
       console.log(`[ParkDetection] 🔄 Stale spot detected during new park event. Deleting old spot ${stateData.serverSpotId}...`);
       if (!String(stateData.serverSpotId).startsWith('local-')) {
         deleteSpot(stateData.serverSpotId).catch(e => console.error('Stale override delete failed', e));
       }
       // Reset the flags and candidates so the new spot uses the current location
       stateData.parkingNotified = false;
       stateData.softAlertSent = false;
       stateData.commitAboveSince = null;
       stateData.commitAlertSent = false;
       stateData.publicBroadcast = false;
       stateData.vacatingSent = false;
       stateData.smoothedReturningConfidence = 0;
       stateData.stoppedCandidateLocation = null;
       resetPGRHistory();
    }

    if (!stateData.parkingNotified) {
      const finalParkedLoc = location.forcePark ? currentLoc : (stateData.stoppedCandidateLocation || currentLoc);

      stateData.stoppedCandidateLocation = null;

      const spotId = await declareSpot(finalParkedLoc);

      stateData.parkedLocation = finalParkedLoc;
      stateData.serverSpotId = spotId || `local-${Date.now()}`;
      stateData.parkingNotified = true;
      stateData.isAway = false;

      // If GPS accuracy was poor when parking was declared, open a 90s window to refine the location.
      const finalAccuracy = finalParkedLoc.accuracy ?? Infinity;
      stateData.parkRefinementExpiry = finalAccuracy > 20 ? (now + 90000) : null;

      notify('🅿️ Parking confirmed!', { parkedLocation: finalParkedLoc });

      // 🛡️ Arm a geofence around the car so iOS wakes us when the user returns, even after the
      // app has been suspended/terminated for hours while parked. This is the return-detection
      // backbone — continuous location can't survive that idle period.
      await startParkGeofence(finalParkedLoc);
    }
  }

  if (stateData.state === 'DRIVING' && stateData.stoppedCandidateLocation) {
    stateData.stoppedCandidateLocation = null;
  }

  if (stateData.state === 'STOPPED') {
    const currentAccuracy = location.coords.accuracy ?? Infinity;
    const savedAccuracy = stateData.stoppedCandidateLocation?.accuracy ?? Infinity;
    // Only accept GPS fixes with decent accuracy — a 75m fix is useless as a parked location.
    if (currentAccuracy < savedAccuracy && currentAccuracy < 25) {
      stateData.stoppedCandidateLocation = { latitude: location.coords.latitude, longitude: location.coords.longitude, accuracy: currentAccuracy };
    }
  }

  // POST-PARK REFINEMENT: If parking was declared with poor GPS, keep updating parkedLocation
  // for 90 seconds whenever a significantly better fix arrives. Closes on first good fix or timeout.
  if (stateData.parkingNotified && stateData.parkedLocation && stateData.parkRefinementExpiry) {
    const currentAccuracy = location.coords.accuracy ?? Infinity;
    const parkedAccuracy = stateData.parkedLocation.accuracy ?? Infinity;
    if (now < stateData.parkRefinementExpiry && currentAccuracy < parkedAccuracy * 0.5 && currentAccuracy < 20) {
      console.log(`[ParkDetection] Refining parked location: ${parkedAccuracy.toFixed(0)}m → ${currentAccuracy.toFixed(0)}m`);
      stateData.parkedLocation = currentLoc;
      stateData.parkRefinementExpiry = null;
      notify('📍 Parking location refined.', { parkedLocation: currentLoc });
      if (stateData.serverSpotId && !String(stateData.serverSpotId).startsWith('local-')) {
        await updateSpotLocation(stateData.serverSpotId, currentLoc).catch(e => console.error('[ParkDetection] Refinement server update failed:', e.message));
      }
    } else if (now >= stateData.parkRefinementExpiry) {
      stateData.parkRefinementExpiry = null;
    }
  }

  const aiFeatures = {
    speed,
    stepRate,
    accel: acceleration,
    pgr: hmmResult.pgr || 0,
    pgrSlope: hmmResult.slope || 0,
    approachAlignment: hmmResult.approachAlignment || 0,
    deltaRate: hmmResult.deltaRate || 0
  };

  const aiConfidence = await predictReturning(aiFeatures);

  // ==============================
  // 🚀 UNIFIED RETURNING CONFIDENCE (FUSION)
  // ==============================
  // Combine HMM (Holistic), CNN (Pattern), and PGR Alignment (Intent) 
  let rawReturningConfidence = 0;

  if (stateData.isAway && stateData.parkedLocation && distToParked < ALERT_MAX_RANGE) {
    const hmmBelief = currentBelief['RETURNING'] || 0;
    const aiConf = aiConfidence || 0;
    const pgrNorm = Math.max(0, hmmResult.approachAlignment || 0); // 0 to 1

    // Weighted Fusion: 40% HMM, 40% AI, 20% raw Alignment
    rawReturningConfidence = (hmmBelief * 0.4) + (aiConf * 0.4) + (pgrNorm * 0.2);
    
    if (isNaN(rawReturningConfidence)) rawReturningConfidence = 0;
  }

  // 🚀 EMA SMOOTHING
  // Alpha = 0.2 means 20% current reading, 80% historical memory.
  // This acts as a heavy flywheel, eliminating GPS/AI frame jitter.
  const ALPHA = 0.2;
  const prevSmoothed = stateData.smoothedReturningConfidence || 0;
  const overallReturningConfidence = (ALPHA * rawReturningConfidence) + ((1 - ALPHA) * prevSmoothed);

  stateData.smoothedReturningConfidence = overallReturningConfidence;

  // ==============================
  // 🚀 2D DECISION BOUNDARY (distance x confidence)
  // ==============================
  // Replaces the old fixed >0.85 threshold. Two downward-sloping curves classify
  // the (probability, distance) point into WAIT / SOFT / COMMIT zones. See returnBoundary.js.
  const zone = (stateData.isAway && stateData.parkedLocation && distToParked < ALERT_MAX_RANGE)
    ? returnZone(overallReturningConfidence, distToParked)
    : 'WAIT';
  const eta = etaSeconds(distToParked, location.coords.speed); // coords.speed is m/s; null when still

  // Phase 1 — SOFT alert ("soon free" heads-up). Cheap, fire-once, no hold time.
  // A brief entry into the soft zone is enough; re-arms if the user detours back to WAIT.
  if (zone === 'SOFT' || zone === 'COMMIT') {
    if (stateData.serverSpotId && !stateData.softAlertSent) {
      console.log(`[ParkDetection] 🟡 SOFT alert: P=${(overallReturningConfidence * 100).toFixed(0)}% @ ${distToParked.toFixed(0)}m -> soon_free (ETA ${eta}s)`);
      updateSpotStatus(stateData.serverSpotId, 'soon_free').catch(e => {}); // yellow dot
      stateData.softAlertSent = true;
      stateData.publicBroadcast = true; // dot is now visible to the network
    }
  } else {
    stateData.softAlertSent = false; // re-arm after a detour out of the soft zone
  }

  // Phase 2 — COMMIT alert ("vacating now"). Must stay above the commit curve for a
  // sustained window so a brief spike-and-retreat does not fire it. Reset on any dropout.
  if (zone === 'COMMIT') {
    if (!stateData.commitAboveSince) stateData.commitAboveSince = now;
    const sustainedMs = now - stateData.commitAboveSince;
    if (sustainedMs >= COMMIT_HOLD_MS && !stateData.commitAlertSent) {
      console.log(`[ParkDetection] 🟢 COMMIT confirmed: P=${(overallReturningConfidence * 100).toFixed(0)}% @ ${distToParked.toFixed(0)}m sustained ${(sustainedMs / 1000).toFixed(0)}s -> committed (ETA ${eta}s)`);
      if (stateData.serverSpotId) updateSpotStatus(stateData.serverSpotId, 'committed').catch(e => {}); // green dot
      notify('🚗 Spot freeing soon…', { confidence: Math.round(overallReturningConfidence * 100), etaSeconds: eta });
      stateData.commitAlertSent = true;
      stateData.publicBroadcast = true;
    }
  } else {
    stateData.commitAboveSince = null; // dropout (e.g. detour) resets the sustained timer
    stateData.commitAlertSent = false;
  }

  // 📡 Telemetry: Record snapshot for offline analysis, including AI confidence
  logTelemetry({
    timestamp: now, // 🚀 real fix time (location.timestamp), so batched replays log true times
    speed: location.coords.speed,
    stepRate: stepRate,
    accel: acceleration,
    accuracy: location.coords.accuracy,
    bluetoothConnected: lastBluetoothState,
    activity: currentActivity,
    spectralFeatures: spectralFeats
  }, hmmResult, aiConfidence, overallReturningConfidence, {
    zone,
    etaSeconds: eta,
    commitThreshold: commitThreshold(distToParked),
    softThreshold: softThreshold(distToParked)
  });

  // Only surface a state-change message for the live fix — not every replayed historical
  // transition in a buffered batch (that's the fast-forward spam in the notification window).
  if (emitUI && (stateData.state !== prevState || isFirstUpdate)) {
    const messages = {
      'DRIVING': '🚗 Driving detected...',
      'WALKING': '🚶 Walking detected...',
      'STOPPED': '⏱️ Vehicle stopped...',
      'IDLE': '💤 System Idle.'
    };

    // 🚀 RETURNING alerts are now driven by the 2D decision boundary above, not state changes.
    if (stateData.state !== 'RETURNING') {
      notify(messages[stateData.state] || `System State: ${stateData.state}`, { confidence: Math.round(confidence * 100) });
    }
  }

  // 🔴 DRIVING AWAY: the owner just started driving off in their OWN car (passenger-guarded by
  // !isAway, the same guard clearParkingEvent uses). Turn the (already public) dot red — the spot
  // is being vacated right now. Fires once; the dot is removed later on clearParkingEvent.
  if (stateData.state === 'DRIVING' && prevState !== 'DRIVING' &&
      stateData.parkedLocation && !stateData.isAway &&
      stateData.publicBroadcast && stateData.serverSpotId && !stateData.vacatingSent) {
    console.log(`[ParkDetection] 🔴 Driving away from spot ${stateData.serverSpotId} -> vacating`);
    updateSpotStatus(stateData.serverSpotId, 'vacating').catch(e => {}); // red dot
    stateData.vacatingSent = true;
  }

  // Drive the HMM overlay only with the live fix. During a buffered batch this fires once (on
  // the last fix) so the overlay snaps straight to the current state instead of fast-forwarding
  // through every historical measurement.
  if (emitUI) {
    DeviceEventEmitter.emit('parkDetectionDetailedUpdate', {
      state: stateData.state,
      bestState,
      confidence,
      secondBestState,
      secondConfidence,
      belief: currentBelief,
      location: currentLoc,
      returningConfidence: overallReturningConfidence, // 🚀 NEW: Unified Metric
      zone, // 🚀 NEW: 2D boundary zone (WAIT / SOFT / COMMIT)
      etaSeconds: eta, // 🚀 NEW: estimated seconds until the spot frees
      commitThreshold: commitThreshold(distToParked), // 🚀 NEW: commit curve at current distance
      softThreshold: softThreshold(distToParked), // 🚀 NEW: soft curve at current distance
      metrics: {
        speed,
        acceleration,
        stepRate, // 🚀 Uses the boosted Fast-Path rate
        motionActivity: currentActivity,
        headingChange,
        stopDuration: stateData.stopDuration,
        distToParked,
        bluetoothConnected: lastBluetoothState
      }
    });
  }

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
  // 🚀 FFT PREP: Increase frequency to 50Hz (20ms) for high-res spectral analysis
  Accelerometer.setUpdateInterval(20); 
  accelSubscription = Accelerometer.addListener(data => {
    // 1. Calculate magnitude for HMM fast-path logic
    const mag = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
    currentAcceleration = mag;
    lastAccelTimestamp = Date.now();

    // 2. 🚀 FFT SLIDING WINDOW
    spectralBuffer.push(mag);
    if (spectralBuffer.length >= SPECTRAL_WINDOW_SIZE) {
      // Extract features from the latest window
      currentSpectralFeatures = extractSpectralFeatures(spectralBuffer, SAMPLE_RATE_HZ);
      
      // Slide window by 25% (32 samples) for 0.6s overlap
      spectralBuffer = spectralBuffer.slice(32);
    }
    
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
      
      if (typeof MotionActivityTracker.getPermissionStatusAsync === 'function') {
        const authStatus = await MotionActivityTracker.getPermissionStatusAsync();
        console.log('[ParkDetection] Motion Activity Authorization status:', authStatus);
      }
      
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

            if (state !== prevState && isInitialized) {
              console.log(`[ParkDetection] Activity changed from ${prevState} to ${state}.`);
              triggerVirtualUpdate();
            }
          }
        });
      }

      if (typeof MotionActivityTracker.startTracking === 'function') {
        console.log('[ParkDetection] Starting Motion Activity updates...');
        await MotionActivityTracker.startTracking();
      } else {
        console.warn('[ParkDetection] startTracking method NOT found on MotionActivityTracker.');
      }
    } else {
      console.warn('[ParkDetection] MotionActivityTracker native module is null/undefined.');
    }
  } catch (e) {
    console.error('[ParkDetection] CRITICAL Error starting MotionActivityTracker:', e);
  }

  // 🚀 FIX: Initial Bluetooth State Capture (Android Only)
  if (Platform.OS === 'android' && RNBluetoothClassic) {
    try {
      const connectedDevices = await RNBluetoothClassic.getConnectedDevices();
      const isCarConnected = connectedDevices.some(device => {
        const name = (device.name || '').toLowerCase();
        return name.includes('car') || name.includes('audio') || name.includes('hands-free');
      });
      lastBluetoothState = isCarConnected;
      console.log(`[ParkDetection] Initial Bluetooth state: ${lastBluetoothState}`);
    } catch (err) {
      console.warn('[ParkDetection] Failed to get initial BT state:', err.message);
    }
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

// ---------------- HISTORICAL ACTIVITY BACKFILL ----------------
// In the background CoreMotion's LIVE activity stream is dead (the JS thread is suspended),
// so every buffered fix would otherwise carry a stale 'unknown' activity — which starves the
// HMM's DRIVING logic (it leans on the 'automotive' signal). The motion coprocessor, however,
// records the real activity continuously on dedicated hardware, even while the app is asleep.
// We query that history for the batch's time window and tag each fix with what was actually
// happening then. getHistoricalData returns segments with epoch-SECONDS timestamps and a
// string confidence ('low'|'medium'|'high').
function mapHistoricalActivity(a) {
  if (!a) return null;
  const confidence = a.confidence === 'high' ? 2 : (a.confidence === 'medium' ? 1 : 0);
  let state = 'unknown';
  if (a.automotive) state = 'automotive';
  else if (a.walking || a.running) state = 'walking';
  else if (a.stationary) state = 'stationary';
  return {
    state,
    automotive: !!a.automotive,
    walking: !!(a.walking || a.running),
    stationary: !!a.stationary,
    unknown: state === 'unknown',
    confidence
  };
}

async function fetchActivityTimeline(locations) {
  const fixTimes = locations.map(l => l.timestamp).filter(Boolean);
  if (!fixTimes.length || !MotionActivityTracker || typeof MotionActivityTracker.getHistoricalData !== 'function') {
    return null;
  }
  try {
    const start = new Date(Math.min(...fixTimes) - 5000);
    const end = new Date(Math.max(...fixTimes) + 5000);
    const raw = await withTimeout(MotionActivityTracker.getHistoricalData(start, end), 4000, 'getHistoricalData');
    const timeline = (raw || [])
      .map(a => ({ t: (a.timestamp || 0) * 1000, act: mapHistoricalActivity(a) })) // epoch s -> ms
      .filter(x => x.act)
      .sort((x, y) => x.t - y.t);
    console.log(`[ParkDetection] Backfilled ${timeline.length} historical activity segments for batch.`);
    return timeline.length ? timeline : null;
  } catch (e) {
    console.warn('[ParkDetection] Historical activity backfill failed:', e.message);
    return null;
  }
}

// Resolve the activity in effect at a given fix time (latest segment that started at/before it).
function activityAt(timeline, fixTimeMs) {
  let resolved = null;
  for (const seg of timeline) {
    if (seg.t <= fixTimeMs) resolved = seg.act; else break;
  }
  return resolved;
}

// ---------------- TASK ----------------
// 🔒 SERIAL TASK QUEUE: When iOS resumes the app after suspension it dumps every
// location it buffered while suspended as a BURST of separate task invocations (the
// heartbeat showed 114 fires in one instant). The old `if (isProcessing) return` mutex
// dropped all but the first, throwing away the entire background window. Chaining the
// invocations processes every buffered location in order instead of losing them.
let taskQueue = Promise.resolve();

TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data, error }) => {
  if (error) {
    console.error(`[ParkDetection] Task Error: ${error.message}`);
    return;
  }
  if (!data || !data.locations) {
    console.warn('[ParkDetection] Received task data without locations.');
    return;
  }

  // 💓 HEARTBEAT: record that the task fired, ALWAYS — even when not recording and even
  // if we bail out below. This is the ground truth for "did iOS wake the app in background?"
  // (independent of the telemetry recording session, which the old recorder couldn't see).
  logHeartbeat({ n: data.locations.length, cold: !isInitialized });

  taskQueue = taskQueue
    .then(() => runTaskBatch(data.locations))
    .catch(e => console.error('[ParkDetection] Task batch error:', e.message));
  return taskQueue;
});

async function runTaskBatch(locations) {
  // isProcessing still gates the foreground sensor fast-path (triggerVirtualUpdate);
  // taskQueue guarantees only one batch runs at a time, so it stays a clean flag.
  isProcessing = true;
  try {
    if (!isInitialized) {
      console.log('[ParkDetection] Engine woke up in background. Initializing...');
      isInitialized = true;
      // Restore the recording flag — a cold background relaunch reset it to false, which
      // would otherwise make logTelemetry() silently drop every background entry.
      await restoreTelemetryState();
      await initAIEngine();
      await startSensors();
    }

    // 🚀 OPTIMIZATION: Fetch step rate once for the entire batch
    currentStepRate = await getRecentStepRate();

    // 🚀 Backfill the real motion activity the coprocessor recorded across this batch window.
    const activityTimeline = await fetchActivityTimeline(locations);

    let stateData = null;
    try {
      const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'TaskManager.getItem');
      if (saved) stateData = JSON.parse(saved);
      else stateData = {};
    } catch (e) {
      console.error('[ParkDetection] Failed to load state from storage in TaskManager:', e.message);
      // 🚀 CRITICAL FIX: If storage fails to load, abort to prevent overwriting with {} and losing parkedLocation
      return;
    }

    for (let i = 0; i < locations.length; i++) {
      const loc = locations[i];
      const isLastInBatch = i === locations.length - 1;
      // Tag this fix with the activity the coprocessor actually recorded at its timestamp,
      // so a buffered drive carries 'automotive' instead of the stale live 'unknown'.
      if (activityTimeline && loc.timestamp) {
        const resolved = activityAt(activityTimeline, loc.timestamp);
        if (resolved) currentActivity = resolved;
      }
      // 🚀 SPEED SAFETY NET: if history is missing/unknown but GPS shows a clearly vehicular
      // speed (>20 km/h is impossible on foot), synthesize a medium-confidence automotive
      // signal so the DRIVING path engages even when activity history is unavailable.
      if (currentActivity.unknown && (loc.coords?.speed || 0) * 3.6 > 20) {
        currentActivity = { state: 'automotive', automotive: true, walking: false, stationary: false, unknown: false, confidence: 1 };
      }
      // Pass the current stateData to handleLocationUpdate for sequential processing. Only the
      // last fix of the batch surfaces to the UI (see emitUI) so replays don't fast-forward.
      stateData = await handleLocationUpdate(stateData, loc, false, isLastInBatch);
    }

    try {
      await withTimeout(AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData)), 2000, 'TaskManager.setItem');
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage in TaskManager:', e.message);
    }
  } finally {
    isProcessing = false;
  }
}

// ---------------- RETURN GEOFENCE ----------------
// A circular region around the parked car. iOS monitors it on the low-power coprocessor and
// relaunches the app (even after termination) when the user crosses back in — the only reliable
// way to wake a long-suspended app for return detection. On ENTER we re-engage tracking so the
// existing 2D-boundary returning logic runs over the approach and fires the soft/commit alerts.

async function startParkGeofence(loc) {
  if (!loc || loc.latitude == null || loc.longitude == null) return;
  try {
    const has = await Location.hasStartedGeofencingAsync(PARK_GEOFENCE_TASK).catch(() => false);
    if (has) await Location.stopGeofencingAsync(PARK_GEOFENCE_TASK).catch(() => {});
    await Location.startGeofencingAsync(PARK_GEOFENCE_TASK, [{
      identifier: 'parked-car',
      latitude: loc.latitude,
      longitude: loc.longitude,
      radius: GEOFENCE_RADIUS,
      notifyOnEnter: true,
      notifyOnExit: true,
    }]);
    console.log(`[ParkDetection] 🛡️ Geofence armed: ${GEOFENCE_RADIUS}m around (${loc.latitude.toFixed(5)}, ${loc.longitude.toFixed(5)})`);
  } catch (e) {
    console.error('[ParkDetection] Failed to arm geofence:', e.message);
  }
}

async function stopParkGeofence() {
  try {
    const has = await Location.hasStartedGeofencingAsync(PARK_GEOFENCE_TASK).catch(() => false);
    if (has) {
      await Location.stopGeofencingAsync(PARK_GEOFENCE_TASK);
      console.log('[ParkDetection] Geofence disarmed.');
    }
  } catch (e) {
    console.error('[ParkDetection] Failed to disarm geofence:', e.message);
  }
}

TaskManager.defineTask(PARK_GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.error(`[ParkDetection] Geofence Task Error: ${error.message}`);
    return;
  }
  const { eventType, region } = data || {};
  const isEnter = eventType === Location.GeofencingEventType.Enter;
  logHeartbeat({ geofence: isEnter ? 'ENTER' : 'EXIT', region: region?.identifier });
  console.log(`[ParkDetection] 📍 Geofence ${isEnter ? 'ENTER' : 'EXIT'} (${region?.identifier})`);

  // Only ENTER matters: the user has come back into the car's vicinity after being away.
  // (Departure/drive-off is already handled by the location task.)
  if (!isEnter) return;

  try {
    if (!isInitialized) {
      console.log('[ParkDetection] Geofence woke the engine. Initializing...');
      isInitialized = true;
      await restoreTelemetryState();
      await initAIEngine();
      await startSensors();
    }
    notify('🚶 Returning to your car…');

    // Run one immediate fix so the returning logic engages right away instead of waiting for
    // the location stream to resume. handleLocationUpdate (single-arg) loads/saves state itself.
    const loc = await withTimeout(
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.BestForNavigation }),
      8000, 'geofence.getCurrentPosition'
    ).catch(() => null);
    if (loc) await handleLocationUpdate(loc);
  } catch (e) {
    console.error('[ParkDetection] Geofence enter handling failed:', e.message);
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

    // 🚨 BACKGROUND ("Always") LOCATION IS REQUIRED.
    // Every location update — foreground AND background — is delivered by the single
    // startLocationUpdatesAsync task below. Without "Always" permission, iOS only delivers
    // while the app is in the foreground, so with the screen off the detector goes silent and
    // a real drive→park is never seen. Treat a denied/undetermined upgrade as a hard failure
    // with an actionable prompt instead of quietly running foreground-only.
    try {
      console.log('[ParkDetection] Requesting background location permissions...');
      const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus !== 'granted') {
        console.warn('[ParkDetection] Background ("Always") location permission not granted:', bgStatus);
        notify('⚠️ Background location is OFF — parking detection cannot run with the screen off.');
        // iOS will not re-prompt after the first decision, so send the user to Settings.
        Alert.alert(
          'Allow location "Always"',
          'Parksphere needs the "Always" location permission to detect parking while the app is in the background or the screen is off. With "While Using", detection stops the moment you lock your phone.\n\nOpen Settings and set Location to "Always".',
          [
            { text: 'Not now', style: 'cancel' },
            { text: 'Open Settings', onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
        return false; // do not pretend detection is active; it won't survive backgrounding
      }
      console.log('[ParkDetection] Background ("Always") location permissions granted.');
    } catch (bgError) {
      console.error('[ParkDetection] Error requesting background permissions:', bgError);
      notify('⚠️ Could not verify background location permission.');
      return false;
    }

    console.log('[ParkDetection] Initializing HMM components...');
    isInitialized = true; // background permission confirmed; engine is now live

    // 🚀 FIX: Load persisted state immediately before starting HMM/Sensors
    // This ensures parkedLocation is available even if handleLocationUpdate 
    // is called by a background task before the UI can pass it in.
    const saved = await withTimeout(AsyncStorage.getItem(STORAGE_KEY), 2000, 'startParkDetection.getItem');
    if (saved) {
       console.log('[ParkDetection] Found persisted state during startup. Restoring...');
       // No-op here, as handleLocationUpdate will load it on its first run if arg2 is null.
       // But we must NOT call resetHMM().shouldClearPersistedState which wipes it.

       // Safety re-arm: if we restart while already parked & away, make sure the return
       // geofence is monitoring (iOS usually persists it, but re-arm to be certain).
       try {
         const restored = JSON.parse(saved);
         if (restored.parkedLocation) await startParkGeofence(restored.parkedLocation);
       } catch (e) { /* malformed state; ignore */ }
    }

    resetHMM(); // Reset HMM state to IDLE (but keep isAway if it matches persisted)
    await initAIEngine(); // Initialize TFJS model
    await startSensors();
    
    const { currentState } = getHMMStatus();

    try {
      console.log('[ParkDetection] Checking if background task is already running...');
      const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
      if (!started) {
        console.log('[ParkDetection] Starting background location updates...');
        await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
          // 🚨 BestForNavigation (= kCLLocationAccuracyBestForNavigation), not High.
          // High maps to kCLLocationAccuracyNearestTenMeters, a power-saving tier iOS
          // suspends aggressively when you're slow/stationary — confirmed by the heartbeat
          // (105s screen-off gap, app suspended, locations buffered & dumped on resume).
          // BestForNavigation is the "active navigation, keep GPS hot" tier that resists
          // background suspension and keeps the location session (and app) alive.
          accuracy: Location.Accuracy.BestForNavigation,
          timeInterval: 2000,               // 🚀 Reduced to 2s to align with FFT 2.56s window
          distanceInterval: 0,              // 🚀 Force constant updates even if stationary
          // 🚨 NO DEFERRAL: expo-location buffers fixes in memory and only flushes them to the
          // task once the batch spans deferredUpdatesInterval. In the background that buffer is
          // lost whenever iOS suspends/terminates the app — which is exactly the screen-off drive
          // blackout we saw (logs 26 & 27). With deferral off, every fix iOS delivers is processed
          // immediately, so a brief background wakeup is captured before the app can be killed.
          deferredUpdatesInterval: 0,
          showsBackgroundLocationIndicator: true,
          // 🚨 iOS: never let the OS pause updates when it thinks we're "unlikely to move".
          // This is what kept the engine silent on the bus (28-min update gap with screen off).
          pausesUpdatesAutomatically: false,
          // Navigation-grade continuous tracking across both driving and walking legs.
          activityType: Location.ActivityType.OtherNavigation,
          foregroundService: {
            notificationTitle: 'Parksphere',
            notificationBody: 'Detecting parking activity',
          },
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
    await stopParkGeofence(); // tear down the return geofence when detection is fully stopped
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
  resetAIBuffer();
  
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
    await withTimeout(AsyncStorage.removeItem('parkedLocation'), 2000, 'resetParkDetection.removeParkedLoc');
    await stopParkGeofence(); // clear the return geofence on full reset
    console.log('[ParkDetection] Persisted state and parkedLocation cleared from AsyncStorage.');
    
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

    notify('Park detection engine reset.', { clearParkedLocation: true });
  } catch (e) {
    console.error('[ParkDetection] Failed to clear persisted state:', e.message);
    notify('Error resetting park detection engine.');
  }
};
