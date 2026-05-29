const Module = require('module');

/**
 * HIJACKER: Intercept React Native & Expo imports so Node doesn't crash
 */
let mockedApiCalls = [];
let mockStorage = {
  'userToken': 'fake-token',
  'userId': '123'
};
let simulatedSteps = 0;

const originalRequire = Module.prototype.require;
Module.prototype.require = function(request) {
  if (request === '@react-native-async-storage/async-storage') {
    return {
      getItem: async (key) => mockStorage[key] || null,
      setItem: async (key, val) => { mockStorage[key] = val; },
      removeItem: async (key) => { delete mockStorage[key]; },
      clear: async () => { mockStorage = {}; }
    };
  }
  if (request === 'react-native') {
    return { 
      DeviceEventEmitter: { emit: () => {} },
      Alert: { alert: (title, msg) => console.log(`[Mock Alert] ${title}: ${msg}`) }
    };
  }
  if (request === 'expo-location') {
    return { 
      requestForegroundPermissionsAsync: async () => ({ status: 'granted' }),
      requestBackgroundPermissionsAsync: async () => ({ status: 'granted' }),
      hasStartedLocationUpdatesAsync: async () => false,
      startLocationUpdatesAsync: async () => {},
      stopLocationUpdatesAsync: async () => {},
      Accuracy: { Balanced: 3 },
      installWebGeolocationPolyfill: () => {}
    };
  }
  if (request === 'expo-task-manager') return { defineTask: () => {} };
  if (request === 'expo-sensors') {
    return { 
      Accelerometer: { setUpdateInterval: () => {}, addListener: () => ({ remove: () => {} }) }, 
      Pedometer: { 
        isAvailableAsync: async () => true, 
        getStepCountAsync: async () => ({ steps: simulatedSteps }),
        watchStepCount: () => ({ remove: () => {} })
      } 
    };
  }
  if (request === 'expo-file-system/legacy') return { documentDirectory: 'mock://' };
  if (request === 'expo-sharing') return { isAvailableAsync: async () => true };
  if (request === 'react-native-motion-activity-tracker') return {
    startTracking: async () => {},
    stopTracking: async () => {},
    addMotionStateChangeListener: () => {},
    getPermissionStatusAsync: async () => 'granted'
  };
  
  if (request.includes('./apiService')) {
    return {
      apiRequest: async (url, options) => {
        mockedApiCalls.push({ url, options });
        if (url.includes('/api/declare-spot')) {
          return { ok: true, json: async () => ({ spotId: 45 }) }; // Numeric ID!
        }
        return { ok: true, json: async () => ({}), text: async () => "{}" };
      }
    };
  }

  return originalRequire.apply(this, arguments);
};

// ---------------------------------------------------------
// 2. NOW LOAD THE SERVICE & HMM
// ---------------------------------------------------------
const { handleLocationUpdate, resetParkDetection, simulateMotionActivity } = require('../utils/parkDetectionService.js');
const { SCENARIOS } = require('./simulationScenarios.js');
const assert = require('assert');

async function runServiceIntegrationTest() {
  console.log('\n🚀 Starting Service + HMM Integration Test...');
  
  // Setup Mock Time
  let simulatedTime = 1600000000000;
  const realDateNow = Date.now;
  global.Date.now = () => simulatedTime;

  // Reset Engine and Mocks
  await resetParkDetection();
  mockedApiCalls = []; 

  const scenario = SCENARIOS.REAL_LIFE_ODYSSEY;
  const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
  let latOffset = 0;
  let finalStateData = {};

  try {
    console.log(`Running Scenario: ${scenario.name}`);
    
    for (const step of scenario.steps) {
      console.log(`   - Step: ${step.label || 'Step'} (${step.duration}s @ ${step.speed}km/h, steps=${step.steps})`);
      
      if (step.startDistance !== undefined) latOffset = step.startDistance * 0.000009;

      // Update Simulated Sensors
      if (step.speed > 10) simulateMotionActivity('AUTOMOTIVE', 'HIGH');
      else if (step.steps > 0.5) simulateMotionActivity('WALKING', 'HIGH');
      else simulateMotionActivity('STATIONARY', 'LOW');

      simulatedSteps = (step.steps || 0) * 8; // match getRecentStepRate math

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
      }
    }

    // 4. VALIDATION
    console.log('\n📊 Validating Integration Results...');
    
    // Check if Spot was declared
    const declaredSpot = mockedApiCalls.find(call => call.url.includes('/api/declare-spot'));
    assert.ok(declaredSpot, '❌ FAILURE: Spot was never declared to the server.');
    console.log('   ✅ Spot declared successfully.');

    // Check if Spot was freed (This tests the String(id) fix for numeric IDs from server)
    const freedSpot = mockedApiCalls.find(call => 
      call.url.includes('/api/parkingspots/45/status') && 
      call.options.body.includes('free')
    );
    assert.ok(freedSpot, '❌ FAILURE: Spot was never freed (status update failed). Check if numeric ID handling is broken.');
    console.log('   ✅ Spot freed successfully (numeric ID 45 handled).');

    // Verify state cleanup
    assert.strictEqual(finalStateData.serverSpotId, null, '❌ FAILURE: serverSpotId was not reset to null.');
    assert.strictEqual(finalStateData.parkedLocation, null, '❌ FAILURE: parkedLocation was not reset to null.');
    console.log('   ✅ Local state cleaned up correctly.');

    console.log('\n🎉 ALL SERVICE INTEGRATION TESTS PASSED!');

  } catch (error) {
    console.error('\n❌ INTEGRATION TEST FAILED:');
    console.error(error);
    process.exit(1);
  } finally {
    global.Date.now = realDateNow; 
  }
}

runServiceIntegrationTest();
