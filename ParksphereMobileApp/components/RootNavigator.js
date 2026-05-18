import React, { useMemo, useState } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet, Modal } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import HomeScreen from './HomeScreen';
import ChatTab from './ChatTab';
import SearchScreen from './SearchScreen';
import RequestsScreen from './RequestsScreen';
import UserDetails from './UserDetails';
import Profile from './Profile';
import AboutScreen from './AboutScreen';

import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { useNotifications } from '../context/NotificationContext';
import { useSpots } from '../context/SpotContext';

const Tab = createBottomTabNavigator();

export default function RootNavigator({
  navigationRef,
  socket,
  setActiveScreen,
  userLocation,
  locationPermissionGranted,
  getDistance,
}) {
  const { currentUser } = useAuth();
  const { totalUnreadMessagesCount } = useChat();
  const { hasNewRequests } = useSpots();
  const [showAboutScreen, setShowAboutScreen] = useState(false);

  const WrappedHomeScreen = useMemo(() => (props) => {
    return (
      <HomeScreen 
        {...props} 
        userLocation={userLocation} 
        locationPermissionGranted={locationPermissionGranted}
        socket={socket}
        getDistance={getDistance}
      />
    );
  }, [userLocation, locationPermissionGranted, socket, getDistance]);

  const WrappedChatTab = useMemo(() => (props) => {
    return (
      <ChatTab 
        {...props} 
        socket={socket} 
      />
    );
  }, [socket]);

  const WrappedSearchScreen = useMemo(() => (props) => {
    return <SearchScreen {...props} />;
  }, []);

  const WrappedRequestsScreen = useMemo(() => (props) => {
    return (
      <RequestsScreen 
        {...props}
      />
    );
  }, []);

  const ProfileScreen = useMemo(() => (props) => {
    return (
      <UserDetails
        onBack={() => {}} 
        onEditProfile={() => {}}
      />
    );
  }, []);

  return (
    <NavigationContainer ref={navigationRef}>
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => setShowAboutScreen(true)} style={styles.headerLeft}>
            <Image source={require('../assets/images/logo.png')} style={styles.logo} />
          </TouchableOpacity>
          <Modal
            visible={showAboutScreen}
            animationType="slide"
            onRequestClose={() => setShowAboutScreen(false)}
          >
            <AboutScreen onClose={() => setShowAboutScreen(false)} />
          </Modal>
          <View style={styles.titleContainer}>
            <Text style={styles.appName}>Parksphere</Text>
          </View>
        </View>
        
        <Tab.Navigator
          screenListeners={{
            state: (e) => {
              const currentScreen = e.data.state.routes[e.data.state.index].name;
              setActiveScreen(currentScreen);
            },
          }}
          screenOptions={({ route }) => ({
            tabBarIcon: ({ focused, color, size }) => {
              let iconName;
              let showRequestBadge = false;
              let showChatBadge = false;

              if (route.name === 'Home') {
                iconName = 'home';
              } else if (route.name === 'Chat') {
                iconName = 'comments';
                showChatBadge = totalUnreadMessagesCount > 0;
              } else if (route.name === 'Requests') {
                iconName = 'list-alt';
                if (hasNewRequests) {
                    showRequestBadge = true;
                }
              } else if (route.name === 'Search') {
                iconName = 'search';
              } else if (route.name === 'Profile') {
                return <Image source={{ uri: currentUser?.avatar_url }} style={styles.tabBarIcon} />;
              }

              return (
                <View>
                  <FontAwesome name={iconName} size={size} color={color} />
                  {(showRequestBadge || showChatBadge) && (
                    <View
                      style={{
                        position: 'absolute',
                        right: -6,
                        top: -3,
                        backgroundColor: 'red',
                        borderRadius: 6,
                        width: 12,
                        height: 12,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    />
                  )}
                </View>
              );
            },
            tabBarActiveTintColor: 'tomato',
            tabBarInactiveTintColor: 'gray',
            headerShown: false,
            tabBarStyle: { height: 60 },
          })}
        >
          <Tab.Screen name="Home" component={WrappedHomeScreen} />
          <Tab.Screen name="Chat" component={WrappedChatTab} />
          <Tab.Screen name="Requests" component={WrappedRequestsScreen} />
          <Tab.Screen name="Search" component={WrappedSearchScreen} />
          <Tab.Screen name="Profile" component={ProfileScreen} />
        </Tab.Navigator>
      </View>
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  fullContainer: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 10,
    paddingHorizontal: 20,
    backgroundColor: '#512da8',
    paddingTop: 50,
    height: 100,
  },
  headerLeft: {
    zIndex: 1,
  },
  titleContainer: {
    ...StyleSheet.absoluteFillObject,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50,
    pointerEvents: 'none',
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 28,
  },
  appName: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 21.12,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 0,
  },
  tabBarIcon: {
    width: 24,
    height: 24,
    borderRadius: 13,
  },
});
