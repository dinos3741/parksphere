import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Accelerometer, Pedometer } from 'expo-sensors';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
// Import the modified processLocationHMM which now returns belief
import { initMotionTracking, processLocationHMM, resetHMM, getHMMStatus } from './parkDetection_HMM';

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';
let isInitialized = false;

// Sensor data cache
let currentAcceleration = 0;
let currentStepRate = 0;
let accelSubscription = null;
let pedoSubscription = null;

// ---------------- HELPERS ----------------
async function declareSpot(location) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const userId = await AsyncStorage.getItem('userId');
    // Use a more robust way to get server IP, e.g., from config or env
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;

    if (!token || !userId) {
      console.warn('[ParkDetection] User token or ID missing, cannot declare spot.');
      return;
    }

    const response = await fetch(`${serverUrl}/api/declare-spot`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        userId: parseInt(userId, 10),
        latitude: location.latitude,
        longitude: location.longitude,
        timeToLeave: 60, // Defaulting to 60 minutes
        costType: 'free', // Defaulting to free
        price: 0,
        declaredCarType: 'sedan', // Defaulting car type
        comments: 'Auto-detected parking spot (HMM)',
        isAutoDetected: true,
      }),
    });

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
    console.error('[ParkDetection] Error declaring spot:', error);
    notify('Error declaring parking spot.');
  }
}

async function updateSpotStatus(spotId, status) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP || 'localhost'}:3001`;
    if (!token || !spotId) {
      console.warn('[ParkDetection] Token or spotId missing, cannot update spot status.');
      return;
    }

    await fetch(`${serverUrl}/api/parkingspots/${spotId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
    console.log(`[ParkDetection] Updated spot ${spotId} status to: ${status}`);
  } catch (error) {
    console.error(`[ParkDetection] Failed to update spot ${spotId} status to ${status}:`, error);
    notify(`Error updating spot status for ${spotId}.`);
  }
}

function notify(message) {
  console.log(`[ParkDetection] ${message}`);
  DeviceEventEmitter.emit('parkDetectionUpdate', { message });
}

// ---------------- CORE ENGINE (HMM) ----------------
export async function handleLocationUpdate(arg1, arg2) {
  if (!isInitialized) {
    console.log('[ParkDetection] System not initialized yet, skipping location update.');
    return arg2 ? arg1 : {}; // Return existing stateData if called internally
  }

  let stateData, location;
  let isInternal = false;

  if (arg2) { // Called internally with state and location
    stateData = arg1;
    location = arg2;
    isInternal = true;
  } else { // Called externally (e.g., from TaskManager)
    location = arg1;
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      stateData = saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error('[ParkDetection] Failed to load state from storage:', e);
      stateData = {}; // Reset to default if loading fails
    }
  }

  const prevState = stateData.state || 'IDLE';
  const currentLoc = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };

  // Calculate supplemental metrics for HMM
  const now = Date.now();
  const speed = (location.coords.speed || 0) * 3.6; // km/h
  
  // 1. Heading Change
  const currentHeading = location.coords.heading || 0;
  let headingChange = 0;
  if (stateData.lastHeading !== undefined) {
    let diff = Math.abs(currentHeading - stateData.lastHeading);
    headingChange = diff > 180 ? 360 - diff : diff;
  }
  stateData.lastHeading = currentHeading;

  // 2. Stop Duration
  if (speed < 1.0) { // threshold for stopping
    if (!stateData.stopStartTime) stateData.stopStartTime = now;
    stateData.stopDuration = (now - stateData.stopStartTime) / 1000; // seconds
  } else {
    stateData.stopStartTime = null;
    stateData.stopDuration = 0;
  }

  // 3. Acceleration and Steps (from sensor cache)
  const acceleration = currentAcceleration;
  const stepRate = currentStepRate;

  // Run HMM Inference
  const hmmResult = await processLocationHMM(location, stateData.parkedLocation, {
    acceleration_magnitude: acceleration,
    step_rate: stepRate,
    heading_change: headingChange,
    stop_duration: stateData.stopDuration,
    lastDistanceToCar: stateData.lastDistanceToCar
  });

  const {
    state: hmmState,
    bestState,
    confidence,
    secondBestState,
    secondConfidence,
    belief: currentBelief,
    distToParked
  } = hmmResult;

  stateData.lastDistanceToCar = distToParked;
  const isFirstUpdate = !stateData.lastUpdate;
  stateData.lastUpdate = now;
  stateData.state = hmmState;
  stateData.belief = currentBelief;

  // Handle side effects of state transitions
  if (stateData.state !== prevState || isFirstUpdate) {
    const messages = {
      'DRIVING': '🚗 Driving detected...',
      'WALKING': '🚶 Walking detected...',
      'STOPPED': '⏱️ Vehicle stopped...',
      'PARKED': '🅿️ Parking confirmed!',
      'WALKING_AWAY': '🚶 Walking away from vehicle...',
      'AWAY': '📍 You are away from the vehicle.',
      'RETURNING': '📍 Approaching vehicle...',
      'IN_CAR': '🚗 Back in car...',
      'IDLE': '💤 System Idle.'
    };

    let debugInfo = `\n(Top: ${bestState} ${Math.round(confidence*100)}%, 2nd: ${secondBestState} ${Math.round(secondConfidence*100)}%)`;
    notify((messages[stateData.state] || `System State: ${stateData.state}`) + debugInfo);

    // State Machine Side-Effects
    if (stateData.state === 'STOPPED') {
      stateData.stoppedLocation = currentLoc;
      console.log('[ParkDetection] Stopped location recorded:', currentLoc);
    }

    if (stateData.state === 'PARKED') {
      // "Candidate" location - refined while user is stationary
      stateData.parkedLocation = currentLoc; 
      console.log('[ParkDetection] Parked location candidate updated:', currentLoc);
    }

    // THE OFFICIAL CONFIRMATION:
    // Transition from a stationary state to a walking-away state
    const isStationary = (s) => ['PARKED', 'STOPPED', 'IDLE'].includes(s);
    const isWalkingAway = (s) => ['WALKING_AWAY', 'AWAY'].includes(s);

    if (isWalkingAway(stateData.state) && isStationary(prevState) && !stateData.serverSpotId) {
      console.log('[ParkDetection] Official Confirmation: User walked away. Declaring spot...');
      const finalParkedLoc = stateData.parkedLocation || stateData.stoppedLocation || currentLoc;
      stateData.serverSpotId = await declareSpot(finalParkedLoc);
    }

    if (stateData.state === 'RETURNING' && stateData.serverSpotId) {
      await updateSpotStatus(stateData.serverSpotId, 'soon_free');
    }

    if (stateData.state === 'IN_CAR' && stateData.serverSpotId) {
      await updateSpotStatus(stateData.serverSpotId, 'free');
      stateData.serverSpotId = null;
      stateData.parkedLocation = null; // Clear parked location when back in car
      stateData.stoppedLocation = null; // Clear stopped location
      stateData.lastDistanceToCar = null;
    }
  }

  // Also emit a detailed update for UI observers (live dashboard)
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
      stepRate,
      headingChange,
      stopDuration: stateData.stopDuration,
      distToParked
    }
  });

  if (!isInternal) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData));
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage:', e);
    }
  }

  return stateData; // Return the updated stateData object
}

// ---------------- SENSORS ----------------
function startSensors() {
  Accelerometer.setUpdateInterval(1000);
  accelSubscription = Accelerometer.addListener(data => {
    // Magnitude of acceleration: sqrt(x^2 + y^2 + z^2)
    currentAcceleration = Math.sqrt(data.x ** 2 + data.y ** 2 + data.z ** 2);
  });

  Pedometer.isAvailableAsync().then(available => {
    if (available) {
      // Track steps in 5 second windows to get a "rate"
      let lastStepCount = 0;
      let lastTimestamp = Date.now();

      pedoSubscription = Pedometer.watchStepCount(result => {
        const now = Date.now();
        const dt = (now - lastTimestamp) / 1000;

        const deltaSteps = result.steps - lastStepCount;

        currentStepRate = dt > 0 ? deltaSteps / dt : 0;

        lastStepCount = result.steps;
        lastTimestamp = now;
      });
    }
  });
}

function stopSensors() {
  if (accelSubscription) accelSubscription.remove();
  if (pedoSubscription) pedoSubscription.remove();
  accelSubscription = null;
  pedoSubscription = null;
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

  let stateData = {};
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) stateData = JSON.parse(saved);
  } catch (e) {
    console.error('[ParkDetection] Failed to load state from storage in TaskManager:', e);
  }

  for (const loc of data.locations) {
    // Pass the current stateData to handleLocationUpdate for sequential processing
    stateData = await handleLocationUpdate(stateData, loc);
  }

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData));
  } catch (e) {
    console.error('[ParkDetection] Failed to save state to storage in TaskManager:', e);
  }
});

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
    // initMotionTracking(); // Initialize motion tracking
    resetHMM(); // Reset HMM state to IDLE
    startSensors();

    // Clear persistent state on clean start to avoid immediate transitions from stale data
    await AsyncStorage.removeItem(STORAGE_KEY);
    
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

