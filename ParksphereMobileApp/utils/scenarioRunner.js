import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from './parkDetectionService';
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
  timer = setInterval(async () => {
    elapsed += 5;
    
    const shift = (step.speed / 3.6) * 5 * 0.000009;
    if (step.moveDirection === 'AWAY') {
      latOffset += shift;
    } else if (step.moveDirection === 'TOWARD') {
      latOffset -= shift;
    }

    const mockLocation = {
      coords: {
        latitude: baseLocation.latitude + latOffset,
        longitude: baseLocation.longitude + lonOffset,
        speed: step.speed / 3.6,
        accuracy: 5,
      },
      timestamp: Date.now(),
    };

    // Update sensor cache
    if (step.steps > 0) {
      simulateMotionActivity('WALKING', step.steps > 1.5 ? 'HIGH' : 'LOW');
    } else if (step.speed > 10) {
      simulateMotionActivity('AUTOMOTIVE', 'HIGH');
    } else {
      simulateMotionActivity('STATIONARY');
    }

    await handleLocationUpdate(mockLocation);

    if (elapsed >= step.duration) {
      clearInterval(timer);
      executeStep(scenario, stepIndex + 1, baseLocation);
    }
  }, 5000);
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
