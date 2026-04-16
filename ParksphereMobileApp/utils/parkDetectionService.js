import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';

const PARK_DETECTION_TASK = 'PARK_DETECTION_TASK';

const STATE = {
  IDLE: 'IDLE',
  IN_VEHICLE: 'IN_VEHICLE',
  POSSIBLE_PARK: 'POSSIBLE_PARK',
  PARKED: 'PARKED',
  EXIT_CONFIRMED: 'EXIT_CONFIRMED',
};

// Configuration constants
const SPEED_THRESHOLD_VEHICLE = 15; // km/h
const SPEED_THRESHOLD_IDLE = 3;    // km/h
const CONFIDENCE_THRESHOLD = 0.8;  // Probability to trigger transition
const DURATION_PARKED_CONFIRM = 300000; // 5 minutes in ms
const DISTANCE_EXIT_CONFIRM = 50; // meters

class ParkDetectionService {
  constructor() {
    this.currentState = STATE.IDLE;
    this.lastTransitionTime = Date.now();
    this.parkedLocation = null;
    
    // Probabilistic scores (0.0 to 1.0)
    this.confidence = {
      [STATE.IN_VEHICLE]: 0,
      [STATE.PARKED]: 0,
    };
  }

  async initialize() {
    const savedState = await AsyncStorage.getItem('park_detection_state');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        this.currentState = parsed.state || STATE.IDLE;
        this.lastTransitionTime = parsed.timestamp || Date.now();
        this.parkedLocation = parsed.parkedLocation || null;
        this.confidence = parsed.confidence || { [STATE.IN_VEHICLE]: 0, [STATE.PARKED]: 0 };
      } catch (e) {
        console.error('[ParkDetection] Failed to parse saved state', e);
      }
    }
  }

  async saveState() {
    await AsyncStorage.setItem('park_detection_state', JSON.stringify({
      state: this.currentState,
      timestamp: this.lastTransitionTime,
      parkedLocation: this.parkedLocation,
      confidence: this.confidence,
    }));
  }

  async transitionTo(newState) {
    if (this.currentState === newState) return;

    console.log(`[ParkDetection] Transition: ${this.currentState} -> ${newState} (Confidence: ${this.confidence[newState] || 1.0})`);
    this.currentState = newState;
    this.lastTransitionTime = Date.now();
    
    // Reset other confidences upon transition
    Object.keys(this.confidence).forEach(key => {
      if (key !== newState) this.confidence[key] = 0;
    });

    await this.saveState();

    let uiMessage = '';
    if (newState === STATE.IN_VEHICLE) uiMessage = 'Driving detected...';
    if (newState === STATE.POSSIBLE_PARK) uiMessage = 'Possible parking detected. Waiting to confirm...';
    if (newState === STATE.PARKED) {
      uiMessage = 'Parking spot identified! Walk away to confirm.';
      await this.notifyUser('Potential Parking Detected', 'We think you just parked. Walk away to confirm and share!');
    } else if (newState === STATE.EXIT_CONFIRMED) {
      uiMessage = 'Parking spot confirmed and shared!';
      await this.notifyUser('Parking Spot Confirmed!', 'Your spot is now visible to others in the network.');
      this.currentState = STATE.IDLE;
      this.parkedLocation = null;
      await this.saveState();
    }

    if (uiMessage) {
      DeviceEventEmitter.emit('parkDetectionUpdate', { message: uiMessage });
    }
  }

  async notifyUser(title, body) {
    await Notifications.scheduleNotificationAsync({
      content: { title, body, sound: true },
      trigger: null,
    });
  }

  async handleLocationUpdate(location) {
    const { speed, latitude, longitude } = location.coords;
    const speedKmH = (speed || 0) * 3.6;
    const now = Date.now();

    // Signal: Update In-Vehicle Confidence
    if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
      this.confidence[STATE.IN_VEHICLE] = Math.min(1, this.confidence[STATE.IN_VEHICLE] + 0.2);
    } else if (speedKmH < SPEED_THRESHOLD_IDLE) {
      this.confidence[STATE.IN_VEHICLE] = Math.max(0, this.confidence[STATE.IN_VEHICLE] - 0.1);
    }

    console.log(`[ParkDetection] State: ${this.currentState} | Speed: ${speedKmH.toFixed(1)} km/h | Conf[VEHICLE]: ${this.confidence[STATE.IN_VEHICLE].toFixed(2)} | Conf[PARKED]: ${this.confidence[STATE.PARKED].toFixed(2)}`);

    switch (this.currentState) {
      case STATE.IDLE:
        if (this.confidence[STATE.IN_VEHICLE] > CONFIDENCE_THRESHOLD) {
          await this.transitionTo(STATE.IN_VEHICLE);
        }
        break;

      case STATE.IN_VEHICLE:
        if (speedKmH < SPEED_THRESHOLD_IDLE) {
          await this.transitionTo(STATE.POSSIBLE_PARK);
        }
        break;

      case STATE.POSSIBLE_PARK:
        if (this.confidence[STATE.IN_VEHICLE] > CONFIDENCE_THRESHOLD) {
          await this.transitionTo(STATE.IN_VEHICLE); // False stop (traffic light)
        } else {
          // Increase PARKED confidence over time while stationary
          const timeStationary = now - this.lastTransitionTime;
          this.confidence[STATE.PARKED] = Math.min(1, timeStationary / DURATION_PARKED_CONFIRM);
          
          if (this.confidence[STATE.PARKED] > CONFIDENCE_THRESHOLD) {
            this.parkedLocation = { latitude, longitude };
            await this.transitionTo(STATE.PARKED);
          }
        }
        break;

      case STATE.PARKED:
        if (this.confidence[STATE.IN_VEHICLE] > CONFIDENCE_THRESHOLD) {
          await this.transitionTo(STATE.IN_VEHICLE); // Drove away
          this.parkedLocation = null;
        } else if (this.parkedLocation) {
          const distance = this.getDistance(
            latitude, longitude,
            this.parkedLocation.latitude, this.parkedLocation.longitude
          );
          
          // Signal: Distance from parked spot
          // If we move away without high speed, it's likely walking (EXIT_CONFIRMED)
          if (distance > DISTANCE_EXIT_CONFIRM && speedKmH < 10) {
            await this.transitionTo(STATE.EXIT_CONFIRMED);
          }
        }
        break;
    }
    
    await this.saveState();
  }

  getDistance(lat1, lon1, lat2, lon2) {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180;
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }
}

const detectionService = new ParkDetectionService();

TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data, error }) => {
  if (error) {
    console.error('[ParkDetection] Task error:', error);
    return;
  }
  if (data) {
    const { locations } = data;
    for (const location of locations) {
      await detectionService.handleLocationUpdate(location);
    }
  }
});

export const startParkDetection = async () => {
  const { status } = await Location.requestBackgroundPermissionsAsync();
  if (status !== 'granted') {
    console.error('[ParkDetection] Background location permission denied');
    return;
  }

  await detectionService.initialize();
  
  await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    deferredUpdatesInterval: 5000,
    foregroundService: {
      notificationTitle: 'Parksphere Auto-Detection',
      notificationBody: 'Monitoring for parking activity...',
    },
  });
};

export const stopParkDetection = async () => {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (hasStarted) {
    await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
  }
};
