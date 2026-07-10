import { useEffect } from 'react';
import { DeviceEventEmitter, AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { startParkDetection, stopParkDetection, handleLocationUpdate, feedLocationBatch } from '../utils/parkDetectionService';
import { visitMonitorToLocation } from '../utils/visitMonitorAdapter';
import { useBluetoothMonitoring } from './useBluetoothMonitoring';

const PARK_STATE_KEY = 'PARK_STATE';
// Native now owns ALL background detection (park-bt/park-stop/return/rearm in VisitMonitor). When the
// app foregrounds after a background drive, iOS flushes the whole buffered fix history at once; feeding
// that to the HMM re-derives the trip and CHURNS the map (arm/clear/arm…, often ending cleared) and
// fast-forwards notifications — all redundant. A LIVE foreground fix is a few seconds old; a buffered
// flush is minutes/hours old. Skip any batch whose newest fix is older than this.
const BATCH_STALE_MS = 45 * 1000;

// VisitMonitor is the single CoreLocation owner and the HMM's location source. Its on-demand stream
// is turned ON/OFF by the mode controller in useReturnDetection (foreground only, for now); here we
// just consume whatever fixes arrive and drive the HMM with them. Guarded require: absent until the
// native module is built.
let VM = null;
try {
  VM = require('../modules/visit-monitor');
} catch (_) {}

export const useParkDetectionEngine = (currentUser, isLoggedIn, addNotification, setParkedLocation) => {
  const { isConnected } = useBluetoothMonitoring();

  useEffect(() => {
    console.log(`[useParkDetectionEngine] Bluetooth isConnected: ${isConnected}`);

    // ⚡ Inject Bluetooth state into the HMM engine on change
    handleLocationUpdate({ bluetoothConnected: isConnected }, null, true);
  }, [isConnected]);

  // Surface the current parked spot to the map on foreground. A spot declared in the BACKGROUND by
  // CLVisit writes PARK_STATE (via seedParkedSpot) but never touches the map's LocationContext store,
  // and a warm resume doesn't remount the setup effect — so without this the CLVisit spot stays
  // invisible until a relaunch. On every 'active', mirror PARK_STATE.parkedLocation onto the map.
  useEffect(() => {
    const syncSpotToMap = async () => {
      try {
        const saved = await AsyncStorage.getItem(PARK_STATE_KEY);
        const parked = saved ? JSON.parse(saved).parkedLocation : null;
        if (parked && setParkedLocation) setParkedLocation(parked);
      } catch (_) {}
    };
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') syncSpotToMap();
    });
    // When useReturnDetection adopts the authoritative native park on foreground, mirror it to the map
    // immediately (don't wait for the next 'active' sync, and it's the last state after the churn fix).
    const nativeSub = DeviceEventEmitter.addListener('nativeSpotAdopted', (spot) => {
      if (spot && setParkedLocation) setParkedLocation(spot);
    });
    syncSpotToMap(); // also run once on mount
    return () => { try { sub?.remove(); } catch (_) {} try { nativeSub?.remove(); } catch (_) {} };
  }, [setParkedLocation]);

  useEffect(() => {
    let detectionSubscription = null;
    let locationSub = null;

    detectionSubscription = DeviceEventEmitter.addListener('parkDetectionUpdate', (data) => {
      if (addNotification) addNotification(data.message);
      if (data.parkedLocation) {
        if (setParkedLocation) setParkedLocation(data.parkedLocation);
      } else if (data.clearParkedLocation) {
        if (setParkedLocation) setParkedLocation(null);
      }
    });

    // Drive the HMM from VisitMonitor's location batches (replaces the retired PARK_DETECTION_TASK).
    // A batch = the buffered fixes iOS delivers when it wakes the app after suspending it during a
    // drive (or a single foreground fix). feedLocationBatch runs the proven pipeline (temporal replay
    // + historical activity backfill) and cold-inits the engine if this is a fresh background wake.
    if (VM) {
      locationSub = VM.addLocationBatchListener((batch) => {
        const raw = batch?.locations || [];
        if (!raw.length) return;
        // Skip a stale buffered flush (the background drive iOS delivers all at once on foreground) —
        // native already detected everything live; replaying it just churns the map + notifications.
        const newestTs = raw[raw.length - 1]?.timestamp || 0;
        if (Date.now() - newestTs > BATCH_STALE_MS) {
          console.log(`[useParkDetectionEngine] skipped stale buffered batch (${raw.length} fixes; native owns bg detection)`);
          return;
        }
        feedLocationBatch(raw.map(visitMonitorToLocation)).catch((e) =>
          console.warn('[useParkDetectionEngine] feedLocationBatch failed:', e?.message)
        );
      });
    }

    const setupDetection = async () => {
      try {
        // 🚀 SERVER-INDEPENDENT START: the user profile (which carries auto_detect) is fetched
        // from the server, so it's null whenever the server is unreachable — driving away from
        // the local/mock server, a brief production outage, or a cold relaunch before the fetch
        // returns. The login token, however, is restored from storage with no server. So: prefer
        // the live profile and cache its auto_detect; otherwise fall back to the cached value
        // (default ON if never cached) so detection still starts. Login is the only one-time
        // server need; after that the engine starts standalone.
        let autoDetect;
        if (currentUser) {
          autoDetect = !!currentUser.auto_detect;
          await AsyncStorage.setItem('AUTO_DETECT', autoDetect ? 'true' : 'false');
        } else {
          const cached = await AsyncStorage.getItem('AUTO_DETECT');
          autoDetect = cached === null ? true : cached === 'true';
        }

        if (autoDetect) {
          await startParkDetection();
        }

        const saved = await AsyncStorage.getItem('PARK_STATE');
        if (saved) {
          const stateData = JSON.parse(saved);
          if (stateData.parkedLocation && setParkedLocation) {
            setParkedLocation(stateData.parkedLocation);
          }
        }

        // Location now comes from VisitMonitor's stream (subscribed above), not a location task.
      } catch (error) {
        console.error('[useParkDetectionEngine] Error in setupDetection:', error);
      }
    };

    if (isLoggedIn) {
      setupDetection();
    }

    return () => {
      if (detectionSubscription) {
        detectionSubscription.remove();
      }
      try { locationSub?.remove(); } catch (_) {}
      stopParkDetection();
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.auto_detect, addNotification, setParkedLocation]);
};
