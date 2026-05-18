import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, TouchableOpacity, Text, Image, StyleSheet, DeviceEventEmitter, Alert } from 'react-native';
import * as Location from 'expo-location'; 
import Map from './Map';
import Notifications from './Notifications';
import SpotDetails from './SpotDetails';
import TimeOptionsModal from './TimeOptionsModal';
import ArrivalConfirmationModal from './ArrivalConfirmationModal';
import RatingModal from './RatingModal';
import RequesterArrivalModal from './RequesterArrivalModal';
import EditSpotMobileModal from './EditSpotMobileModal';
import RequesterProfileModal from './RequesterProfileModal';
import LeavingModal from './LeavingModal';

import { useAuth } from '../context/AuthContext';
import { useNotifications } from '../context/NotificationContext';
import { useSpots } from '../context/SpotContext';
import { useChat } from '../context/ChatContext';

export default function HomeScreen({ 
  userLocation, 
  locationPermissionGranted, 
  socket,
  getDistance,
  parkedLocation,
}) {
  const { userId, currentUsername, token, serverUrl } = useAuth();
  const { notifications, triggerNotification } = useNotifications();
  const { 
    parkingSpots, setParkingSpots, acceptedSpot, setAcceptedSpot, 
    handleRequestSpot, handleDeleteSpot, handleSaveEditedSpot, handleCreateSpot, 
    setSpotRequests, setHasNewRequests, arrivalConfirmed, setArrivalConfirmed, hasActiveSpot 
  } = useSpots();
  const { handleOpenChat } = useChat();

  const handleRate = useCallback(async (rating, ratedUserId) => {
    if (!token || !ratedUserId) return;
    try {
      const response = await fetch(`${serverUrl}/api/users/rate`, {
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
  const [showEditSpotMobileModal, setShowEditSpotMobileModal] = useState(false);
  const [spotToEdit, setSpotToEdit] = useState(null);
  const [showRequesterDetailsModal, setShowRequesterDetailsModal] = useState(false);
  const [selectedRequester, setSelectedRequester] = useState(null);
  const [newSpotCoordinates, setNewSpotCoordinates] = useState(null);
  const [isAddingSpot, setIsAddingSpot] = useState(false);
  const [isLeavingModalVisible, setLeavingModalVisible] = useState(false);

  const mapViewRef = useRef(null);

  const handleCenterMap = async () => {
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
  };

  useEffect(() => {
    const proximitySubscription = DeviceEventEmitter.addListener('proximityArrival', () => {
      console.log('[HomeScreen] Proximity arrival event received.');
      setRequesterArrivalModalOpen(true);
    });

    return () => {
      proximitySubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (socket && socket.current) {
      const s = socket.current;

      const onRequestResponse = (data) => {
        if (data.spot && mapViewRef.current) {
          mapViewRef.current.animateToRegion({
            latitude: parseFloat(data.spot.latitude),
            longitude: parseFloat(data.spot.longitude),
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }, 1000);
        }
      };

      const onRequesterArrived = (data) => {
        console.log('[HomeScreen] Requester arrived notification received:', data);
        const message = `User ${data.requesterUsername} has arrived at spot ${data.spotId}. Please confirm to complete the transaction.`;
        triggerNotification(message, 'arrived');
        setArrivalConfirmationData(data);
        setArrivalConfirmationModalOpen(true);
      };

      const onTransactionComplete = (data) => {
        console.log('[HomeScreen] Transaction complete received:', data);
        Alert.alert('Arrival Confirmed', 'Spot owner confirmed arrival.');
        triggerNotification(data.message, 'default');
        setAcceptedSpot(null);
        setArrivalConfirmed(false);
        if (data.ownerId && data.ownerUsername) {
          setUserToRate({ requester_id: data.ownerId, requester_username: data.ownerUsername });
          setShowRatingModal(true);
        }
      };

      const onArrivalRejected = (data) => {
        console.log('[HomeScreen] Arrival rejected notification received:', data);
        Alert.alert('Arrival Not Confirmed', 'The owner did not confirm your arrival. Please try again.');
        setArrivalConfirmed(false); 
      };

      s.on('requestResponse', onRequestResponse);
      s.on('requesterArrived', onRequesterArrived);
      s.on('transactionComplete', onTransactionComplete);
      s.on('arrivalRejected', onArrivalRejected);

      return () => {
        s.off('requestResponse', onRequestResponse);
        s.off('requesterArrived', onRequesterArrived);
        s.off('transactionComplete', onTransactionComplete);
        s.off('arrivalRejected', onArrivalRejected);
      };
    }
  }, [socket, setAcceptedSpot, setArrivalConfirmed, triggerNotification]);


  const handleConfirmArrival = () => {
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
  };

  const handleManualArrivalClick = () => {
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
  };

  const handleLocalOpenChat = (user) => {
    handleOpenChat(user);
    setShowRequesterDetailsModal(false); 
    setSelectedRequester(null); 
  };

  const handleLocalSpotPress = (spot) => {
    setSelectedSpot(spot);
    setSpotDetailsVisible(true);
  };

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
      setLeavingModalVisible(true);
    }
  }, [acceptedSpot, arrivalConfirmed, isAddingSpot, handleManualArrivalClick]);

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

  const handleEditSpot = (spot) => {
    setSpotToEdit(spot);
    setShowEditSpotMobileModal(true);
    setSpotDetailsVisible(false); 
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
          setSpotDetailsVisible={setSpotDetailsVisible}
          isAddingSpot={isAddingSpot}
          setIsAddingSpot={setIsAddingSpot}
          setNewSpotCoordinates={setNewSpotCoordinates}
          setShowTimeOptionsModal={setShowTimeOptionsModal}
          acceptedSpot={acceptedSpot}
          parkedLocation={parkedLocation}
        />
        <TouchableOpacity
          style={[
            styles.fab,
            (hasActiveSpot && !acceptedSpot && !isAddingSpot) && { backgroundColor: 'gray' }
          ]}
          onPress={handleLocalFabPress}
          disabled={hasActiveSpot && !acceptedSpot && !isAddingSpot}
        >
          {(acceptedSpot) ? (
            <Image source={require('../assets/images/arrived.png')} style={styles.fabIcon} />
          ) : (
            <Text style={isAddingSpot ? styles.fabTextSmall : styles.fabText}>
              {isAddingSpot ? 'X' : '+'}
            </Text>
          )}
        </TouchableOpacity>
      </View>
      <Notifications notifications={notifications} />

      <LeavingModal
        visible={isLeavingModalVisible}
        onClose={() => setLeavingModalVisible(false)}
        onCreateSpot={(time) => {
          handleCreateSpot(time);
          setLeavingModalVisible(false);
        }}
      />

      <SpotDetails
        visible={isSpotDetailsVisible}
        spot={selectedSpot}
        onClose={() => setSpotDetailsVisible(false)}
        onRequestSpot={handleRequestSpot}
        onDeleteSpot={handleDeleteSpot}
        onEditSpot={handleEditSpot}
        userLocation={userLocation}
        acceptedSpot={acceptedSpot}
        arrivalConfirmed={arrivalConfirmed}
        onOpenChat={handleLocalOpenChat}
        onConfirmArrival={handleManualArrivalClick}
      />

      <TimeOptionsModal
        visible={showTimeOptionsModal}
        onClose={() => setShowTimeOptionsModal(false)}
        onSelectTime={handleCreateSpot}
      />

      <EditSpotMobileModal
        visible={showEditSpotMobileModal}
        onClose={() => setShowEditSpotMobileModal(false)}
        spotData={spotToEdit}
        onSave={handleSaveEditedSpot}
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
    borderWidth: 2,
    borderColor: 'blue',
    borderRadius: 10,
    margin: 5,
  },
  fab: {
    position: 'absolute',
    width: 91,
    height: 91,
    borderRadius: 46,
    backgroundColor: '#9b59b6',
    justifyContent: 'center',
    alignItems: 'center',
    bottom: 10,
    alignSelf: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    transform: [{ rotate: '0deg' }],
  },
  fabText: {
    color: 'white',
    fontSize: 55,
    fontWeight: '300',
    lineHeight: 55,
  },
  fabTextSmall: {
    color: 'red',
    fontSize: 35,
    fontWeight: '300',
    lineHeight: 35,
    top: 3,
  },
  fabIcon: {
    width: 55,
    height: 55,
    resizeMode: 'contain',
  },
});
