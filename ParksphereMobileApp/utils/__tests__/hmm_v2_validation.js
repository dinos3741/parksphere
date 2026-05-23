const HMM = require('../parkDetection_HMM.js');
const { SCENARIOS } = require('../simulationScenarios.js');

/**
 * HMM Test Runner V2 (Focus: Stability & Spike Resistance)
 */
function runHeadlessScenario(scenario) {
  HMM.resetHMM();
  let currentState = 'IDLE';
  let belief = {};
  let isAway = false;
  let history = [];

  const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
  let latOffset = 0;

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

    for (let t = 0; t < step.duration; t++) {
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

      history.push({ 
        time: t, 
        state: currentState, 
        candidate: result.bestState, 
        conf: result.confidence,
        belief: { ...result.belief },
        speed: result.filteredSpeed,
        dist: result.distToParked
      });
    }
  });

  return { finalState: currentState, history, finalBelief: belief };
}

const tests = [
  {
    name: 'Fix 1: Absolute Step Block for Driving',
    fn: () => {
      const scenario = {
        steps: [
          { label: 'Running (High Steps)', speed: 30, steps: 3.5, duration: 10, accel: 1.5, activity: { walking: true, confidence: 2 } }
        ]
      };
      const result = runHeadlessScenario(scenario);
      // Even with speed 30 and automotive activity, steps > 0.35 must block DRIVING
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
      // A single 1-second spike to 60km/h shouldn't trigger DRIVING
      const triggeredDriving = result.history.some(h => h.state === 'DRIVING');
      if (triggeredDriving) {
        const spike = result.history.find(h => h.state === 'DRIVING');
        console.log(`    [Debug] Driving triggered at speed: ${spike.speed.toFixed(2)}`);
      }
      return !triggeredDriving;
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
      // With 150m accuracy and 1s duration, speed should stay low
      const maxSpeed = Math.max(...result.history.map(h => h.speed));
      if (maxSpeed >= 15) console.log(`    [Debug] Max speed reached: ${maxSpeed.toFixed(2)}`);
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
      // Simulate approach to satisfy deltaRate < -0.1 requirement
      const scenarioNoBT = {
        steps: [{ label: 'Approaching Car', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: false }]
      };
      const scenarioWithBT = {
        steps: [{ label: 'Approaching Car with BT', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: true }]
      };
      
      const res1 = runHeadlessScenario(scenarioNoBT);
      const res2 = runHeadlessScenario(scenarioWithBT);
      
      if (res2.finalBelief['IN_CAR'] <= res1.finalBelief['IN_CAR']) {
        console.log(`    [Debug] No BT IN_CAR: ${res1.finalBelief['IN_CAR'].toFixed(4)}`);
        console.log(`    [Debug] With BT IN_CAR: ${res2.finalBelief['IN_CAR'].toFixed(4)}`);
      }
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
      // Even if stationary and close-ish, 8m > 5m must block IN_CAR
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
      // Approach speed < 0.5 m/s should block RETURNING
      return result.finalState !== 'RETURNING';
    }
  }
];

console.log('\n🚀 RUNNING HMM V2 VALIDATION SUITE\n');
let passed = 0;
tests.forEach((t, i) => {
  try {
    const ok = t.fn();
    console.log(`${ok ? '✅' : '❌'} [Test ${i+1}] ${t.name}`);
    if (ok) passed++;
  } catch (e) {
    console.log(`❌ [Test ${i+1}] ${t.name} - ERROR: ${e.message}`);
    console.error(e);
  }
});

console.log(`\n📊 Summary: ${passed}/${tests.length} passed`);
process.exit(passed === tests.length ? 0 : 1);
