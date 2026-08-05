import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, StyleSheet, DeviceEventEmitter, Alert } from 'react-native';
import * as Location from 'expo-location'; 
import Map from './Map';
import Notifications from './Notifications';
import SpotDetails from './SpotDetails';
import TimeOptionsModal from './TimeOptionsModal';
import ArrivalConfirmationModal from './ArrivalConfirmationModal';
import RatingModal from './RatingModal';
import RequesterArrivalModal from './RequesterArrivalModal';
import RequesterProfileModal from './RequesterProfileModal';
import LeavingModal from './LeavingModal';

import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useSpots } from '../context/SpotContext';
import { useChat } from '../context/ChatContext';
import { useLocation } from '../context/LocationContext';
import { useHeaderAction } from '../context/HeaderActionContext';
import { apiRequest } from '../utils/apiService';

export default function HomeScreen({ 
  socket,
}) {
  const { userId, token, currentUsername, serverUrl, currentUser } = useAuth();
  const { userLocation, getDistance, locationPermissionGranted, parkedLocation } = useLocation();
  const { notifications, addNotification, triggerNotification } = useNotifications();
  const { setHeaderAction } = useHeaderAction();
  const {
    parkingSpots, setParkingSpots, acceptedSpot, setAcceptedSpot,
    handleRequestSpot, handleDeleteSpot, handleSaveEditedSpot, handleCreateSpot,
    setSpotRequests, setHasNewRequests, arrivalConfirmed, setArrivalConfirmed, hasActiveSpot,
    spotRadiusKm,
  } = useSpots();
  const { handleOpenChat } = useChat();

  const handleLocalOpenChat = useCallback((userId) => {
    handleOpenChat(userId);
  }, [handleOpenChat]);

  const handleRate = useCallback(async (rating, ratedUserId) => {
    if (!token || !ratedUserId) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/users/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ rated_user_id: ratedUserId, rating }),
      });
      if (response.ok) {
        triggerNotification('Rating submitted successfully!', 'default');
      }
    } catch (error) {
      console.error('Error submitting rating:', error);
    }
  }, [token, serverUrl, triggerNotification]);

  const [selectedSpot, setSelectedSpot] = useState(null);
  const [isSpotDetailsVisible, setSpotDetailsVisible] = useState(false);
  const [showTimeOptionsModal, setShowTimeOptionsModal] = useState(false);
  const [isArrivalConfirmationModalOpen, setArrivalConfirmationModalOpen] = useState(false);
  const [arrivalConfirmationData, setArrivalConfirmationData] = useState(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [userToRate, setUserToRate] = useState(null);
  const [isRequesterArrivalModalOpen, setRequesterArrivalModalOpen] = useState(false);
  const [showRequesterDetailsModal, setShowRequesterDetailsModal] = useState(false);
  const [selectedRequester, setSelectedRequester] = useState(null);
  const [newSpotCoordinates, setNewSpotCoordinates] = useState(null);
  const [isAddingSpot, setIsAddingSpot] = useState(false);
  const [isLeavingModalVisible, setLeavingModalVisible] = useState(false);

  const mapViewRef = useRef(null);

  const handleCenterMap = useCallback(async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const currentLocation = await Location.getCurrentPositionAsync({});
      if (mapViewRef.current) {
        mapViewRef.current.animateToRegion({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      }
    } catch (e) {
      console.error('[HomeScreen] Error fetching live location for map centering:', e);
    }
  }, []);

  const handleConfirmArrival = useCallback(() => {
    if (socket.current && acceptedSpot && userId) {
      socket.current.emit('requester-arrived', {
        spotId: acceptedSpot.id,
        requesterId: userId,
        requesterUsername: currentUsername,
      });
      Alert.alert('Arrival Confirmed', 'Spot owner has been notified of your arrival.');
      setArrivalConfirmed(true); 
      setSpotDetailsVisible(false); 
      setRequesterArrivalModalOpen(false); 
    }
  }, [socket, acceptedSpot, userId, currentUsername, setArrivalConfirmed]);

  const handleManualArrivalClick = useCallback(() => {
    if (acceptedSpot && userLocation) {
      const spotLat = parseFloat(acceptedSpot.latitude);
      const spotLon = parseFloat(acceptedSpot.longitude);
      const distance = getDistance(userLocation.latitude, userLocation.longitude, spotLat, spotLon);
      const distanceThreshold = 100; 
      if (distance > distanceThreshold) {
        Alert.alert('Too Far', `You are too far from the spot to confirm arrival. Please get closer (within 100 meters). Current distance: ${distance.toFixed(0)}m`);
        return;
      }
      setRequesterArrivalModalOpen(true);
    } else {
      Alert.alert('Error', 'Could not determine distance. Please check your location settings.');
    }
  }, [acceptedSpot, userLocation, getDistance]);

// ... (other code between them remains the same)

  const handleLocalSpotPress = useCallback((spot) => {
    setSelectedSpot(spot);
    setSpotDetailsVisible(true);
  }, []);

  const handleLocalFabPress = useCallback(() => {
    if (acceptedSpot) {
      if (!arrivalConfirmed) {
        handleManualArrivalClick();
      } else {
        Alert.alert('Arrival Confirmed', 'The owner has been notified of your arrival. Please wait for their confirmation.');
      }
    } else if (isAddingSpot) {
      setIsAddingSpot(false);
      setNewSpotCoordinates(null);
    } else {
      // Flow fix: Start adding spot mode
      setIsAddingSpot(true);
    }
  }, [acceptedSpot, arrivalConfirmed, isAddingSpot, handleManualArrivalClick]);

  // Publishes the "+" action into the header (RootNavigator lives outside the Tab.Navigator, so it
  // can't be reached with plain JSX composition) — replaces the old floating FAB. Cleared on
  // unmount so a stray Home-only action can't linger into another tab if this screen ever gets
  // unmounted on tab switch.
  useEffect(() => {
    setHeaderAction({
      onPress: handleLocalFabPress,
      disabled: hasActiveSpot && !acceptedSpot && !isAddingSpot,
      mode: acceptedSpot ? 'arrived' : (isAddingSpot ? 'cancel' : 'add'),
    });
    return () => setHeaderAction(null);
  }, [handleLocalFabPress, hasActiveSpot, acceptedSpot, isAddingSpot, setHeaderAction]);

  const handleLocalConfirmTransaction = () => {
    if (socket.current && arrivalConfirmationData) {
      socket.current.emit('confirm-transaction', {
        spotId: arrivalConfirmationData.spotId,
        requesterId: arrivalConfirmationData.requesterId,
      });
      setArrivalConfirmationModalOpen(false);
      triggerNotification('Arrival confirmed!', 'default');
      setUserToRate({ requester_id: arrivalConfirmationData.requesterId, requester_username: arrivalConfirmationData.requesterUsername });
      setShowRatingModal(true);
      setArrivalConfirmationData(null);
    }
  };

  const handleLocalCloseArrivalModal = () => {
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  const handleLocalNotIdentified = () => {
    if (arrivalConfirmationData) {
      socket.current.emit('reject-arrival', {
        spotId: arrivalConfirmationData.spotId,
        requesterId: arrivalConfirmationData.requesterId,
      });
      addNotification(`You have indicated that the requester was not identified.`, 'default');
    }
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  return (
    <View style={{flex: 1}}>
      <View style={{...styles.mapBorderWrapper, flex: 1}}>
        <Map
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
          parkingSpots={parkingSpots}
          handleSpotPress={handleLocalSpotPress}
          handleCenterMap={handleCenterMap}
          mapViewRef={mapViewRef}
          isAddingSpot={isAddingSpot}
          setIsAddingSpot={setIsAddingSpot}
          setNewSpotCoordinates={setNewSpotCoordinates}
          setShowTimeOptionsModal={setShowTimeOptionsModal}
          acceptedSpot={acceptedSpot}
          parkedLocation={parkedLocation}
          getDistance={getDistance}
          spotRadiusKm={spotRadiusKm}
        />
      </View>
      {/* 2026-08-05: every message pushed into `notifications` (SpotContext.js, HomeScreen.js,
          useParkDetectionEngine.js) is a normal user-facing event — spot declared/deleted/updated,
          request received, rating submitted, arrival confirmed. None of it is admin-diagnostic
          (that lives separately, in HMMOverlay/DebugSimulator, still admin-gated) — this panel was
          just built admin-only by default and never opened up. All logged-in users get it now. */}
      {currentUser && <Notifications notifications={notifications} />}

      <LeavingModal
        visible={isLeavingModalVisible}
        onClose={() => setLeavingModalVisible(false)}
        onCreateSpot={(time) => {
          handleCreateSpot(time, newSpotCoordinates || userLocation);
          setLeavingModalVisible(false);
          setNewSpotCoordinates(null);
        }}
      />

      <SpotDetails
        visible={isSpotDetailsVisible}
        spot={selectedSpot}
        onClose={() => setSpotDetailsVisible(false)}
        onRequestSpot={handleRequestSpot}
        onDeleteSpot={handleDeleteSpot}
        onUpdateSpot={handleSaveEditedSpot}
        userLocation={userLocation}
        acceptedSpot={acceptedSpot}
        arrivalConfirmed={arrivalConfirmed}
        onOpenChat={handleLocalOpenChat}
        onConfirmArrival={handleManualArrivalClick}
      />

      <TimeOptionsModal
        visible={showTimeOptionsModal}
        onClose={() => setShowTimeOptionsModal(false)}
        onSelectTime={(time) => {
          handleCreateSpot(time, newSpotCoordinates || userLocation);
          setNewSpotCoordinates(null);
        }}
      />

      <ArrivalConfirmationModal
        isOpen={isArrivalConfirmationModalOpen}
        onClose={handleLocalCloseArrivalModal}
        onConfirm={handleLocalConfirmTransaction}
        onNotIdentified={handleLocalNotIdentified}
        requesterUsername={arrivalConfirmationData?.requesterUsername}
        spotId={arrivalConfirmationData?.spotId}
      />

      <RequesterArrivalModal
        isOpen={isRequesterArrivalModalOpen}
        onClose={() => {
          setRequesterArrivalModalOpen(false);
          setArrivalConfirmed(false); 
        }}
        onConfirm={handleConfirmArrival}
      />

      <RatingModal
        isOpen={showRatingModal}
        onClose={() => setShowRatingModal(false)}
        requester={userToRate}
        onRate={handleRate}
      />

      <RequesterProfileModal
        visible={showRequesterDetailsModal}
        onClose={() => setShowRequesterDetailsModal(false)}
        user={selectedRequester}
        onOpenChat={handleLocalOpenChat}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  mapBorderWrapper: {
    flex: 1,
  },
});
