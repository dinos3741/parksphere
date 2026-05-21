import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const LocationContext = createContext();

export const LocationProvider = ({ children }) => {
  const [userLocation, setUserLocation] = useState(null);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  const [parkedLocation, setParkedLocationState] = useState(null);

  const setParkedLocation = useCallback(async (location) => {
    setParkedLocationState(location);
    if (location) {
      await AsyncStorage.setItem('parkedLocation', JSON.stringify(location));
    } else {
      await AsyncStorage.removeItem('parkedLocation');
    }
  }, []);

  useEffect(() => {
    const loadParkedLocation = async () => {
      try {
        const saved = await AsyncStorage.getItem('parkedLocation');
        if (saved) {
          setParkedLocationState(JSON.parse(saved));
        }
      } catch (e) {
        console.error('[LocationContext] Failed to load parked location:', e);
      }
    };
    loadParkedLocation();
  }, []);

  const resetLocation = useCallback(async () => {
    setParkedLocationState(null);
    await AsyncStorage.removeItem('parkedLocation');
  }, []);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('dataReset', resetLocation);
    return () => subscription.remove();
  }, [resetLocation]);

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI/180;
    const φ2 = lat2 * Math.PI/180;
    const Δφ = (lat2-lat1) * Math.PI/180;
    const Δλ = (lon2-lon1) * Math.PI/180;

    const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ/2) * Math.sin(Δλ/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

    return R * c;
  };

  return (
    <LocationContext.Provider value={{ 
      userLocation, 
      setUserLocation, 
      locationPermissionGranted, 
      setLocationPermissionGranted,
      parkedLocation,
      setParkedLocation,
      resetLocation,
      getDistance
    }}>
      {children}
    </LocationContext.Provider>
  );
};

export const useLocation = () => useContext(LocationContext);
