import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';
import { SCENARIOS } from './simulationScenarios';

let timer = null;
let latOffset = 0;
let lonOffset = 0;

/**
 * Console-based Scenario Runner
 * Usage in Console: runScenario('HAPPY_PATH', { latitude: 37.7749, longitude: -122.4194 })
 */
export const runScenario = async (scenarioKey, baseLocation) => {
  if (timer) clearInterval(timer);
  
  const scenario = SCENARIOS[scenarioKey];
  if (!scenario) {
    console.error(`[Simulator] Scenario ${scenarioKey} not found.`);
    console.log('Available scenarios:', Object.keys(SCENARIOS).join(', '));
    return;
  }

  if (!baseLocation) {
    console.error('[Simulator] Please provide baseLocation: { latitude, longitude }');
    return;
  }

  console.log(`[Simulator] 🚀 Starting Scenario: ${scenario.name}`);
  await resetParkDetection();
  latOffset = 0;
  lonOffset = 0;

  executeStep(scenario, 0, baseLocation);
};

const executeStep = async (scenario, stepIndex, baseLocation) => {
  if (stepIndex >= scenario.steps.length) {
    console.log(`[Simulator] ✅ Scenario ${scenario.name} completed.`);
    return;
  }

  const step = scenario.steps[stepIndex];
  console.log(`[Simulator] 📍 Step ${stepIndex + 1}/${scenario.steps.length}: ${step.label}`);

  if (step.startDistance !== undefined) {
    latOffset = step.startDistance * 0.000009;
    lonOffset = 0;
  }

  let elapsed = 0;
  let currentSpeed = 0; // 🚀 New: track actual physical speed for acceleration
  const tick = 2000; // 🚀 Run HMM more frequently (every 2s) for better physics

  timer = setInterval(async () => {
    elapsed += (tick / 1000);
    
    // 🚀 PHYSICS: Realistic acceleration curve
    const targetSpeed = step.speed / 3.6;
    const accelRate = 1.5; // m/s^2 (conservative car accel)
    if (currentSpeed < targetSpeed) {
      currentSpeed = Math.min(targetSpeed, currentSpeed + (accelRate * (tick / 1000)));
    } else if (currentSpeed > targetSpeed) {
      currentSpeed = Math.max(targetSpeed, currentSpeed - (accelRate * 2 * (tick / 1000)));
    }

    const shift = currentSpeed * (tick / 1000) * 0.000009;
    if (step.moveDirection === 'AWAY') {
      latOffset += shift;
    } else if (step.moveDirection === 'TOWARD') {
      latOffset -= shift;
    }

    // 🚀 GPS JITTER: Add random noise based on accuracy
    const accuracy = step.accuracy || 10;
    const jitterLat = (Math.random() - 0.5) * (accuracy * 0.000009);
    const jitterLon = (Math.random() - 0.5) * (accuracy * 0.000009);

    const mockLocation = {
      coords: {
        latitude: baseLocation.latitude + latOffset + jitterLat,
        longitude: baseLocation.longitude + lonOffset + jitterLon,
        speed: currentSpeed,
        accuracy: accuracy,
      },
      timestamp: Date.now(),
    };

    // Update sensor cache
    // 🚀 SENSOR LAG: 20% chance to report old activity to simulate transition noise
    if (Math.random() > 0.2) {
      if (step.steps > 0) {
        simulateMotionActivity('WALKING', step.steps > 1.5 ? 'HIGH' : 'LOW');
      } else if (currentSpeed > 5) {
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
      } else {
        simulateMotionActivity('STATIONARY');
      }
    }

    // Update Bluetooth if specified
    if (step.bluetoothConnected !== undefined) {
      await handleLocationUpdate({ bluetoothConnected: step.bluetoothConnected }, undefined, true);
    }

    await handleLocationUpdate(mockLocation);

    if (elapsed >= step.duration) {
      clearInterval(timer);
      executeStep(scenario, stepIndex + 1, baseLocation);
    }
  }, tick);
};

// Stop current simulation
export const stopScenario = () => {
  if (timer) {
    clearInterval(timer);
    console.log('[Simulator] 🛑 Simulation aborted.');
  }
};

// Register globally for console access
const registerGlobals = () => {
  const target = globalThis || global || window;
  if (target) {
    target.runScenario = runScenario;
    target.stopScenario = stopScenario;
    target.LIST_SCENARIOS = () => console.log('Available scenarios:', Object.keys(SCENARIOS));
    console.log('[Simulator] 🛠️ Console commands registered: runScenario, stopScenario, LIST_SCENARIOS');
  } else {
    console.warn('[Simulator] ⚠️ Could not find global object to register commands.');
  }
};

registerGlobals();
