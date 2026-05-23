const HMM = require('./parkDetection_HMM.js');
const { SCENARIOS } = require('./simulationScenarios.js');

/**
 * HMM Test Runner (Headless)
 * Simulates real-world sensor data streams and validates HMM behavior.
 */
function runHeadlessScenario(scenario) {
  HMM.resetHMM();
  
  // Mock Date.now to simulate time passing
  const realDateNow = Date.now;
  let simulatedTime = 1600000000000; // Fixed start point
  global.Date.now = () => simulatedTime;

  let currentState = 'IDLE';
  let belief = {};
  for (const s of HMM.STATES) belief[s] = s === 'IDLE' ? 1 : 0; // Proper init

  let history = [];
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
  let proximityCounter = 0;
  let lastDistanceToCar = undefined;

  scenario.steps.forEach((step, stepIndex) => {
    if (step.startDistance !== undefined) {
      latOffset = step.startDistance * 0.000009;
    }

    // Simulate 1-second intervals for the duration of the step
    for (let t = 0; t < step.duration; t++) {
      simulatedTime += 1000; // 🚀 Advance time by 1s

      const shift = (step.speed / 3.6) * 1 * 0.000009; 
      if (step.moveDirection === 'AWAY') latOffset += shift;
      else if (step.moveDirection === 'TOWARD') latOffset -= shift;

      const mockLocation = {
        coords: {
          latitude: baseLocation.latitude + latOffset,
          longitude: baseLocation.longitude,
          speed: step.speed / 3.6,
          accuracy: step.accuracy || 10
        }
      };

      const motionActivity = step.activity || {};
      if (!step.activity) {
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
      }

      const result = HMM.processLocationHMM(mockLocation, (stepIndex > 0 || step.startDistance !== undefined) ? baseLocation : null, {
        previousState: currentState,
        previousBelief: belief,
        isAway: isAway,
        step_rate: step.steps || 0,
        acceleration_magnitude: step.accel || 1.0,
        motion_activity: motionActivity,
        tripDrivingTime,
        drivingCounter,
        walkingCounter,
        returnCounter,
        inCarCounter,
        proximityCounter,
        bluetoothConnected: step.bluetoothConnected || false,
        accuracy: step.accuracy || 10,
        lastDistanceToCar: lastDistanceToCar
      });

      currentState = result.state;
      belief = result.belief;
      isAway = result.isAway;
      tripDrivingTime = result.tripDrivingTime;
      drivingCounter = result.drivingCounter;
      walkingCounter = result.walkingCounter;
      returnCounter = result.returnCounter;
      inCarCounter = result.inCarCounter;
      proximityCounter = result.proximityCounter;
      lastDistanceToCar = result.distToParked;

      if (result.parkedEvent) parkedEventOccurred = true;
      if (result.awayEvent) awayEventOccurred = true;

      history.push({ 
        time: t, 
        state: currentState, 
        candidate: result.bestState,
        speed: result.filteredSpeed,
        dist: result.distToParked,
        belief: { ...result.belief }
      });
    }
  });

  // Restore real Date.now
  global.Date.now = realDateNow;

  return { finalState: currentState, parkedEventOccurred, awayEventOccurred, isAway, history, finalBelief: belief };
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
          { label: 'Driving', speed: 45, steps: 0, duration: 20, accel: 1.3 },
          { label: 'Stopped at Light', speed: 0, steps: 0, duration: 30, accel: 1.0 },
          { label: 'Walking Away (Parked)', speed: 4, steps: 1.8, duration: 10, accel: 1.2, moveDirection: 'AWAY' }
        ]
      };
      const result = runHeadlessScenario(redLightScenario);
      return result.parkedEventOccurred && result.finalState === 'WALKING';
    }
  },
  {
    name: 'Fix 1: Absolute Step Block for Driving',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'Running (High Steps)', speed: 30, steps: 3.5, duration: 10, accel: 1.5, activity: { walking: true, confidence: 2 } }
        ]
      };
      const result = runHeadlessScenario(scenario);
      return result.finalState !== 'DRIVING';
    }
  },
  {
    name: 'Kalman Tuning: Speed Spike Resistance',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'Idle', speed: 0, steps: 0, duration: 5, accel: 1.0 },
          { label: 'GPS Spike', speed: 60, steps: 0, duration: 1, accel: 1.0 },
          { label: 'Back to Idle', speed: 0, steps: 0, duration: 5, accel: 1.0 }
        ]
      };
      const result = runHeadlessScenario(scenario);
      return !result.history.some(h => h.state === 'DRIVING');
    }
  },
  {
    name: 'Dynamic Accuracy: High Error Dampening',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'GPS Jump with low accuracy', speed: 40, steps: 0, duration: 1, accuracy: 150, moveDirection: 'AWAY' }
        ]
      };
      const result = runHeadlessScenario(scenario);
      const maxSpeed = Math.max(...result.history.map(h => h.speed));
      return maxSpeed < 15; 
    }
  },
  {
    name: 'Hysteresis Gap: Flapping Prevention',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'Ambiguous State', speed: 12, steps: 0.2, duration: 20, accel: 1.1 }
        ]
      };
      const result = runHeadlessScenario(scenario);
      let switches = 0;
      for (let i = 1; i < result.history.length; i++) {
        if (result.history[i].state !== result.history[i-1].state) switches++;
      }
      return switches <= 2; 
    }
  },
  {
    name: 'Bluetooth Signal: IN_CAR Boost',
    fn: () => {
      const scenarioNoBT = {
        steps: [{ label: 'Approaching Car', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: false }]
      };
      const scenarioWithBT = {
        steps: [{ label: 'Approaching Car with BT', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: true }]
      };
      
      const res1 = runHeadlessScenario(scenarioNoBT);
      const res2 = runHeadlessScenario(scenarioWithBT);
      
      return res2.finalBelief['IN_CAR'] > res1.finalBelief['IN_CAR'];
    }
  },
  {
    name: 'Tightened IN_CAR Gate: Distance > 5m Block',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'Approaching but far', speed: 2, steps: 0, duration: 5, startDistance: 8, moveDirection: 'TOWARD', activity: { stationary: true, confidence: 2 } }
        ]
      };
      const result = runHeadlessScenario(scenario);
      return result.finalState !== 'IN_CAR';
    }
  },
  {
    name: 'Tightened RETURNING Gate: Approach Speed Block',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'Walking away (IsAway=true)', speed: 4, steps: 1.5, duration: 10, moveDirection: 'AWAY' },
          { label: 'Walking very slowly toward', speed: 0.2, steps: 0.5, duration: 5, moveDirection: 'TOWARD' }
        ]
      };
      const result = runHeadlessScenario(scenario);
      return result.finalState !== 'RETURNING';
    }
  },
  {
    name: 'Away Event Threshold (Must be > 20m)',
    fn: () => {
      const nearCarScenario = {
        steps: [{ label: 'Walking near car', speed: 3.6, steps: 1.2, duration: 5, startDistance: 10, moveDirection: 'AWAY' }]
      };
      const result = runHeadlessScenario(nearCarScenario);
      return !result.awayEventOccurred;
    }
  },
  {
    name: 'Proximity Reset (Sustained proximity clears isAway)',
    fn: () => {
      const proximityScenario = {
        steps: [
            { label: 'Walking away', speed: 4, steps: 1.8, duration: 30, moveDirection: 'AWAY' }, 
            { label: 'Hanging out near car', speed: 0.5, steps: 0, duration: 30, startDistance: 5, moveDirection: 'TOWARD' }
        ]
      };
      const result = runHeadlessScenario(proximityScenario);
      return result.isAway === false;
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
