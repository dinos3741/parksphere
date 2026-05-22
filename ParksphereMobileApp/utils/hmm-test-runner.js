const HMM = require('./parkDetection_HMM.js');
const { SCENARIOS } = require('./simulationScenarios.js');

/**
 * HMM Test Runner (Headless)
 * Simulates real-world sensor data streams and validates HMM behavior.
 */
function runHeadlessScenario(scenario) {
  HMM.resetHMM();
  let currentState = 'IDLE';
  let belief = {};
  let parkedEventOccurred = false;
  let awayEventOccurred = false;
  let isAway = false;

  const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
  let latOffset = 0;

  // Internal counters maintained across steps
  let tripDrivingTime = 0;
  let drivingCounter = 0;
  let walkingCounter = 0;
  let returnCounter = 0;
  let inCarCounter = 0;

  scenario.steps.forEach((step, stepIndex) => {
    if (step.startDistance !== undefined) {
      latOffset = step.startDistance * 0.000009;
    }

    // Simulate 1-second intervals for the duration of the step
    for (let t = 0; t < step.duration; t++) {
      const shift = (step.speed / 3.6) * 1 * 0.000009; 
      if (step.moveDirection === 'AWAY') latOffset += shift;
      else if (step.moveDirection === 'TOWARD') latOffset -= shift;

      const mockLocation = {
        coords: {
          latitude: baseLocation.latitude + latOffset,
          longitude: baseLocation.longitude,
          speed: step.speed / 3.6,
        }
      };

      const motionActivity = {};
      if (step.speed > 10) {
        motionActivity.automotive = true;
        motionActivity.confidence = 2;
      } else if (step.steps > 0 || step.speed > 1) {
        motionActivity.walking = true;
        motionActivity.confidence = 2;
      } else {
        motionActivity.stationary = true;
        motionActivity.confidence = 2;
      }

      const result = HMM.processLocationHMM(mockLocation, (stepIndex > 0 || step.startDistance !== undefined) ? baseLocation : null, {
        previousState: currentState,
        previousBelief: belief,
        isAway: isAway, // 🛡️ CRITICAL: Maintain continuity
        step_rate: step.steps || (step.speed > 1 ? 1.5 : 0),
        acceleration_magnitude: step.accel || 1.0,
        motion_activity: motionActivity,
        tripDrivingTime,
        drivingCounter,
        walkingCounter,
        returnCounter,
        inCarCounter
      });

      currentState = result.state;
      belief = result.belief;
      isAway = result.isAway; // 🛡️ CRITICAL: Update for next loop
      
      // Simulate real-world persistence: accumulation of trip time
      if (result.state === 'DRIVING' || result.state === 'STOPPED') {
          tripDrivingTime += 1;
      }
      
      drivingCounter = result.drivingCounter;
      walkingCounter = result.walkingCounter;
      returnCounter = result.returnCounter;
      inCarCounter = result.inCarCounter;

      if (result.parkedEvent) parkedEventOccurred = true;
      if (result.awayEvent) awayEventOccurred = true;
    }
  });

  return { finalState: currentState, parkedEventOccurred, awayEventOccurred, isAway };
}

const tests = [
  {
    name: 'Standard Drive & Park',
    fn: () => {
      const result = runHeadlessScenario(SCENARIOS.HAPPY_PATH);
      return result.finalState === 'WALKING' && result.parkedEventOccurred;
    }
  },
  {
    name: 'Indoor Jitter Defense (No accidental Driving/Stopped)',
    fn: () => {
      const indoorScenario = {
        steps: [{ label: 'Walking in Supermarket', speed: 6, steps: 1.5, duration: 60, accel: 1.2 }]
      };
      const result = runHeadlessScenario(indoorScenario);
      return result.finalState !== 'STOPPED' && result.finalState !== 'DRIVING' && ['WALKING', 'IDLE'].includes(result.finalState);
    }
  },
  {
    name: 'Red Light Persistence (Trip timer continues while stopped)',
    fn: () => {
      const redLightScenario = {
        steps: [
          { label: 'Driving', speed: 45, steps: 0, duration: 15, accel: 1.3 },
          { label: 'Stopped at Light', speed: 0, steps: 0, duration: 30, accel: 1.0 },
          { label: 'Walking Away (Parked)', speed: 4, steps: 1.8, duration: 10, accel: 1.2, moveDirection: 'AWAY' }
        ]
      };
      const result = runHeadlessScenario(redLightScenario);
      return result.parkedEventOccurred && result.finalState === 'WALKING';
    }
  },
  {
    name: 'Away Event Threshold (Must be > 20m)',
    fn: () => {
      const nearCarScenario = {
        // Start at 10m, walk at 1m/s for 5s = 15m total. Should NOT trigger.
        steps: [{ label: 'Walking near car', speed: 3.6, steps: 1.2, duration: 5, startDistance: 10, moveDirection: 'AWAY' }]
      };
      const result = runHeadlessScenario(nearCarScenario);
      return !result.awayEventOccurred;
    }
  }
];

console.log('\n🚀 RUNNING HMM AUTOMATED REGRESSION SUITE\n');
let passed = 0;
tests.forEach((t, i) => {
  try {
    const ok = t.fn();
    console.log(`${ok ? '✅' : '❌'} [Test ${i+1}] ${t.name}`);
    if (ok) passed++;
  } catch (e) {
    console.log(`❌ [Test ${i+1}] ${t.name} - ERROR: ${e.message}`);
  }
});

console.log(`\n📊 Summary: ${passed}/${tests.length} passed`);
process.exit(passed === tests.length ? 0 : 1);
