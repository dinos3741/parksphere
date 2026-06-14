import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';
import { returnZone } from '../utils/returnBoundary';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Pedometer } from 'expo-sensors';
import * as ApiService from '../utils/apiService';

/**
 * 2D Decision Boundary Integration Test
 * Drives a full park -> leave -> return trajectory and verifies the boundary
 * wiring end-to-end:
 *   - every emitted frame reports a self-consistent zone + ETA
 *   - phase-1 ("soon_free") fires when the return crosses the soft curve
 *   - phase-2 ("commit") never fires on a brief spike (sustained-hold guard)
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
  hasStartedGeofencingAsync: jest.fn().mockResolvedValue(false),
  startGeofencingAsync: jest.fn(),
  stopGeofencingAsync: jest.fn(),
  getCurrentPositionAsync: jest.fn().mockResolvedValue(null),
  GeofencingEventType: { Enter: 1, Exit: 2 },
  Accuracy: { Balanced: 3 }
}));

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));

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

describe('2D Decision Boundary Integration', () => {
  let simulatedTime = 1600000000000;
  const realDateNow = Date.now;
  let testStorage = {};
  let detailedFrames = [];
  let commitNotifies = [];
  let statusCalls = [];
  let deleteCalls = [];
  let apiSpy;

  const { DeviceEventEmitter } = require('react-native');
  const originalEmit = DeviceEventEmitter.emit;

  beforeEach(async () => {
    jest.clearAllMocks();
    simulatedTime = 1600000000000;
    global.Date.now = jest.fn(() => simulatedTime);
    testStorage = { 'userToken': 'fake-token', 'userId': '123' };
    detailedFrames = [];
    commitNotifies = [];
    statusCalls = [];
    deleteCalls = [];

    AsyncStorage.getItem.mockImplementation(async (key) => testStorage[key] || null);
    AsyncStorage.setItem.mockImplementation(async (key, val) => { testStorage[key] = val; });
    AsyncStorage.removeItem.mockImplementation(async (key) => { delete testStorage[key]; });

    DeviceEventEmitter.emit = jest.fn((event, data) => {
      // Only the main update path carries boundary data; the BT fast-path and reset
      // emits legitimately omit it.
      if (event === 'parkDetectionDetailedUpdate' && data.zone !== undefined) detailedFrames.push(data);
      if (event === 'parkDetectionUpdate' && data.message && data.message.includes('freeing soon')) {
        commitNotifies.push(data);
      }
    });

    apiSpy = jest.spyOn(ApiService, 'apiRequest').mockImplementation(async (url, opts) => {
      if (url.includes('/api/declare-spot')) {
        return { ok: true, json: async () => ({ spotId: 45 }), text: async () => '{}' };
      }
      if (url.includes('/status') && opts && opts.body) {
        statusCalls.push(JSON.parse(opts.body).status);
      }
      if (opts && opts.method === 'DELETE') {
        deleteCalls.push(url);
      }
      return { ok: true, json: async () => ({}), text: async () => '{}' };
    });

    Pedometer.getStepCountAsync.mockResolvedValue({ steps: 0 });
    await resetParkDetection();
  });

  afterAll(() => {
    global.Date.now = realDateNow;
    DeviceEventEmitter.emit = originalEmit;
  });

  async function runScenario(scenario) {
    const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
    let latOffset = 0;
    const originalLog = console.log;
    const originalWarn = console.warn;
    console.log = () => {};
    console.warn = () => {};
    try {
      for (const step of scenario.steps) {
        if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;
        const activityType = step.speed > 10 ? 'AUTOMOTIVE' : (step.steps > 0.5 ? 'WALKING' : 'STATIONARY');
        simulateMotionActivity(activityType, 'HIGH');
        for (let t = 0; t < step.duration; t++) {
          simulatedTime += 1000;
          const shift = (step.speed / 3.6) * 1 * 0.000009;
          if (step.moveDirection === 'AWAY') latOffset += shift;
          else if (step.moveDirection === 'TOWARD') latOffset -= shift;

          if (step.bluetoothConnected !== undefined) {
            await handleLocationUpdate({ bluetoothConnected: step.bluetoothConnected }, null, true);
          }
          await handleLocationUpdate({
            coords: {
              latitude: baseLocation.latitude + latOffset,
              longitude: baseLocation.longitude,
              speed: step.speed / 3.6,
              accuracy: step.accuracy || 10,
              heading: 0
            },
            timestamp: simulatedTime
          });
        }
      }
    } finally {
      console.log = originalLog;
      console.warn = originalWarn;
    }
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  test('emits self-consistent zone + ETA every frame and fires soft alert on return', async () => {
    await runScenario(SCENARIOS.REAL_LIFE_ODYSSEY);

    expect(detailedFrames.length).toBeGreaterThan(0);

    for (const f of detailedFrames) {
      const dist = f.metrics?.distToParked ?? 0;
      // ETA = distance / current speed, or null (N/A) when essentially still.
      // metrics.speed is km/h derived from the same coords.speed used for the ETA.
      const speedMs = (f.metrics?.speed ?? 0) / 3.6;
      if (speedMs < 0.5) {
        expect(f.etaSeconds).toBeNull();
      } else {
        expect(typeof f.etaSeconds).toBe('number');
        expect(f.etaSeconds).toBeGreaterThanOrEqual(0);
      }
      expect(['WAIT', 'SOFT', 'COMMIT']).toContain(f.zone);

      // The reported zone must be consistent with the thresholds reported alongside it.
      if (f.zone === 'COMMIT') {
        expect(f.returningConfidence).toBeGreaterThan(f.commitThreshold);
      } else if (f.zone === 'SOFT') {
        expect(f.returningConfidence).toBeGreaterThan(f.softThreshold);
        expect(f.returningConfidence).toBeLessThanOrEqual(f.commitThreshold);
      }
      // Cross-check against the pure boundary function for the active (gated) frames.
      if (f.returningConfidence > 0 && f.zone !== 'WAIT') {
        expect(f.zone).toBe(returnZone(f.returningConfidence, dist));
      }
    }

    // The return leg should drive at least one non-WAIT frame and a soon_free heads-up.
    const nonWait = detailedFrames.filter(f => f.zone !== 'WAIT');
    expect(nonWait.length).toBeGreaterThan(0);
    expect(statusCalls).toContain('soon_free');
  });

  test('a brief commit spike does NOT fire the commit alert (sustained-hold guard)', async () => {
    // Pass-by: approaches the car then immediately walks away — never sustains COMMIT.
    await runScenario(SCENARIOS.PASS_BY_SPOT);
    expect(commitNotifies.length).toBe(0);
  });

  test('broadcasts the lifecycle in order (soon_free -> committed -> vacating) and removes on clear', async () => {
    await runScenario(SCENARIOS.REAL_LIFE_ODYSSEY);

    const firstIdx = (status) => statusCalls.indexOf(status);

    // Yellow always precedes green, and green always precedes red — never out of order.
    if (firstIdx('committed') !== -1) {
      expect(firstIdx('soon_free')).not.toBe(-1);
      expect(firstIdx('soon_free')).toBeLessThan(firstIdx('committed'));
    }
    if (firstIdx('vacating') !== -1) {
      // red is only sent once the dot is already public (a soft/commit broadcast happened).
      const publicBefore = firstIdx('soon_free') !== -1 || firstIdx('committed') !== -1;
      expect(publicBefore).toBe(true);
      if (firstIdx('committed') !== -1) {
        expect(firstIdx('committed')).toBeLessThan(firstIdx('vacating'));
      }
    }

    // 'committed' (green) must never be sent without a sustained-COMMIT confirmation (notify).
    if (firstIdx('committed') !== -1) {
      expect(commitNotifies.length).toBeGreaterThan(0);
    }

    // The auto-clear removes the spot (DELETE) rather than marking it 'free'.
    expect(statusCalls).not.toContain('free');
    expect(deleteCalls.length).toBeGreaterThan(0);
  });
});
