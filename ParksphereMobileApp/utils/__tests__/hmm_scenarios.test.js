import { processLocationHMM, resetHMM } from '../parkDetection_HMM';
import { SCENARIOS } from '../../tests/simulationScenarios';

// Module-level simulated clock — advanced by runHeadlessScenario, mocked in describe hooks.
let _simTime = 1600000000000;

/**
 * HMM Test Harness V2
 * Upgraded to support:
 * - Dynamic accuracy
 * - Bluetooth signals
 * - deltaRate calculation (via lastDistanceToCar)
 * - All internal counters
 */
function runHeadlessScenario(scenario) {
  resetHMM();
  let currentState = 'IDLE';
  let belief = {};
  let history = [];
  let parkedEventOccurred = false;
  let awayEventOccurred = false;
  let isAway = false;
  let activeParkedLocation = null;

  const baseLocation = { latitude: 37.7749, longitude: -122.4194 };
  let latOffset = 0;

  // Counters to maintain state between steps
  let tripDrivingTime = 0;
  let tripDrivingDistance = 0;
  let drivingCounter = 0;
  let walkingCounter = 0;
  let returnCounter = 0;
  let inCarCounter = 0;
  let proximityCounter = 0;
  let lastDistanceToCar = undefined;
  let lastTripX = null;
  let lastTripY = null;

  scenario.steps.forEach((step, stepIndex) => {
    if (step.startDistance !== undefined) {
      latOffset = step.startDistance * 0.000009;
      activeParkedLocation = baseLocation;
    }

    // Simulate 1-second intervals for the duration of the step
    for (let t = 0; t < step.duration; t++) {
      _simTime += 1000; // advance mock clock by 1 second per frame
      const shift = (step.speed / 3.6) * 1 * 0.000009; // 1s intervals
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

      const result = processLocationHMM(mockLocation, activeParkedLocation, {
        previousState: currentState,
        previousBelief: belief,
        isAway: isAway,
        step_rate: step.steps || 0,
        acceleration_magnitude: step.accel || 1.0,
        motion_activity: motionActivity,
        tripDrivingTime,
        tripDrivingDistance,
        drivingCounter,
        walkingCounter,
        returnCounter,
        inCarCounter,
        proximityCounter,
        lastTripX,
        lastTripY,
        bluetoothConnected: step.bluetoothConnected || false,
        accuracy: step.accuracy || 10,
        lastDistanceToCar: lastDistanceToCar
      });

      currentState = result.state;
      belief = result.belief;
      isAway = result.isAway;
      tripDrivingTime = result.tripDrivingTime;
      tripDrivingDistance = result.tripDrivingDistance;
      drivingCounter = result.drivingCounter;
      walkingCounter = result.walkingCounter;
      returnCounter = result.returnCounter;
      inCarCounter = result.inCarCounter;
      proximityCounter = result.proximityCounter;
      lastTripX = result.lastTripX;
      lastTripY = result.lastTripY;
      lastDistanceToCar = result.distToParked;

      if (result.parkedEvent) {
        parkedEventOccurred = true;
        activeParkedLocation = mockLocation.coords;
      }
      if (result.awayEvent) awayEventOccurred = true;
      if (result.clearParkingEvent) activeParkedLocation = null;

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

  return { finalState: currentState, parkedEventOccurred, awayEventOccurred, history, finalBelief: belief };
}

describe('HMM Regression Suite', () => {
  let dateSpy;

  beforeEach(() => {
    _simTime = 1600000000000;
    dateSpy = jest.spyOn(global.Date, 'now').mockImplementation(() => _simTime);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

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
    expect(result.finalState).not.toBe('STOPPED');
    expect(result.finalState).not.toBe('DRIVING');
    expect(['WALKING', 'IDLE']).toContain(result.finalState);
  });

  test('Red Light Persistence: Stopping should not break trip timer', () => {
    const redLightScenario = {
      name: "Red Light",
      steps: [
        { label: "Driving", speed: 40, steps: 0, duration: 35, accel: 1.3, moveDirection: 'AWAY' },
        { label: "Stopped at Light", speed: 0, steps: 0, duration: 20, accel: 1.0 },
        { label: "Walking Away (Parked)", speed: 4, steps: 1.8, duration: 10, accel: 1.2, moveDirection: 'AWAY' }
      ]
    };
    const result = runHeadlessScenario(redLightScenario);
    expect(result.parkedEventOccurred).toBe(true);
    expect(result.finalState).toBe('WALKING');
  });

  test('Fix 1: Absolute Step Block for Driving', () => {
    const scenario = {
      steps: [
        { label: 'Running (High Steps)', speed: 30, steps: 3.5, duration: 10, accel: 1.5, activity: { walking: true, confidence: 2 } }
      ]
    };
    const result = runHeadlessScenario(scenario);
    // Even with speed 30 and automotive activity, steps > 0.35 must block DRIVING
    expect(result.finalState).not.toBe('DRIVING');
  });

  test('Kalman Tuning: Speed Spike Resistance', () => {
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
    expect(triggeredDriving).toBe(false);
  });

  test('Dynamic Accuracy: High Error Dampening', () => {
    const scenario = {
      steps: [
        { label: 'GPS Jump with low accuracy', speed: 40, steps: 0, duration: 1, accuracy: 150, moveDirection: 'AWAY' }
      ]
    };
    const result = runHeadlessScenario(scenario);
    // With 150m accuracy and 1s duration, speed should stay low
    const maxSpeed = Math.max(...result.history.map(h => h.speed));
    expect(maxSpeed).toBeLessThan(15);
  });

  test('Hysteresis Gap: Flapping Prevention', () => {
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
    expect(switches).toBeLessThanOrEqual(2);
  });

  test('Bluetooth Signal: IN_CAR Boost', () => {
    const scenarioNoBT = {
      steps: [{ label: 'Approaching Car', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: false }]
    };
    const scenarioWithBT = {
      steps: [{ label: 'Approaching Car with BT', speed: 2, steps: 0, duration: 2, startDistance: 4, moveDirection: 'TOWARD', bluetoothConnected: true }]
    };
    
    const res1 = runHeadlessScenario(scenarioNoBT);
    const res2 = runHeadlessScenario(scenarioWithBT);
    
    expect(res2.finalBelief['IN_CAR']).toBeGreaterThan(res1.finalBelief['IN_CAR']);
  });

  test('Tightened IN_CAR Gate: Distance > 5m Block', () => {
    const scenario = {
      steps: [
        // User stands still at 8m — well outside the IN_CAR threshold (≤5m)
        { label: 'Stationary at 8m', speed: 0, steps: 0, duration: 5, startDistance: 8, activity: { stationary: true, confidence: 2 } }
      ]
    };
    const result = runHeadlessScenario(scenario);
    // 8m is above the IN_CAR distance gate so the state must stay blocked
    expect(result.finalState).not.toBe('IN_CAR');
  });

  test('Tightened RETURNING Gate: Approach Speed Block', () => {
    const scenario = {
      steps: [
        { label: 'Walking away (IsAway=true)', speed: 4, steps: 1.5, duration: 10, moveDirection: 'AWAY' },
        { label: 'Walking very slowly toward', speed: 0.2, steps: 0.5, duration: 5, moveDirection: 'TOWARD' }
      ]
    };
    const result = runHeadlessScenario(scenario);
    // Approach speed < 0.5 m/s should block RETURNING
    expect(result.finalState).not.toBe('RETURNING');
  });

  test('Real-Life Odyssey: Full Cycle (Walk -> Drive -> Park -> Return -> Drive)', () => {
    const result = runHeadlessScenario(SCENARIOS.REAL_LIFE_ODYSSEY);
    
    expect(result.parkedEventOccurred).toBe(true);
    expect(result.awayEventOccurred).toBe(true);
    expect(['DRIVING', 'STOPPED']).toContain(result.finalState);
    
    const sawReturning = result.history.some(h => h.state === 'RETURNING');
    expect(sawReturning).toBe(true);
  });
});
