import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { initMotionTracking, processLocationHMM } from './parkDetection_HMM';

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';

// ---------------- HELPERS ----------------
async function declareSpot(location) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const userId = await AsyncStorage.getItem('userId');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

    if (!token || !userId) return;

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
        timeToLeave: 60,
        costType: 'free',
        price: 0,
        declaredCarType: 'sedan',
        comments: 'Auto-detected parking spot (HMM)',
      }),
    });

    if (response.ok) {
      const data = await response.json();
      notify('Spot successfully registered in the system!');
      return data.spotId;
    }
  } catch (error) {
    console.error('[ParkDetection] Failed to declare spot:', error);
  }
}

async function updateSpotStatus(spotId, status) {
  try {
    const token = await AsyncStorage.getItem('userToken');
    const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;
    if (!token || !spotId) return;

    await fetch(`${serverUrl}/api/parkingspots/${spotId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ status }),
    });
  } catch (error) {
    console.error('[ParkDetection] Failed to update spot status:', error);
  }
}

function notify(message) {
  console.log(`[ParkDetection] ${message}`);
  DeviceEventEmitter.emit('parkDetectionUpdate', { message });
}

// ---------------- CORE ENGINE (HMM) ----------------
export async function handleLocationUpdate(arg1, arg2) {
  let state, location;
  let isInternal = false;

  if (arg2) {
    state = arg1;
    location = arg2;
    isInternal = true;
  } else {
    location = arg1;
    try {
      const saved = await AsyncStorage.getItem(STORAGE_KEY);
      state = saved ? JSON.parse(saved) : {};
    } catch {
      state = {};
    }
  }

  const prevState = state.state || 'IDLE';
  const currentLoc = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };

  // Run HMM Inference
  const { state: hmmState } = await processLocationHMM(location, state.parkedLocation);
  state.state = hmmState;

  // Handle side effects of state transitions
  if (state.state !== prevState) {
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
    notify(messages[state.state] || `System State: ${state.state}`);

    // State Machine Side-Effects
    if (state.state === 'PARKED') {
      state.parkedLocation = currentLoc;
    }

    if (state.state === 'WALKING_AWAY' && !state.serverSpotId) {
      state.serverSpotId = await declareSpot(state.parkedLocation || currentLoc);
    }

    if (state.state === 'RETURNING' && state.serverSpotId) {
      await updateSpotStatus(state.serverSpotId, 'soon_free');
    }

    if (state.state === 'IN_CAR' && state.serverSpotId) {
      await updateSpotStatus(state.serverSpotId, 'free');
      state.serverSpotId = null;
      state.parkedLocation = null;
    }
  }

  if (!isInternal) {
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }

  return state;
}

// ---------------- TASK ----------------
TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data, error }) => {
  if (error || !data) return;

  let state = {};
  try {
    const saved = await AsyncStorage.getItem(STORAGE_KEY);
    if (saved) state = JSON.parse(saved);
  } catch {}

  for (const loc of data.locations) {
    state = await handleLocationUpdate(state, loc);
  }

  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
});

// ---------------- START/STOP ----------------
export const startParkDetection = async () => {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    notify('Foreground location permission denied.');
    return;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    notify('Background location permission denied.');
  }

  initMotionTracking();
  resetHMM();

  const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (!started) {
    await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      deferredUpdatesInterval: 5000,
      showsBackgroundLocationIndicator: true,
    });
    notify('Background HMM detection started.');
  } else {
    notify('Detection service is already running.');
  }
};

export const stopParkDetection = async () => {
  const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (started) {
    await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
    notify('Background HMM detection stopped.');
  }
};
