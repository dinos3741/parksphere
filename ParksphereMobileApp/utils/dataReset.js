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
 * Resets all application data stored in AsyncStorage.
 * Used for development simulation, "reset engine" functionality, and logout — a full reset must
 * cover BOTH the legacy JS-HMM engine (parkDetectionService.js) AND the current event-based
 * architecture (native CLVisit + geofence), since they keep entirely separate state. Missing the
 * latter here is what let a Demo Login session's native-owned spot/geofence survive into a real
 * user's session (2026-07-26): the map showed the previous account's parked-car marker because
 * nothing cleared EVENT_PARKED_SPOT / native's serverSpotId+carLocation / parkedLocation.
 */
export const resetAllAppData = async () => {
  console.log('[System] Resetting all application data...');

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

    // 5. Clear other persistent application keys — including mockModeEnabled, so a fresh login
    // can never inherit a stale demo-mode session.
    const keysToClear = [
      'userToken',
      'userId',
      'username',
      'autoDetectionEnabled',
      'mockModeEnabled',
    ];

    await AsyncStorage.multiRemove(keysToClear);
    console.log('[System] Application data cleared successfully.');

    return true;
  } catch (error) {
    console.error('[System] Error during full app data reset:', error);
    return false;
  }
};
