import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';

/**
 * Service + HMM Integration Test (Jest Version)
 * Validates the full detection lifecycle including server calls and numeric ID handling.
 */

// ---------------------------------------------------------
// 1. MOCKS
// ---------------------------------------------------------
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

import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { Pedometer } from 'expo-sensors';

describe('ParkDetection Service Integration', () => {
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
    
    // Default Storage Mock
    AsyncStorage.getItem.mockImplementation(async (key) => {
      return testStorage[key] || null;
    });
    AsyncStorage.setItem.mockImplementation(async (key, val) => {
      testStorage[key] = val;
    });
    AsyncStorage.removeItem.mockImplementation(async (key) => {
      delete testStorage[key];
    });

    // Default API Mock (Return Numeric ID for Spot Declaration)
    apiRequest.mockImplementation(async (url) => {
      if (url.includes('/api/declare-spot')) {
        return { 
          ok: true, 
          json: async () => ({ spotId: 45 }),
          text: async () => "{}"
        };
      }
      return { 
        ok: true, 
        json: async () => ({}),
        text: async () => "{}"
      };
    });

    // Default Pedometer Mock
    Pedometer.getStepCountAsync.mockResolvedValue({ steps: 5 });

    await resetParkDetection();
  });

  afterAll(() => {
    global.Date.now = realDateNow;
  });

  test('Full Life-Cycle: Walk -> Drive -> Park -> Return -> Drive', async () => {
    const scenario = SCENARIOS.REAL_LIFE_ODYSSEY;
    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    let finalStateData = {};
    let lastState = 'IDLE';

    console.log(`[Test] Running Scenario: ${scenario.name}`);

    try {
      for (const step of scenario.steps) {
        if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;

        // Update Simulated Sensors
        if (step.speed > 10) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        else if (step.steps > 0.5) simulateMotionActivity('WALKING', 'HIGH');
        else simulateMotionActivity('STATIONARY', 'LOW');

        // 🚀 NEW: Update Bluetooth if specified in step
        if (step.bluetoothConnected !== undefined) {
          await handleLocationUpdate({ bluetoothConnected: step.bluetoothConnected }, undefined, true);
        }

        // Mock pedometer rate for this step
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
            timestamp: simulatedTime
          };

          finalStateData = await handleLocationUpdate(mockLocation);

          // 📢 Only log actual state transitions
          if (finalStateData.state !== lastState) {
            console.log(`   [HMM] ${lastState} -> ${finalStateData.state}`);
            lastState = finalStateData.state;
          }
        }
      }
    } finally {
      // 🔊 No logging restoration needed
    }

    // --- VALIDATION ---
    console.log('[Test] Validating Integration Results...');

    // 1. Spot Declaration (Server Call)
    const declareCall = apiRequest.mock.calls.find(call => call[0].includes('/api/declare-spot'));
    expect(declareCall).toBeDefined();
    console.log('   ✅ Spot declared to server.');

    // 2. Numeric ID Handling (Clear -> Delete)
    // The server returned spotId: 45. On clear the spot is removed (DELETE /parkingspots/45),
    // so the dot disappears for everyone rather than lingering as 'free'.
    const deleteCall = apiRequest.mock.calls.find(call =>
      call[0].includes('/api/parkingspots/45') &&
      call[1] && call[1].method === 'DELETE'
    );
    expect(deleteCall).toBeDefined();
    console.log('   ✅ Spot removed on clear (DELETE, Numeric ID 45 handled).');

    // 3. State Cleanup
    expect(finalStateData.serverSpotId).toBeNull();
    expect(finalStateData.parkedLocation).toBeNull();
    console.log('   ✅ Local state reset correctly.');
  });
});
