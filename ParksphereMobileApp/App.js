import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Alert, Modal, DeviceEventEmitter, View, ActivityIndicator } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigationContainerRef } from '@react-navigation/native';
import * as Location from 'expo-location'; 
import * as Font from 'expo-font';
import { useAudioPlayer } from 'expo-audio';
import { apiRequest } from './utils/apiService';
import LeavingModal from './components/LeavingModal';
import HMMOverlay from './components/HMMOverlay';
import DebugSimulator from './components/DebugSimulator';
import Login from './components/Login';
import Register from './components/Register';
import { startParkDetection, stopParkDetection, resetParkDetection, handleLocationUpdate } from './utils/parkDetectionService';
import * as ExpoNotifications from 'expo-notifications';
import { useLocationTracking } from './hooks/useLocationTracking';
import { useSocketConnection } from './hooks/useSocketConnection';

import AboutScreen from './components/AboutScreen';
import RootNavigator from './components/RootNavigator';

import { AuthProvider, useAuth } from './context/AuthContext';
import { SpotProvider, useSpots } from './context/SpotContext';

import { enableScreens } from 'react-native-screens';
enableScreens(false);

function AppContent() {
  const { 
    token, 
    userId, 
    currentUsername, 
    currentUser, 
    setCurrentUser,
    isLoggedIn, 
    isLoading, 
    login, 
    logout 
  } = useAuth();

  const [fontLoaded, setFontLoaded] = useState(false);
  const [isLeavingModalVisible, setLeavingModalVisible] = useState(false);
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

  const [notifications, setNotifications] = useState([]); 
  const addNotification = useCallback((msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setNotifications((prevNotifications) => [...prevNotifications, { msg, timestamp }]);
  }, []);
  const [showRegister, setShowRegister] = useState(false); 
  const [showAboutScreen, setShowAboutScreen] = useState(false); 
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [acceptedRequest, setAcceptedRequest] = useState(null);
  const navigationRef = useNavigationContainerRef(); 
  const [totalUnreadMessagesCount, setTotalUnreadMessagesCount] = useState(0); 
  const [unreadConversations, setUnreadConversations] = useState({}); 
  const [parkedLocation, setParkedLocation] = useState(null); 
  const [arrivalConfirmed, setArrivalConfirmed] = useState(false); 

  const { userLocation, setUserLocation, locationPermissionGranted, getDistance } = useLocationTracking(
    null, // Will be updated in AppLayout
    arrivalConfirmed,
    () => {
      setArrivalConfirmed(true);
      DeviceEventEmitter.emit('proximityArrival');
    }
  );

  const socket = useSocketConnection(serverUrl, userId, currentUsername, isLoggedIn, token);

  useEffect(() => {
    if (socket.current) {
      const s = socket.current;
      // Socket listeners are better off in a hook or separate component that has access to SpotContext
      // For now, let's keep them here but they need setParkingSpots etc.
    }
  }, [socket]);

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
        if (currentUser.auto_detect) {
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
          await logout();
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setIsRefreshing(false);
      }
    }
  }, [isLoggedIn, userId, token, serverUrl, logout, setCurrentUser]);

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

  const handleProfileUpdate = (shouldClose = true) => {
    fetchUserData();
    if (shouldClose === true) {
      setIsEditingProfile(false); 
    }
  };

  const handleOpenChat = (user) => {
    navigationRef.current?.navigate('Chat', { recipient: user });
  };

  const handleRate = async (rating, ratedUserId) => {
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
        addNotification('Rating submitted successfully!', 'green');
      }
    } catch (error) {
      console.error('Error submitting rating:', error);
    }
  };

  const getAvatarUri = (avatarUrl, username) => {
    if (!avatarUrl) return `https://i.pravatar.cc/150?u=${username}`;
    if (avatarUrl.startsWith('http')) {
      if (avatarUrl.includes('localhost')) return avatarUrl.replace('http://localhost:3001', serverUrl);
      return avatarUrl;
    }
    return `${serverUrl}${avatarUrl}`;
  };

  if (isLoading || !fontLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <ActivityIndicator size="large" color="#512da8" />
      </View>
    );
  }

  return (
    <SpotProvider 
      addNotification={addNotification} 
      socket={socket} 
      userId={userId} 
      currentUsername={currentUsername}
    >
      <AppLayout 
        isLoggedIn={isLoggedIn}
        currentUser={currentUser}
        showRegister={showRegister}
        setShowRegister={setShowRegister}
        navigationRef={navigationRef}
        socket={socket}
        totalUnreadMessagesCount={totalUnreadMessagesCount}
        unreadConversations={unreadConversations}
        setActiveScreen={setActiveScreen}
        getAvatarUri={getAvatarUri}
        userLocation={userLocation}
        locationPermissionGranted={locationPermissionGranted}
        notifications={notifications}
        parkedLocation={parkedLocation}
        handleMarkAsRead={handleMarkAsRead}
        activeChatPartnerRef={activeChatPartnerRef}
        setTotalUnreadMessagesCount={setTotalUnreadMessagesCount}
        acceptedRequest={acceptedRequest}
        setAcceptedRequest={setAcceptedRequest}
        handleOpenChat={handleOpenChat}
        isEditingProfile={isEditingProfile}
        setIsEditingProfile={setIsEditingProfile}
        handleProfileUpdate={handleProfileUpdate}
        isRefreshing={isRefreshing}
        handleRate={handleRate}
        arrivalConfirmed={arrivalConfirmed}
        setArrivalConfirmed={setArrivalConfirmed}
        playSoundArrived={playSoundArrived}
        addNotification={addNotification}
        getDistance={getDistance}
        isLeavingModalVisible={isLeavingModalVisible}
        setLeavingModalVisible={setLeavingModalVisible}
        showAboutScreen={showAboutScreen}
        setShowAboutScreen={setShowAboutScreen}
        userId={userId}
        token={token}
        currentUsername={currentUsername}
        fetchUserData={fetchUserData}
        setIsRefreshing={setIsRefreshing}
        playSound={playSound}
        playSoundMessage={playSoundMessage}
        handleMarkAsUnread={handleMarkAsUnread}
      />
    </SpotProvider>
  );
}

function AppLayout({
  isLoggedIn,
  currentUser,
  showRegister,
  setShowRegister,
  navigationRef,
  socket,
  totalUnreadMessagesCount,
  unreadConversations,
  setActiveScreen,
  getAvatarUri,
  userLocation,
  locationPermissionGranted,
  notifications,
  parkedLocation,
  handleMarkAsRead,
  activeChatPartnerRef,
  setTotalUnreadMessagesCount,
  acceptedRequest,
  setAcceptedRequest,
  handleOpenChat,
  isEditingProfile,
  setIsEditingProfile,
  handleProfileUpdate,
  isRefreshing,
  handleRate,
  arrivalConfirmed,
  setArrivalConfirmed,
  playSoundArrived,
  addNotification,
  getDistance,
  isLeavingModalVisible,
  setLeavingModalVisible,
  showAboutScreen,
  setShowAboutScreen,
  userId,
  token,
  currentUsername,
  fetchUserData,
  setIsRefreshing,
  playSound,
  playSoundMessage,
  handleMarkAsUnread,
}) {
  const {
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
  } = useSpots();

  useEffect(() => {
    if (isLoggedIn && token && userId) {
      fetchUserData();
      fetchParkingSpots();
    }
  }, [isLoggedIn, token, userId, fetchUserData, fetchParkingSpots]);

  const localHandleRefresh = () => {
    setIsRefreshing(true);
    fetchUserData();
    fetchParkingSpots();
  };

  useEffect(() => {
    if (socket.current) {
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
        addNotification(data.message);
        playSound();
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

      const onPrivateMessage = (message) => {
        if (message.to === userId && message.from !== userId) {
          playSoundMessage();
          if (activeChatPartnerRef.current !== message.from) {
            handleMarkAsUnread(message.from);
          }
        }
      };

      s.on('newParkingSpot', onNewSpot);
      s.on('spotDeleted', onSpotDeleted);
      s.on('spotUpdated', onSpotUpdated);
      s.on('spotStatusUpdated', onSpotStatusUpdated);
      s.on('spotRequest', onSpotRequest);
      s.on('requestAcceptedOrDeclined', onReqAccDec);
      s.on('requestResponse', onRequestResponse);
      s.on('privateMessage', onPrivateMessage);

      return () => {
        s.off('newParkingSpot', onNewSpot);
        s.off('spotDeleted', onSpotDeleted);
        s.off('spotUpdated', onSpotUpdated);
        s.off('spotStatusUpdated', onSpotStatusUpdated);
        s.off('spotRequest', onSpotRequest);
        s.off('requestAcceptedOrDeclined', onReqAccDec);
        s.off('requestResponse', onRequestResponse);
        s.off('privateMessage', onPrivateMessage);
      };
    }
  }, [socket, userId, setParkingSpots, setSpotRequests, setHasNewRequests, setAcceptedSpot, setArrivalConfirmed, addNotification, playSound, playSoundMessage, activeChatPartnerRef, handleMarkAsUnread]);

  const hasActiveSpot = parkingSpots.some(spot => spot.ownerId === userId);

  return (
    <>
      <StatusBar style="auto" />
      {isLoggedIn && currentUser ? (
        <RootNavigator
          navigationRef={navigationRef}
          socket={socket}
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
          isRefreshing={isRefreshing}
          handleRefresh={localHandleRefresh}
          handleRequestSpot={handleRequestSpot}
          handleDeleteSpot={handleDeleteSpot}
          handleSaveEditedSpot={handleSaveEditedSpot}
          handleRate={handleRate}
          handleCreateSpot={handleCreateSpot}
          arrivalConfirmed={arrivalConfirmed}
          setArrivalConfirmed={setArrivalConfirmed}
          playSoundArrived={playSoundArrived}
          addNotification={addNotification}
          getDistance={getDistance}
        />
      ) : showRegister ? (
        <Register onBack={() => setShowRegister(false)} />
      ) : (
        <Login onRegister={() => setShowRegister(true)} />
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

export default function App() {
  return (
    <AuthProvider>
      <AppContentWrapper />
    </AuthProvider>
  );
}

function AppContentWrapper() {
  const { userId, currentUsername, isLoggedIn, token } = useAuth();
  const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;
  
  // We need addNotification and socket here, but they are defined in AppContent.
  // This is a circular dependency. 
  // Refactor: Move addNotification and socket management into their own providers or hooks if possible.
  // For now, let's keep it simple: Move SpotProvider inside AppContent, but it must be above the useSpots call.
  // Actually, standard practice is to have the SpotProvider higher up.
  return (
    <AppContent />
  );
}
