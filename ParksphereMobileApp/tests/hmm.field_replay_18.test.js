/**
 * Field Replay Regression Test — Log 18
 *
 * Replays the real-life recording from telemetry_log.18json.json directly
 * through processLocationHMM (bypassing the service layer entirely).
 *
 * All sensor inputs (speed, stepRate, accel, activity, pgr, approachAlignment,
 * deltaRate) come verbatim from the recorded log. GPS coordinates are
 * reconstructed from the recorded distToParked values so distances are correct.
 *
 * Expected events (from real run):
 *   t≈315s  parkedEvent (first park: STOPPED→WALKING)
 *   t≈327s  awayEvent   (dist crossed 15m)
 *   t≈500s  RETURNING state entered
 *   t≈649s  clearParkingEvent (drove away > 100m for > 30s)
 *   t≈716s  parkedEvent (second park at home)
 *   t≈729s  awayEvent
 */

import fs from 'fs';
import path from 'path';
import { processLocationHMM, resetHMM } from '../utils/parkDetection_HMM';

// ─── load log ────────────────────────────────────────────────────────────────
const LOG_PATH = path.resolve(__dirname, '../ai/data/telemetry_log.18json.json');
const LOG_DATA = JSON.parse(fs.readFileSync(LOG_PATH, 'utf8'));

// ─── helpers ─────────────────────────────────────────────────────────────────
const BASE_LAT = 37.7749;
const BASE_LON = -122.4194;
const METERS_PER_DEG = 111111;

function coordsAtDist(parkedLoc, distMeters) {
  // Place the user directly north of the parked location at the recorded distance.
  return {
    latitude:  parkedLoc.latitude + distMeters / METERS_PER_DEG,
    longitude: parkedLoc.longitude,
  };
}

// ─── test ─────────────────────────────────────────────────────────────────────
describe('HMM Field Replay — Log 18 (real-life recording)', () => {
  let dateSpy;

  beforeEach(() => {
    // Mock Date.now() so the HMM's internal dt calculation uses log timestamps.
    // Without this, all frames run synchronously → dt≈0 → tripDrivingTime never
    // accumulates → parkedEvent never fires.
    dateSpy = jest.spyOn(global.Date, 'now').mockReturnValue(LOG_DATA[0].timestamp);
  });

  afterEach(() => {
    dateSpy.mockRestore();
  });

  test('Full cycle: walk → drive → park → away → return → clear → home park', () => {
    resetHMM();

    // ── rolling HMM state ──
    let currentState  = 'IDLE';
    let belief        = {};
    let isAway        = false;
    let parkedLocation = null;

    // ── persisted counters (mirror what the service layer tracks) ──
    let tripDrivingTime     = 0;
    let tripDrivingDistance = 0;
    let drivingCounter      = 0;
    let walkingCounter      = 0;
    let returnCounter       = 0;
    let proximityCounter    = 0;
    let lastDistanceToCar   = undefined;
    let lastTripX           = null;
    let lastTripY           = null;
    let isReturningIntentLocked = false;
    let minDistDuringReturn = Infinity;

    // ── event tracking ──
    const events = [];   // { t, type }
    const stateLog = []; // { t, state } — for failure diagnosis

    // ── synthetic GPS base (used before first park) ──
    let synthLat = BASE_LAT;

    for (let i = 0; i < LOG_DATA.length; i++) {
      const entry   = LOG_DATA[i];
      const t       = (entry.timestamp - LOG_DATA[0].timestamp) / 1000;
      const sensors = entry.sensors;
      const feats   = entry.features || {};
      const recDist = entry.hmm?.distToParked ?? 0;

      // ── synthesise GPS coords ──────────────────────────────────────────────
      // Before first park: advance synthLat from speed so the Kalman filter
      // sees realistic movement (direction doesn't matter for state detection).
      // After first park: place user at recorded distance from parked location
      // so RETURNING / clearing distance checks are accurate.
      let coords;
      if (!parkedLocation || recDist === 0) {
        const dt = i > 0
          ? (LOG_DATA[i].timestamp - LOG_DATA[i - 1].timestamp) / 1000
          : 1;
        synthLat += (sensors.speed || 0) * dt / METERS_PER_DEG;
        coords = { latitude: synthLat, longitude: BASE_LON };
      } else {
        coords = coordsAtDist(parkedLocation, recDist);
      }

      const mockLocation = {
        coords: {
          latitude:  coords.latitude,
          longitude: coords.longitude,
          speed:     sensors.speed || 0,   // m/s (as recorded)
          accuracy:  sensors.accuracy || 10,
        },
      };

      // ── motion activity ────────────────────────────────────────────────────
      const activity = sensors.activity || {};
      if (!sensors.activity) {
        const kmh = (sensors.speed || 0) * 3.6;
        if (kmh > 10)      { activity.automotive = true; activity.confidence = 2; }
        else if (kmh > 1.5){ activity.walking    = true; activity.confidence = 2; }
        else               { activity.stationary = true; activity.confidence = 2; }
      }

      // ── advance mock clock so HMM sees real dt between frames ────────────
      dateSpy.mockReturnValue(entry.timestamp);

      // ── call HMM ──────────────────────────────────────────────────────────
      const result = processLocationHMM(mockLocation, parkedLocation, {
        previousState:           currentState,
        previousBelief:          belief,
        isAway,
        isReturningIntentLocked,
        minDistDuringReturn,
        step_rate:               sensors.stepRate  || 0,
        smoothedStepRate:        sensors.stepRate  || 0,
        acceleration_magnitude:  sensors.accel     || 1.0,
        motion_activity:         activity,
        bluetoothConnected:      sensors.bluetooth || false,
        accuracy:                sensors.accuracy  || 10,
        pgr:                     feats.pgr         || 0,
        slope:                   feats.pgrSlope     || 0,
        approachAlignment:       feats.approachAlignment || 0,
        deltaRate:               feats.deltaRate    || 0,
        tripDrivingTime,
        tripDrivingDistance,
        drivingCounter,
        walkingCounter,
        returnCounter,
        proximityCounter,
        lastDistanceToCar,
        lastTripX,
        lastTripY,
      });

      // ── update rolling state ───────────────────────────────────────────────
      currentState            = result.state;
      belief                  = result.belief;
      isAway                  = result.isAway;
      isReturningIntentLocked = result.isReturningIntentLocked;
      minDistDuringReturn     = result.minDistDuringReturn;
      tripDrivingTime         = result.tripDrivingTime;
      tripDrivingDistance     = result.tripDrivingDistance;
      drivingCounter          = result.drivingCounter;
      walkingCounter          = result.walkingCounter;
      returnCounter           = result.returnCounter;
      proximityCounter        = result.proximityCounter;
      lastTripX               = result.lastTripX;
      lastTripY               = result.lastTripY;
      lastDistanceToCar       = result.distToParked;

      if (result.parkedEvent) {
        parkedLocation = { ...coords };
        events.push({ t, type: 'PARKED' });
        // reset synth anchor to parked position
        synthLat = coords.latitude;
      }
      if (result.awayEvent)        events.push({ t, type: 'AWAY' });
      if (result.clearParkingEvent){
        events.push({ t, type: 'CLEARED' });
        parkedLocation = null;
      }

      stateLog.push({ t, state: currentState });
    }

    // ── diagnostics (printed on failure) ─────────────────────────────────────
    const transitions = stateLog.filter((s, i) => i === 0 || s.state !== stateLog[i-1].state);
    const summary = transitions.map(s => `t=${s.t.toFixed(0)}s → ${s.state}`).join('\n  ');
    const eventSummary = events.map(e => `t=${e.t.toFixed(0)}s ${e.type}`).join(', ');

    // ── assertions ────────────────────────────────────────────────────────────

    const parkedEvents  = events.filter(e => e.type === 'PARKED');
    const awayEvents    = events.filter(e => e.type === 'AWAY');
    const clearEvents   = events.filter(e => e.type === 'CLEARED');

    // 1. Two parks fired
    expect(parkedEvents.length).toBe(2);

    // 2. First park: STOPPED→WALKING transition, within 20s of real (315s)
    expect(parkedEvents[0].t).toBeGreaterThan(290);
    expect(parkedEvents[0].t).toBeLessThan(360);

    // 3. Away event fired after first park
    expect(awayEvents.length).toBeGreaterThanOrEqual(1);
    expect(awayEvents[0].t).toBeGreaterThan(parkedEvents[0].t);

    // 4. RETURNING state was reached during the return journey
    const sawReturning = stateLog.some(s => s.state === 'RETURNING');
    expect(sawReturning).toBe(true);

    // 5. Spot was cleared (drove away > 100m for > 30s)
    expect(clearEvents.length).toBe(1);
    expect(clearEvents[0].t).toBeGreaterThan(600);
    expect(clearEvents[0].t).toBeLessThan(720);

    // 6. Second park fired (home) after the clear
    expect(parkedEvents[1].t).toBeGreaterThan(clearEvents[0].t);
    expect(parkedEvents[1].t).toBeGreaterThan(680);
    expect(parkedEvents[1].t).toBeLessThan(780);

    // 7. RETURNING never fired before the first park (no false positives)
    const earlyReturning = stateLog.some(s => s.t < parkedEvents[0].t && s.state === 'RETURNING');
    expect(earlyReturning).toBe(false);

    // 8. No DRIVING before first confirmed drive (t~237s)
    const earlyDriving = stateLog.some(s => s.t < 200 && s.state === 'DRIVING');
    expect(earlyDriving).toBe(false);

    console.log(`\n  Events: ${eventSummary}`);
    console.log(`\n  Transitions:\n  ${summary}`);
  });
});
