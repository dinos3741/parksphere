import "./polyfills";

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Alert, Modal, DeviceEventEmitter, View, ActivityIndicator, Text, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigationContainerRef } from '@react-navigation/native';
import * as Location from 'expo-location'; 
import * as Font from 'expo-font';
import { useAudioPlayer } from 'expo-audio';
import Ionicons from '@expo/vector-icons/Ionicons';
import { apiRequest } from './utils/apiService';
import LeavingModal from './components/LeavingModal';
import HMMOverlay from './components/HMMOverlay';
import DebugSimulator from './components/DebugSimulator';
import StreamMonitor from './components/StreamMonitor';
import Login from './components/Login';
import Register from './components/Register';
import { startParkDetection, stopParkDetection, resetParkDetection, handleLocationUpdate } from './utils/parkDetectionService';
// import * as ExpoNotifications from 'expo-notifications';
import { useLocationTracking } from './hooks/useLocationTracking';
import { useSocketConnection } from './hooks/useSocketConnection';
import { useParkDetectionEngine } from './hooks/useParkDetectionEngine';
import { useCarConnectionProbe } from './hooks/useCarConnectionProbe'; // MILESTONE 1: BT-wake validation (settled: BT disconnect won't wake suspended app)
import { useReturnDetection } from './hooks/useReturnDetection'; // event-based lifecycle: CLVisit park + geofence return/drive-off

import RootNavigator from './components/RootNavigator';

import { AuthProvider, useAuth } from './context/AuthContext';
import { SpotProvider, useSpots } from './context/SpotContext';
import { ChatProvider, useChat } from './context/ChatContext';
import { NotificationProvider, useNotifications } from './context/NotificationContext';
import { LocationProvider, useLocation } from './context/LocationContext';
import { OverlayProvider } from './context/OverlayContext';
import { HeaderActionProvider } from './context/HeaderActionContext';
import { DebugToolsProvider, useDebugTools } from './context/DebugToolsContext';

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
  const { setParkedLocation, parkedLocation } = useLocation();
  const [showRegister, setShowRegister] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');

  useEffect(() => {
    async function prepare() {
      console.log('[App.js] Starting preparation...');
      try {
        await Font.loadAsync({
          'AdventPro-SemiBold': require('./assets/fonts/AdventPro-SemiBold.ttf'),
          'AdventPro-Regular': require('./assets/fonts/AdventPro-Regular.ttf'),
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

  // HMM engine, reactivated (Phase 2): driven by VisitMonitor's location stream instead of the retired
  // continuous-location task. The stream is turned ON/OFF by useReturnDetection's mode controller
  // (foreground only for now), so the engine runs like the old foreground path without keeping the app
  // awake in the background.
  useParkDetectionEngine(currentUser, isLoggedIn, addNotification, setParkedLocation);
  useReturnDetection(); // park (CLVisit) → arm geofence → return (enter) / drive-off (exit) + stream mode control

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
      parkedLocation={parkedLocation}
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
  const { fetchParkingSpots, retryPendingManualDeclare } = useSpots();
  const { userId, token, fetchUserData, profileFetchFailed } = useAuth();
  const { showHmmEngine, showFlightRecorder, showFixesWindow } = useDebugTools();

  useEffect(() => {
    if (isLoggedIn && userId && token) {
      console.log('[App.js] AppLayout: Fetching user data and spots...');
      fetchUserData();
      fetchParkingSpots();
      retryPendingManualDeclare(); // catch up a manual declare that failed for lack of connectivity
    }
  }, [isLoggedIn, userId, token, fetchUserData, fetchParkingSpots, retryPendingManualDeclare]);
  return (
    <>
      <StatusBar style="auto" />
      {isLoggedIn && currentUser ? (
        <RootNavigator
          navigationRef={navigationRef}
          socket={socket}
          setActiveScreen={setActiveScreen}
        />
      ) : isLoggedIn && !currentUser && profileFetchFailed ? (
        // 2026-08-07: an unexplained infinite spinner (the branch below) is its own kind of
        // confusing once the server has been unreachable for a while — this fires once at least one
        // fetchUserData() attempt has actually failed (not just "still in flight"), so there's a
        // clear signal instead of silent waiting. AuthContext.js keeps retrying every 5s and on every
        // foreground regardless — "Try again" just gives an immediate, visible retry on top of that.
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff', padding: 32 }}>
          <View style={{
            width: 100, height: 100, borderRadius: 50,
            backgroundColor: 'rgba(81, 45, 168, 0.08)',
            justifyContent: 'center', alignItems: 'center',
            shadowColor: '#512da8', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.18, shadowRadius: 16,
            elevation: 6,
          }}>
            <View style={{
              width: 74, height: 74, borderRadius: 37,
              backgroundColor: 'rgba(81, 45, 168, 0.12)',
              justifyContent: 'center', alignItems: 'center',
            }}>
              <Ionicons name="cloud-offline-outline" size={40} color="#512da8" />
            </View>
          </View>
          <Text style={{ marginTop: 20, fontSize: 16, fontWeight: '600', color: '#333', textAlign: 'center' }}>
            Can't reach the server
          </Text>
          <Text style={{ marginTop: 6, fontSize: 14, color: '#777', textAlign: 'center' }}>
            You're still logged in — this will resolve automatically once you're back online.
          </Text>
          <TouchableOpacity
            onPress={fetchUserData}
            style={{ marginTop: 20, paddingVertical: 10, paddingHorizontal: 24, borderRadius: 999, backgroundColor: '#512da8' }}
          >
            <Text style={{ color: 'white', fontWeight: '600' }}>Try again</Text>
          </TouchableOpacity>
        </View>
      ) : isLoggedIn ? (
        // 2026-08-07: a valid, unexpired token (isLoggedIn — restored straight from AsyncStorage,
        // no network needed) but currentUser still null just means fetchUserData()'s network call
        // hasn't succeeded yet — e.g. poor connectivity right when the app resumes. Used to fall
        // through to the Login screen here, which looked exactly like being logged out even though
        // nothing was actually invalidated. A spinner instead makes that distinction visible.
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#fff' }}>
          <ActivityIndicator size="large" color="#512da8" />
        </View>
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
             isVisible={navigationRef.getCurrentRoute()?.name === 'Home' && currentUser?.role === 'admin' && showHmmEngine}
           />
           {navigationRef.getCurrentRoute()?.name === 'Home' && currentUser?.role === 'admin' && showFlightRecorder && <DebugSimulator />}
           {__DEV__ && navigationRef.getCurrentRoute()?.name === 'Home' && currentUser?.role === 'admin' && showFixesWindow && <StreamMonitor />}
           {/* 2026-08-08: currentUser is now hydrated from cache on boot (AuthContext.js), so a
               failed/slow fetchUserData() no longer blocks the app — it just means the profile
               being shown might be stale. Docked above the tab bar (bottom:20, height:58,
               RootNavigator.js) rather than the top, which is already occupied by RootNavigator's
               own absolute-positioned header. */}
           {currentUser && profileFetchFailed && (
             <View
               pointerEvents="box-none"
               style={{ position: 'absolute', left: 12, right: 12, bottom: 90, zIndex: 998 }}
             >
               <View style={{
                 flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
                 backgroundColor: 'rgba(81, 45, 168, 0.95)', borderRadius: 16,
                 paddingVertical: 10, paddingHorizontal: 14,
                 shadowColor: '#000', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.2, shadowRadius: 8,
                 elevation: 6,
               }}>
                 <View style={{ flexDirection: 'row', alignItems: 'center', flex: 1, marginRight: 10 }}>
                   <Ionicons name="cloud-offline-outline" size={18} color="white" />
                   <Text style={{ color: 'white', marginLeft: 8, fontSize: 13, flexShrink: 1 }}>
                     Can't reach the server — showing cached data
                   </Text>
                 </View>
                 <TouchableOpacity
                   onPress={fetchUserData}
                   style={{ paddingVertical: 6, paddingHorizontal: 14, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.22)' }}
                 >
                   <Text style={{ color: 'white', fontWeight: '600', fontSize: 13 }}>Retry</Text>
                 </TouchableOpacity>
               </View>
             </View>
           )}
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
          <HeaderActionProvider>
            <DebugToolsProvider>
              <AppContentWrapper />
            </DebugToolsProvider>
          </HeaderActionProvider>
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
