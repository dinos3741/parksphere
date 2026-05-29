import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { Pedometer } from 'expo-sensors';

/**
 * Service Trace Integration Test
 * Runs a scenario and prints a detailed lifecycle report, exercing the full service stack.
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

describe('Service Trace Tool', () => {
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

    await resetParkDetection();
  });

  afterAll(() => {
    global.Date.now = realDateNow;
  });

  async function traceScenario(scenario) {
    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let totalSeconds = 0;
    let currentSpeed = 0;

    console.log(`\n=== TRACING SCENARIO (INTEGRATION): ${scenario.name} ===`);
    console.log(`${'TIME'.padEnd(6)} | ${'LABEL'.padEnd(20)} | ${'STATE'.padEnd(10)} | ${'DIST'.padEnd(6)} | ${'ID'.padEnd(8)} | ${'EVENTS'}`);
    console.log('-'.repeat(80));

    let finalStateData = {};

    for (const step of scenario.steps) {
      if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;

      const activityType = step.speed > 10 ? 'AUTOMOTIVE' : (step.steps > 0.5 ? 'WALKING' : 'STATIONARY');
      simulateMotionActivity(activityType, 'HIGH');

      for (let t = 0; t < step.duration; t += 2) {
        simulatedTime += 2000;
        totalSeconds += 2;

        // Physics: Smooth acceleration
        const targetSpeed = step.speed / 3.6;
        const accelRate = 1.5; 
        if (currentSpeed < targetSpeed) currentSpeed = Math.min(targetSpeed, currentSpeed + (accelRate * 2));
        else if (currentSpeed > targetSpeed) currentSpeed = Math.max(targetSpeed, currentSpeed - (accelRate * 4));

        const shift = currentSpeed * 2 * 0.000009;
        if (step.moveDirection === 'AWAY') latOffset += shift;
        else if (step.moveDirection === 'TOWARD') latOffset -= shift;

        const mockLocation = {
          coords: {
            latitude: baseLocation.latitude + latOffset,
            longitude: baseLocation.longitude,
            speed: currentSpeed,
            accuracy: step.accuracy || 10,
            heading: 0
          },
          timestamp: simulatedTime
        };

        Pedometer.getStepCountAsync.mockResolvedValue({ steps: (step.steps || 0) * 8 });

        const prevState = finalStateData.state;
        const prevSpotId = finalStateData.serverSpotId;
        
        finalStateData = await handleLocationUpdate(mockLocation);

        let events = [];
        if (finalStateData.state !== prevState) events.push(`🔄 ${finalStateData.state}`);
        if (finalStateData.serverSpotId && !prevSpotId) events.push('🅿️ PARKED');
        if (!finalStateData.serverSpotId && prevSpotId) events.push('🏁 CLEARED');
        if (t === 0) events.push(`[${step.label}]`);

        if (events.length > 0 || totalSeconds % 20 === 0) {
            const timeStr = `${totalSeconds}s`.padEnd(6);
            const labelStr = step.label.substring(0, 20).padEnd(20);
            const stateStr = (finalStateData.state || 'IDLE').padEnd(10);
            const distStr = `${(finalStateData.lastDistanceToCar || 0).toFixed(1)}m`.padEnd(6);
            const idStr = String(finalStateData.serverSpotId || 'none').padEnd(8);
            console.log(`${timeStr} | ${labelStr} | ${stateStr} | ${distStr} | ${idStr} | ${events.join(', ')}`);
        }
      }
    }
    console.log('=== TRACE COMPLETE ===\n');
  }

  test('Trace Real-Life Odyssey', async () => {
    await traceScenario(SCENARIOS.REAL_LIFE_ODYSSEY);
  }, 30000);

  test('Trace Pass-By Spot', async () => {
    await traceScenario(SCENARIOS.PASS_BY_SPOT);
  }, 30000);
});
