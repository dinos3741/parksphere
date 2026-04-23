import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
// Import the modified processLocationHMM which now returns belief
import { initMotionTracking, processLocationHMM, resetHMM } from './parkDetection_HMM';

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';

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

  // Run HMM Inference
  // processLocationHMM now returns { state: newState, bestState, confidence, belief: newBelief }
  const { state: hmmState, bestState, confidence, belief: currentBelief } = await processLocationHMM(location, stateData.parkedLocation);

  // Update stateData with results from HMM
  stateData.state = hmmState;
  stateData.belief = currentBelief; // Store the belief distribution for potential future use or inspection

  // Handle side effects of state transitions
  if (stateData.state !== prevState) {    const messages = {
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
    notify(messages[stateData.state] || `System State: ${stateData.state}`);

    // State Machine Side-Effects
    if (stateData.state === 'PARKED') {
      stateData.parkedLocation = currentLoc; // Update parked location
      console.log('[ParkDetection] Parked location recorded:', currentLoc);
    }

    if (stateData.state === 'WALKING_AWAY' && !stateData.serverSpotId) {
      // Use parkedLocation from stateData which might have been updated in the PARKED state
      stateData.serverSpotId = await declareSpot(stateData.parkedLocation || currentLoc);
    }

    if (stateData.state === 'RETURNING' && stateData.serverSpotId) {
      await updateSpotStatus(stateData.serverSpotId, 'soon_free');
    }

    if (stateData.state === 'IN_CAR' && stateData.serverSpotId) {
      await updateSpotStatus(stateData.serverSpotId, 'free');
      stateData.serverSpotId = null;
      stateData.parkedLocation = null; // Clear parked location when back in car
    }
  }

  if (!isInternal) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(stateData));
    } catch (e) {
      console.error('[ParkDetection] Failed to save state to storage:', e);
    }
  }

  return stateData; // Return the updated stateData object
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
  console.log('[ParkDetection] Attempting to start park detection...');
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    notify('Foreground location permission denied.');
    return false;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    notify('Background location permission denied.');
    // Depending on requirements, might return false here or proceed with foreground only
  }

  initMotionTracking(); // Initialize motion tracking
  resetHMM(); // Reset HMM state to IDLE

  const { currentState } = getHMMStatus();

  const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (!started) {
    await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
      accuracy: Location.Accuracy.Balanced, // Consider Balanced for battery efficiency vs High for precision
      timeInterval: 5000, // Update every 5 seconds
      deferredUpdatesInterval: 5000, // Deliver deferred updates every 5 seconds
      showsBackgroundLocationIndicator: true,
    });
    notify(`Background HMM detection started. State: ${currentState}`);
    console.log('[ParkDetection] Location updates started for PARK_DETECTION_TASK.');
    return true;
  } else {
    console.log('[ParkDetection] PARK_DETECTION_TASK is already running.');
    return false;
  }
};

export const stopParkDetection = async () => {
  const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
    notify('Background HMM detection stopped.');
    console.log('[ParkDetection] Location updates stopped for PARK_DETECTION_TASK.');
  }
};
