import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { Pedometer } from 'expo-sensors';

/**
 * Service Stress Test (Jest Integration)
 * Runs full service integration with randomized noise and jitter.
 */

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
      const randomDuration = Math.max(1, Math.round(step.duration * (0.9 + Math.random() * 0.2)));
      if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;

      // Noise on activity simulation
      const activityType = step.speed > 10 ? 'AUTOMOTIVE' : (step.steps > 0.5 ? 'WALKING' : 'STATIONARY');
      simulateMotionActivity(activityType, Math.random() > 0.1 ? 'HIGH' : 'LOW');

      for (let t = 0; t < randomDuration; t++) {
        simulatedTime += 1000;
        const randomSpeed = (step.speed * (0.85 + Math.random() * 0.3)) / 3.6;
        const jitter = (Math.random() - 0.5) * 0.00001; 

        const shift = randomSpeed * 1 * 0.000009;
        if (step.moveDirection === 'AWAY') latOffset += shift;
        else if (step.moveDirection === 'TOWARD') latOffset -= shift;

        const mockLocation = {
          coords: {
            latitude: baseLocation.latitude + latOffset + jitter,
            longitude: baseLocation.longitude + jitter,
            speed: randomSpeed,
            accuracy: 5 + Math.random() * 15,
            heading: 0
          },
          timestamp: simulatedTime
        };

        const randomSteps = (step.steps || 0) * (0.8 + Math.random() * 0.4) * 8;
        Pedometer.getStepCountAsync.mockResolvedValue({ steps: randomSteps });

        const prevState = finalStateData.state;
        finalStateData = await handleLocationUpdate(mockLocation);

        if (finalStateData.state === 'WALKING' && finalStateData.serverSpotId) events.parked = true;
        if (finalStateData.isAway) events.away = true;
        if (events.away && (finalStateData.state === 'DRIVING' || finalStateData.state === 'STOPPED')) events.returned = true;
      }
    }
    return events;
  }

  const STRESS_ITERATIONS = 5; // Reduced for CI speed

  test('Happy Path Reliability under noise', async () => {
    let successCount = 0;
    for (let i = 0; i < STRESS_ITERATIONS; i++) {
        await resetParkDetection();
        const res = await runRandomizedScenario(SCENARIOS.HAPPY_PATH);
        if (res.parked) successCount++;
    }
    expect(successCount).toBeGreaterThanOrEqual(STRESS_ITERATIONS * 0.8);
  }, 30000);

  test('Real-Life Odyssey Reliability under noise', async () => {
    let successCount = 0;
    for (let i = 0; i < STRESS_ITERATIONS; i++) {
        await resetParkDetection();
        const res = await runRandomizedScenario(SCENARIOS.REAL_LIFE_ODYSSEY);
        if (res.parked && res.away && res.returned) successCount++;
    }
    expect(successCount).toBeGreaterThanOrEqual(STRESS_ITERATIONS * 0.6); // Lower threshold due to extreme randomness
  }, 60000);
});
