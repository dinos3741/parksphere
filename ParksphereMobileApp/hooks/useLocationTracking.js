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
    let subscription = null;
    let cancelled = false;

    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (cancelled) return;
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Permission to access location was denied. Map will show a default location.');
        setLocationPermissionGranted(false);
        // Leave userLocation null rather than a hardcoded fallback (previously London,
        // 51.505/-0.09) — callers (Map.js's initialRegion, its radius filter) already treat a null
        // userLocation as "unknown" and degrade gracefully, instead of silently computing distances
        // against a fake location thousands of km away.
        return;
      }

      setLocationPermissionGranted(true);
      // Continuous watch instead of one getCurrentPositionAsync() call on mount — a single fetch can
      // return a stale/cached or low-accuracy fix (common on a cold GPS lock indoors), and userLocation
      // would then silently stay wrong for the rest of the session — e.g. quietly filtering every
      // nearby spot out of the map's radius check with no visible sign anything was wrong.
      subscription = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.Balanced, timeInterval: 5000, distanceInterval: 20 },
        (location) => {
          if (cancelled) return;
          setUserLocation({
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.0922,
            longitudeDelta: 0.0421,
          });
        }
      );
    })();

    return () => {
      cancelled = true;
      if (subscription) subscription.remove();
    };
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
