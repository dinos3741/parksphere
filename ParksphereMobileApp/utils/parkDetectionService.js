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
  IN_VEHICLE: 'IN_VEHICLE',
  POSSIBLE_PARK: 'POSSIBLE_PARK',
  PARKED: 'PARKED',
  EXIT_CONFIRMED: 'EXIT_CONFIRMED',
};

const SPEED_THRESHOLD_VEHICLE = 15;
const SPEED_THRESHOLD_IDLE = 3;
const CONFIDENCE_THRESHOLD = 0.8;
const DURATION_PARKED_CONFIRM = 300000;
const DISTANCE_EXIT_CONFIRM = 50;

class ParkDetectionService {
  constructor() {
    this.currentState = STATE.IDLE;
    this.lastTransitionTime = Date.now();
    this.parkedLocation = null;
    this.stepsAtParking = 0;
    this.baselineSteps = 0;
    this.liveSteps = 0;
    this.pedometerSubscription = null;
    this.isInitialized = false;
    this.heartbeatInterval = null;
    
    this.confidence = {
      [STATE.IN_VEHICLE]: 0,
      [STATE.PARKED]: 0,
    };
  }

  async initialize() {
    if (this.isInitialized) return;
    
    console.log('[ParkDetection] Initializing Service...');
    
    try {
      const isAvailable = await Pedometer.isAvailableAsync();
      console.log(`[ParkDetection] Pedometer available: ${isAvailable}`);
      
      const { status } = await Pedometer.requestPermissionsAsync();
      console.log(`[ParkDetection] Pedometer permission: ${status}`);
      
      if (status === 'granted' && isAvailable) {
        this.startStepStreaming();
      }
    } catch (e) {
      console.warn('[ParkDetection] Pedometer Init Error:', e);
    }

    const savedState = await AsyncStorage.getItem('park_detection_state');
    if (savedState) {
      try {
        const parsed = JSON.parse(savedState);
        this.currentState = parsed.state || STATE.IDLE;
        this.lastTransitionTime = parsed.timestamp || Date.now();
        this.parkedLocation = parsed.parkedLocation || null;
        this.stepsAtParking = parsed.stepsAtParking || 0;
        this.baselineSteps = parsed.baselineSteps || 0;
        this.confidence = parsed.confidence || { [STATE.IN_VEHICLE]: 0, [STATE.PARKED]: 0 };
      } catch (e) {
        console.error('[ParkDetection] State Parse Error:', e);
      }
    }
    
    // Start heartbeat for time-based checks when stationary
    if (this.heartbeatInterval) clearInterval(this.heartbeatInterval);
    this.heartbeatInterval = setInterval(() => this.runTimeBasedChecks(), 10000); // Every 10 seconds
    
    this.isInitialized = true;
    console.log('[ParkDetection] Service Initialized');
    
    // Emit initial status message
    DeviceEventEmitter.emit('parkDetectionUpdate', { message: 'Monitoring for activity...' });
  }

  startStepStreaming() {
    console.log('[ParkDetection] Starting live step streaming...');
    if (this.pedometerSubscription) this.pedometerSubscription.remove();
    this.pedometerSubscription = Pedometer.watchStepCount(result => {
      this.liveSteps = result.steps;
    });
  }

  async runTimeBasedChecks() {
    const isEnabled = await AsyncStorage.getItem('autoDetectionEnabled');
    if (isEnabled !== 'true') return;

    const now = Date.now();
    const timeSinceLastTransition = now - this.lastTransitionTime;

    if (this.currentState === STATE.WALKING && timeSinceLastTransition > 30000) {
      console.log('[ParkDetection] Heartbeat: Walking timeout reached. Returning to IDLE.');
      await this.transitionTo(STATE.IDLE);
    }
    
    if (this.currentState === STATE.POSSIBLE_PARK) {
      // Possible park also depends on time
      this.confidence[STATE.PARKED] = Math.min(1, timeSinceLastTransition / DURATION_PARKED_CONFIRM);
      if (this.confidence[STATE.PARKED] > CONFIDENCE_THRESHOLD) {
        console.log('[ParkDetection] Heartbeat: Possible park confirmed via time.');
        await this.transitionTo(STATE.PARKED);
      }
    }
  }

  async transitionTo(newState) {
    if (this.currentState === newState) return;

    console.log(`[ParkDetection] Transition: ${this.currentState} -> ${newState}`);
    
    if (newState === STATE.PARKED) {
      this.stepsAtParking = this.liveSteps;
    }

    if (newState === STATE.IDLE || newState === STATE.WALKING) {
      this.baselineSteps = this.liveSteps;
    }

    this.currentState = newState;
    this.lastTransitionTime = Date.now();
    
    Object.keys(this.confidence).forEach(key => {
      if (key !== newState) this.confidence[key] = 0;
    });

    await AsyncStorage.setItem('park_detection_state', JSON.stringify({
      state: this.currentState,
      timestamp: this.lastTransitionTime,
      parkedLocation: this.parkedLocation,
      stepsAtParking: this.stepsAtParking,
      baselineSteps: this.baselineSteps,
      confidence: this.confidence,
    }));

    let uiMessage = '';
    if (newState === STATE.IDLE) uiMessage = 'Monitoring for activity...';
    if (newState === STATE.WALKING) uiMessage = 'Walking detected...';
    if (newState === STATE.IN_VEHICLE) uiMessage = 'Driving detected...';
    if (newState === STATE.POSSIBLE_PARK) uiMessage = 'Possible parking detected...';
    if (newState === STATE.PARKED) {
      uiMessage = 'Parking spot identified!';
      await this.notifyUser('Potential Parking Detected', 'Walk away to confirm.');
    } else if (newState === STATE.EXIT_CONFIRMED) {
      uiMessage = 'Parking spot confirmed!';
      await this.notifyUser('Parking Spot Confirmed!', 'Your spot is now shared.');
      this.currentState = STATE.IDLE;
      this.parkedLocation = null;
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
    if (!this.isInitialized) await this.initialize();

    const isEnabled = await AsyncStorage.getItem('autoDetectionEnabled');
    if (isEnabled !== 'true') return;

    const { speed, latitude, longitude } = location.coords;
    const speedKmH = (speed || 0) * 3.6;
    const now = Date.now();

    if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
      this.confidence[STATE.IN_VEHICLE] = Math.min(1, this.confidence[STATE.IN_VEHICLE] + 0.2);
    } else if (speedKmH < SPEED_THRESHOLD_IDLE) {
      this.confidence[STATE.IN_VEHICLE] = Math.max(0, this.confidence[STATE.IN_VEHICLE] - 0.1);
    }

    const stepsSinceIdle = this.liveSteps - this.baselineSteps;
    console.log(`[ParkDetection] ${this.currentState} | Speed: ${speedKmH.toFixed(1)} | Steps: ${stepsSinceIdle}`);

    switch (this.currentState) {
      case STATE.IDLE:
        if (stepsSinceIdle >= 3 && speedKmH < 10) {
          await this.transitionTo(STATE.WALKING);
        } else if (this.confidence[STATE.IN_VEHICLE] > CONFIDENCE_THRESHOLD) {
          await this.transitionTo(STATE.IN_VEHICLE);
        }
        break;

      case STATE.WALKING:
        if (speedKmH > SPEED_THRESHOLD_VEHICLE) {
          await this.transitionTo(STATE.IN_VEHICLE);
        } else if (speedKmH < SPEED_THRESHOLD_IDLE) {
          if (now - this.lastTransitionTime > 30000) {
            await this.transitionTo(STATE.IDLE);
          }
        }
        break;

      case STATE.IN_VEHICLE:
        if (speedKmH < SPEED_THRESHOLD_IDLE) {
          await this.transitionTo(STATE.POSSIBLE_PARK);
        }
        break;

      case STATE.POSSIBLE_PARK:
        if (this.confidence[STATE.IN_VEHICLE] > CONFIDENCE_THRESHOLD) {
          await this.transitionTo(STATE.IN_VEHICLE);
        } else {
          this.confidence[STATE.PARKED] = Math.min(1, (now - this.lastTransitionTime) / DURATION_PARKED_CONFIRM);
          if (this.confidence[STATE.PARKED] > CONFIDENCE_THRESHOLD) {
            this.parkedLocation = { latitude, longitude };
            await this.transitionTo(STATE.PARKED);
          }
        }
        break;

      case STATE.PARKED:
        if (this.confidence[STATE.IN_VEHICLE] > CONFIDENCE_THRESHOLD) {
          await this.transitionTo(STATE.IN_VEHICLE);
          this.parkedLocation = null;
        } else if (this.parkedLocation) {
          const distance = this.getDistance(latitude, longitude, this.parkedLocation.latitude, this.parkedLocation.longitude);
          const stepsTaken = this.liveSteps - this.stepsAtParking;
          console.log(`[ParkDetection] PARKED | Dist: ${distance.toFixed(1)}m | Steps: ${stepsTaken}`);
          if (distance > DISTANCE_EXIT_CONFIRM && stepsTaken > 15 && speedKmH < 10) {
            await this.transitionTo(STATE.EXIT_CONFIRMED);
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
    const a = Math.sin(Δφ/2)**2 + Math.cos(φ1)*Math.cos(φ2)*Math.sin(Δλ/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }
}

const detectionService = new ParkDetectionService();

export const handleLocationUpdate = async (location) => {
  await detectionService.handleLocationUpdate(location);
};

TaskManager.defineTask(PARK_DETECTION_TASK, async ({ data, error }) => {
  if (data) {
    const { locations } = data;
    for (const location of locations) {
      await detectionService.handleLocationUpdate(location);
    }
  }
});

export const startParkDetection = async () => {
  await detectionService.initialize();
  try {
    await Location.startLocationUpdatesAsync(PARK_DETECTION_TASK, {
      accuracy: Location.Accuracy.BestForNavigation,
      timeInterval: 2000,
      deferredUpdatesInterval: 2000,
      foregroundService: {
        notificationTitle: 'Parksphere Auto-Detection',
        notificationBody: 'Monitoring...',
      },
    });
  } catch (e) {}
};

export const stopParkDetection = async () => {
  const hasStarted = await Location.hasStartedLocationUpdatesAsync(PARK_DETECTION_TASK);
  if (hasStarted) await Location.stopLocationUpdatesAsync(PARK_DETECTION_TASK);
};
