import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Alert, AppState, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAuth } from './AuthContext';
import { apiRequest } from '../utils/apiService';

const SpotContext = createContext();

export const useSpots = () => {
  const context = useContext(SpotContext);
  if (!context) {
    throw new Error('useSpots must be used within a SpotProvider');
  }
  return context;
};

export const SpotProvider = ({ children, addNotification, socket, userId, currentUsername, triggerNotification, setParkedLocation, parkedLocation }) => {
  const { token, isLoggedIn, serverUrl, logout } = useAuth();
  const [parkingSpots, setParkingSpots] = useState([]);
  const [acceptedSpot, setAcceptedSpotState] = useState(null);
  const [spotRequests, setSpotRequests] = useState([]);
  const [hasNewRequests, setHasNewRequests] = useState(false);
  const [arrivalConfirmed, setArrivalConfirmedState] = useState(false);
  // R7 (2026-07-26): gates the reconciliation effect below — parkingSpots starts empty on every
  // launch while the first fetch is in flight, and without this the "no spot found for me" branch
  // would fire immediately and wipe a real cached marker before the server had even been asked.
  const [spotsLoaded, setSpotsLoaded] = useState(false);

  const setAcceptedSpot = useCallback(async (spot) => {
    setAcceptedSpotState(spot);
    if (spot) {
      await AsyncStorage.setItem('acceptedSpot', JSON.stringify(spot));
    } else {
      await AsyncStorage.removeItem('acceptedSpot');
    }
  }, []);

  const setArrivalConfirmed = useCallback(async (confirmed) => {
    setArrivalConfirmedState(confirmed);
    await AsyncStorage.setItem('arrivalConfirmed', JSON.stringify(confirmed));
  }, []);

  useEffect(() => {
    const loadPersistedState = async () => {
      try {
        const savedSpot = await AsyncStorage.getItem('acceptedSpot');
        const savedArrival = await AsyncStorage.getItem('arrivalConfirmed');
        
        if (savedSpot) {
          setAcceptedSpotState(JSON.parse(savedSpot));
        }
        if (savedArrival) {
          setArrivalConfirmedState(JSON.parse(savedArrival));
        }
      } catch (e) {
        console.error('[SpotContext] Failed to load persisted state:', e);
      }
    };
    loadPersistedState();
  }, []);

  useEffect(() => {
    if (socket && socket.current) {
      const s = socket.current;

      const onNewSpot = (newSpot) => {
        const spotWithOwnerId = { ...newSpot, ownerId: newSpot.user_id };
        setParkingSpots((prevSpots) => [...prevSpots, spotWithOwnerId]);
      };

      const onSpotDeleted = ({ spotId }) => {
        setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== parseInt(spotId, 10)));
        setSpotRequests((prevRequests) => prevRequests.filter((request) => request.spotId !== parseInt(spotId, 10)));
        setAcceptedSpot(prev => (prev && prev.id === parseInt(spotId, 10) ? null : prev));
      };

      const onSpotUpdated = (updatedSpot) => {
        setParkingSpots((prevSpots) => prevSpots.map((spot) => (spot.id === updatedSpot.id ? updatedSpot : spot)));
      };

      const onSpotStatusUpdated = (updatedSpot) => {
        setParkingSpots((prevSpots) => prevSpots.map((spot) => (spot.id === updatedSpot.id ? updatedSpot : spot)));
      };

      const onSpotRequest = (data) => {
        setSpotRequests(prevRequests => [...prevRequests, data]);
        setHasNewRequests(true);
        triggerNotification(data.message, 'newRequest');
      };

      const onReqAccDec = ({ spotId, requestId }) => {
        setSpotRequests(prevRequests => prevRequests.filter(req => req.requestId !== requestId));
      };

      const onRequestResponse = (data) => {
        Alert.alert('Spot Request Update', data.message);
        if (data.spot) {
          setAcceptedSpot(data.spot);
          setArrivalConfirmed(false);
        } else {
          setAcceptedSpot(null);
          setArrivalConfirmed(false);
        }
      };

      s.on('newParkingSpot', onNewSpot);
      s.on('spotDeleted', onSpotDeleted);
      s.on('spotUpdated', onSpotUpdated);
      s.on('spotStatusUpdated', onSpotStatusUpdated);
      s.on('spotRequest', onSpotRequest);
      s.on('requestAcceptedOrDeclined', onReqAccDec);
      s.on('requestResponse', onRequestResponse);

      return () => {
        s.off('newParkingSpot', onNewSpot);
        s.off('spotDeleted', onSpotDeleted);
        s.off('spotUpdated', onSpotUpdated);
        s.off('spotStatusUpdated', onSpotStatusUpdated);
        s.off('spotRequest', onSpotRequest);
        s.off('requestAcceptedOrDeclined', onReqAccDec);
        s.off('requestResponse', onRequestResponse);
      };
    }
  }, [socket, triggerNotification, setAcceptedSpot, setArrivalConfirmed]);

  // Expiration logic
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      setParkingSpots(prevSpots => {
        let changed = false;
        const filtered = prevSpots.filter(spot => {
          const expirationTime = new Date(spot.declared_at).getTime() + spot.time_to_leave * 60 * 1000;
          if (now > expirationTime) {
            changed = true;
            return false;
          }
          return true;
        });
        
        if (changed) {
          // Also cleanup requests for expired spots
          const spotIds = filtered.map(s => s.id);
          setSpotRequests(prevRequests => prevRequests.filter(req => spotIds.includes(req.spotId)));
        }
        
        return changed ? filtered : prevSpots;
      });
    }, 10000); // 10s check instead of 1s for efficiency
    return () => clearInterval(interval);
  }, []);

  const fetchParkingSpots = useCallback(async () => {
    if (!isLoggedIn || !token) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/parkingspots`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const transformedData = data.map(spot => ({ ...spot, ownerId: spot.user_id }));
        setParkingSpots(transformedData);
        setSpotsLoaded(true);
      } else if (response.status === 401 || response.status === 403) {
        await logout();
      }
    } catch (error) {
      console.error('[SpotContext] Error fetching parking spots:', error);
    }
  }, [isLoggedIn, token, serverUrl, logout]);

  // R7 (2026-07-26): fetchParkingSpots only runs once at login (App.js's effect keys off
  // isLoggedIn/userId/token) — if the server happened to be unreachable at that moment, spotsLoaded
  // stays false and the reconciliation effect below never runs for the rest of the session. Re-fetch
  // on every foreground so a transient failure at launch doesn't strand the whole session; mirrors
  // the AppState pattern already used in useReturnDetection.js.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') fetchParkingSpots();
    });
    return () => sub.remove();
  }, [fetchParkingSpots]);

  // R7 (2026-07-26): sync the map's "Your Car" marker FROM the server when it knows about a spot
  // the client doesn't have locally yet (e.g. an account switch that left a stale/empty local cache).
  // Deliberately one-directional — SET only, never CLEAR. `parkedLocation` is a personal, offline-
  // first "where's my car" indicator; the server's spot listing is a separate, connectivity-dependent
  // feature (sharing your spot with other users). An earlier version of this effect also cleared
  // parkedLocation when the user had no active spot server-side, which sounds right but isn't: if
  // declareServerSpot fails (no connectivity — confirmed 2026-07-26, server unreachable, code:0/
  // ok:false), the server legitimately has no record of a spot native just detected locally, and the
  // clear branch erased that real, freshly-detected park purely because it hadn't reached the network
  // yet. Clearing stays exclusively the job of clearSpot()'s 'parkedLocationCleared' event
  // (useReturnDetection.js) — driven by local detection, so it works fully offline.
  useEffect(() => {
    if (!spotsLoaded || !userId) return;
    const myActiveSpot = parkingSpots.find((s) => s.user_id === userId);
    if (myActiveSpot) {
      const serverLoc = { latitude: myActiveSpot.latitude, longitude: myActiveSpot.longitude };
      if (!parkedLocation || parkedLocation.latitude !== serverLoc.latitude || parkedLocation.longitude !== serverLoc.longitude) {
        setParkedLocation(serverLoc);
      }
    }
  }, [spotsLoaded, parkingSpots, userId, parkedLocation, setParkedLocation]);

  const handleRequestSpot = async (spotId, requesterLat, requesterLon) => {
    if (!token) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/request-spot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ spotId, requesterLat, requesterLon }),
      });
      if (!response.ok) {
        const data = await response.json();
        Alert.alert('Error', data.message || 'Failed to request spot.');
      }
    } catch (error) {
      console.error('[SpotContext] Error requesting spot:', error);
    }
  };

  const handleDeleteSpot = async (spotId) => {
    if (!token) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/parkingspots/${spotId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        addNotification(`Spot ${spotId} deleted successfully!`);
        setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== spotId));
      } else if (response.status === 401 || response.status === 403) {
        await logout();
      }
    } catch (error) {
      console.error('[SpotContext] Error deleting spot:', error);
    }
  };

  const handleSaveEditedSpot = async (spotId, updatedDetails) => {
    if (!token) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/parkingspots/${spotId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(updatedDetails),
      });
      if (response.ok) {
        addNotification(`Spot ${spotId} updated successfully!`);
        setParkingSpots((prevSpots) =>
          prevSpots.map((spot) => (spot.id === spotId ? { ...spot, ...updatedDetails } : spot))
        );
      } else if (response.status === 401 || response.status === 403) {
        await logout();
      }
    } catch (error) {
      console.error('[SpotContext] Error updating spot:', error);
    }
  };

  const handleCreateSpot = async (duration, coordinates) => {
    if (!token || !userId || !coordinates) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/declare-spot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: userId,
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          timeToLeave: duration,
          costType: 'free',
          price: 0,
          declaredCarType: 'sedan', 
          comments: '',
        }),
      });
      if (response.ok) {
        const data = await response.json();
        addNotification(`Parking spot ${data.spotId} declared successfully!`);
        if (setParkedLocation) {
          setParkedLocation(coordinates);
        }
      } else if (response.status === 401 || response.status === 403) {
        await logout();
      }
    } catch (error) {
      console.error('[SpotContext] Error creating spot:', error);
    }
  };

  const handleAcceptRequest = (request) => {
    if (socket.current) {
      socket.current.emit('acceptRequest', {
        requestId: request.requestId,
        requesterId: request.requesterId,
        spotId: request.spotId,
        ownerUsername: currentUsername,
        ownerId: userId,
      });
      // Note: acceptedRequest state is usually handled by socket listeners in AppContent, 
      // but we can manage it here if we move listeners too. For now, let's keep it consistent.
      setSpotRequests([]);
    }
  };

  const handleDeclineRequest = (request) => {
    if (socket.current) {
      socket.current.emit('declineRequest', {
        requestId: request.requestId,
        requesterId: request.requesterId,
        spotId: request.spotId,
        ownerUsername: currentUsername,
        ownerId: userId,
      });
      setSpotRequests(prevRequests => prevRequests.filter(req => req.requestId !== request.requestId));
    }
  };

  const resetParkingSpots = useCallback(async () => {
    setParkingSpots([]);
    setSpotsLoaded(false);
    setAcceptedSpotState(null);
    setArrivalConfirmedState(false);
    setSpotRequests([]);
    setHasNewRequests(false);
    await AsyncStorage.multiRemove(['acceptedSpot', 'arrivalConfirmed']);
  }, []);

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('dataReset', resetParkingSpots);
    return () => subscription.remove();
  }, [resetParkingSpots]);

  const value = {
    parkingSpots,
    setParkingSpots,
    acceptedSpot,
    setAcceptedSpot,
    arrivalConfirmed,
    setArrivalConfirmed,
    spotRequests,
    setSpotRequests,
    hasNewRequests,
    setHasNewRequests,
    fetchParkingSpots,
    handleRequestSpot,
    handleDeleteSpot,
    handleSaveEditedSpot,
    handleCreateSpot,
    handleAcceptRequest,
    handleDeclineRequest,
    resetParkingSpots,
  };

  return (
    <SpotContext.Provider value={value}>
      {children}
    </SpotContext.Provider>
  );
};
