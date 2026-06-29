// Event-based parking lifecycle orchestrator (native CLVisit + geofence).
//
//   CLVisit arrival   → save the spot + arm a geofence around it      → 🅿️ Parked
//   geofence ENTER    → owner crossed back toward the car             → 🟢 Returning
//   geofence EXIT     → owner left the area (at the gym: drove off)    → 🏁 Spot free
//
// All native "monitoring" services — they coexist and wake a suspended/terminated app. Each step
// fires a notification + a heartbeat so a field test is fully traceable.
//
// KNOWN LIMITS (test build):
//  • CLVisit arrival is delayed (minutes) and coarse — the geofence centers on an approximate spot.
//  • A geofence EXIT means "drove off" at the gym (you stay inside the radius until you drive), but
//    for far-walk parking an EXIT can also be "walked away to a destination" — distinguishing the
//    two needs a speed check on exit (a refinement, not in this build).
import { useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { initNotifications, notifyUser } from '../utils/notificationService';
import { logHeartbeat, flushTelemetry } from '../utils/telemetryService';

const SPOT_KEY = 'EVENT_PARKED_SPOT';
const GEOFENCE_RADIUS = 150; // metres (≈ iOS reliable floor)

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
    let alive = null;
    let cancelled = false;

    const log = async (info) => { logHeartbeat(info); await flushTelemetry(); };

    (async () => {
      await initNotifications();

      // Re-arm the geofence from a stored spot on launch (covers a fresh process after relaunch).
      try {
        const saved = await AsyncStorage.getItem(SPOT_KEY);
        if (saved) {
          const s = JSON.parse(saved);
          await VM.armGeofence(s.latitude, s.longitude, GEOFENCE_RADIUS);
          console.log('[Return] re-armed geofence from stored spot:', saved);
        }
      } catch (_) {}

      // CLVisit → park
      visitSub = VM.addVisitListener(async (v) => {
        if (cancelled) return;
        const ts = new Date().toLocaleTimeString();
        await log({ src: 'visit', type: v?.type, lat: v?.latitude, lon: v?.longitude });
        console.log('[Return] visit:', JSON.stringify(v));
        if (v?.type === 'arrival') {
          const spot = { latitude: v.latitude, longitude: v.longitude };
          await AsyncStorage.setItem(SPOT_KEY, JSON.stringify(spot));
          await VM.armGeofence(spot.latitude, spot.longitude, GEOFENCE_RADIUS);
          await notifyUser('🅿️ Parked', `spot saved + geofence armed @ ${ts}`);
        }
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
          await notifyUser('🏁 Spot free', `drove off @ ${ts}`);
          await AsyncStorage.removeItem(SPOT_KEY);
          await VM.clearGeofence();
        }
      });

      await VM.startVisitMonitoring();
      console.log('[Return] monitoring started');

      // Light liveness ping (cadence while awake, gap while suspended) for traceability.
      const ping = async () => { if (!cancelled) await log({ src: 'alive' }); };
      await ping();
      alive = setInterval(ping, 120000);
    })();

    return () => {
      cancelled = true;
      try { visitSub?.remove(); } catch {}
      try { geoSub?.remove(); } catch {}
      if (alive) clearInterval(alive);
      // Not stopping monitoring — iOS should keep delivering visits/geofence in the background.
    };
  }, []);
}
