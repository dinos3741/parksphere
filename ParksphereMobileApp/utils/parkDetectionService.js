import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import { DeviceEventEmitter } from 'react-native';

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

// ---------------- CONSTANTS ----------------
const STORAGE_KEY = 'PARK_STATE';

const SPEED_DRIVING = 15;
const SPEED_ZERO = 0.5;

const T_DRIVING_CONFIRM = 60000;
const T_STOP_CONFIRM = 30000;
const T_PARK_CONFIRM = 120000;

const DIST_STABLE = 10;
const DIST_LEFT = 30;
const DIST_RETURN_TRIGGER = 50; // Increased to 50m for earlier broadcast
const DIST_RETURN_CONFIRM = 15;

// ---------------- HELPERS ----------------
function getBearing(start, end) {
  const startLat = start.latitude * Math.PI / 180;
  const startLon = start.longitude * Math.PI / 180;
  const endLat = end.latitude * Math.PI / 180;
  const endLon = end.longitude * Math.PI / 180;

  const y = Math.sin(endLon - startLon) * Math.cos(endLat);
  const x = Math.cos(startLat) * Math.sin(endLat) -
            Math.sin(startLat) * Math.cos(endLat) * Math.cos(endLon - startLon);
  const bearing = Math.atan2(y, x) * 180 / Math.PI;
  return (bearing + 360) % 360;
}

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
        comments: 'Auto-detected parking spot',
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

function getDistance(a, b) {
  if (!a || !b) return Infinity;

  const R = 6371e3;
  const φ1 = a.latitude * Math.PI / 180;
  const φ2 = b.latitude * Math.PI / 180;
  const Δφ = (b.latitude - a.latitude) * Math.PI / 180;
  const Δλ = (b.longitude - a.longitude) * Math.PI / 180;

  const x =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;

  return R * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

function average(points) {
  const lat = points.reduce((s, p) => s + p.latitude, 0) / points.length;
  const lon = points.reduce((s, p) => s + p.longitude, 0) / points.length;
  return { latitude: lat, longitude: lon };
}

function notify(message) {
  console.log(`[ParkDetection] ${message}`);
  DeviceEventEmitter.emit('parkDetectionUpdate', { message });
}

// ---------------- CORE ENGINE ----------------
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

  const now = Date.now();
  const dt = now - (state.lastUpdate || now);
  const isFirstUpdate = !state.lastUpdate;
  state.lastUpdate = now;

  const speed = (location.coords.speed || 0) * 3.6;

  const currentLoc = {
    latitude: location.coords.latitude,
    longitude: location.coords.longitude,
  };

  // fallback walking detection (pedometer unreliable in background)
  const walking = speed > 1 && speed < 6;
  const idle = speed <= 1;

  const prevState = state.state || 'IDLE';
  state.state = prevState;

  if (isFirstUpdate) {
    notify(`Service active. Initial state: ${state.state}`);
  }

  switch (state.state) {
    case 'IDLE':
      if (speed > SPEED_DRIVING) {
        state.drivingTime = (state.drivingTime || 0) + dt;
        if (state.drivingTime > T_DRIVING_CONFIRM) {
          state.state = 'DRIVING';
        }
      } else if (walking) {
        state.state = 'WALKING';
      }
      break;

    case 'WALKING':
      if (speed > SPEED_DRIVING) {
        state.state = 'DRIVING';
      } else if (idle) {
        state.state = 'IDLE';
      }
      break;

    case 'DRIVING':
      if (speed <= SPEED_ZERO) {
        state.stopTime = (state.stopTime || 0) + dt;

        if (state.stopTime > T_STOP_CONFIRM) {
          state.stopLocations = [currentLoc];
          state.maxDistance = 0;
          state.parkTime = 0;
          state.state = 'POSSIBLE_PARK';
        }
      } else {
        state.stopTime = 0;
      }
      break;

    case 'POSSIBLE_PARK': {
      const base = state.stopLocations[0];
      const dist = getDistance(base, currentLoc);

      state.maxDistance = Math.max(state.maxDistance || 0, dist);

      // The condition is valid if the user is walking or idle, 
      // even if speed is slightly higher than 'ZERO' because they are now on foot.
      const valid = (walking || idle || speed <= SPEED_ZERO) && state.maxDistance < DIST_STABLE;

      if (valid) {
        state.parkTime = (state.parkTime || 0) + dt;
        state.stopLocations.push(currentLoc);

        if (state.parkTime > T_PARK_CONFIRM) {
          state.parkedLocation = average(state.stopLocations);
          state.state = 'PARKED';
          state.hasLeftArea = false;
        }
      } else {
        // If they speed up too much or move too far before 2 minutes, it wasn't a park
        state.state = 'DRIVING';
        state.stopLocations = [];
      }
      break;
    }

    case 'PARKED': {
      const d = getDistance(state.parkedLocation, currentLoc);
      if (speed > SPEED_DRIVING) {
        state.state = 'IDLE';
        state.parkedLocation = null;
        notify('Parking spot vacated. Driving detected.');
      } else if (d > DIST_LEFT && walking) {
        state.state = 'LEFT_AREA';
        state.hasLeftArea = true;
        // Declare the spot to the database when the user walks away
        state.serverSpotId = await declareSpot(state.parkedLocation);
      }
      break;
    }

    case 'LEFT_AREA': {
      const d = getDistance(state.parkedLocation, currentLoc);
      
      if (speed > SPEED_DRIVING) {
        state.state = 'EXIT_CONFIRMED';
        if (state.serverSpotId) {
          await updateSpotStatus(state.serverSpotId, 'free');
        }
      } else if (d < DIST_RETURN_TRIGGER && (walking || idle)) {
        // VECTOR ANALYSIS: Is the user moving TOWARDS the car?
        let isHeadingToCar = false;
        
        const bearingToCar = getBearing(currentLoc, state.parkedLocation);
        const userHeading = location.coords.heading; // 0-360 degrees

        if (userHeading !== null && userHeading !== undefined && userHeading >= 0) {
          const diff = Math.abs(userHeading - bearingToCar);
          const angle = diff > 180 ? 360 - diff : diff;
          if (angle < 45) isHeadingToCar = true; // Heading within 45 degrees of car
        } else if (state.prevLoc) {
          // Fallback: calculate heading from movement vector
          const actualHeading = getBearing(state.prevLoc, currentLoc);
          const diff = Math.abs(actualHeading - bearingToCar);
          const angle = diff > 180 ? 360 - diff : diff;
          // Use a tighter angle for movement vector to be sure
          if (angle < 40 && getDistance(state.prevLoc, currentLoc) > 2) isHeadingToCar = true;
        }

        // Trigger if heading to car OR if very close (15m fallback)
        if (isHeadingToCar || d < 15) {
          state.state = 'POSSIBLE_RETURN';
          if (state.serverSpotId) {
            await updateSpotStatus(state.serverSpotId, 'soon_free');
          }
          notify('Approaching vehicle detected via vector analysis.');
        }
      }
      break;
    }

    case 'POSSIBLE_RETURN': {
      const d = getDistance(state.parkedLocation, currentLoc);
      
      if (speed > SPEED_DRIVING) {
        state.state = 'EXIT_CONFIRMED';
        if (state.serverSpotId) {
          await updateSpotStatus(state.serverSpotId, 'free');
        }
      } else if (d > DIST_RETURN_TRIGGER) {
        // User walked away again
        state.state = 'LEFT_AREA';
        if (state.serverSpotId) {
          await updateSpotStatus(state.serverSpotId, 'occupied');
        }
      }
      break;
    }

    case 'EXIT_CONFIRMED':
      if (speed <= SPEED_ZERO) {
        state.state = 'IDLE';
        state.parkedLocation = null;
        state.serverSpotId = null;
      }
      break;
  }

  if (state.state !== prevState) {
    const messages = {
      'DRIVING': '🚗 Driving detected...',
      'WALKING': '🚶 Walking detected...',
      'POSSIBLE_PARK': '⏱️ Vehicle stopped. Monitoring...',
      'PARKED': '🅿️ Parking confirmed!',
      'LEFT_AREA': '🚶 You have left the vehicle.',
      'POSSIBLE_RETURN': '📍 Approaching vehicle...',
      'EXIT_CONFIRMED': '🛫 Leaving parking spot...',
      'IDLE': '💤 System Idle.'
    };
    notify(messages[state.state] || `System State: ${state.state}`);
  }

  state.prevLoc = currentLoc;

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

// ---------------- START ----------------
export const startParkDetection = async () => {
  const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
  if (fgStatus !== 'granted') {
    notify('Foreground location permission denied.');
    return;
  }

  const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
  if (bgStatus !== 'granted') {
    notify('Background location permission denied. Auto-detection may be limited.');
  }

  const started = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (!started) {
    await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 5000,
      deferredUpdatesInterval: 5000,
      showsBackgroundLocationIndicator: true,
    });
    notify('Background detection started.');
  } else {
    notify('Detection service is already running.');
  }
};

// ---------------- STOP ----------------
export const stopParkDetection = async () => {
  const started = await Location.hasStartedLocationUpdatesAsync(
    PARK_DETECTION_TASK
  );

  if (started) {
    await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
  }
};
