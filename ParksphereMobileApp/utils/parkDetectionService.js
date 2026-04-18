import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { Pedometer } from 'expo-sensors';

export const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

const STATE = {
  IDLE: 'IDLE',
  WALKING: 'WALKING',
  DRIVING: 'DRIVING',
  POSSIBLE_PARK: 'POSSIBLE_PARK',
  PARKED: 'PARKED',
  POSSIBLE_WALK_AWAY: 'POSSIBLE_WALK_AWAY',
  LEFT_SPOT: 'LEFT_SPOT',
  POSSIBLE_RETURN: 'POSSIBLE_RETURN',
  EXIT_CONFIRMED: 'EXIT_CONFIRMED',
};

const SPEED_THRESHOLD_VEHICLE = 15;
const SPEED_THRESHOLD_IDLE = 3;
const CONFIDENCE_THRESHOLD = 0.8;
const DURATION_PARKED_CONFIRM = 300000;
const DISTANCE_EXIT_CONFIRM = 50;
const DURATION_LOW_SPEED_BEFORE_POSSIBLE_PARK = 30000;
const DISTANCE_NEAR_CAR_WALKING = 10;
const DISTANCE_RETURN_TO_CAR = 20;

class ParkDetectionService {
  constructor() {
    this.currentState = STATE.IDLE;
    this.lastTransitionTime = Date.now();
    this.parkedLocation = null;
    this.currentSpotId = null;
    this.stepsAtParking = 0;
    this.baselineSteps = 0;
    this.liveSteps = 0;
    this.pedometerSubscription = null;
    this.isInitialized = false;
    this.heartbeatInterval = null;
    this.lastLowSpeedTime = 0;
    this.tempLocation = null;

    this.confidence = {
      [STATE.DRIVING]: 0,
      [STATE.PARKED]: 0,
    };

    this.autoDetectionEnabled = false;
    }

    async initialize() {
    if (this.isInitialized) return;

    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      const { status } = await Pedometer.requestPermissionsAsync();

      if (status === 'granted' && isAvailable) {
        this.startStepStreaming();
      }
    } catch (e) {
      console.warn('Pedometer error:', e);
    }

    const savedState = await AsyncStorage.getItem('park_detection_state');
    const isEnabled = await AsyncStorage.getItem('autoDetectionEnabled');
    this.autoDetectionEnabled = isEnabled === 'true';

    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        this.currentState = parsed.state || STATE.IDLE;

        // Safety check: If we think we are PARKED but have no location, reset to IDLE
        if (this.currentState === STATE.PARKED && !parsed.parkedLocation) {
          console.warn('[ParkDetection] Invalid PARKED state detected (no location). Resetting to IDLE.');
          this.currentState = STATE.IDLE;
        }

        this.lastTransitionTime = parsed.timestamp || Date.now();
        this.parkedLocation = parsed.parkedLocation || null;
        this.currentSpotId = parsed.currentSpotId || null;
        this.stepsAtParking = parsed.stepsAtParking || 0;
        this.baselineSteps = parsed.baselineSteps || 0;
        this.confidence = parsed.confidence || this.confidence;
      } catch (e) {}
    }

    this.heartbeatInterval = setInterval(() => this.runTimeBasedChecks(), 10000);
    this.isInitialized = true;
    console.log(`[ParkDetection] Initialized. Current state: ${this.currentState}, Parked location: ${JSON.stringify(this.parkedLocation)}, Spot ID: ${this.currentSpotId}`);

    DeviceEventEmitter.emit('parkDetectionUpdate', { message: 'Idle' });
    }

    startStepStreaming() {
    if (this.pedometerSubscription) this.pedometerSubscription.remove();
    this.pedometerSubscription = Pedometer.watchStepCount(result => {
      this.liveSteps = result.steps;
    });
    }

    async runTimeBasedChecks() {
    if (!this.autoDetectionEnabled) return;

    const now = Date.now();
    const dt = now - this.lastTransitionTime;

    if (this.currentState === STATE.WALKING && dt > 30000) {
      await this.transitionTo(STATE.IDLE);
    }

    if (this.currentState === STATE.POSSIBLE_PARK) {
      this.confidence[STATE.PARKED] = Math.min(1, dt / DURATION_PARKED_CONFIRM);
      if (this.confidence[STATE.PARKED] > CONFIDENCE_THRESHOLD) {
        await this.transitionTo(STATE.PARKED);
      }
    }
    }

    async transitionTo(newState) {
    if (this.currentState === newState) return;

    if (newState === STATE.PARKED) {
      this.stepsAtParking = this.liveSteps;
      if (this.parkedLocation) {
        await this.declareParkingSpot(this.parkedLocation.latitude, this.parkedLocation.longitude);
      }
    }

    if (newState === STATE.IDLE || newState === STATE.WALKING) {
      this.baselineSteps = this.liveSteps;
    }

    this.currentState = newState;
    this.lastTransitionTime = Date.now();

    Object.keys(this.confidence).forEach(k => {
      if (k !== newState) this.confidence[k] = 0;
    });

    await AsyncStorage.setItem('park_detection_state', JSON.stringify({
      state: this.currentState,
      timestamp: this.lastTransitionTime,
      parkedLocation: this.parkedLocation,
      currentSpotId: this.currentSpotId,
      stepsAtParking: this.stepsAtParking,
      baselineSteps: this.baselineSteps,
      confidence: this.confidence,
    }));

    let msg = '';

    if (newState === STATE.IDLE) msg = 'Idle';
    if (newState === STATE.WALKING) msg = 'Walking detected...';
    if (newState === STATE.DRIVING) msg = 'Driving detected...';
    if (newState === STATE.POSSIBLE_PARK) msg = 'Possible parking detected...';
    if (newState === STATE.POSSIBLE_WALK_AWAY) msg = 'Walking away detected...';

    if (newState === STATE.PARKED) {
      msg = 'Parking spot identified!';
      await this.notifyUser('Parking Detected', 'Walk away to confirm.');
    }

    if (newState === STATE.POSSIBLE_RETURN) msg = 'Returning to vehicle...';

    if (newState === STATE.LEFT_SPOT) {
      msg = 'Leaving spot...';
      if (this.currentSpotId) {
        await this.removeParkingSpot();
      }
      this.parkedLocation = null;
      this.currentSpotId = null;
    }

    if (newState === STATE.EXIT_CONFIRMED) {
      msg = 'Spot confirmed!';
      await this.notifyUser('Spot shared', 'Your parking spot is now public.');
    }

    if (msg) {
      DeviceEventEmitter.emit('parkDetectionUpdate', { message: msg });
    }
    }

    async declareParkingSpot(latitude, longitude) {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const userId = await AsyncStorage.getItem('userId');
      const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

      if (!token || !userId) {
        console.warn('[ParkDetection] No token or userId found, cannot declare spot.');
        return;
      }

      console.log(`[ParkDetection] Attempting to declare spot at ${latitude}, ${longitude}`);

      const response = await fetch(`${serverUrl}/api/declare-spot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: parseInt(userId, 10),
          latitude,
          longitude,
          timeToLeave: 60, // Default to 60 minutes for auto-detected spots
          costType: 'free',
          price: 0,
          declaredCarType: 'sedan', // Should ideally come from user profile
          comments: 'Auto-detected parking spot',
        }),
      });

      if (response.ok) {
        const data = await response.json();
        this.currentSpotId = data.spotId;
        console.log('[ParkDetection] Spot declared successfully:', this.currentSpotId);

        // Save state again with currentSpotId
        await AsyncStorage.setItem('park_detection_state', JSON.stringify({
          state: this.currentState,
          timestamp: this.lastTransitionTime,
          parkedLocation: this.parkedLocation,
          currentSpotId: this.currentSpotId,
          stepsAtParking: this.stepsAtParking,
          baselineSteps: this.baselineSteps,
          confidence: this.confidence,
        }));

        // await this.notifyUser('Spot Shared', 'Your parking spot has been automatically shared.');
      } else {
        const errorData = await response.json();
        console.error('[ParkDetection] Failed to declare spot:', response.status, errorData.message);
      }
    } catch (error) {
      console.error('[ParkDetection] Error declaring spot:', error);
    }
    }

    async removeParkingSpot() {
    try {
      const token = await AsyncStorage.getItem('userToken');
      const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

      if (!token || !this.currentSpotId) {
        console.warn('[ParkDetection] No token or spotId found, cannot remove spot.');
        return;
      }

      console.log(`[ParkDetection] Attempting to remove spot ${this.currentSpotId}`);

      const response = await fetch(`${serverUrl}/api/parkingspots/${this.currentSpotId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        console.log('[ParkDetection] Spot removed successfully:', this.currentSpotId);
        this.currentSpotId = null;
      } else {
        console.error('[ParkDetection] Failed to remove spot:', response.status);
      }
    } catch (error) {
      console.error('[ParkDetection] Error removing spot:', error);
    }
    }

    async notifyUser(title, body) {    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
    }

    async handleLocationUpdate(location) {
    if (!this.isInitialized) await this.initialize();
    if (!this.autoDetectionEnabled) return;

    const { speed, latitude, longitude } = location.coords;
    const speedKmH = (speed || 0) * 3.6;

    if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
      this.confidence[STATE.DRIVING] = Math.min(1, this.confidence[STATE.DRIVING] + 0.2);
    } else {
      this.confidence[STATE.DRIVING] = Math.max(0, this.confidence[STATE.DRIVING] - 0.1);
    }

    let steps = this.liveSteps - this.baselineSteps;
    // If the baseline from storage is higher than current live steps, the pedometer likely reset.
    // Reset baseline to current live steps to normalize.
    if (steps < 0 && this.baselineSteps > 0) {
      this.baselineSteps = this.liveSteps;
      steps = 0;
    }

    switch (this.currentState) {
      case STATE.IDLE:
        if (steps > 3) {
            await this.transitionTo(STATE.WALKING);
        }
        else if (this.confidence[STATE.DRIVING] > CONFIDENCE_THRESHOLD)
          await this.transitionTo(STATE.DRIVING);
        break;

      case STATE.WALKING:
        if (speedKmH > SPEED_THRESHOLD_VEHICLE)
          await this.transitionTo(STATE.DRIVING);
        break;

      case STATE.DRIVING:
        if (speedKmH < SPEED_THRESHOLD_IDLE) {
          if (this.lastLowSpeedTime === 0) {
            this.lastLowSpeedTime = Date.now();
            this.tempLocation = { latitude, longitude };
          } else if ((Date.now() - this.lastLowSpeedTime) > DURATION_LOW_SPEED_BEFORE_POSSIBLE_PARK) {
            this.parkedLocation = this.tempLocation;
            await this.transitionTo(STATE.POSSIBLE_PARK);
            this.lastLowSpeedTime = 0; // Reset after transition
          }
        } else {
          this.lastLowSpeedTime = 0; // Reset if speed increases
        }
        break;

      case STATE.PARKED:
        if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
          await this.transitionTo(STATE.LEFT_SPOT);
        } else if (this.parkedLocation) {
          const d = this.getDistance(
            latitude,
            longitude,
            this.parkedLocation.latitude,
            this.parkedLocation.longitude
          );
          const stepsAway = this.liveSteps - this.stepsAtParking;

          if (stepsAway > 5 && d < DISTANCE_NEAR_CAR_WALKING) {
            await this.transitionTo(STATE.POSSIBLE_WALK_AWAY);
          } else if (d > DISTANCE_EXIT_CONFIRM && stepsAway > 15) {
            await this.transitionTo(STATE.EXIT_CONFIRMED);
          }
        }
        break;

      case STATE.POSSIBLE_WALK_AWAY:
        if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
          await this.transitionTo(STATE.LEFT_SPOT);
        } else if (this.parkedLocation) {
          const d = this.getDistance(
            latitude,
            longitude,
            this.parkedLocation.latitude,
            this.parkedLocation.longitude
          );
          const stepsAway = this.liveSteps - this.stepsAtParking;

          if (d > DISTANCE_EXIT_CONFIRM && stepsAway > 15) {
            await this.transitionTo(STATE.EXIT_CONFIRMED);
          } else if (stepsAway < 5 && d < DISTANCE_NEAR_CAR_WALKING) { // User came back or stopped walking
            await this.transitionTo(STATE.PARKED);
          }
        }
        break;

      case STATE.EXIT_CONFIRMED:
        if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
          await this.transitionTo(STATE.LEFT_SPOT);
        } else if (this.parkedLocation) {
          const d = this.getDistance(
            latitude,
            longitude,
            this.parkedLocation.latitude,
            this.parkedLocation.longitude
          );
          if (d < DISTANCE_RETURN_TO_CAR && speedKmH < SPEED_THRESHOLD_IDLE) {
            await this.transitionTo(STATE.POSSIBLE_RETURN);
          }
        }
        break;

      case STATE.LEFT_SPOT: // Also check if returned to car after leaving spot
        if (this.parkedLocation) {
          const d = this.getDistance(
            latitude,
            longitude,
            this.parkedLocation.latitude,
            this.parkedLocation.longitude
          );
          if (d < DISTANCE_RETURN_TO_CAR && speedKmH < SPEED_THRESHOLD_IDLE) {
            await this.transitionTo(STATE.POSSIBLE_RETURN);
          } else if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
            await this.transitionTo(STATE.IN_VEHICLE);
          }
        } else if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
          await this.transitionTo(STATE.IN_VEHICLE);
        }
        break;

      case STATE.POSSIBLE_RETURN:
        if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
          await this.transitionTo(STATE.IN_VEHICLE);
        } else if (this.parkedLocation) {
          const d = this.getDistance(
            latitude,
            longitude,
            this.parkedLocation.latitude,
            this.parkedLocation.longitude
          );
          if (d > DISTANCE_RETURN_TO_CAR) {
            // User moved away again after possibly returning
            // We transition to IDLE as the spot is already considered left.
            await this.transitionTo(STATE.IDLE);
          }
        }
        break;
    }
  }

  getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3;
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a =
      Math.sin(Δφ/2) ** 2 +
      Math.cos(φ1) * Math.cos(φ2) *
      Math.sin(Δλ/2) ** 2;

    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
  }
}

const detectionService = new ParkDetectionService();

export const handleLocationUpdate = async (location) => {
  await detectionService.handleLocationUpdate(location);
};

TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data }) => {
  if (!data) return;

  for (const location of data.locations) {
    await detectionService.handleLocationUpdate(location);
  }
});

export const startParkDetection = async () => {
  await detectionService.initialize();
  detectionService.autoDetectionEnabled = true;

  await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
    accuracy: Location.Accuracy.BestForNavigation,
    timeInterval: 2000,
    deferredUpdatesInterval: 2000,
    foregroundService: {
      notificationTitle: 'Auto Detection',
      notificationBody: 'Monitoring parking...',
    },
  });
};

export const stopParkDetection = async () => {
  detectionService.autoDetectionEnabled = false;

  if (await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK)) {
    await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
  }
};
