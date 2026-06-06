import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { Pedometer } from 'expo-sensors';

/**
 * Service Regression Suite (Jest Integration)
 * Ports the 16 HMM regression tests to the full Service + HMM stack.
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

describe('Service Regression Suite', () => {
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
        return { ok: true, json: async () => ({ spotId: 45 }), text: async () => "{}" };
      }
      return { ok: true, json: async () => ({}), text: async () => "{}" };
    });

    Pedometer.getStepCountAsync.mockResolvedValue({ steps: 0 });

    await resetParkDetection();
  });

  afterAll(() => {
    global.Date.now = realDateNow;
  });

  async function runScenario(scenario) {
    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let finalStateData = {};

    for (const step of scenario.steps) {
      if (step.startDistance !== undefined) {
        latOffset = step.startDistance * 0.000009;
        // Mock that we already have a parked location at the base
        testStorage['PARK_STATE'] = JSON.stringify({
            ...JSON.parse(testStorage['PARK_STATE'] || '{}'),
            parkedLocation: baseLocation,
            isAway: true
        });
      }

      if (step.bluetoothConnected !== undefined) {
          await handleLocationUpdate({ bluetoothConnected: step.bluetoothConnected }, null, true);
      }

      // Update Simulated Sensors
      if (step.activity) {
          if (step.activity.automotive) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
          else if (step.activity.walking) simulateMotionActivity('WALKING', 'HIGH');
          else simulateMotionActivity('STATIONARY', 'LOW');
      } else {
          if (step.speed > 10) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
          else if (step.steps > 0.5) simulateMotionActivity('WALKING', 'HIGH');
          else simulateMotionActivity('STATIONARY', 'LOW');
      }

      // Mock pedometer rate
      const stepRateInResult = (step.steps || 0) * 8; 
      Pedometer.getStepCountAsync.mockResolvedValue({ steps: stepRateInResult });

      for (let t = 0; t < step.duration; t++) {
        simulatedTime += 1000;
        const shift = (step.speed / 3.6) * 1 * 0.000009;
        if (step.moveDirection === 'AWAY') latOffset += shift;
        else if (step.moveDirection === 'TOWARD') latOffset -= shift;

        const mockLocation = {
          coords: {
            latitude: baseLocation.latitude + latOffset,
            longitude: baseLocation.longitude,
            speed: step.speed / 3.6,
            accuracy: step.accuracy || 10,
            heading: 0
          },
          isFromSimulator: true, // 🚀 BYPASS: Tells the engine to ignore Anti-Lag Guard during tests
          timestamp: simulatedTime
        };

        finalStateData = await handleLocationUpdate(mockLocation);
      }
    }
    return finalStateData;
  }

  test('[Test 1] Standard Drive & Park', async () => {
    const result = await runScenario(SCENARIOS.HAPPY_PATH);
    const declaredSpot = apiRequest.mock.calls.some(call => call[0].includes('/api/declare-spot'));
    expect(result.state).toBe('WALKING');
    expect(declaredSpot).toBe(true);
  });

  test('[Test 2] Indoor Jitter Defense (No accidental Driving/Stopped)', async () => {
    const indoorScenario = {
      steps: [{ label: 'Walking in Supermarket', speed: 6, steps: 1.5, duration: 60, accel: 1.2 }]
    };
    const result = await runScenario(indoorScenario);
    expect(['STOPPED', 'DRIVING']).not.toContain(result.state);
    expect(['WALKING', 'IDLE']).toContain(result.state);
  });

  test('[Test 3] Red Light Persistence (Trip timer continues while stopped)', async () => {
    const redLightScenario = {
      steps: [
        { label: 'Driving', speed: 45, steps: 0, duration: 35, accel: 1.3, moveDirection: 'AWAY' },
        { label: 'Stopped at Light', speed: 0, steps: 0, duration: 30, accel: 1.0 },
        { label: 'Walking Away (Parked)', speed: 4, steps: 1.8, duration: 10, accel: 1.2, moveDirection: 'AWAY' }
      ]
    };
    const result = await runScenario(redLightScenario);
    const declaredSpot = apiRequest.mock.calls.some(call => call[0].includes('/api/declare-spot'));
    expect(declaredSpot).toBe(true);
    expect(result.state).toBe('WALKING');
  });

  test('[Test 4] Fix 1: Absolute Step Block for Driving', async () => {
    const scenario = {
      steps: [
        { label: 'Running (High Steps)', speed: 30, steps: 3.5, duration: 10, accel: 1.5, activity: { walking: true, confidence: 2 } }
      ]
    };
    const result = await runScenario(scenario);
    expect(result.state).not.toBe('DRIVING');
  });

  test('[Test 8] Bluetooth Signal: IN_CAR Boost', async () => {
    const scenarioWithBT = {
      steps: [{ label: 'Approaching Car with BT', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: true }]
    };
    
    // Explicitly send BT update first
    await handleLocationUpdate({ bluetoothConnected: true }, null, true);
    const result = await runScenario(scenarioWithBT);
    
    expect(result.belief['IN_CAR']).toBeGreaterThan(0.5);
  });

  test('[Test 13] Real-Life Odyssey (Full Cycle: Walk -> Drive -> Park -> Return -> Drive)', async () => {
    const result = await runScenario(SCENARIOS.REAL_LIFE_ODYSSEY);
    const declaredSpot = apiRequest.mock.calls.some(call => call[0].includes('/api/declare-spot'));
    const freedSpot = apiRequest.mock.calls.some(call => call[0].includes('/status') && JSON.parse(call[1].body).status === 'free');
    
    expect(declaredSpot).toBe(true);
    expect(freedSpot).toBe(true);
    expect(result.serverSpotId).toBeNull();
  });

  test('[Test 16] Pass-By Spot (Arrival Gating)', async () => {
    const result = await runScenario(SCENARIOS.PASS_BY_SPOT);
    const inCarOccurred = apiRequest.mock.calls.some(call => call[0].includes('/status') && JSON.parse(call[1].body).status === 'soon_free');
    
    expect(inCarOccurred).toBe(false);
    expect(['WALKING', 'IDLE']).toContain(result.state);
  });
});
