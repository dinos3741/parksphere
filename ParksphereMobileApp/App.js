import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Alert, Modal, DeviceEventEmitter } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigationContainerRef } from '@react-navigation/native';
import * as Location from 'expo-location'; 
import * as Font from 'expo-font';
import { useAudioPlayer } from 'expo-audio';
import { apiRequest } from './utils/apiService';
import LeavingModal from './components/LeavingModal';
import SpotDetails from './components/SpotDetails';
import HMMOverlay from './components/HMMOverlay';
import DebugSimulator from './components/DebugSimulator';
import Login from './components/Login';
import Register from './components/Register';
import TimeOptionsModal from './components/TimeOptionsModal'; 
import { startParkDetection, stopParkDetection, resetParkDetection, handleLocationUpdate } from './utils/parkDetectionService';
import * as ExpoNotifications from 'expo-notifications';
import { useLocationTracking } from './hooks/useLocationTracking';
import { useSocketConnection } from './hooks/useSocketConnection';

import EditSpotMobileModal from './components/EditSpotMobileModal'; 
import ArrivalConfirmationModal from './components/ArrivalConfirmationModal';
import RequesterArrivalModal from './components/RequesterArrivalModal';
import RatingModal from './components/RatingModal';
import RequesterProfileModal from './components/RequesterProfileModal'; 
import AboutScreen from './components/AboutScreen';
import RootNavigator from './components/RootNavigator';

import { enableScreens } from 'react-native-screens';
enableScreens(false);

export default function App() {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [isLeavingModalVisible, setLeavingModalVisible] = useState(false);
  const mapViewRef = useRef(null);
  const activeChatPartnerRef = useRef(null); 

  const newRequestPlayer = useAudioPlayer(require('./assets/sounds/new-request.wav'));
  const arrivedPlayer = useAudioPlayer(require('./assets/sounds/arrived.wav'));
  const messagePlayer = useAudioPlayer(require('./assets/sounds/message-sound.wav'));

  const playSound = useCallback(() => {
    newRequestPlayer.play();
  }, [newRequestPlayer]);

  const playSoundArrived = useCallback(() => {
    arrivedPlayer.play();
  }, [arrivedPlayer]);

  const playSoundMessage = useCallback(() => {
    messagePlayer.play();
  }, [messagePlayer]);

  useEffect(() => {
    async function prepare() {
      try {
        await Font.loadAsync({
          'AdventPro-SemiBold': require('./assets/fonts/AdventPro-SemiBold.ttf'),
        });
        setFontLoaded(true);
        await resetParkDetection();
      } catch (e) {
        console.warn('[App.js] Initialization error:', e);
      }
    }
    prepare();
  }, []);

  const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

  const [currentUsername, setCurrentUsername] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [message, setMessage] = useState('Please log in.');
  const [notifications, setNotifications] = useState([]); 
  const addNotification = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setNotifications((prevNotifications) => [...prevNotifications, { msg, timestamp }]);
  };
  const [showRegister, setShowRegister] = useState(false); 
  const [showAboutScreen, setShowAboutScreen] = useState(false); 
  const [currentUser, setCurrentUser] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [spotRequests, setSpotRequests] = useState([]);
  const [acceptedRequest, setAcceptedRequest] = useState(null);
  const [hasNewRequests, setHasNewRequests] = useState(false);
  const navigationRef = useNavigationContainerRef(); 
  const [totalUnreadMessagesCount, setTotalUnreadMessagesCount] = useState(0); 
  const [unreadConversations, setUnreadConversations] = useState({}); 
  const [parkedLocation, setParkedLocation] = useState(null); 
  const [acceptedSpot, setAcceptedSpot] = useState(null); 
  const [arrivalConfirmed, setArrivalConfirmed] = useState(false); 
  const [parkingSpots, setParkingSpots] = useState([]); 

  const { userLocation, setUserLocation, locationPermissionGranted, getDistance } = useLocationTracking(
    acceptedSpot, 
    arrivalConfirmed,
    () => {
      setArrivalConfirmed(true);
      DeviceEventEmitter.emit('proximityArrival');
    }
  );

  const hasActiveSpot = parkingSpots.some(spot => spot.ownerId === userId);

  const socket = useSocketConnection(serverUrl, userId, currentUsername, isLoggedIn, token, (newSocket) => {
    newSocket.on('newParkingSpot', (newSpot) => {
      const spotWithOwnerId = { ...newSpot, ownerId: newSpot.user_id };
      setParkingSpots((prevSpots) => [...prevSpots, spotWithOwnerId]);
    });

    newSocket.on('spotDeleted', ({ spotId }) => {
      setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== parseInt(spotId, 10)));
      setSpotRequests((prevRequests) => prevRequests.filter((request) => request.spotId !== parseInt(spotId, 10)));
      setAcceptedSpot(prev => (prev && prev.id === parseInt(spotId, 10) ? null : prev));
    });

    newSocket.on('spotUpdated', (updatedSpot) => {
      setParkingSpots((prevSpots) => prevSpots.map((spot) => (spot.id === updatedSpot.id ? updatedSpot : spot)));
    });

    newSocket.on('spotStatusUpdated', (updatedSpot) => {
      setParkingSpots((prevSpots) => prevSpots.map((spot) => (spot.id === updatedSpot.id ? updatedSpot : spot)));
    });

    newSocket.on('spotRequest', (data) => {
      setSpotRequests(prevRequests => [...prevRequests, data]);
      setHasNewRequests(true);
      addNotification(data.message);
      playSound();
    });

    newSocket.on('requestAcceptedOrDeclined', ({ spotId, requestId }) => {
      setSpotRequests(prevRequests => prevRequests.filter(req => req.requestId !== requestId));
    });

    newSocket.on('requestResponse', (data) => {
      Alert.alert('Spot Request Update', data.message);
      if (data.spot) {
        setAcceptedSpot(data.spot);
        setArrivalConfirmed(false);
        if (mapViewRef.current) {
          mapViewRef.current.animateToRegion({
            latitude: parseFloat(data.spot.latitude),
            longitude: parseFloat(data.spot.longitude),
            latitudeDelta: 0.005,
            longitudeDelta: 0.005,
          }, 1000);
        }
      } else {
        setAcceptedSpot(null);
        setArrivalConfirmed(false);
      }
    });

    // requesterArrived, transactionComplete, and arrivalRejected listeners moved to HomeScreen.js

    newSocket.on('privateMessage', (message) => {
      if (message.to === userId && message.from !== userId) {
        playSoundMessage();
        if (activeChatPartnerRef.current !== message.from) {
          handleMarkAsUnread(message.from);
        }
      }
    });
  });

  useEffect(() => {
    const detectionSubscription = DeviceEventEmitter.addListener('parkDetectionUpdate', (data) => {
      addNotification(data.message);
      if (data.parkedLocation) {
        setParkedLocation(data.parkedLocation);
      } else if (data.clearParkedLocation) {
        setParkedLocation(null);
      }
    });

    const setupNotificationsAndDetection = async () => {
      const { status: existingStatus } = await ExpoNotifications.getPermissionsAsync();
      if (existingStatus !== 'granted') {
        await ExpoNotifications.requestPermissionsAsync();
      }
      
      if (currentUser) {
        const autoDetectionEnabled = await AsyncStorage.getItem('autoDetectionEnabled');
        if (currentUser.auto_detect || autoDetectionEnabled === 'true') {
          if (currentUser.auto_detect) {
            await AsyncStorage.setItem('autoDetectionEnabled', 'true');
          }
          await startParkDetection();
        }
      }

      const saved = await AsyncStorage.getItem('PARK_STATE');
      if (saved) {
        const stateData = JSON.parse(saved);
        if (stateData.parkedLocation) {
          setParkedLocation(stateData.parkedLocation);
        }
      }
    };
    
    let foregroundSubscription = null;
    const setupForegroundFallback = async () => {
       const storedEnabled = await AsyncStorage.getItem('autoDetectionEnabled');
       const isEnabled = (storedEnabled === 'true') || (currentUser && currentUser.auto_detect);
       
       if (isEnabled) {
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
      const initializeAll = async () => {
        await setupNotificationsAndDetection();
        await setupForegroundFallback();
      };
      initializeAll();
    }

    return () => {
      if (foregroundSubscription) {
        foregroundSubscription.remove();
      }
      detectionSubscription.remove();
      stopParkDetection(); 
    };
  }, [isLoggedIn, currentUser?.id, currentUser?.auto_detect]);

  useEffect(() => {
    const loadToken = async () => {
      try {
        const storedToken = await AsyncStorage.getItem('userToken');
        const storedUserId = await AsyncStorage.getItem('userId');
        const storedUsername = await AsyncStorage.getItem('username');
        if (storedToken && storedUserId && storedUsername) {
          setToken(storedToken);
          setUserId(parseInt(storedUserId, 10));
          setCurrentUsername(storedUsername);
          setIsLoggedIn(true);
        }
      } catch (error) {
        console.error('Failed to load token from AsyncStorage', error);
      }
    };
    loadToken();
  }, []);

  const fetchUserData = useCallback(async () => {
    if (isLoggedIn && userId && token) {
      try {
        const response = await apiRequest(`${serverUrl}/api/users/${userId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data);
        } else if (response.status === 401 || response.status === 403) {
          await handleLogout();
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [isLoggedIn, userId, token, serverUrl]);

  const handleLogout = useCallback(async () => {
    try {
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('userId');
      await AsyncStorage.removeItem('username');
      setToken(null);
      setUserId(null);
      setCurrentUsername(null);
      setCurrentUser(null);
      setIsLoggedIn(false);
      setNotifications([]);
      setTotalUnreadMessagesCount(0);
      await stopParkDetection();
    } catch (error) {
      console.error('Error during logout:', error);
    }
  }, []);

  useEffect(() => {
    const currentTotalUnread = Object.keys(unreadConversations).length;
    setTotalUnreadMessagesCount(currentTotalUnread);
  }, [unreadConversations]);

  const handleMarkAsRead = useCallback((otherUserId) => {
    setUnreadConversations(prev => {
      const newState = { ...prev };
      if (newState[otherUserId]) {
        delete newState[otherUserId];
      }
      return newState;
    });
  }, []);

  const handleMarkAsUnread = useCallback((otherUserId) => {
    setUnreadConversations(prev => {
      return { ...prev, [otherUserId]: true };
    });
  }, []);

  useEffect(() => {
    if (isLoggedIn && token && userId && currentUsername) {
      fetchUserData();
      const fetchParkingSpots = async () => {
        try {
          const response = await fetch(`${serverUrl}/api/parkingspots`, {
            headers: { 'Authorization': `Bearer ${token}` },
          });
          if (response.ok) {
            const data = await response.json();
            const transformedData = data.map(spot => ({ ...spot, ownerId: spot.user_id }));
            setParkingSpots(transformedData);
          } else if (response.status === 401 || response.status === 403) {
            await handleLogout();
          }
        } catch (error) {
          console.error('Error fetching parking spots:', error);
        }
      };
      fetchParkingSpots();
    }
  }, [isLoggedIn, token, userId, currentUsername, serverUrl, fetchUserData, handleLogout]);

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      parkingSpots.forEach(spot => {
        const expirationTime = new Date(spot.declared_at).getTime() + spot.time_to_leave * 60 * 1000;
        if (now > expirationTime) {
          setParkingSpots(prevSpots => prevSpots.filter(s => s.id !== spot.id));
          setSpotRequests(prevRequests => prevRequests.filter(req => req.spotId !== spot.id));
        }
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [parkingSpots]);

  const handleLogin = (data) => {
    setToken(data.token);
    setUserId(data.userId);
    setCurrentUsername(data.username);
    setIsLoggedIn(true);
    addNotification(`Welcome ${data.username}!`);
  };

  const handleSpotPress = (spot) => {
    setSelectedSpot(spot);
    setSpotDetailsVisible(true);
  };

  const handleRequestSpot = async (spotId, requesterLat, requesterLon) => {
    if (!token) {
      Alert.alert('Error', 'You must be logged in to request a spot.');
      return;
    }
    try {
      const response = await fetch(`${serverUrl}/api/request-spot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ spotId, requesterLat, requesterLon }),
      });
      const data = await response.json();
      if (!response.ok) {
        Alert.alert('Error', data.message || 'Failed to request spot.');
      }
    } catch (error) {
      console.error('Error requesting spot:', error);
      Alert.alert('Error', 'Could not connect to the server to request the spot.');
    }
    setSpotDetailsVisible(false);
  };

  const handleDeleteSpot = async (spotId) => {
    if (!token) {
      Alert.alert('Error', 'You must be logged in to delete a spot.');
      return;
    }
    const executeDelete = async () => {
      try {
        const response = await fetch(`${serverUrl}/api/parkingspots/${spotId}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (response.ok) {
          addNotification(`Spot ${spotId} deleted successfully!`);
          setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== spotId));
          setSpotDetailsVisible(false); 
        } else if (response.status === 401 || response.status === 403) {
          handleLogout();
        } else {
          const data = await response.json();
          Alert.alert('Error', `Failed to delete spot: ${data.message || 'Unknown error'}`);
        }
      } catch (error) {
        console.error('Error deleting spot:', error);
        Alert.alert('Error', 'Could not connect to the server to delete spot.');
      }
    };
    Alert.alert('Confirm Deletion', 'Are you sure you want to delete this parking spot?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: executeDelete },
    ], { cancelable: true });
  };

  const handleEditSpot = (spot) => {
    setSpotToEdit(spot);
    setShowEditSpotMobileModal(true);
    setSpotDetailsVisible(false); 
  };

  const handleSaveEditedSpot = async (spotId, updatedDetails) => {
    if (!token) {
      Alert.alert('Error', 'You must be logged in to edit a spot.');
      return;
    }
    try {
      const response = await fetch(`${serverUrl}/api/parkingspots/${spotId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(updatedDetails),
      });
      const data = await response.json();
      if (response.ok) {
        addNotification(`Spot ${spotId} updated successfully!`);
        setParkingSpots((prevSpots) =>
          prevSpots.map((spot) => (spot.id === spotId ? { ...spot, ...updatedDetails } : spot))
        );
      } else if (response.status === 401 || response.status === 403) {
        handleLogout();
      } else {
        Alert.alert('Error', `Failed to update spot: ${data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating spot:', error);
      Alert.alert('Error', 'Could not connect to the server to update spot.');
    } finally {
      setShowEditSpotMobileModal(false); 
      setSpotToEdit(null); 
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
      setAcceptedRequest(request);
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

  const handleCenterMap = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission denied', 'Permission to access location was denied');
        return;
      }
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
      console.error('Error fetching live location for map centering:', e);
      if (mapViewRef.current && userLocation) {
        mapViewRef.current.animateToRegion({
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
      }
    }
  };

  const handleCreateSpot = async (duration) => {
    if (!token || !userId || !newSpotCoordinates) {
      Alert.alert('Error', 'Please log in and select a location to create a spot.');
      return;
    }
    try {
      const response = await fetch(`${serverUrl}/api/declare-spot`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          userId: userId,
          latitude: newSpotCoordinates.latitude,
          longitude: newSpotCoordinates.longitude,
          timeToLeave: duration,
          costType: 'free',
          price: 0,
          declaredCarType: 'sedan', 
          comments: '',
        }),
      });
      const data = await response.json();
      if (response.ok) {
        addNotification(`Parking spot ${data.spotId} declared successfully by user ${currentUsername}`);
        setShowTimeOptionsModal(false); 
        setNewSpotCoordinates(null); 
      } else if (response.status === 401 || response.status === 403) {
        handleLogout();
      } else {
        Alert.alert('Error', `Failed to create spot: ${data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating spot:', error);
      Alert.alert('Error', 'Could not connect to the server to create spot.');
    }
  };

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchUserData();
  };

  const handleProfileUpdate = (shouldClose = true) => {
    fetchUserData();
    if (shouldClose === true) {
      setIsEditingProfile(false); 
    }
  };

  const handleOpenChat = (user) => {
    navigationRef.current?.navigate('Chat', { recipient: user });
  };

  const handleRate = async (rating) => {
    if (!userToRate) return;
    try {
      const token = await AsyncStorage.getItem('userToken');
      const response = await fetch(`${serverUrl}/api/users/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ rated_user_id: userToRate.requester_id, rating }),
      });
      if (!response.ok) {
        throw new Error('Failed to submit rating');
      }
      addNotification('Rating submitted successfully!', 'green');
      setShowRatingModal(false);
      setUserToRate(null);
    } catch (error) {
      console.error('Error submitting rating:', error);
      addNotification('Failed to submit rating', 'red');
    }
  };

  const handleConfirmTransaction = () => {
    if (socket.current && arrivalConfirmationData) {
      socket.current.emit('confirm-transaction', {
        spotId: arrivalConfirmationData.spotId,
        requesterId: arrivalConfirmationData.requesterId,
      });
      setArrivalConfirmationModalOpen(false);
      addNotification('Arrival confirmed!', 'green');
      setUserToRate({ requester_id: arrivalConfirmationData.requesterId, requester_username: arrivalConfirmationData.requesterUsername });
      setShowRatingModal(true);
      setArrivalConfirmationData(null);
    }
  };

  const handleCloseArrivalModal = () => {
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  const handleNotIdentified = () => {
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

  const getAvatarUri = (avatarUrl, username) => {
    if (!avatarUrl) return `https://i.pravatar.cc/150?u=${username}`;
    if (avatarUrl.startsWith('http')) {
      if (avatarUrl.includes('localhost')) return avatarUrl.replace('http://localhost:3001', serverUrl);
      return avatarUrl;
    }
    return `${serverUrl}${avatarUrl}`;
  };

  if (!fontLoaded) return null;

  return (
    <>
      <StatusBar style="auto" />
      {isLoggedIn && currentUser ? (
        <RootNavigator
          navigationRef={navigationRef}
          isLoggedIn={isLoggedIn}
          currentUser={currentUser}
          userId={userId}
          token={token}
          socket={socket}
          serverUrl={serverUrl}
          totalUnreadMessagesCount={totalUnreadMessagesCount}
          unreadConversations={unreadConversations}
          hasNewRequests={hasNewRequests}
          setHasNewRequests={setHasNewRequests}
          setAcceptedRequest={setAcceptedRequest}
          setActiveScreen={setActiveScreen}
          getAvatarUri={getAvatarUri}
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
          parkingSpots={parkingSpots}
          setParkingSpots={setParkingSpots}
          handleCenterMap={handleCenterMap}
          mapViewRef={mapViewRef}
          notifications={notifications}
          acceptedSpot={acceptedSpot}
          setAcceptedSpot={setAcceptedSpot}
          hasActiveSpot={hasActiveSpot}
          parkedLocation={parkedLocation}
          handleMarkAsRead={handleMarkAsRead}
          activeChatPartnerRef={activeChatPartnerRef}
          setTotalUnreadMessagesCount={setTotalUnreadMessagesCount}
          spotRequests={spotRequests}
          setSpotRequests={setSpotRequests}
          acceptedRequest={acceptedRequest}
          handleAcceptRequest={handleAcceptRequest}
          handleDeclineRequest={handleDeclineRequest}
          handleOpenChat={handleOpenChat}
          isEditingProfile={isEditingProfile}
          setIsEditingProfile={setIsEditingProfile}
          handleProfileUpdate={handleProfileUpdate}
          handleLogout={handleLogout}
          isRefreshing={isRefreshing}
          handleRefresh={handleRefresh}
          handleRequestSpot={handleRequestSpot}
          handleDeleteSpot={handleDeleteSpot}
          handleEditSpot={handleEditSpot}
          handleSaveEditedSpot={handleSaveEditedSpot}
          handleRate={handleRate}
          handleCreateSpot={handleCreateSpot}
          arrivalConfirmed={arrivalConfirmed}
          setArrivalConfirmed={setArrivalConfirmed}
          currentUsername={currentUsername}
          playSoundArrived={playSoundArrived}
          addNotification={addNotification}
          getDistance={getDistance}
        />
      ) : showRegister ? (
        <Register onBack={() => setShowRegister(false)} onLogin={handleLogin} />
      ) : (
        <Login onLogin={handleLogin} onRegister={() => setShowRegister(true)} />
      )}

      {navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === 'Home' && (
        <>
          <HMMOverlay />
          <DebugSimulator userLocation={userLocation} />
        </>
      )}

      <LeavingModal
        visible={isLeavingModalVisible}
        onClose={() => setLeavingModalVisible(false)}
        onCreateSpot={handleCreateSpot}
      />
      <Modal
        visible={showAboutScreen}
        animationType="slide"
        onRequestClose={() => setShowAboutScreen(false)}
      >
        <AboutScreen onClose={() => setShowAboutScreen(false)} />
      </Modal>
    </>
  );
}
