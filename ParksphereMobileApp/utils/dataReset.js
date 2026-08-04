import AsyncStorage from '@react-native-async-storage/async-storage';
import { DeviceEventEmitter } from 'react-native';
import { stopParkDetection, resetParkDetection } from './parkDetectionService';

let VM = null;
try {
  VM = require('../modules/visit-monitor');
} catch (e) {
  console.warn('[System] VisitMonitor native module unavailable (needs a rebuild):', e.message);
}

/**
 * Wipes park-detection state only — BOTH the legacy JS-HMM engine (parkDetectionService.js) AND
 * the current event-based architecture (native CLVisit + geofence), since they keep entirely
 * separate state. Split out from the old resetAllAppData() (2026-08-04): that function ran
 * unconditionally on every logout, including a routine session hiccup with no real account change
 * (e.g. a stale/lost token after a force-quit) — destroying a live, legitimate parked-car geofence
 * and return-tracking state for no reason. This piece is now only called when AuthContext's login()
 * confirms the incoming account actually differs from whoever was last logged out (see there), plus
 * the original callers that always mean a real reset: the dev "reset engine" tool and Demo Login.
 */
export const resetParkDetectionState = async () => {
  console.log('[System] Resetting park-detection state...');
  try {
    // 1. Stop the (legacy JS) detection engine first so background tasks are cleared
    await stopParkDetection();

    // 2. Legacy JS-HMM engine reset (deletes its own server spot, clears PARK_STATE)
    await resetParkDetection();

    // 3. Current event-based architecture: its own spot handle + native-persisted state.
    await AsyncStorage.removeItem('EVENT_PARKED_SPOT');
    if (VM?.resetParkDetection) { try { await VM.resetParkDetection(); } catch (_) {} }
    if (VM?.clearGeofence) { try { await VM.clearGeofence(); } catch (_) {} }
    if (VM?.clearNativePark) { try { await VM.clearNativePark(); } catch (_) {} }

    // 4. Trigger a global reset event for components (like SpotContext / LocationContext's
    // parkedLocation cache) to clear their own local state.
    DeviceEventEmitter.emit('dataReset');

    console.log('[System] Park-detection state cleared successfully.');
    return true;
  } catch (error) {
    console.error('[System] Error resetting park-detection state:', error);
    return false;
  }
};

// Auth/app-preference keys only — always safe to clear on any logout, account change or not.
// mockModeEnabled is included so a fresh login can never inherit a stale demo-mode session.
export const clearAuthKeys = async () => {
  const keysToClear = [
    'userToken',
    'userId',
    'username',
    'autoDetectionEnabled',
    'mockModeEnabled',
  ];
  await AsyncStorage.multiRemove(keysToClear);
};

/**
 * Full reset: park-detection state + auth keys together. Not currently called anywhere (both real
 * login and Demo Login now go through AuthContext.js's login()/logout(), which decide the
 * park-detection wipe conditionally — see resetParkDetectionState() above) — kept as a convenience
 * for a future manual/dev "reset everything" tool.
 */
export const resetAllAppData = async () => {
  console.log('[System] Resetting all application data...');
  const parkOk = await resetParkDetectionState();
  await clearAuthKeys();
  console.log('[System] Application data cleared successfully.');
  return parkOk;
};
