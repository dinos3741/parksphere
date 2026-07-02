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
import { seedParkedSpot } from '../utils/parkDetectionService';

const SPOT_KEY = 'EVENT_PARKED_SPOT';
const GEOFENCE_RADIUS = 200; // metres — bigger = more return lead time (within iOS reliability)
const OLD_PARK_TASK = 'PARK_DETECTION_TASK'; // legacy continuous-location task to deregister

// Geofence EXIT is ambiguous: driving off (spot is now free) vs. walking out to a far destination
// (spot is still taken). Walking tops out ~5-7 km/h; a car crossing a 200m radius is well above that.
// 10 km/h cleanly separates the two.
const DRIVE_OFF_SPEED_KMH = 10;
const EXIT_SPEED_WINDOW_MS = 7000; // background region-event execution is short — sample briefly

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
    let appStateSub = null;
    let modeTimer = null;
    let alive = null;
    let cancelled = false;

    // One shared "parked spot" for both detectors. Whoever declares the park — the HMM in the
    // foreground, CLVisit in the background — arms the same geofence and persists the same spot, so
    // return/drive-off works regardless of who set it.
    const armSpot = async (spot, source) => {
      await AsyncStorage.setItem(SPOT_KEY, JSON.stringify(spot));
      await VM.armGeofence(spot.latitude, spot.longitude, GEOFENCE_RADIUS);
      await log({ src: 'armSpot', source, lat: spot.latitude, lon: spot.longitude });
      console.log(`[Return] spot armed by ${source}:`, JSON.stringify(spot));
    };
    const clearSpot = async (source) => {
      await AsyncStorage.removeItem(SPOT_KEY);
      await VM.clearGeofence();
      await log({ src: 'clearSpot', source });
      console.log(`[Return] spot cleared by ${source}`);
    };

    const log = async (info) => { logHeartbeat(info); await flushTelemetry(); };

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
        const ts = new Date().toLocaleTimeString();
        await log({ src: 'visit', type: v?.type, lat: v?.latitude, lon: v?.longitude, app: AppState.currentState });
        console.log('[Return] visit:', JSON.stringify(v));
        if (v?.type === 'arrival') {
          if (AppState.currentState === 'active') {
            console.log('[Return] foreground CLVisit arrival ignored — HMM is the park authority.');
            return;
          }
          const spot = { latitude: v.latitude, longitude: v.longitude, accuracy: v.accuracy };
          await armSpot(spot, 'clvisit');
          await seedParkedSpot(spot); // hand the car location to the HMM for later returning
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
        const ts = new Date().toLocaleTimeString();
        await log({ src: 'geofence', type: g?.type });
        console.log('[Return] geofence:', JSON.stringify(g));
        if (g?.type === 'enter') {
          await notifyUser('🟢 Returning', `you're near your car @ ${ts}`);
        } else if (g?.type === 'exit') {
          // Distinguish driving off (spot free) from walking away to a destination (spot still taken).
          const speedKmh = await readExitSpeedKmh();
          const drivingOff = speedKmh === null ? true : speedKmh >= DRIVE_OFF_SPEED_KMH;
          const speedStr = speedKmh === null ? 'unknown' : `${Math.round(speedKmh)} km/h`;
          await log({ src: 'geofence', type: 'exit', speedKmh, drivingOff });
          if (drivingOff) {
            await notifyUser('🏁 Spot free', `drove off (${speedStr}) @ ${ts}`);
            await AsyncStorage.removeItem(SPOT_KEY);
            await VM.clearGeofence();
          } else {
            // Walked out of the radius — keep the spot + geofence so the return alert still fires.
            console.log(`[Return] exit at walking speed (${speedStr}) — keeping spot`);
          }
        }
      });

      await VM.startVisitMonitoring();
      console.log('[Return] monitoring started');

      // ── Location stream (Phase 1: verify streaming; seed of the Phase 3 mode controller) ──────
      // The HMM will consume these fixes (Phase 2). For now, log each one so a build can prove the
      // VisitMonitor stream works foreground AND after a background geofence wake. Buffered — the
      // 2-min ping (or a background event's flush) writes them, so we don't thrash the disk per fix.
      let locCount = 0;
      locSub = VM.addLocationListener((loc) => {
        if (cancelled) return;
        locCount += 1;
        logHeartbeat({ src: 'loc', n: locCount, lat: loc?.latitude, lon: loc?.longitude, spd: loc?.speed });
        console.log('[Return] loc:', JSON.stringify(loc));
      });

      // Mode controller (minimal): stream ON in the foreground so the HMM can run like today's
      // foreground path; OFF when backgrounded so the app suspends and native visit/region events
      // fire. The bounded return-window start (on geofence ENTER) comes in Phase 4.
      let lastOn = null; // dedupe: only act (and log) when the desired stream state actually changes
      const applyMode = async (state) => {
        if (cancelled) return;
        const on = state === 'active';
        if (on === lastOn) return;
        lastOn = on;
        console.log(`[Return] mode: AppState=${state} → stream ${on ? 'ON' : 'OFF'}`);
        try {
          if (on) await VM.startLocationUpdates();
          else await VM.stopLocationUpdates();
        } catch (e) { lastOn = null; console.warn('[Return] mode switch failed:', e?.message); }
      };
      appStateSub = AppState.addEventListener('change', applyMode);
      // Self-heal: on iOS Debug builds the resume 'change'→'active' event is sometimes dropped by the
      // just-woken JS thread, leaving the stream stuck OFF. Re-assert from AppState.currentState on a
      // short timer (JS is suspended in the background, so this only ticks in the foreground) so the
      // stream reliably returns without depending on catching every event.
      modeTimer = setInterval(() => applyMode(AppState.currentState), 4000);
      console.log(`[Return] mode controller armed; current AppState=${AppState.currentState}`);
      await applyMode(AppState.currentState); // apply current state on mount

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
      try { appStateSub?.remove(); } catch {}
      try { VM.stopLocationUpdates(); } catch {}
      if (modeTimer) clearInterval(modeTimer);
      if (alive) clearInterval(alive);
      // Not stopping visit/region monitoring — iOS should keep delivering visits/geofence in the
      // background. Only the location stream is torn down (it's foreground/return-window scoped).
    };
  }, []);
}
