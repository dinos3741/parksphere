import { processLocationHMM, resetHMM } from '../parkDetection_HMM';
import { SCENARIOS } from '../simulationScenarios';

/**
 * HMM Test Harness
 * Plays a scenario through the HMM and returns the final state + history
 */
function runHeadlessScenario(scenario) {
  resetHMM();
  let currentState = 'IDLE';
  let belief = {};
  let history = [];
  let parkedEventOccurred = false;
  let awayEventOccurred = false;

  const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
  let latOffset = 0;

  // Counters to maintain state between steps
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
      const shift = (step.speed / 3.6) * 1 * 0.000009; // 1s intervals
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
      } else if (step.steps > 0) {
        motionActivity.walking = true;
        motionActivity.confidence = 2;
      } else {
        motionActivity.stationary = true;
        motionActivity.confidence = 2;
      }

      const result = processLocationHMM(mockLocation, (stepIndex > 0 || step.startDistance !== undefined) ? baseLocation : null, {
        previousState: currentState,
        previousBelief: belief,
        step_rate: step.steps || 0,
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
      tripDrivingTime = result.tripDrivingTime;
      drivingCounter = result.drivingCounter;
      walkingCounter = result.walkingCounter;
      returnCounter = result.returnCounter;
      inCarCounter = result.inCarCounter;

      if (result.parkedEvent) parkedEventOccurred = true;
      if (result.awayEvent) awayEventOccurred = true;

      history.push({ time: t, state: currentState, candidate: result.bestState });
    }
  });

  return { finalState: currentState, parkedEventOccurred, awayEventOccurred, history };
}

describe('HMM Regression Suite', () => {
  test('Happy Path: Drive and Park', () => {
    const result = runHeadlessScenario(SCENARIOS.HAPPY_PATH);
    expect(result.finalState).toBe('WALKING');
    expect(result.parkedEventOccurred).toBe(true);
  });

  test('Indoor Stability: Walking should not trigger STOPPED/DRIVING', () => {
    const indoorScenario = {
      name: "Indoor Walking Jitter",
      steps: [
        { label: "Walking in House", speed: 4, steps: 1.5, duration: 30, accel: 1.2 }
      ]
    };
    const result = runHeadlessScenario(indoorScenario);
    
    // It should stay in WALKING or IDLE, never move to STOPPED/DRIVING
    expect(result.finalState).not.toBe('STOPPED');
    expect(result.finalState).not.toBe('DRIVING');
    expect(['WALKING', 'IDLE']).toContain(result.finalState);
  });

  test('Red Light Persistence: Stopping should not break trip timer', () => {
    const redLightScenario = {
      name: "Red Light",
      steps: [
        { label: "Driving", speed: 40, steps: 0, duration: 15, accel: 1.3 },
        { label: "Stopped at Light", speed: 0, steps: 0, duration: 20, accel: 1.0 },
        { label: "Walking Away (Parked)", speed: 4, steps: 1.8, duration: 10, accel: 1.2, moveDirection: 'AWAY' }
      ]
    };
    const result = runHeadlessScenario(redLightScenario);
    expect(result.parkedEventOccurred).toBe(true);
    expect(result.finalState).toBe('WALKING');
  });
});
