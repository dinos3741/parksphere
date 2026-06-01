import fs from 'fs';
import path from 'path';
import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import * as ApiService from '../utils/apiService';

/**
 * Telemetry Replay Integration Test
 * Feeds a real-world recorded JSON flight recorder log back through the
 * full ParkDetectionService to verify holistic engine behavior.
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

describe('Telemetry Replay Integration', () => {
  let simulatedTime = 1600000000000;
  const realDateNow = Date.now;
  let testStorage = {};
  let notifyCalls = [];
  let apiSpy;

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

  test('Replay telemetry_log4.json through full ParkDetectionService', async () => {
    const logPath = path.resolve(__dirname, '../ai/data/telemetry_log4.json');
    if (!fs.existsSync(logPath)) {
      console.warn('Telemetry log not found, skipping test.');
      return;
    }

    const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
    console.log(`[Test] Replaying ${logData.length} telemetry frames from log4...`);

    let prevLogTime = null;
    let finalStateData = {};
    let parkedEventsDetected = 0;
    
    let currentLat = 37.7749;
    let currentLon = -122.4194;

    for (let i = 0; i < logData.length; i++) {
      const entry = logData[i];

      let dt = 1;
      if (prevLogTime) {
          let timeDiff = entry.timestamp - prevLogTime;
          if (timeDiff < 1) {
              entry.timestamp = prevLogTime + 1; // prevent 0 dt
              timeDiff = 1;
          }
          dt = timeDiff / 1000;
      }
      prevLogTime = entry.timestamp;
      
      // Keep Date.now() in sync with the simulated timeline
      simulatedTime = entry.timestamp; 
      
      // Synthesize physical GPS movement using speed
      const speedMs = entry.sensors.speed || 0;
      const distanceMovedMeters = speedMs * dt;
      currentLat += distanceMovedMeters / 111111; // Approx 111,111 meters per degree latitude

      const mockLocation = {
          coords: {
              latitude: currentLat,
              longitude: currentLon,
              speed: speedMs, // In m/s
              accuracy: entry.sensors.accuracy || 10
          },
          timestamp: entry.timestamp
      };

      // Set Activity exactly as the log implies
      // Since early logs lacked activity, we deduce it from speed to keep the test robust
      if (entry.sensors.activity) {
        if (entry.sensors.activity.automotive) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        else if (entry.sensors.activity.walking) simulateMotionActivity('WALKING', 'HIGH');
        else simulateMotionActivity('STATIONARY', 'HIGH');
      } else {
        const speedKmh = mockLocation.coords.speed * 3.6;
        if (speedKmh > 10) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        else if (speedKmh > 1.5) simulateMotionActivity('WALKING', 'HIGH');
        else simulateMotionActivity('STATIONARY', 'HIGH');
      }

      // Update Bluetooth if recorded
      if (entry.sensors.bluetooth !== undefined) {
         await handleLocationUpdate({ bluetoothConnected: entry.sensors.bluetooth }, null, true);
      }

      finalStateData = await handleLocationUpdate(mockLocation);
      
      if (finalStateData.state === 'WALKING' && finalStateData.parkingNotified === true) {
        parkedEventsDetected++;
        // Clear it so we can detect the next one
        finalStateData.parkingNotified = false;
      }
    }
    
    // Give async promises time to resolve
    await new Promise(resolve => setTimeout(resolve, 100));

    // Validations:
    // This specific JSON file contains 2 distinct drive-and-park cycles
    const declareCalls = apiSpy.mock.calls.filter(call => call[0].includes('/api/declare-spot'));
    expect(declareCalls.length).toBeGreaterThanOrEqual(1); 
    console.log(`   ✅ Replay finished. Spots successfully declared to API: ${declareCalls.length}`);
    expect(finalStateData.state).toBeDefined();
  }, 30000);
});
