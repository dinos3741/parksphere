import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import * as ApiService from '../utils/apiService';

/**
 * Field Replica Integration Test
 * Specifically designed to mimic the observations from today's real-life test.
 * Verifies threshold fixes and notification anti-spam.
 */

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(),
  setItem: jest.fn(),
  removeItem: jest.fn(),
  clear: jest.fn()
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

describe('Field Replica Integration', () => {
  let simulatedTime = 1600000000000;
  const realDateNow = Date.now;
  let testStorage = {};
  let notifyCalls = [];
  let apiSpy;

  // Mock DeviceEventEmitter to track notifications
  const { DeviceEventEmitter } = require('react-native');
  const originalEmit = DeviceEventEmitter.emit;

  beforeEach(async () => {
    jest.clearAllMocks();
    simulatedTime = 1600000000000;
    global.Date.now = jest.fn(() => simulatedTime);
    testStorage = {
      'userToken': 'fake-token',
      'userId': '123'
    };
    notifyCalls = [];

    AsyncStorage.getItem.mockImplementation(async (key) => testStorage[key] || null);
    AsyncStorage.setItem.mockImplementation(async (key, val) => { testStorage[key] = val; });
    AsyncStorage.removeItem.mockImplementation(async (key) => { delete testStorage[key]; });

    DeviceEventEmitter.emit = jest.fn((event, data) => {
      if (event === 'parkDetectionUpdate') notifyCalls.push(data.message);
    });

    // Use SpyOn for guaranteed call tracking across scopes
    apiSpy = jest.spyOn(ApiService, 'apiRequest').mockImplementation(async (url) => {
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
    DeviceEventEmitter.emit = originalEmit;
  });

  test('Field Replica: Spot 1 (Work) -> Spot 2 (Home) + Spam Defense', async () => {
    const scenario = SCENARIOS.FIELD_TEST_REPLICA;
    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let finalStateData = {};

    console.log(`[Test] Starting Field Replica Trace...`);

    for (const step of scenario.steps) {
      if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;

      const activityType = step.speed > 10 ? 'AUTOMOTIVE' : (step.steps > 0.5 ? 'WALKING' : 'STATIONARY');
      simulateMotionActivity(activityType, 'HIGH');

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
          timestamp: simulatedTime
        };

        if (step.bluetoothConnected !== undefined) {
           await handleLocationUpdate({ bluetoothConnected: step.bluetoothConnected }, null, true);
        }

        finalStateData = await handleLocationUpdate(mockLocation);
      }
    }

    // Small buffer to allow background async cleanup calls to complete
    await new Promise(resolve => setTimeout(resolve, 100));

    // --- VALIDATION ---

    // 1. Verify multiple spots were declared (Work and Home)
    const declareCalls = apiSpy.mock.calls.filter(call => call[0].includes('/api/declare-spot'));
    expect(declareCalls.length).toBeGreaterThanOrEqual(2); 
    console.log('   ✅ Multiple spots declared correctly.');

    // 2. Verify Spam Defense (Vicinity Messages)
    const vicinityMessages = notifyCalls.filter(msg => msg.includes('left the vicinity'));
    expect(vicinityMessages.length).toBe(2); 
    console.log(`   ✅ Vicinity notification spam prevented (Got ${vicinityMessages.length} total messages for 2 trips).`);

    // 3. Verify Home Spot Persistence (No drift deletion)
    expect(finalStateData.parkedLocation).not.toBeNull(); 
    console.log('   ✅ Home spot preserved (Drift Guard worked).');
  });
});
