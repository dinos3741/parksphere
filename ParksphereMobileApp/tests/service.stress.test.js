import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { Pedometer } from 'expo-sensors';

/**
 * Service Stress Test (Jest Integration)
 * Runs full service integration with randomized noise and jitter.
 */

// ==============================
// STRESS CONFIGURATION
// ==============================
const STRESS_CONFIG = {
  ITERATIONS: 100,           // Number of times to run each scenario
  TEMPORAL_JITTER: 0.10,     // +/- 10% duration variance
  SPEED_JITTER: 0.15,        // +/- 15% velocity variance
  COORD_JITTER: 0.00002,     // ~2 meter physical wobble
  ACCURACY_MIN: 5,           // Best case GPS accuracy (meters)
  ACCURACY_MAX: 20,          // Worst case GPS accuracy (meters)
  STEP_RATE_JITTER: 0.20,    // +/- 20% pedometer intensity variance
  LOW_CONF_PROB: 0.10        // 10% chance of receiving LOW confidence from OS
};

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
}));

jest.mock('../utils/apiService', () => ({
  apiRequest: jest.fn()
}));

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  requestBackgroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'granted' }),
  hasStartedLocationUpdatesAsync: jest.fn().mockResolvedValue(false),
  startLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(false),
  startGeofencingAsync: jest.fn(),
  stopGeofencingAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  GeofencingEventType: { Enter: 1, Exit: 2 },
  Accuracy: { Balanced: 3 }
}));

jest.mock('expo-task-manager', () => ({
  defineTask: jest.fn()
}));

jest.mock('expo-sensors', () => ({
  Accelerometer: { 
    setUpdateInterval: jest.fn(), 
    addListener: jest.fn().mockReturnValue({ remove: jest.fn() }) 
  },
  Pedometer: { 
    isAvailableAsync: jest.fn().mockResolvedValue(true), 
    getStepCountAsync: jest.fn(),
    watchStepCount: jest.fn().mockReturnValue({ remove: jest.fn() })
  }
}));

describe('Service Stress Test', () => {
  let simulatedTime = 1600000000000;
  const realDateNow = Date.now;
  let testStorage = {};

  beforeEach(async () => {
    jest.clearAllMocks();
    simulatedTime = 1600000000000;
    global.Date.now = jest.fn(() => simulatedTime);
    testStorage = {
      'userToken': 'fake-token',
      'userId': '123'
    };
    
    AsyncStorage.getItem.mockImplementation(async (key) => testStorage[key] || null);
    AsyncStorage.setItem.mockImplementation(async (key, val) => { testStorage[key] = val; });
    AsyncStorage.removeItem.mockImplementation(async (key) => { delete testStorage[key]; });

    apiRequest.mockImplementation(async (url) => {
      if (url.includes('/api/declare-spot')) {
        return { ok: true, json: async () => ({ spotId: Math.floor(Math.random() * 1000) }), text: async () => "{}" };
      }
      return { ok: true, json: async () => ({}), text: async () => "{}" };
    });

    await resetParkDetection();
  });

  afterAll(() => {
    global.Date.now = realDateNow;
  });

  async function runRandomizedScenario(scenario) {
    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let finalStateData = {};
    let events = { parked: false, away: false, returned: false };

    for (const step of scenario.steps) {
      // 1. Temporal Jitter
      const durationRange = STRESS_CONFIG.TEMPORAL_JITTER * 2;
      const durationFactor = (1 - STRESS_CONFIG.TEMPORAL_JITTER) + (Math.random() * durationRange);
      const randomDuration = Math.max(1, Math.round(step.duration * durationFactor));
      
      if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;

      // 2. Sensor Confidence Noise
      const activityType = step.speed > 10 ? 'AUTOMOTIVE' : (step.steps > 0.5 ? 'WALKING' : 'STATIONARY');
      const confidence = Math.random() > STRESS_CONFIG.LOW_CONF_PROB ? 'HIGH' : 'LOW';
      simulateMotionActivity(activityType, confidence);

      for (let t = 0; t < randomDuration; t++) {
        simulatedTime += 1000;

        // 3. Speed Jitter
        const speedRange = STRESS_CONFIG.SPEED_JITTER * 2;
        const speedFactor = (1 - STRESS_CONFIG.SPEED_JITTER) + (Math.random() * speedRange);
        const randomSpeed = (step.speed * speedFactor) / 3.6;

        // 4. GPS Coordinate Noise
        const jitter = (Math.random() - 0.5) * STRESS_CONFIG.COORD_JITTER; 

        const shift = randomSpeed * 1 * 0.000009;
        if (step.moveDirection === 'AWAY') latOffset += shift;
        else if (step.moveDirection === 'TOWARD') latOffset -= shift;

        const mockLocation = {
          coords: {
            latitude: baseLocation.latitude + latOffset + jitter,
            longitude: baseLocation.longitude + jitter,
            speed: randomSpeed,
            // 5. Accuracy Randomization
            accuracy: STRESS_CONFIG.ACCURACY_MIN + Math.random() * (STRESS_CONFIG.ACCURACY_MAX - STRESS_CONFIG.ACCURACY_MIN),
            heading: 0
          },
          timestamp: simulatedTime
        };

        // 6. Step Rate Jitter
        const stepsRange = STRESS_CONFIG.STEP_RATE_JITTER * 2;
        const stepsFactor = (1 - STRESS_CONFIG.STEP_RATE_JITTER) + (Math.random() * stepsRange);
        const randomSteps = (step.steps || 0) * stepsFactor * 8;
        Pedometer.getStepCountAsync.mockResolvedValue({ steps: randomSteps });

        finalStateData = await handleLocationUpdate(mockLocation);

        if (finalStateData.state === 'WALKING' && finalStateData.serverSpotId) events.parked = true;
        if (finalStateData.isAway) events.away = true;
        if (events.away && (finalStateData.state === 'DRIVING' || finalStateData.state === 'STOPPED')) events.returned = true;
      }
    }
    return events;
  }

  test('Happy Path Reliability under noise', async () => {
    let successCount = 0;
    let visualProgress = '';
    
    for (let i = 0; i < STRESS_CONFIG.ITERATIONS; i++) {
        await resetParkDetection();
        const res = await runRandomizedScenario(SCENARIOS.HAPPY_PATH);
        if (res.parked) {
          successCount++;
          visualProgress += '✅';
        } else {
          visualProgress += '❌';
        }
    }
    
    const rate = (successCount / STRESS_CONFIG.ITERATIONS) * 100;
    console.log(`\n   [HAPPY_PATH] Progress: ${visualProgress}`);
    console.log(`   📊 PASS RATE: ${rate}% (${successCount}/${STRESS_CONFIG.ITERATIONS})\n`);
    
    expect(successCount).toBeGreaterThanOrEqual(STRESS_CONFIG.ITERATIONS * 0.8);
  }, 120000); 

  test('Real-Life Odyssey Reliability under noise', async () => {
    let successCount = 0;
    let visualProgress = '';
    
    for (let i = 0; i < STRESS_CONFIG.ITERATIONS; i++) {
        await resetParkDetection();
        const res = await runRandomizedScenario(SCENARIOS.REAL_LIFE_ODYSSEY);
        if (res.parked && res.away && res.returned) {
          successCount++;
          visualProgress += '✅';
        } else {
          visualProgress += '❌';
        }
    }
    
    const rate = (successCount / STRESS_CONFIG.ITERATIONS) * 100;
    console.log(`\n   [ODYSSEY] Progress: ${visualProgress}`);
    console.log(`   📊 PASS RATE: ${rate}% (${successCount}/${STRESS_CONFIG.ITERATIONS})\n`);
    
    expect(successCount).toBeGreaterThanOrEqual(STRESS_CONFIG.ITERATIONS * 0.6); 
  }, 300000);
});
