// Event-based parking lifecycle orchestrator (native CLVisit + geofence).
//
//   CLVisit arrival   → save the spot + arm a geofence around it      → 🅿️ Parked
//   geofence ENTER    → owner crossed back toward the car             → 🟢 Returning
//   geofence EXIT     → owner left the area (at the gym: drove off)    → 🏁 Spot free
//
// All native "monitoring" services — they coexist and wake a suspended/terminated app. Each step
// fires a notification + a heartbeat so a field test is fully traceable.
//
// A geofence EXIT is ambiguous — driving off (spot free) vs. walking out to a far destination (spot
// still taken). On exit we sample speed for a few seconds: >= DRIVE_OFF_SPEED_KMH ⇒ drove off (clear
// the spot); walking speed ⇒ keep the spot + geofence so the return alert still fires when you head back.
//
// KNOWN LIMITS (test build):
//  • CLVisit arrival is delayed (minutes) and coarse — the geofence centers on an approximate spot.
import { useEffect } from 'react';
import { AppState, DeviceEventEmitter } from 'react-native';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initNotifications, notifyUser } from '../utils/notificationService';
import { logHeartbeat, flushTelemetry } from '../utils/telemetryService';
import { seedParkedSpot, queryTravelMode } from '../utils/parkDetectionService';

const SPOT_KEY = 'EVENT_PARKED_SPOT';
const GEOFENCE_RADIUS = 200; // metres — bigger = more return lead time (within iOS reliability)
const OLD_PARK_TASK = 'PARK_DETECTION_TASK'; // legacy continuous-location task to deregister

// Geofence EXIT is ambiguous: driving off (spot is now free) vs. walking out to a far destination
// (spot is still taken). Walking tops out ~5-7 km/h; a car crossing a 200m radius is well above that.
// 10 km/h cleanly separates the two.
const DRIVE_OFF_SPEED_KMH = 10;
const EXIT_SPEED_WINDOW_MS = 7000; // background region-event execution is short — sample briefly

// #2 A/B toggle — set false to disable drive-capture entirely and run the pure CLVisit + geofence
// path (the old proven background behavior). Used to isolate whether continuous drive-capture location
// is what's suppressing iOS's visit/geofence background wakeups. SLC stays on (low-power wake helper).
// ── Build toggles (2026-07-05 A/B/C/D background-wake investigation) ──────────────────────────────
//   Build B = drive-capture only (buried, buffered).  Build C = rolling fence only (dense live wakes
//   then iOS-throttled).  Build D = drive-capture + CLBackgroundActivitySession to keep the app ALIVE
//   through the drive (iOS 17+) — ALL FAILED (app suspended, ride buffered into one foreground flush).
//   ⭐ OPTION 1 (2026-07-06): stop fighting iOS. Build A base (drive-capture OFF) wakes reliably in the
//   background (verified ~6 live wakes/ride, app:background); each wake grabs a fresh one-shot fix to
//   build a trip trail, and the spot is anchored on the fix nearest the coprocessor's vehicle-stop time
//   — NOT the CLVisit dwell (which is the destination, wrong when you park then walk). See the memory
//   note "DIRECTION 2026-07-06". Flip these to re-run an old experiment; only one at a time.
// ⭐ BUILD E-PROBE (2026-07-07): re-run the D-v2 config (drive-capture + session + liveUpdates) but
// now with a NATIVE heartbeat in the Swift liveUpdates loop. Goal: prove whether NATIVE code runs
// LIVE during the drive while the JS thread is suspended (research 2026-07-07 says it should — iOS
// freezes the RN JS thread, not the native location process). If native ticks live → build native
// park-detection + local notification (real Build E). Read src:'nativeHb' entries in the heartbeat:
// spread `t` with small `t-gps` = native alive; clustered `t` at foreground with huge delta = frozen.
const DRIVE_CAPTURE_ENABLED = true;      // BUILD E-PROBE: continuous drive-capture (kept-alive candidate)
const BACKGROUND_SESSION_ENABLED = true; // BUILD E-PROBE: hold CLBackgroundActivitySession (iOS 17+)
const USE_LIVE_UPDATES = true;           // BUILD E-PROBE: deliver via CLLocationUpdate.liveUpdates (the API the session sustains)
const ROLLING_FENCE_ENABLED = false;     // (Build C) off — iOS throttles rapid region re-arming
// House test (2026-07-08): when true, backgrounding the app schedules a native notification ~15s out,
// so a lock-screen "🔧 Native alive (scheduled)" confirms native→notification delivery with no drive.
// Set false once confirmed (it would nag on every background otherwise).
const NATIVE_NOTIF_HOUSE_TEST = true;
const HOUSE_TEST_DELAY_SEC = 15;
const ROLLING_FENCE_RADIUS = 400;        // metres (Build C) — finer than SLC's ~500m, coarse enough to dodge the throttle

// #3 Retroactive park thresholds. A CLVisit arrival whose arrivalDate is well in the past is a
// background park the app slept through — delivered only now, on foreground, in a buffer flush — NOT a
// live foreground dwell. Honor it as a fallback park instead of dropping it.
const STALE_ARRIVAL_MS = 90 * 1000;   // arrival older than this ⇒ buffered/background, not a live dwell
const RETRO_FALLBACK_DELAY_MS = 5000; // defer the coarse fallback so a dense-buffer HMM park can win first
const HMM_DEDUP_MS = 15000;           // if the HMM parked this recently, it wins (precise) — skip fallback
const TRAVEL_LOOKBACK_MS = 25 * 60 * 1000; // how far back to ask the coprocessor "was this a real trip?"

// ── Option 1: background-wake fix trail + vehicle-stop anchoring ────────────────────────────────────
const ONE_SHOT_THROTTLE_MS = 20 * 1000;      // grab at most one fresh fix per background wake burst
const TRIP_FIX_MAX = 300;                    // cap the in-memory trip trail
const TRIP_FIX_MAX_AGE_MS = 45 * 60 * 1000;  // prune trail fixes older than this
const CAR_SPOT_WINDOW_PAD_MS = 90 * 1000;    // tolerance around the vehicle-stop time when choosing the fix
// Field test 2026-07-07 (ground truth): at Build A wake cadence the car-stop moment falls in a wake
// gap, so the nearest trail fix is usually a STALE driving fix (413m off) or the walk-destination desk
// — both WORSE than the plain CLVisit dwell (114m). Only trust a trail fix if it lands within this
// tight gate of the coprocessor's vehicle-stop instant (i.e. a wake genuinely coincided with the park);
// otherwise fall back to the dwell so we are NEVER worse than plain CLVisit. See the memory note.
const STOP_TIME_GATE_MS = 60 * 1000;

// Sample location for a few seconds on a geofence exit and return the max speed seen (km/h), or null
// if no valid speed fix arrives (coords.speed is -1/unknown until GPS establishes velocity). Exits
// early the moment a clear driving speed is seen so a real drive-off is handled fast.
async function readExitSpeedKmh() {
  return new Promise((resolve) => {
    let sub = null;
    let best = null;
    let settled = false;
    const finish = (val) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { sub?.remove(); } catch (_) {}
      resolve(val);
    };
    const timer = setTimeout(() => finish(best), EXIT_SPEED_WINDOW_MS);
    Location.watchPositionAsync(
      { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
      (loc) => {
        const s = loc?.coords?.speed;
        if (typeof s === 'number' && s >= 0) {
          const kmh = s * 3.6;
          if (best === null || kmh > best) best = kmh;
          if (kmh >= DRIVE_OFF_SPEED_KMH) finish(kmh); // unmistakably driving — decide now
        }
      }
    ).then((s) => { if (settled) { try { s.remove(); } catch (_) {} } else { sub = s; } })
     .catch(() => finish(best));
  });
}

// A previous build called Location.startLocationUpdatesAsync(PARK_DETECTION_TASK), which registers
// a continuous-location task with iOS that PERSISTS across launches. It keeps location active in the
// background (invalidating the CLVisit/geofence suspension test + draining battery) even though the
// engine code is now disabled. Deregister it once on startup.
async function killLegacyLocationTask() {
  // Unconditional: hasStartedLocationUpdatesAsync reports false for a task registered by a PREVIOUS
  // install while iOS still delivers to it, so a gate skips the cleanup. Each call is independently
  // guarded so one failing doesn't block the others.
  try { await Location.stopLocationUpdatesAsync(OLD_PARK_TASK); } catch (_) {}
  try { await TaskManager.unregisterTaskAsync(OLD_PARK_TASK); } catch (_) {}
  console.log('[Return] legacy location task cleanup attempted');
}

let VM = null;
try {
  VM = require('../modules/visit-monitor');
} catch (e) {
  console.warn('[Return] VisitMonitor native module unavailable (needs a rebuild):', e.message);
}

export function useReturnDetection() {
  useEffect(() => {
    if (!VM) return;
    let visitSub = null;
    let geoSub = null;
    let locSub = null;
    let hmmSpotSub = null;
    let pausedSub = null;
    let resumedSub = null;
    let appStateSub = null;
    let modeTimer = null;
    let alive = null;
    let cancelled = false;

    // ── Drive-capture state (precise background park via iOS auto-pause) ──────────────────────────
    // On a drive we run VisitMonitor's auto-pausing .automotiveNavigation location; iOS pauses it at
    // the park and the last fix before the pause is the real spot. driveSessionSawDriving gates it so
    // a departure-on-foot can't produce a false park at a walking destination.
    let driveCaptureActive = false;
    let lastDriveFix = null;
    let driveSessionSawDriving = false;
    let lastDepartureTs = 0; // last CLVisit departure time — start of the travel window we ask the coprocessor about
    let driveSpotSetThisTrip = false; // dedupe: once drive-capture set a precise spot, ignore coarse CLVisit
    let driveTimer = null; // safety: force-end drive-capture if iOS never auto-pauses
    let lastHmmParkAt = 0; // when the HMM last declared a park — so a coarse retroactive fallback yields to it
    const DRIVE_CAPTURE_MAX_MS = 60 * 60 * 1000; // 60 min hard cap
    // Defined in the mode-controller block below (needs applyMode); handlers close over this let and
    // call it after the effect body has run, so the real implementation is in place by then.
    let startDriveCapture = async () => {};

    // ── Option 1: trip fix trail + one-shot densifier ────────────────────────────────────────────
    // Build A wakes the app ~every few minutes in the background but each wake carries a coarse/cached
    // fix. We keep a rolling trail of all wake fixes (+ a fresh best-accuracy one-shot per wake) so that
    // when a park is confirmed we can anchor the spot on the fix nearest the vehicle-stop time (below),
    // rather than the CLVisit dwell (= destination, wrong when you park then walk to it).
    let tripFixes = []; // { lat, lon, acc, t }
    let lastOneShotAt = 0;
    const pushTripFix = (f) => {
      if (!f || typeof f.latitude !== 'number') return;
      const t = f.timestamp || Date.now();
      tripFixes.push({ lat: f.latitude, lon: f.longitude, acc: f.accuracy, t });
      const cutoff = Date.now() - TRIP_FIX_MAX_AGE_MS;
      while (tripFixes.length && tripFixes[0].t < cutoff) tripFixes.shift();
      if (tripFixes.length > TRIP_FIX_MAX) tripFixes.splice(0, tripFixes.length - TRIP_FIX_MAX);
    };
    // Request a fresh best-accuracy fix on a background wake (throttled). No-op in the foreground (the
    // live stream is already running) or on an un-rebuilt binary. The result returns via onLocationBatch.
    const maybeOneShot = () => {
      if (AppState.currentState === 'active' || !VM?.requestOneShotLocation) return;
      const now = Date.now();
      if (now - lastOneShotAt <= ONE_SHOT_THROTTLE_MS) return;
      lastOneShotAt = now;
      VM.requestOneShotLocation().catch(() => {});
    };
    // Pick the parked-car location: the trail fix closest in time to when vehicle motion stopped
    // (from the coprocessor). Falls back to the CLVisit dwell if we have no vehicle-stop time or no
    // trail fix in the travel window. Returns { spot, source } so the heartbeat records which won.
    const pickCarSpot = (vehicleEndMs, since, until, fallback) => {
      if (!vehicleEndMs || !tripFixes.length) return { spot: fallback, source: 'clvisit' };
      const lo = (since || 0) - CAR_SPOT_WINDOW_PAD_MS;
      const hi = (until || Date.now()) + CAR_SPOT_WINDOW_PAD_MS;
      let best = null, bestD = Infinity;
      for (const f of tripFixes) {
        if (f.t < lo || f.t > hi) continue;
        const d = Math.abs(f.t - vehicleEndMs);
        if (d < bestD) { bestD = d; best = f; }
      }
      // Only override the dwell if a fix genuinely coincided with the stop; a distant fix is a stale
      // driving waypoint or the walk destination — both worse than the dwell (proven 2026-07-07).
      if (!best || bestD > STOP_TIME_GATE_MS) return { spot: fallback, source: 'clvisit' };
      return { spot: { latitude: best.lat, longitude: best.lon, accuracy: best.acc }, source: 'vehicle-stop' };
    };

    // One shared "parked spot" for both detectors. Whoever declares the park — the HMM in the
    // foreground, CLVisit in the background — arms the same geofence and persists the same spot, so
    // return/drive-off works regardless of who set it.
    const armSpot = async (spot, source) => {
      driveCaptureActive = false; // a spot exists now → the drive is over
      if (driveTimer) { clearTimeout(driveTimer); driveTimer = null; }
      await AsyncStorage.setItem(SPOT_KEY, JSON.stringify(spot));
      await VM.armGeofence(spot.latitude, spot.longitude, GEOFENCE_RADIUS);
      await log({ src: 'armSpot', source, lat: spot.latitude, lon: spot.longitude });
      console.log(`[Return] spot armed by ${source}:`, JSON.stringify(spot));
      await stopRolling(); // trip's over — the parked-spot geofence takes over from the rolling one
      // Build D: release the background session on park (applyMode isn't re-run from here).
      if (BACKGROUND_SESSION_ENABLED && VM?.stopBackgroundSession) {
        try { await VM.stopBackgroundSession(); await log({ src: 'bgSession', action: 'stop', mode: 'armed' }); } catch (_) {}
      }
    };
    const clearSpot = async (source) => {
      await AsyncStorage.removeItem(SPOT_KEY);
      await VM.clearGeofence();
      await seedParkedSpot(null); // keep the HMM's PARK_STATE in sync so no stale spot resurfaces
      await log({ src: 'clearSpot', source });
      console.log(`[Return] spot cleared by ${source}`);
    };

    const log = async (info) => { logHeartbeat(info); await flushTelemetry(); };

    // ── Rolling geofence (Build C) — start on trip departure, stop once a spot is armed ──────────────
    let rollingActive = false;
    const startRolling = async () => {
      if (!ROLLING_FENCE_ENABLED || rollingActive || !VM?.startRollingFence) return;
      rollingActive = true;
      try { await VM.startRollingFence(ROLLING_FENCE_RADIUS); await log({ src: 'roll', type: 'start' }); }
      catch (e) { rollingActive = false; console.warn('[Return] startRollingFence failed (rebuild?):', e?.message); }
    };
    const stopRolling = async () => {
      if (!rollingActive || !VM?.stopRollingFence) return;
      rollingActive = false;
      try { await VM.stopRollingFence(); await log({ src: 'roll', type: 'stop' }); } catch (_) {}
    };

    // ── Native heartbeat merge (Build E premise test) ────────────────────────────────────────────
    // Pull the native-captured heartbeat lines (written by the Swift liveUpdates loop, off the JS
    // thread) and fold them into the telemetry heartbeat, preserving each line's NATIVE timestamp `t`
    // and its GPS time `gps`. `dtMs = t - gps`: ~0 across the drive ⇒ native ran LIVE while JS slept;
    // a huge delta clustered at foreground ⇒ native was frozen too. Runs on every foreground.
    const mergeNativeLog = async () => {
      if (!VM?.readNativeLog) return;
      try {
        const raw = await VM.readNativeLog();
        const lines = (raw || '').split('\n').filter(Boolean);
        if (!lines.length) return;
        for (const ln of lines) {
          try {
            const e = JSON.parse(ln);
            logHeartbeat({ src: 'nativeHb', t: e.t, gps: e.gps, lat: e.lat, lon: e.lon, spd: e.spd, tag: e.tag, dtMs: Math.round((e.t || 0) - (e.gps || 0)), mergedAt: Date.now() });
          } catch (_) {}
        }
        await flushTelemetry();
        await VM.clearNativeLog();
        console.log(`[Return] merged ${lines.length} native heartbeat lines`);
      } catch (e) { console.warn('[Return] mergeNativeLog failed (rebuild?):', e?.message); }
    };

    // Did the user actually travel to this dwell (car or bike), or just walk-and-dwell? A CLVisit
    // arrival alone can't tell — walking around the city and stopping at places logs arrivals too, and
    // those were arming phantom parks (2026-07-05). Ask the motion coprocessor how the travel window
    // was spent; it records automotive/cycling/walking 24/7 in hardware, so this works even in the
    // background with no location stream (Build A, drive-capture OFF). Falls back to the drive-capture
    // flag only if the coprocessor is unavailable. Logs the breakdown so the heartbeat shows what it saw.
    // Returns { isTrip, vehicleEndMs, since, until }. isTrip gates arming a park at all (a walking
    // dwell must not); vehicleEndMs + the window let pickCarSpot anchor on the real car location.
    const droveToHere = async (arrivalMs) => {
      const until = arrivalMs || Date.now();
      const since = (lastDepartureTs && lastDepartureTs < until && until - lastDepartureTs < TRAVEL_LOOKBACK_MS)
        ? lastDepartureTs
        : until - TRAVEL_LOOKBACK_MS;
      const travel = await queryTravelMode(since, until);
      await log({ src: 'travelMode', ...travel, sinceMs: since, untilMs: until });
      const isTrip = travel.available ? travel.isVehicleTrip : driveSessionSawDriving; // fallback: old flag
      return { isTrip, vehicleEndMs: travel.lastVehicleEndMs || null, since, until };
    };

    (async () => {
      await initNotifications();
      await killLegacyLocationTask(); // stop the old continuous-location task so the app can suspend

      // Re-arm the geofence from a stored spot on launch (covers a fresh process after relaunch).
      try {
        const saved = await AsyncStorage.getItem(SPOT_KEY);
        if (saved) {
          const s = JSON.parse(saved);
          await VM.armGeofence(s.latitude, s.longitude, GEOFENCE_RADIUS);
          console.log('[Return] re-armed geofence from stored spot:', saved);
        }
      } catch (_) {}

      // CLVisit → park (BACKGROUND only). In the foreground the HMM is the authority and sets the
      // spot via its park event (below), so ignore CLVisit arrivals while active — this stops CLVisit
      // from arming a geofence at every foreground dwell. In the background the HMM can't run, so
      // CLVisit is the park source; it also seeds the HMM's parkedLocation so returning works if the
      // app later comes forward.
      visitSub = VM.addVisitListener(async (v) => {
        if (cancelled) return;
        maybeOneShot(); // Option 1: a visit is a background wake — grab a fresh fix for the trail
        const ts = new Date().toLocaleTimeString();
        // Log the REAL arrival/departure times (from CLVisit) + delivery time, so a buffered/late event
        // (arrival far in the past, delivered now) is distinguishable from a live one — without this we
        // can't tell "iOS woke us late" from "iOS never woke us" (everything just reads the flush time).
        await log({ src: 'visit', type: v?.type, lat: v?.latitude, lon: v?.longitude, app: AppState.currentState, arrival: v?.arrival, departure: v?.departure });
        console.log('[Return] visit:', JSON.stringify(v));
        if (v?.type === 'departure') {
          // Leaving a place → a drive is likely starting. Remember when, so the next arrival can ask the
          // coprocessor how the in-between window was travelled. Kick off drive-capture so iOS's auto-pause
          // catches the actual parking spot (precise), instead of relying on the coarse arrival dwell.
          lastDepartureTs = v?.departure || Date.now();
          await startDriveCapture();
          await startRolling(); // Build C: begin periodic movement wakes for the trip
          return;
        }
        if (v?.type === 'arrival') {
          const spot = { latitude: v.latitude, longitude: v.longitude, accuracy: v.accuracy };
          const arrivalAgeMs = v?.arrival ? Date.now() - v.arrival : null;
          const buffered = arrivalAgeMs !== null && arrivalAgeMs > STALE_ARRIVAL_MS;

          if (driveSpotSetThisTrip) {
            console.log('[Return] CLVisit arrival ignored — drive-capture already set the precise spot.');
            return;
          }
          if (AppState.currentState === 'active' && !buffered) {
            // A live foreground dwell — the HMM is the park authority here, so ignore CLVisit.
            console.log('[Return] foreground live CLVisit arrival ignored — HMM is the park authority.');
            return;
          }
          if (AppState.currentState === 'active' && buffered) {
            // #3 Retroactive park: this arrival actually happened in the BACKGROUND (arrivalDate is old)
            // and is only surfacing now, on foreground, in a buffer flush — a park the app slept through.
            // Defer briefly so a dense-buffer HMM park from the same flush can win (precise); if none
            // lands, arm the coarse CLVisit spot so the user recovers their car instead of getting nothing.
            console.log(`[Return] buffered CLVisit arrival (age ${Math.round(arrivalAgeMs / 1000)}s) — deferring retroactive fallback`);
            setTimeout(async () => {
              if (cancelled || driveSpotSetThisTrip) return;
              if (Date.now() - lastHmmParkAt < HMM_DEDUP_MS) {
                console.log('[Return] retroactive fallback skipped — HMM already parked from this flush.');
                return;
              }
              // Only recover a park if the coprocessor shows a real trip (car/bike) into this dwell — a
              // pure walking dwell (café, shop) must not resurrect a phantom park on foreground flush.
              const travel = await droveToHere(v.arrival);
              if (!travel.isTrip) {
                console.log('[Return] retroactive fallback skipped — coprocessor shows no vehicle trip (walking dwell).');
                return;
              }
              // Anchor on the vehicle-stop fix (the car), not the CLVisit dwell (the destination).
              const { spot: carSpot, source } = pickCarSpot(travel.vehicleEndMs, travel.since, travel.until, spot);
              await armSpot(carSpot, source === 'vehicle-stop' ? 'vehicle-stop-retro' : 'clvisit-retro');
              await seedParkedSpot(carSpot);
              await notifyUser('🅿️ Parked (recovered)', `saved a background park we slept through @ ${ts}`);
            }, RETRO_FALLBACK_DELAY_MS);
            return;
          }
          // Background arrival — the park signal in Option 1 (drive-capture is off). Confirm a real trip
          // (car/bike) into this dwell first — a walking dwell must not arm. Then anchor the spot on the
          // vehicle-stop fix from the trip trail (the car), falling back to CLVisit's coarse dwell.
          const travel = await droveToHere(v.arrival);
          if (!travel.isTrip) {
            console.log('[Return] background CLVisit arrival ignored — coprocessor shows no vehicle trip (walking dwell).');
            return;
          }
          const { spot: carSpot, source } = pickCarSpot(travel.vehicleEndMs, travel.since, travel.until, spot);
          await armSpot(carSpot, source);
          await seedParkedSpot(carSpot); // hand the car location to the HMM for later returning
          await notifyUser('🅿️ Parked', `spot saved + geofence armed @ ${ts}`);
        }
      });

      // HMM → park / drive-off (FOREGROUND). The reactivated HMM declares parks via parkDetectionUpdate
      // ({parkedLocation}) and drive-offs via ({clearParkedLocation}); mirror those onto the shared
      // spot + geofence so the HMM is the foreground park source (a real drove→stopped→walked, not
      // every dwell).
      hmmSpotSub = DeviceEventEmitter.addListener('parkDetectionUpdate', async (data) => {
        if (cancelled) return;
        try {
          if (data?.parkedLocation) {
            lastHmmParkAt = Date.now(); // mark the HMM park so a coarse retroactive CLVisit fallback yields to it
            await armSpot(
              { latitude: data.parkedLocation.latitude, longitude: data.parkedLocation.longitude, accuracy: data.parkedLocation.accuracy },
              'hmm'
            );
          } else if (data?.clearParkedLocation) {
            await clearSpot('hmm');
          }
        } catch (e) { console.warn('[Return] HMM spot sync failed:', e?.message); }
      });

      // Geofence → return / drive-off
      geoSub = VM.addGeofenceListener(async (g) => {
        if (cancelled) return;
        maybeOneShot(); // Option 1: a geofence crossing is a background wake — grab a fresh fix
        const ts = new Date().toLocaleTimeString();
        // Rolling-fence crossings are a Build C wake probe — re-armed + fed to the HMM natively. Just
        // record the wake (with its live/buffered app tag) and DON'T run parked-spot return/drive-off.
        if (g?.id === 'rollingFence') {
          await log({ src: 'roll', type: g?.type, lat: g?.lat, lon: g?.lon, app: AppState.currentState });
          return;
        }
        await log({ src: 'geofence', type: g?.type });
        console.log('[Return] geofence:', JSON.stringify(g));
        if (g?.type === 'enter') {
          await notifyUser('🟢 Returning', `you're near your car @ ${ts}`);
        } else if (g?.type === 'exit') {
          // Distinguish driving off (spot free) from walking away to a destination (spot still taken).
          // Unknown speed (null) must NOT clear the spot — a missing reading on an exit-while-walking
          // would otherwise free the spot from under you (seen 2026-07-05). Default to KEEP; a genuinely
          // stale spot self-heals on the next CLVisit arrival.
          const speedKmh = await readExitSpeedKmh();
          const drivingOff = speedKmh === null ? false : speedKmh >= DRIVE_OFF_SPEED_KMH;
          const speedStr = speedKmh === null ? 'unknown' : `${Math.round(speedKmh)} km/h`;
          await log({ src: 'geofence', type: 'exit', speedKmh, drivingOff });
          if (drivingOff) {
            await notifyUser('🏁 Spot free', `drove off (${speedStr}) @ ${ts}`);
            await clearSpot('geofence-driveoff'); // clears SPOT_KEY + geofence + HMM PARK_STATE together
          } else {
            // Walked out of the radius — keep the spot + geofence so the return alert still fires.
            console.log(`[Return] exit at walking speed (${speedStr}) — keeping spot`);
          }
        }
      });

      await VM.startVisitMonitoring();
      // SLC: low-power background wake on ~500m movement so a new drive can (re)start drive-capture
      // after iOS auto-paused location at the previous park. Guarded — absent on an un-rebuilt binary.
      try { await VM.startSignificantChangeMonitoring(); } catch (e) { console.warn('[Return] SLC start failed (rebuild?):', e?.message); }
      console.log('[Return] monitoring started (visits + SLC)');

      // ── Location stream (Phase 1: verify streaming; seed of the Phase 3 mode controller) ──────
      // The HMM will consume these fixes (Phase 2). For now, log each one so a build can prove the
      // VisitMonitor stream works foreground AND after a background geofence wake. Buffered — the
      // 2-min ping (or a background event's flush) writes them, so we don't thrash the disk per fix.
      let locCount = 0;
      locSub = VM.addLocationBatchListener((batch) => {
        if (cancelled) return;
        const fixes = batch?.locations || [];
        if (!fixes.length) return;
        locCount += fixes.length;
        for (const f of fixes) pushTripFix(f); // Option 1: build the trip trail for car-spot anchoring
        // A background batch while we're neither foreground nor already capturing means SLC woke us
        // for a new drive (~500m of movement) — start drive-capture so location keeps flowing through
        // the park. Timely trigger; CLVisit departure (delayed minutes) is only a backup.
        if (!driveCaptureActive && AppState.currentState !== 'active') {
          maybeOneShot();  // Option 1: grab a fresh best-accuracy fix on this bg wake (throttled)
          startDriveCapture();
          startRolling(); // Build C: also (re)start the rolling fence on any bg movement wake, not just CLVisit departure
        }
        const last = fixes[fixes.length - 1];
        if (driveCaptureActive) {
          lastDriveFix = last;
          if (fixes.some((f) => (f.speed || 0) * 3.6 > 15)) driveSessionSawDriving = true;
        }
        logHeartbeat({ src: 'loc', n: locCount, batch: fixes.length, lat: last?.latitude, lon: last?.longitude, spd: last?.speed, drive: driveCaptureActive });
        console.log(`[Return] loc batch (${fixes.length}):`, JSON.stringify(last));
      });

      // iOS auto-paused location (device parked) → the last drive fix is the parking spot. Gate on
      // driveSessionSawDriving so a departure-on-foot that pauses at a walking destination doesn't
      // register a phantom park.
      pausedSub = VM.addLocationPausedListener(async () => {
        if (cancelled) return;
        const capturing = driveCaptureActive;
        const drove = driveSessionSawDriving;
        await log({ src: 'locationPaused', capturing, drove, hasFix: !!lastDriveFix });
        console.log(`[Return] iOS auto-paused (parked). capturing=${capturing} drove=${drove}`);
        driveCaptureActive = false;
        await applyMode(); // drive-capture over → release location (off if backgrounded)
        if (!capturing || !drove || !lastDriveFix) {
          console.log('[Return] pause ignored (not a real drive/no fix) — CLVisit fallback stands.');
          return;
        }
        const spot = { latitude: lastDriveFix.latitude, longitude: lastDriveFix.longitude, accuracy: lastDriveFix.accuracy };
        await armSpot(spot, 'drive');
        await seedParkedSpot(spot);
        driveSpotSetThisTrip = true;
        await notifyUser('🅿️ Parked', `spot captured @ ${new Date().toLocaleTimeString()}`);
      });
      resumedSub = VM.addLocationResumedListener(async () => {
        if (cancelled) return;
        await log({ src: 'locationResumed' });
        console.log('[Return] iOS resumed location (movement).');
      });

      // Mode controller — one CLLocationManager, three location modes:
      //   • foreground (AppState active)      → 'stream' (continuous, no pause) so the HMM runs live.
      //   • background + drive-capturing      → 'drive'  (auto-pausing .automotiveNavigation) to catch the park.
      //   • otherwise                         → 'off'    so the app suspends; SLC/visit/geofence wake it.
      let lastMode = null; // dedupe: only act (and log) when the desired mode actually changes
      const applyMode = async () => {
        if (cancelled) return;
        const active = AppState.currentState === 'active';
        const mode = active ? 'stream' : (driveCaptureActive ? 'drive' : 'off');
        if (mode === lastMode) return;
        lastMode = mode;
        console.log(`[Return] location mode → ${mode} (app=${AppState.currentState}, drive=${driveCaptureActive})`);
        try {
          if (mode === 'drive') {
            // Build D-v2: modern liveUpdates (kept alive by the session) vs legacy startUpdatingLocation.
            if (USE_LIVE_UPDATES && VM.startDriveLiveUpdates) await VM.startDriveLiveUpdates();
            else await VM.startDriveLocationUpdates();
          } else {
            if (VM.stopDriveLiveUpdates) await VM.stopDriveLiveUpdates(); // end the live task when leaving drive
            if (mode === 'stream') await VM.startLocationUpdates();
            else await VM.stopLocationUpdates();
          }
        } catch (e) { lastMode = null; console.warn('[Return] mode switch failed:', e?.message); }
        // Build D: hold a CLBackgroundActivitySession for the duration of a background drive so iOS
        // keeps the app alive receiving fixes instead of suspending-and-buffering (Build B failure).
        // Bound to 'drive' mode — released the moment we leave it (park, foreground, or suspend).
        if (BACKGROUND_SESSION_ENABLED && VM?.startBackgroundSession) {
          try {
            if (mode === 'drive') { await VM.startBackgroundSession(); await log({ src: 'bgSession', action: 'start' }); }
            else { await VM.stopBackgroundSession(); await log({ src: 'bgSession', action: 'stop', mode }); }
          } catch (e) { console.warn('[Return] bgSession toggle failed (rebuild?):', e?.message); }
        }
      };
      startDriveCapture = async () => {
        if (!DRIVE_CAPTURE_ENABLED) return; // #2 A/B: pure CLVisit + geofence when disabled
        if (driveCaptureActive) return;
        driveCaptureActive = true;
        lastDriveFix = null;
        driveSessionSawDriving = false;
        driveSpotSetThisTrip = false;
        if (driveTimer) clearTimeout(driveTimer);
        driveTimer = setTimeout(async () => {
          if (!driveCaptureActive) return;
          console.log('[Return] drive-capture hit max duration — ending (iOS never auto-paused).');
          driveCaptureActive = false;
          await log({ src: 'driveCapture', action: 'timeout' });
          await applyMode();
        }, DRIVE_CAPTURE_MAX_MS);
        await log({ src: 'driveCapture', action: 'start', app: AppState.currentState });
        console.log('[Return] drive-capture started');
        await applyMode(); // → 'drive' if backgrounded
      };
      appStateSub = AppState.addEventListener('change', (s) => {
        applyMode();
        if (s === 'active') mergeNativeLog(); // fold in native-captured fixes on foreground
        // House test: on backgrounding, schedule a native notification so it lands while suspended.
        if (NATIVE_NOTIF_HOUSE_TEST && (s === 'background' || s === 'inactive') && VM?.scheduleTestNotification) {
          VM.scheduleTestNotification(HOUSE_TEST_DELAY_SEC).catch(() => {});
        }
      });
      // Self-heal: on iOS Debug builds the resume 'change'→'active' event is sometimes dropped by the
      // just-woken JS thread. Re-assert the mode on a short timer (JS is suspended in the background,
      // so this only ticks in the foreground) so the stream reliably returns on foreground.
      modeTimer = setInterval(() => applyMode(), 4000);
      console.log(`[Return] mode controller armed; current AppState=${AppState.currentState}`);
      await applyMode(); // apply current state on mount
      await mergeNativeLog(); // fold in any native-captured fixes buffered from a drive before this launch

      // Light liveness ping (cadence while awake, gap while suspended) for traceability.
      const ping = async () => { if (!cancelled) await log({ src: 'alive' }); };
      await ping();
      alive = setInterval(ping, 120000);
    })();

    return () => {
      cancelled = true;
      try { visitSub?.remove(); } catch {}
      try { geoSub?.remove(); } catch {}
      try { locSub?.remove(); } catch {}
      try { hmmSpotSub?.remove(); } catch {}
      try { pausedSub?.remove(); } catch {}
      try { resumedSub?.remove(); } catch {}
      try { appStateSub?.remove(); } catch {}
      try { VM.stopLocationUpdates(); } catch {}
      try { VM.stopSignificantChangeMonitoring(); } catch {}
      if (modeTimer) clearInterval(modeTimer);
      if (driveTimer) clearTimeout(driveTimer);
      if (alive) clearInterval(alive);
      // Not stopping visit/region monitoring — iOS should keep delivering visits/geofence in the
      // background. Only the location stream is torn down (it's foreground/return-window scoped).
    };
  }, []);
}
