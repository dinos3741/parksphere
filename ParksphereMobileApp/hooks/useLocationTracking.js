import { useState, useEffect } from 'react';
import * as Location from 'expo-location';
import { Alert } from 'react-native';

export const useLocationTracking = (acceptedSpot, arrivalConfirmed, onProximityArrival) => {
  const [userLocation, setUserLocation] = useState(null);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);

  // Helper function to calculate distance between two coordinates (Haversine formula)
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in metres
    return d;
  };

  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Permission to access location was denied. Map will show a default location.');
        setLocationPermissionGranted(false);
        setUserLocation({
          latitude: 51.505,
          longitude: -0.09,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
        return;
      }

      setLocationPermissionGranted(true);
      let location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      });
    })();
  }, []);

  useEffect(() => {
    let isMounted = true;

    // Foreground-only tracking for UI responsiveness
    const setupLocationTracking = async () => {
      if (locationPermissionGranted && acceptedSpot && !arrivalConfirmed) {
         // Background task was removed to avoid conflict with PARK_DETECTION_TASK
      }
    };

    setupLocationTracking();

    return () => {
      isMounted = false;
    };
  }, [locationPermissionGranted, acceptedSpot, arrivalConfirmed]);

  return { userLocation, setUserLocation, locationPermissionGranted, getDistance };
};
