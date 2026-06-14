import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LOG_FILE = `${FileSystem.documentDirectory}telemetry_log.json`;
const HEARTBEAT_FILE = `${FileSystem.documentDirectory}telemetry_heartbeat.json`;
const REC_FLAG_KEY = 'TELEMETRY_RECORDING'; // survives background relaunch

let isRecording = false;
let currentSession = [];
let currentManualLabel = null;
let rawAccelBuffer = []; // 🚀 High-frequency buffer (X, Y, Z, timestamp)
const MAX_RAW_BUFFER = 512; // Store ~10 seconds at 50Hz

// 🚀 BACKGROUND-SAFE, BURST-SAFE PERSISTENCE
// iOS terminates+relaunches the app to deliver background location (wiping module state),
// AND it delivers buffered fixes in big bursts (hundreds–thousands at once on a wakeup). The
// previous recorder rewrote the WHOLE log file on EVERY entry — O(n²) — so during a burst the
// write queue couldn't drain before iOS re-suspended the app, and the later records were lost
// (a real drive's home leg vanished from the log this way). Now: logTelemetry/logHeartbeat only
// PUSH to an in-memory buffer (no I/O); the engine calls flushTelemetry() once per batch,
// awaited so it lands before suspension. Each flush hydrates the file once (so relaunches append
// instead of overwrite) and writes each file exactly ONCE — no per-entry rewrites.
let pending = [];           // telemetry entries buffered since the last flush
let pendingHeartbeat = [];  // heartbeat records buffered since the last flush
let flushQueue = Promise.resolve();
let sessionHydrated = false; // have we loaded the existing telemetry file this process?
let hbHydrated = false;      // have we loaded the existing heartbeat file this process?
let heartbeat = [];
const MAX_HEARTBEAT = 5000;

/**
 * Log a single high-frequency accelerometer sample
 */
export const logRawAccel = (x, y, z) => {
  if (!isRecording) return;
  rawAccelBuffer.push({ x, y, z, t: Date.now() });
  if (rawAccelBuffer.length > MAX_RAW_BUFFER) {
    rawAccelBuffer.shift();
  }
};

/**
 * Set the current manual label for training (e.g., 'RETURNING', 'NOT_RETURNING')
 */
export const setManualLabel = (label) => {
  currentManualLabel = label;
  console.log(`[Telemetry] Manual label set to: ${label}`);
};

/**
 * Restore the recording flag after a background relaunch (fresh JS context).
 * Called by the background location task on cold start — without it, logTelemetry()
 * silently no-ops in the background because module-level isRecording reset to false.
 */
export const restoreTelemetryState = async () => {
  try {
    const flag = await AsyncStorage.getItem(REC_FLAG_KEY);
    isRecording = flag === 'true';
  } catch (e) {
    isRecording = false;
  }
  return isRecording;
};

/**
 * Start a new telemetry recording session.
 */
export const startTelemetry = async () => {
  isRecording = true;
  currentSession = [];
  pending = [];
  sessionHydrated = true; // brand-new session; nothing on disk to append to
  rawAccelBuffer = [];
  try {
    await AsyncStorage.setItem(REC_FLAG_KEY, 'true');
    await FileSystem.writeAsStringAsync(LOG_FILE, '[]'); // reset the log for the new session
  } catch (e) {
    console.error('[Telemetry] Failed to initialize log file:', e.message);
  }
  console.log('[Telemetry] Recording started.');
};

/**
 * Stop recording. Entries were already flushed to disk incrementally, so here we just
 * clear the flag and wait for any queued writes to settle.
 */
export const stopTelemetry = async () => {
  isRecording = false;
  try {
    await AsyncStorage.setItem(REC_FLAG_KEY, 'false');
  } catch (e) { /* non-fatal */ }

  await flushTelemetry(); // write out anything still buffered in memory

  let count = 0;
  try {
    const existing = await FileSystem.readAsStringAsync(LOG_FILE);
    count = existing ? JSON.parse(existing).length : 0;
  } catch (e) {
    count = currentSession.length;
  }

  if (count === 0) {
    Alert.alert('Telemetry', 'No data was recorded.');
    return;
  }
  console.log(`[Telemetry] Saved ${count} entries to ${LOG_FILE}`);
  Alert.alert('Telemetry', `Saved ${count} entries to local storage.`);
};

/**
 * Log a single snapshot of sensor data and HMM state. Persisted to disk immediately
 * (queued) so it survives the app being suspended/terminated in the background.
 */
export const logTelemetry = (obs, result, aiConfidence = 0, overallReturningConfidence = 0, boundary = {}) => {
  if (!isRecording) return;

  const entry = {
    timestamp: obs.timestamp || Date.now(), // 🚀 real fix time so batched replays log true times
    manualLabel: currentManualLabel, // 🚀 The "Ground Truth" for AI training
    sensors: {
      speed: obs.speed,
      stepRate: obs.stepRate,
      accel: obs.accel,
      accuracy: obs.accuracy,
      bluetooth: obs.bluetoothConnected,
      activity: result.metrics?.motionActivity || obs.activity,
      spectral: obs.spectralFeatures
    },
    features: {
      pgr: result.pgr || 0,
      pgrSlope: result.slope || 0,
      pgrConsistency: result.pgrConsistency || 0,
      approachAlignment: result.approachAlignment || 0,
      deltaRate: result.deltaRate || 0
    },
    hmm: {
      state: result.state,
      confidence: result.confidence,
      parkedEvent: result.parkedEvent,
      awayEvent: result.awayEvent,
      clearParkingEvent: result.clearParkingEvent,
      isAway: result.isAway,
      distToParked: result.distToParked,
      aiReturningConfidence: aiConfidence,
      overallReturningConfidence: overallReturningConfidence
    },
    boundary: {
      zone: boundary.zone,
      etaSeconds: boundary.etaSeconds,
      commitThreshold: boundary.commitThreshold,
      softThreshold: boundary.softThreshold
    }
  };

  // Buffer in memory only — no disk I/O here. flushTelemetry() (called once per batch by the
  // engine) writes it out. This is what keeps big background bursts from backing up.
  pending.push(entry);
};

/**
 * Always-on heartbeat: records that the background task fired, independent of whether
 * a recording session is active. This is the definitive signal for "is iOS actually
 * waking the app in the background?" — it's buffered even when isRecording is false.
 */
export const logHeartbeat = (info = {}) => {
  pendingHeartbeat.push({ t: Date.now(), ...info });
};

/**
 * Flush buffered telemetry + heartbeat to disk. The engine calls this once per task batch and
 * awaits it, so the write completes before iOS can re-suspend the app. Each file is hydrated
 * once per process (so background relaunches append instead of overwrite) and written exactly
 * once per flush — no per-entry rewrites, so large bursts can't lose data.
 */
export const flushTelemetry = async () => {
  flushQueue = flushQueue
    .then(doFlush)
    .catch(e => console.error('[Telemetry] flush failed:', e.message));
  return flushQueue;
};

async function doFlush() {
  if (pending.length) {
    if (!sessionHydrated) {
      try {
        const existing = await FileSystem.readAsStringAsync(LOG_FILE);
        currentSession = existing ? JSON.parse(existing) : [];
      } catch (e) {
        currentSession = [];
      }
      sessionHydrated = true;
    }
    const batch = pending;
    pending = [];
    currentSession.push(...batch);
    await FileSystem.writeAsStringAsync(LOG_FILE, JSON.stringify(currentSession));
  }

  if (pendingHeartbeat.length) {
    if (!hbHydrated) {
      try {
        const existing = await FileSystem.readAsStringAsync(HEARTBEAT_FILE);
        heartbeat = existing ? JSON.parse(existing) : [];
      } catch (e) {
        heartbeat = [];
      }
      hbHydrated = true;
    }
    const batch = pendingHeartbeat;
    pendingHeartbeat = [];
    heartbeat.push(...batch);
    if (heartbeat.length > MAX_HEARTBEAT) heartbeat = heartbeat.slice(-MAX_HEARTBEAT);
    await FileSystem.writeAsStringAsync(HEARTBEAT_FILE, JSON.stringify(heartbeat));
  }
}

async function shareFile(file, emptyMsg) {
  try {
    const fileExists = await FileSystem.getInfoAsync(file);
    if (!fileExists.exists) {
      Alert.alert('No Log Found', emptyMsg);
      return;
    }
    if (!Sharing || typeof Sharing.isAvailableAsync !== 'function') {
      Alert.alert('Module Error', 'The native sharing module is not loaded correctly. Please rebuild the app.');
      return;
    }
    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
      Alert.alert('Sharing Unavailable', 'Sharing is not available on this device.');
      return;
    }
    await Sharing.shareAsync(file);
  } catch (e) {
    console.error('[Telemetry] Share failed:', e.message);
    Alert.alert('Share Error', `An error occurred: ${e.message}`);
  }
}

/**
 * Export the main telemetry log via the iOS/Android sharing sheet.
 */
export const shareTelemetryLog = async () => {
  await shareFile(LOG_FILE, "You need to Record and then 'Stop & Save' before you can export.");
};

/**
 * Export the always-on heartbeat log (task-fire timestamps).
 */
export const shareHeartbeatLog = async () => {
  await shareFile(HEARTBEAT_FILE, 'No heartbeat recorded yet.');
};

/**
 * Clear the local log files.
 */
export const clearTelemetryLog = async () => {
  try {
    await FileSystem.deleteAsync(LOG_FILE, { idempotent: true });
    await FileSystem.deleteAsync(HEARTBEAT_FILE, { idempotent: true });
    currentSession = [];
    heartbeat = [];
    pending = [];
    pendingHeartbeat = [];
    sessionHydrated = false;
    hbHydrated = false;
    console.log('[Telemetry] Log files cleared.');
    Alert.alert('Telemetry', 'Local log files cleared.');
  } catch (e) {
    // Files might not exist, ignore
  }
};

export const getTelemetryStatus = () => isRecording;
