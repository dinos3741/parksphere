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
import { ChatProvider, useChat } from './context/ChatContext';
import { NotificationProvider, useNotifications } from './context/NotificationContext';

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

  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [acceptedRequest, setAcceptedRequest] = useState(null);
  const navigationRef = useNavigationContainerRef(); 
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

  const { 
    notifications,
    addNotification, 
    triggerNotification,
    playSound,
    playSoundMessage 
  } = useNotifications();

  return (
    <SpotProvider 
      addNotification={addNotification} 
      socket={socket} 
      userId={userId} 
      currentUsername={currentUsername}
      triggerNotification={triggerNotification}
      setAcceptedSpot={setAcceptedSpot}
      setArrivalConfirmed={setArrivalConfirmed}
    >
      <ChatProvider 
        socket={socket} 
        userId={userId} 
        triggerNotification={triggerNotification}
      >
        <AppLayout 
          isLoggedIn={isLoggedIn}
          currentUser={currentUser}
          navigationRef={navigationRef}
          socket={socket}
          setActiveScreen={setActiveScreen}
          getAvatarUri={getAvatarUri}
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
          parkedLocation={parkedLocation}
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
          getDistance={getDistance}
          userId={userId}
          token={token}
          currentUsername={currentUsername}
          fetchUserData={fetchUserData}
          setIsRefreshing={setIsRefreshing}
          />
          </ChatProvider>
    </SpotProvider>
  );
}

function AppLayout({
  isLoggedIn,
  currentUser,
  navigationRef,
  socket,
  setActiveScreen,
  userLocation,
  locationPermissionGranted,
  parkedLocation,
  acceptedRequest,
  setAcceptedRequest,
  handleOpenChat,
  isEditingProfile,
  setIsEditingProfile,
  handleProfileUpdate,
  isRefreshing,
  getAvatarUri,
  handleRate,
  arrivalConfirmed,
  setArrivalConfirmed,
  getDistance,
  userId,
  token,
  currentUsername,
  fetchUserData,
  setIsRefreshing,
}) {
  const { 
    addNotification, 
    triggerNotification,
    playSound,
    playSoundMessage 
  } = useNotifications();
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

  const {
    totalUnreadMessagesCount,
    unreadConversations,
    handleMarkAsRead,
    handleMarkAsUnread,
    activeChatPartnerRef,
    setTotalUnreadMessagesCount,
  } = useChat();

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

  // Socket listeners are now moved to contexts.
  const hasActiveSpot = parkingSpots.some(spot => spot.ownerId === userId);

  return (
    <>
      <StatusBar style="auto" />
      {isLoggedIn && currentUser ? (
        <RootNavigator
          navigationRef={navigationRef}
          socket={socket}
          setActiveScreen={setActiveScreen}
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
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
  
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  );
}
