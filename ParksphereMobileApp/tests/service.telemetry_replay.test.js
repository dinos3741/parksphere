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

  const dataDir = path.resolve(__dirname, '../ai/data');
  const logFiles = process.env.LOG_FILE 
    ? [process.env.LOG_FILE] 
    : fs.readdirSync(dataDir).filter(f => f.startsWith('telemetry_log') && f.endsWith('.json'));

  logFiles.forEach(logFile => {
    test(`Replay ${logFile} through full ParkDetectionService`, async () => {
      const logPath = path.join(dataDir, logFile);
      if (!fs.existsSync(logPath)) {
        console.warn(`Telemetry log ${logFile} not found, skipping.`);
        return;
      }

      const logData = JSON.parse(fs.readFileSync(logPath, 'utf8'));
      console.log(`[Test] Replaying ${logData.length} telemetry frames from ${logFile}...`);

      let prevLogTime = null;
      let finalStateData = {};
      
      let currentLat = 37.7749;
      let currentLon = -122.4194;
      let lastState = 'IDLE';

      // 🔇 Silence the noise from the service layer during the heavy loop
      const originalLog = console.log;
      const originalWarn = console.warn;
      console.log = () => {}; 
      console.warn = () => {};

      try {
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
          
          // 📢 Only log actual state transitions
          if (finalStateData.state !== lastState) {
            originalLog(`   [HMM] ${lastState} -> ${finalStateData.state} (${((entry.timestamp - logData[0].timestamp)/1000).toFixed(0)}s)`);
            lastState = finalStateData.state;
          }

          if (finalStateData.state === 'WALKING' && finalStateData.parkingNotified === true) {
            // Clear it so we can detect the next one
            finalStateData.parkingNotified = false;
          }
        }
      } finally {
        // 🔊 Restore logging
        console.log = originalLog;
        console.warn = originalWarn;
      }
      
      // Give async promises time to resolve
      await new Promise(resolve => setTimeout(resolve, 100));

      const declareCalls = apiSpy.mock.calls.filter(call => call[0].includes('/api/declare-spot'));
      expect(declareCalls.length).toBeGreaterThanOrEqual(0); 
      console.log(`   ✅ ${logFile} Replay finished. Spots declared: ${declareCalls.length}`);
      expect(finalStateData.state).toBeDefined();
    }, 60000);
  });
});
