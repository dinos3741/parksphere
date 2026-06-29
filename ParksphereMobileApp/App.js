import "./polyfills";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Alert, Modal, DeviceEventEmitter, View, ActivityIndicator, Text } from 'react-native';
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
// import * as ExpoNotifications from 'expo-notifications';
import { useLocationTracking } from './hooks/useLocationTracking';
import { useSocketConnection } from './hooks/useSocketConnection';
import { useParkDetectionEngine } from './hooks/useParkDetectionEngine';
import { useCarConnectionProbe } from './hooks/useCarConnectionProbe'; // MILESTONE 1: BT-wake validation

import AboutScreen from './components/AboutScreen';
import RootNavigator from './components/RootNavigator';

import { AuthProvider, useAuth } from './context/AuthContext';
import { SpotProvider, useSpots } from './context/SpotContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { NotificationProvider, useNotifications } from './context/NotificationContext';
import { LocationProvider, useLocation } from './context/LocationContext';
import { OverlayProvider } from './context/OverlayContext';

import { enableScreens } from 'react-native-screens';
enableScreens(false);

function AppContent() {
  console.log('[App.js] AppContent rendering...');
  const { 
    token, 
    userId, 
    currentUsername, 
    currentUser, 
    isLoggedIn, 
    isLoading, 
    login, 
    logout,
    serverUrl
  } = useAuth();

  const [fontLoaded, setFontLoaded] = useState(false);
  const navigationRef = useNavigationContainerRef(); 
  const { setParkedLocation } = useLocation(); 
  const [showRegister, setShowRegister] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');

  useEffect(() => {
    async function prepare() {
      console.log('[App.js] Starting preparation...');
      try {
        await Font.loadAsync({
          'AdventPro-SemiBold': require('./assets/fonts/AdventPro-SemiBold.ttf'),
        });
        console.log('[App.js] Fonts loaded successfully');
      } catch (e) {
        console.warn('[App.js] Font loading error:', e);
      } finally {
        setFontLoaded(true);
        console.log('[App.js] Preparation complete');
      }
    }
    prepare();
  }, []);

  const { addNotification, triggerNotification, notifications } = useNotifications();
  const { setUserLocation, setLocationPermissionGranted } = useLocation();

  const { userLocation, locationPermissionGranted, getDistance } = useLocationTracking(
    null,
    false,
    () => {
      DeviceEventEmitter.emit('proximityArrival');
    }
  );

  useEffect(() => {
    setUserLocation(userLocation);
    setLocationPermissionGranted(locationPermissionGranted);
  }, [userLocation, locationPermissionGranted, setUserLocation, setLocationPermissionGranted]);

  const socket = useSocketConnection(serverUrl, userId, currentUsername, isLoggedIn, token);

  // MILESTONE 1: old continuous-location HMM engine disabled so it can't keep the app alive in the
  // background — otherwise the BT-suspend test gives a false pass. We're replacing this engine.
  // useParkDetectionEngine(currentUser, isLoggedIn, addNotification, setParkedLocation);
  useCarConnectionProbe(); // notify on every BT connect/disconnect to test background wake

  console.log(`[App.js] isLoading: ${isLoading}, fontLoaded: ${fontLoaded}`);

  if (isLoading || !fontLoaded) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
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
      setParkedLocation={setParkedLocation}
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
          showRegister={showRegister}
          setShowRegister={setShowRegister}
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
  showRegister,
  setShowRegister,
}) {
  console.log(`[App.js] AppLayout rendering. isLoggedIn: ${isLoggedIn}`);
  const { fetchParkingSpots } = useSpots();
  const { userId, token, fetchUserData } = useAuth();
  const { userLocation } = useLocation();

  useEffect(() => {
    if (isLoggedIn && userId && token) {
      console.log('[App.js] AppLayout: Fetching user data and spots...');
      fetchUserData();
      fetchParkingSpots();
    }
  }, [isLoggedIn, userId, token, fetchUserData, fetchParkingSpots]);
  return (
    <>
      <StatusBar style="auto" />
      {isLoggedIn && currentUser ? (
        <RootNavigator
          navigationRef={navigationRef}
          socket={socket}
          setActiveScreen={setActiveScreen}
        />
      ) : showRegister ? (
        <Register onBack={() => setShowRegister(false)} />
      ) : (
        <Login onRegister={() => setShowRegister(true)} />
      )}

      {navigationRef.isReady() && (
        <View 
          pointerEvents="box-none"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 999 }}
        >
           <HMMOverlay 
             isVisible={navigationRef.getCurrentRoute()?.name === 'Home'} 
           />
           {navigationRef.getCurrentRoute()?.name === 'Home' && <DebugSimulator userLocation={userLocation} />}
        </View>
      )}
    </>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <LocationProvider>
        <OverlayProvider>
          <AppContentWrapper />
        </OverlayProvider>
      </LocationProvider>
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
