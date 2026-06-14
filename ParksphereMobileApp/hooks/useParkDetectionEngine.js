import { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { startParkDetection, stopParkDetection, handleLocationUpdate } from '../utils/parkDetectionService';
import { useBluetoothMonitoring } from './useBluetoothMonitoring';

export const useParkDetectionEngine = (currentUser, isLoggedIn, addNotification, setParkedLocation) => {
  const { isConnected } = useBluetoothMonitoring();

  useEffect(() => {
    console.log(`[useParkDetectionEngine] Bluetooth isConnected: ${isConnected}`);

    // ⚡ Inject Bluetooth state into the HMM engine on change
    handleLocationUpdate({ bluetoothConnected: isConnected }, null, true);
  }, [isConnected]);

  useEffect(() => {
    let detectionSubscription = null;

    detectionSubscription = DeviceEventEmitter.addListener('parkDetectionUpdate', (data) => {
      if (addNotification) addNotification(data.message);
      if (data.parkedLocation) {
        if (setParkedLocation) setParkedLocation(data.parkedLocation);
      } else if (data.clearParkedLocation) {
        if (setParkedLocation) setParkedLocation(null);
      }
    });

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

        // Removed watchPositionAsync - relying exclusively on startLocationUpdatesAsync background task
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
      stopParkDetection();
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.auto_detect, addNotification, setParkedLocation]);
};
