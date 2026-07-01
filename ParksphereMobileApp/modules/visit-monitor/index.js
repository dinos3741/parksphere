// JS interface for the VisitMonitor native module (iOS CLVisit + region monitoring).
//
// requireNativeModule throws if the native module isn't in the build (Expo Go / not yet rebuilt),
// so callers should guard the import.
import { requireNativeModule } from 'expo-modules-core';

const VisitMonitor = requireNativeModule('VisitMonitor');

// ── CLVisit (park / depart) ──────────────────────────────────────────────────
// iOS delivers arrival/departure even after the app is suspended/terminated, once confident.
export function startVisitMonitoring() {
  return VisitMonitor.start();
}
export function stopVisitMonitoring() {
  return VisitMonitor.stop();
}
// listener({ type: 'arrival'|'departure', latitude, longitude, accuracy, arrival, departure })
export function addVisitListener(listener) {
  return VisitMonitor.addListener('onVisit', listener);
}

// ── Geofence (return / drive-off) ────────────────────────────────────────────
// Arm a region around the parked spot. ENTER = owner returning; EXIT = drove off. iOS wakes a
// suspended/terminated app on the crossing and keeps monitoring across app termination.
export function armGeofence(latitude, longitude, radius = 150) {
  return VisitMonitor.armGeofence(latitude, longitude, radius);
}
export function clearGeofence() {
  return VisitMonitor.clearGeofence();
}
// listener({ type: 'enter'|'exit', id })
export function addGeofenceListener(listener) {
  return VisitMonitor.addListener('onGeofence', listener);
}

// ── On-demand location stream (feeds the HMM) ────────────────────────────────
// Streams fixes from the SAME CLLocationManager that does visits + regions, so the app never runs a
// second location owner. The JS mode controller turns this on for the foreground and for the bounded
// return window after a geofence ENTER, and off otherwise so the app can suspend.
export function startLocationUpdates() {
  return VisitMonitor.startLocationUpdates();
}
export function stopLocationUpdates() {
  return VisitMonitor.stopLocationUpdates();
}
// listener({ latitude, longitude, accuracy, altitude, speed, course, timestamp }); speed is m/s (-1 unknown)
export function addLocationListener(listener) {
  return VisitMonitor.addListener('onLocation', listener);
}

export default VisitMonitor;
