import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Alert } from 'react-native';
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

export const SpotProvider = ({ children, addNotification, socket, userId, currentUsername }) => {
  const { token, isLoggedIn, serverUrl, logout } = useAuth();
  const [parkingSpots, setParkingSpots] = useState([]);
  const [acceptedSpot, setAcceptedSpot] = useState(null);
  const [spotRequests, setSpotRequests] = useState([]);
  const [hasNewRequests, setHasNewRequests] = useState(false);

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
      const response = await fetch(`${serverUrl}/api/parkingspots`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (response.ok) {
        const data = await response.json();
        const transformedData = data.map(spot => ({ ...spot, ownerId: spot.user_id }));
        setParkingSpots(transformedData);
      } else if (response.status === 401 || response.status === 403) {
        await logout();
      }
    } catch (error) {
      console.error('[SpotContext] Error fetching parking spots:', error);
    }
  }, [isLoggedIn, token, serverUrl, logout]);

  const handleRequestSpot = async (spotId, requesterLat, requesterLon) => {
    if (!token) return;
    try {
      const response = await fetch(`${serverUrl}/api/request-spot`, {
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
      const response = await fetch(`${serverUrl}/api/parkingspots/${spotId}`, {
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
      const response = await fetch(`${serverUrl}/api/parkingspots/${spotId}`, {
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
      const response = await fetch(`${serverUrl}/api/declare-spot`, {
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

  const value = {
    parkingSpots,
    setParkingSpots,
    acceptedSpot,
    setAcceptedSpot,
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
  };

  return (
    <SpotContext.Provider value={value}>
      {children}
    </SpotContext.Provider>
  );
};
