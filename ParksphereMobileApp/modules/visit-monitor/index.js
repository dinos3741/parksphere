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

// ── One-shot fresh fix (Option 1) ────────────────────────────────────────────
// A single best-accuracy fix on demand, delivered via addLocationBatchListener (1-element batch).
// Densifies the sparse background-wake trail so the parked spot can be anchored on the vehicle-stop
// fix instead of the coarse CLVisit dwell.
export function requestOneShotLocation() {
  return VisitMonitor.requestOneShotLocation();
}
// listener({ locations: [{ latitude, longitude, accuracy, altitude, speed, course, timestamp }, ...] })
// iOS delivers buffered fixes as a BATCH (array) when it wakes the app after suspending it during a
// drive; foreground fixes arrive as batches of 1. speed is m/s (-1 unknown).
export function addLocationBatchListener(listener) {
  return VisitMonitor.addListener('onLocationBatch', listener);
}

// ── Drive-capture (precise background parking spot) ──────────────────────────
// Auto-pausing .automotiveNavigation location: iOS runs it while driving and pauses it at the park,
// firing onLocationPaused. Pair with significant-change monitoring so a new drive wakes the app.
export function startDriveLocationUpdates() {
  return VisitMonitor.startDriveLocationUpdates();
}
export function startSignificantChangeMonitoring() {
  return VisitMonitor.startSignificantChangeMonitoring();
}
export function stopSignificantChangeMonitoring() {
  return VisitMonitor.stopSignificantChangeMonitoring();
}
// listener() — iOS auto-paused location (device parked). The last onLocation before this = the spot.
export function addLocationPausedListener(listener) {
  return VisitMonitor.addListener('onLocationPaused', listener);
}
// listener() — iOS resumed location after a pause (movement).
export function addLocationResumedListener(listener) {
  return VisitMonitor.addListener('onLocationResumed', listener);
}

// ── Rolling geofence (Build C, Life360-style) ────────────────────────────────
// A small region re-armed around the current location on every crossing. Each crossing wakes a
// suspended app in the background (a periodic movement-triggered wake) WITHOUT continuous location —
// which the 2026-07-05 A/B proved makes iOS suspend-and-buffer the whole ride. Crossings arrive via
// addGeofenceListener with id 'rollingFence'; the fix at each crossing also arrives via
// addLocationBatchListener so the HMM sees the path. Re-arming is native (survives JS misses).
export function startRollingFence(radius = 150) {
  return VisitMonitor.startRollingFence(radius);
}
export function stopRollingFence() {
  return VisitMonitor.stopRollingFence();
}

// ── Background activity session (Build D, iOS 17+) ───────────────────────────
// Hold a CLBackgroundActivitySession so continuous drive-capture location keeps the app ALIVE in the
// background instead of iOS suspending-and-buffering the whole ride (proven Build B). Sanctioned
// iOS 17+ API; no-op below iOS 17. Start when drive-capture begins, stop when the trip ends.
export function startBackgroundSession() {
  return VisitMonitor.startBackgroundSession();
}
export function stopBackgroundSession() {
  return VisitMonitor.stopBackgroundSession();
}

// ── Modern live-updates drive capture (Build D-v2, iOS 17+) ──────────────────
// CLLocationUpdate.liveUpdates delivery — the API a CLBackgroundActivitySession actually keeps alive
// in the background (the legacy startUpdatingLocation in Build D buffered anyway). Fixes arrive via
// addLocationBatchListener as 1-element batches, so the HMM pipeline is unchanged. No-op below iOS 17.
export function startDriveLiveUpdates() {
  return VisitMonitor.startDriveLiveUpdates();
}
export function stopDriveLiveUpdates() {
  return VisitMonitor.stopDriveLiveUpdates();
}

// ── Native heartbeat readback (Build E premise test) ─────────────────────────
// The liveUpdates Task logs, from native Swift (off the JS thread), the wall-clock time each fix is
// processed + its GPS timestamp — to prove whether native runs LIVE during a drive while the RN JS
// thread is suspended. JS pulls these lines on foreground and merges them into the telemetry heartbeat.
export function readNativeLog() {
  return VisitMonitor.readNativeLog();
}
export function clearNativeLog() {
  return VisitMonitor.clearNativeLog();
}

// Post a local notification straight from native (UNUserNotificationCenter) — delivers even while the
// JS thread is suspended. Confirmation of live background alerting; foundation of the native park alert.
export function sendLocalNotification(title, body) {
  return VisitMonitor.sendLocalNotification(title, body);
}

// House test: schedule a native notification `afterSeconds` in the future so it lands while the app is
// backgrounded — confirms native → lock-screen delivery with no drive/GPS needed.
export function scheduleTestNotification(afterSeconds) {
  return VisitMonitor.scheduleTestNotification(afterSeconds);
}

// ── Native park-detector readback (Build E) ──────────────────────────────────
// The native park-detector (in the liveUpdates loop) declares the park LIVE in the background — fires a
// local notification + arms the returning geofence + persists the spot here. JS reads it on foreground
// to reconcile SPOT_KEY / the map. Returns the JSON string ("" if the native layer hasn't parked).
export function readNativePark() {
  return VisitMonitor.readNativePark();
}
export function clearNativePark() {
  return VisitMonitor.clearNativePark();
}

// ── Native return-watcher control (Build E) ──────────────────────────────────
// setCarLocation: hand native the car spot so it watches the fix stream for the walk back (distance-
// based — catches close-parking returns a geofence can't). resetParkDetection: on drive-off/new trip,
// drop the spot + re-arm park detection. Both are safe no-ops on an un-rebuilt binary.
export function setCarLocation(latitude, longitude) {
  return VisitMonitor.setCarLocation(latitude, longitude);
}
export function resetParkDetection() {
  return VisitMonitor.resetParkDetection();
}

export default VisitMonitor;
