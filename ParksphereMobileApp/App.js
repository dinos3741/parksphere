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
import { useParkDetectionEngine } from './hooks/useParkDetectionEngine';

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
    logout,
    serverUrl
  } = useAuth();

  const [fontLoaded, setFontLoaded] = useState(false);
  const navigationRef = useNavigationContainerRef(); 
  const [parkedLocation, setParkedLocation] = useState(null); 
  const [showRegister, setShowRegister] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');

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

  const { addNotification, triggerNotification, notifications } = useNotifications();

  const { userLocation, locationPermissionGranted, getDistance } = useLocationTracking(
    null, // Will be updated if needed
    false, // Default
    () => {
      DeviceEventEmitter.emit('proximityArrival');
    }
  );

  const socket = useSocketConnection(serverUrl, userId, currentUsername, isLoggedIn, token);

  useParkDetectionEngine(currentUser, isLoggedIn, addNotification, setParkedLocation);

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
      }
    }
  }, [isLoggedIn, userId, token, serverUrl, logout, setCurrentUser]);

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
      triggerNotification={triggerNotification}
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
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
          getDistance={getDistance}
          fetchUserData={fetchUserData}
          showRegister={showRegister}
          setShowRegister={setShowRegister}
          parkedLocation={parkedLocation}
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
  getDistance,
  fetchUserData,
  showRegister,
  setShowRegister,
  parkedLocation,
}) {
  const { fetchParkingSpots } = useSpots();

  useEffect(() => {
    if (isLoggedIn && currentUser) {
      fetchUserData();
      fetchParkingSpots();
    }
  }, [isLoggedIn, currentUser?.id, fetchUserData, fetchParkingSpots]);

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
          parkedLocation={parkedLocation}
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
  return (
    <NotificationProvider>
      <AppContent />
    </NotificationProvider>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
