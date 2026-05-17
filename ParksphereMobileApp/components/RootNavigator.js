import React, { useMemo } from 'react';
import { View, Text, Image, TouchableOpacity, StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { NavigationContainer } from '@react-navigation/native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

import HomeScreen from './HomeScreen';
import ChatTab from './ChatTab';
import SearchScreen from './SearchScreen';
import RequestsScreen from './RequestsScreen';
import UserDetails from './UserDetails';
import Profile from './Profile';

const Tab = createBottomTabNavigator();

export default function RootNavigator({
  navigationRef,
  isLoggedIn,
  currentUser,
  userId,
  token,
  socket,
  serverUrl,
  totalUnreadMessagesCount,
  unreadConversations,
  hasNewRequests,
  setHasNewRequests,
  setAcceptedRequest,
  setActiveScreen,
  getAvatarUri,
  // HomeScreen Props
  userLocation,
  locationPermissionGranted,
  parkingSpots,
  handleSpotPress,
  handleCenterMap,
  mapViewRef,
  setSpotDetailsVisible,
  notifications,
  isAddingSpot,
  setIsAddingSpot,
  setNewSpotCoordinates,
  setShowTimeOptionsModal,
  acceptedSpot,
  hasActiveSpot,
  handleFabPress,
  parkedLocation,
  // Chat props
  handleMarkAsRead,
  activeChatPartnerRef,
  setTotalUnreadMessagesCount,
  // Requests props
  spotRequests,
  acceptedRequest,
  handleAcceptRequest,
  handleDeclineRequest,
  handleOpenChat,
  // Profile props
  isEditingProfile,
  setIsEditingProfile,
  handleProfileUpdate,
  handleLogout,
  isRefreshing,
  handleRefresh
}) {

  const WrappedHomeScreen = useMemo(() => (props) => {
    return (
      <HomeScreen 
        {...props} 
        userLocation={userLocation} 
        locationPermissionGranted={locationPermissionGranted} 
        parkingSpots={parkingSpots} 
        userId={userId} 
        handleSpotPress={handleSpotPress} 
        handleCenterMap={handleCenterMap} 
        mapViewRef={mapViewRef} 
        setSpotDetailsVisible={setSpotDetailsVisible} 
        notifications={notifications} 
        isAddingSpot={isAddingSpot} 
        setIsAddingSpot={setIsAddingSpot} 
        setNewSpotCoordinates={setNewSpotCoordinates} 
        setShowTimeOptionsModal={setShowTimeOptionsModal} 
        acceptedSpot={acceptedSpot} 
        hasActiveSpot={hasActiveSpot} 
        handleFabPress={handleFabPress} 
        parkedLocation={parkedLocation} 
      />
    );
  }, [userLocation, locationPermissionGranted, parkingSpots, userId, handleSpotPress, handleCenterMap, mapViewRef, setSpotDetailsVisible, notifications, isAddingSpot, setIsAddingSpot, setNewSpotCoordinates, setShowTimeOptionsModal, acceptedSpot, hasActiveSpot, handleFabPress, parkedLocation]);

  const WrappedChatTab = useMemo(() => (props) => {
    return (
      <ChatTab 
        {...props} 
        userId={userId} 
        token={token} 
        socket={socket} 
        serverUrl={serverUrl} 
        currentUser={currentUser} 
        setTotalUnreadMessagesCount={setTotalUnreadMessagesCount}
        unreadConversations={unreadConversations}
        onMarkAsRead={handleMarkAsRead}
        activeChatPartnerRef={activeChatPartnerRef}
      />
    );
  }, [userId, token, socket, serverUrl, currentUser, setTotalUnreadMessagesCount, unreadConversations, handleMarkAsRead, activeChatPartnerRef]);

  const WrappedSearchScreen = useMemo(() => (props) => {
    return <SearchScreen {...props} token={token} serverUrl={serverUrl} />;
  }, [token, serverUrl]);

  const WrappedRequestsScreen = useMemo(() => (props) => {
    const requests = acceptedRequest ? [acceptedRequest] : spotRequests;
    return (
      <RequestsScreen 
        {...props} 
        spotRequests={requests} 
        handleAcceptRequest={handleAcceptRequest} 
        handleDeclineRequest={handleDeclineRequest} 
        token={token} 
        serverUrl={serverUrl} 
        onOpenChat={handleOpenChat} 
      />
    );
  }, [acceptedRequest, spotRequests, handleAcceptRequest, handleDeclineRequest, token, serverUrl, handleOpenChat]);

  const ProfileScreen = useMemo(() => (props) => {
    if (isEditingProfile) {
      return (
        <Profile
          user={currentUser}
          token={token}
          onBack={() => setIsEditingProfile(false)}
          onProfileUpdate={handleProfileUpdate}
        />
      );
    }

    return (
      <UserDetails
        user={currentUser}
        token={token}
        onBack={() => {}} 
        onEditProfile={() => setIsEditingProfile(true)}
        onLogout={handleLogout}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
        onProfileUpdate={handleProfileUpdate}
        serverUrl={serverUrl}
      />
    );
  }, [isEditingProfile, currentUser, token, handleProfileUpdate, handleLogout, isRefreshing, handleRefresh, serverUrl, setIsEditingProfile]);

  return (
    <NavigationContainer ref={navigationRef}>
      <View style={styles.fullContainer}>
        <View style={styles.header}>
          <TouchableOpacity onPress={() => {}} style={styles.headerLeft}>
            <Image source={require('../assets/images/logo.png')} style={styles.logo} />
          </TouchableOpacity>
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
                return <Image source={{ uri: getAvatarUri(currentUser.avatar_url, currentUser.username) }} style={styles.tabBarIcon} />;
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
          <Tab.Screen
            name="Requests"
            component={WrappedRequestsScreen}
            listeners={{
              tabPress: (e) => {
                setHasNewRequests(false);
                setAcceptedRequest(null);
              },
            }}
          />
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
