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

// 🚀 BACKGROUND-SAFE PERSISTENCE
// iOS terminates+relaunches the app to deliver background location. That wipes all
// module state (isRecording → false, currentSession → []). The old recorder held
// everything in RAM and only wrote on manual Stop, so background activity was never
// captured — empty logs looked like "location failed" when the task may have been
// running fine. We now (a) restore the recording flag on relaunch and (b) flush every
// entry to disk immediately, serialized through a queue so concurrent logs don't clobber.
let logWriteQueue = Promise.resolve();
let sessionHydrated = false; // have we loaded the existing file into currentSession this process?

let hbWriteQueue = Promise.resolve();
let hbHydrated = false;
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

  await logWriteQueue; // ensure the last queued write has landed

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

  logWriteQueue = logWriteQueue
    .then(() => persistEntry(entry))
    .catch(e => console.error('[Telemetry] persist failed:', e.message));
};

async function persistEntry(entry) {
  // On a fresh process (e.g. background relaunch) load the existing file once so we
  // append to the session on disk instead of overwriting it with a single entry.
  if (!sessionHydrated) {
    try {
      const existing = await FileSystem.readAsStringAsync(LOG_FILE);
      currentSession = existing ? JSON.parse(existing) : [];
    } catch (e) {
      currentSession = [];
    }
    sessionHydrated = true;
  }
  currentSession.push(entry);
  await FileSystem.writeAsStringAsync(LOG_FILE, JSON.stringify(currentSession));
}

/**
 * Always-on heartbeat: records that the background task fired, independent of whether
 * a recording session is active. This is the definitive signal for "is iOS actually
 * waking the app in the background?" — it writes even when isRecording is false.
 */
export const logHeartbeat = (info = {}) => {
  hbWriteQueue = hbWriteQueue
    .then(() => persistHeartbeat({ t: Date.now(), ...info }))
    .catch(e => console.error('[Telemetry] heartbeat failed:', e.message));
};

async function persistHeartbeat(record) {
  if (!hbHydrated) {
    try {
      const existing = await FileSystem.readAsStringAsync(HEARTBEAT_FILE);
      heartbeat = existing ? JSON.parse(existing) : [];
    } catch (e) {
      heartbeat = [];
    }
    hbHydrated = true;
  }
  heartbeat.push(record);
  if (heartbeat.length > MAX_HEARTBEAT) heartbeat = heartbeat.slice(-MAX_HEARTBEAT);
  await FileSystem.writeAsStringAsync(HEARTBEAT_FILE, JSON.stringify(heartbeat));
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
    sessionHydrated = false;
    hbHydrated = false;
    console.log('[Telemetry] Log files cleared.');
    Alert.alert('Telemetry', 'Local log files cleared.');
  } catch (e) {
    // Files might not exist, ignore
  }
};

export const getTelemetryStatus = () => isRecording;
