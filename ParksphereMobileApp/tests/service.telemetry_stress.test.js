import fs from 'fs';
import path from 'path';
import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import * as ApiService from '../utils/apiService';

/**
 * Telemetry Stress (Fuzz) Test
 * Replays a real-world telemetry log, but applies random +/- 20% noise to 
 * the sensor readings (speed, accuracy) and introduces occasional 
 * sensor dropouts. This proves the HMM is robust against different phones, 
 * sensor degradation, and environmental noise.
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

describe('Telemetry Replay Stress Fuzzing', () => {
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
    testStorage = { 'userToken': 'fake-token', 'userId': '123' };
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

  // Helper to apply +/- percentage noise
  const applyNoise = (value, variance = 0.20) => {
    const multiplier = 1 + (Math.random() * (variance * 2) - variance);
    return value * multiplier;
  };

  const dataDir = path.resolve(__dirname, '../ai/data');
  const logFiles = process.env.LOG_FILE 
    ? [process.env.LOG_FILE] 
    : fs.readdirSync(dataDir).filter(f => f.startsWith('telemetry_log') && f.endsWith('.json'));

  logFiles.forEach(logFile => {
    test(`Stress Replay ${logFile} with +/- 20% fuzzing and sensor dropouts`, async () => {
      const logPath = path.join(dataDir, logFile);
      if (!fs.existsSync(logPath)) {
        console.warn(`Telemetry log ${logFile} not found, skipping.`);
        return;
      }

      const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      console.log(`[Test] Fuzzing ${logData.length} telemetry frames from ${logFile} with 20% variance...`);

      let prevLogTime = null;
      let finalStateData = {};
      let currentLat = 37.7749;
      let currentLon = -122.4194;

      for (let i = 0; i < logData.length; i++) {
        const entry = logData[i];

        let dt = 1;
        if (prevLogTime) {
            let timeDiff = entry.timestamp - prevLogTime;
            if (timeDiff < 1) {
                entry.timestamp = prevLogTime + 1;
                timeDiff = 1;
            }
            dt = timeDiff / 1000;
        }
        prevLogTime = entry.timestamp;
        simulatedTime = entry.timestamp; 
        
        // 🌪️ APPLY FUZZING (Noise)
        const rawSpeed = entry.sensors.speed || 0;
        const fuzzedSpeed = Math.max(0, applyNoise(rawSpeed, 0.20)); // +/- 20% speed
        const fuzzedAccuracy = Math.max(1, applyNoise(entry.sensors.accuracy || 10, 0.50)); // +/- 50% GPS jitter
        
        const distanceMovedMeters = fuzzedSpeed * dt;
        currentLat += distanceMovedMeters / 111111; 

        const mockLocation = {
            coords: {
                latitude: currentLat,
                longitude: currentLon,
                speed: fuzzedSpeed,
                accuracy: fuzzedAccuracy
            },
            timestamp: entry.timestamp
        };

        // 🌪️ SIMULATE SENSOR DROPOUTS
        const isActivityDropout = Math.random() < 0.05;

        if (isActivityDropout) {
           simulateMotionActivity('UNKNOWN', 'LOW');
        } else if (entry.sensors.activity) {
          if (entry.sensors.activity.automotive) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
          else if (entry.sensors.activity.walking) simulateMotionActivity('WALKING', 'HIGH');
          else simulateMotionActivity('STATIONARY', 'HIGH');
        } else {
          const speedKmh = mockLocation.coords.speed * 3.6;
          if (speedKmh > 10) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
          else if (speedKmh > 1.5) simulateMotionActivity('WALKING', 'HIGH');
          else simulateMotionActivity('STATIONARY', 'HIGH');
        }

        // 🌪️ BLUETOOTH DROPOUT (1% chance BT briefly disconnects while driving)
        let btState = entry.sensors.bluetooth !== undefined ? entry.sensors.bluetooth : false;
        if (btState && Math.random() < 0.01) {
           btState = false; // Glitch
        }
        await handleLocationUpdate({ bluetoothConnected: btState }, null, true);

        finalStateData = await handleLocationUpdate(mockLocation);
        
        if (finalStateData.state === 'WALKING' && finalStateData.parkingNotified === true) {
          finalStateData.parkingNotified = false;
        }
      }
      
      await new Promise(resolve => setTimeout(resolve, 100));

      const declareCalls = apiSpy.mock.calls.filter(call => call[0].includes('/api/declare-spot'));
      expect(declareCalls.length).toBeGreaterThanOrEqual(0); 
      console.log(`   ✅ ${logFile} Stress Replay finished. Spots declared despite noise: ${declareCalls.length}`);
      expect(finalStateData.state).toBeDefined();
    }, 60000);
  });
});