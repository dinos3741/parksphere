import { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { startParkDetection, stopParkDetection, handleLocationUpdate, feedLocationFix } from '../utils/parkDetectionService';
import { visitMonitorToLocation } from '../utils/visitMonitorAdapter';
import { useBluetoothMonitoring } from './useBluetoothMonitoring';

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

    // Drive the HMM from VisitMonitor's location stream (replaces the retired PARK_DETECTION_TASK).
    // feedLocationFix guards on isInitialized + isProcessing, so a fix arriving before the engine
    // finishes starting is safely ignored.
    if (VM) {
      locationSub = VM.addLocationListener((fix) => {
        feedLocationFix(visitMonitorToLocation(fix)).catch((e) =>
          console.warn('[useParkDetectionEngine] feedLocationFix failed:', e?.message)
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
