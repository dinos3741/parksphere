import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { Alert } from 'react-native';

const LOG_FILE = `${FileSystem.documentDirectory}telemetry_log.json`;
let isRecording = false;
let currentSession = [];
let currentManualLabel = null; // 🚀 NEW: State for AI training labels

/**
 * Set the current manual label for training (e.g., 'RETURNING', 'NOT_RETURNING')
 */
export const setManualLabel = (label) => {
  currentManualLabel = label;
  console.log(`[Telemetry] Manual label set to: ${label}`);
};

/**
 * Start a new telemetry recording session.
 */
export const startTelemetry = async () => {
  isRecording = true;
  currentSession = [];
  console.log('[Telemetry] Recording started.');
};

/**
 * Stop recording and save to local storage.
 */
export const stopTelemetry = async () => {
  isRecording = false;
  if (currentSession.length === 0) {
    Alert.alert("Telemetry", "No data was recorded.");
    return;
  }

  try {
    const jsonValue = JSON.stringify(currentSession, null, 2);
    await FileSystem.writeAsStringAsync(LOG_FILE, jsonValue);
    console.log(`[Telemetry] Saved ${currentSession.length} entries to ${LOG_FILE}`);
    Alert.alert("Telemetry", `Saved ${currentSession.length} entries to local storage.`);
  } catch (e) {
    console.error('[Telemetry] Failed to save log:', e.message);
    Alert.alert("Telemetry Error", "Failed to save the log file.");
  }
};

/**
 * Log a single snapshot of sensor data and HMM state.
 */
export const logTelemetry = (obs, result) => {
  if (!isRecording) return;

  const entry = {
    timestamp: Date.now(),
    manualLabel: currentManualLabel, // 🚀 NEW: The "Ground Truth" for AI training
    sensors: {
      speed: obs.speed,
      stepRate: obs.stepRate,
      accel: obs.accel,
      accuracy: obs.accuracy,
      bluetooth: obs.bluetoothConnected,
      activity: result.metrics?.motionActivity || obs.activity
    },
    features: { // 🚀 NEW: Rich features for Neural Network input
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
      distToParked: result.distToParked
    }
  };

  currentSession.push(entry);
};

/**
 * Export the log file via iOS/Android sharing sheet.
 */
export const shareTelemetryLog = async () => {
  try {
    const fileExists = await FileSystem.getInfoAsync(LOG_FILE);
    if (!fileExists.exists) {
        Alert.alert("No Log Found", "You need to Record and then 'Stop & Save' before you can export.");
        return;
    }

    // Defensive check for the native module
    if (!Sharing || typeof Sharing.isAvailableAsync !== 'function') {
        Alert.alert("Module Error", "The native sharing module is not loaded correctly. Please rebuild the app.");
        return;
    }

    const isAvailable = await Sharing.isAvailableAsync();
    if (!isAvailable) {
        Alert.alert("Sharing Unavailable", "Sharing is not available on this device.");
        return;
    }

    await Sharing.shareAsync(LOG_FILE);
  } catch (e) {
    console.error('[Telemetry] Share failed:', e.message);
    Alert.alert("Share Error", `An error occurred: ${e.message}`);
  }
};

/**
 * Clear the local log file.
 */
export const clearTelemetryLog = async () => {
    try {
        await FileSystem.deleteAsync(LOG_FILE, { idempotent: true });
        console.log('[Telemetry] Log file cleared.');
        Alert.alert("Telemetry", "Local log file cleared.");
    } catch (e) {
        // File might not exist, ignore
    }
};

export const getTelemetryStatus = () => isRecording;
