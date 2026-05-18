import { useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as ExpoNotifications from 'expo-notifications';
import { startParkDetection, stopParkDetection, handleLocationUpdate } from '../utils/parkDetectionService';

export const useParkDetectionEngine = (currentUser, isLoggedIn, addNotification, setParkedLocation) => {
  useEffect(() => {
    const detectionSubscription = DeviceEventEmitter.addListener('parkDetectionUpdate', (data) => {
      if (addNotification) addNotification(data.message);
      if (data.parkedLocation) {
        if (setParkedLocation) setParkedLocation(data.parkedLocation);
      } else if (data.clearParkedLocation) {
        if (setParkedLocation) setParkedLocation(null);
      }
    });

    const setupNotificationsAndDetection = async () => {
      const { status: existingStatus } = await ExpoNotifications.getPermissionsAsync();
      if (existingStatus !== 'granted') {
        await ExpoNotifications.requestPermissionsAsync();
      }
      
      if (currentUser && currentUser.auto_detect) {
        await startParkDetection();
      }

      const saved = await AsyncStorage.getItem('PARK_STATE');
      if (saved) {
        const stateData = JSON.parse(saved);
        if (stateData.parkedLocation && setParkedLocation) {
          setParkedLocation(stateData.parkedLocation);
        }
      }
    };
    
    let foregroundSubscription = null;
    const setupForegroundFallback = async () => {
       if (currentUser && currentUser.auto_detect) {
         foregroundSubscription = await Location.watchPositionAsync({
           accuracy: Location.Accuracy.High,
           distanceInterval: 1,
           timeInterval: 2000
         }, async (location) => {
           await handleLocationUpdate(location);
         });
       }
    };

    if (isLoggedIn && currentUser) {
      setupNotificationsAndDetection();
      setupForegroundFallback();
    }

    return () => {
      if (foregroundSubscription) foregroundSubscription.remove();
      detectionSubscription.remove();
      stopParkDetection(); 
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.auto_detect, addNotification, setParkedLocation]);
};
