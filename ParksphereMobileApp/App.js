import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button, Alert, TextInput, Image, ImageBackground, TouchableOpacity, TouchableWithoutFeedback, Keyboard, ScrollView, Modal } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import MapView, { Marker, Circle } from 'react-native-maps'; // Import MapView and Marker
import * as Location from 'expo-location'; // Import Location
import * as Font from 'expo-font';
import { Audio } from 'expo-av';
import io from "socket.io-client"; // Import socket.io-client
import LeavingModal from './components/LeavingModal';
import SpotDetails from './components/SpotDetails';
import Notifications from './components/Notifications';
import Map from './components/Map';
import Login from './components/Login';
import Register from './components/Register';
import Profile from './components/Profile';
import ChatTab from './components/ChatTab';
import UserDetails from './components/UserDetails';
import TimeOptionsModal from './components/TimeOptionsModal'; // Import the new modal
import FontAwesome from '@expo/vector-icons/FontAwesome';
import SearchScreen from './components/SearchScreen';
import AboutScreen from './components/AboutScreen';
import RequestsScreen from './components/RequestsScreen';

import EditSpotMobileModal from './components/EditSpotMobileModal'; // Import the new modal

import { enableScreens } from 'react-native-screens';
enableScreens(false);

const Tab = createBottomTabNavigator();

// Helper function to generate fuzzy circle coordinates
const generateFuzzyCircle = (centerLat, centerLon, radius) => {
  const EARTH_RADIUS = 6371000; // meters
  const points = 50; // Number of points to draw the circle
  const coordinates = [];

  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * (2 * Math.PI);
    const lat = centerLat + (radius / EARTH_RADIUS) * (180 / Math.PI) * Math.cos(angle);
    const lon = centerLon + (radius / EARTH_RADIUS) * (180 / Math.PI) / Math.cos(centerLat * Math.PI / 180) * Math.sin(angle);
    coordinates.push({ latitude: lat, longitude: lon });
  }
  return coordinates;
};

function HomeScreen({ navigation, userLocation, locationPermissionGranted, parkingSpots, userId, handleSpotPress, handleCenterMap, mapViewRef, setSpotDetailsVisible, notifications, isAddingSpot, setIsAddingSpot, setNewSpotCoordinates, setShowTimeOptionsModal }) {
  return (
    <View style={{flex: 1}}>
      <View style={{...styles.mapBorderWrapper, flex: 1}}>
        <Map
          key={parkingSpots.length}
          userLocation={userLocation}
          locationPermissionGranted={locationPermissionGranted}
          parkingSpots={parkingSpots}
          userId={userId}
          handleSpotPress={handleSpotPress}
          handleCenterMap={handleCenterMap}
          mapViewRef={mapViewRef}
          setSpotDetailsVisible={setSpotDetailsVisible}
          isAddingSpot={isAddingSpot}
          setIsAddingSpot={setIsAddingSpot}
          setNewSpotCoordinates={setNewSpotCoordinates}
          setShowTimeOptionsModal={setShowTimeOptionsModal}
        />
      </View>
      <Notifications notifications={notifications} />
    </View>
  );
}

export default function App() {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [isLeavingModalVisible, setLeavingModalVisible] = useState(false);
  const socket = useRef(null);
  const mapViewRef = useRef(null);
  const [sound, setSound] = useState();

  async function playSound() {
    console.log('Loading Sound');
    const { sound } = await Audio.Sound.createAsync( require('./assets/sounds/new-request.wav')
    );
    setSound(sound);

    console.log('Playing Sound');
    await sound.playAsync();
  }

  useEffect(() => {
    return sound
      ? () => {
          console.log('Unloading Sound');
          sound.unloadAsync();
        }
      : undefined;
  }, [sound]);


  useEffect(() => {
    async function loadFont() {
      await Font.loadAsync({
        'AdventPro-SemiBold': require('./assets/fonts/AdventPro-SemiBold.ttf'),
      });
      setFontLoaded(true);
    }
    loadFont();
  }, []);

  const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`; // Your laptop's local IP here

  const [currentUsername, setCurrentUsername] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [message, setMessage] = useState('Please log in.');
  const [notifications, setNotifications] = useState([]); // New state for notifications
  const addNotification = (msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setNotifications((prevNotifications) => [...prevNotifications, { msg, timestamp }]);
  };
  const [showRegister, setShowRegister] = useState(false); // New state for register screen
  const [showAboutScreen, setShowAboutScreen] = useState(false); // New state for about screen
  const [currentUser, setCurrentUser] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [activeScreen, setActiveScreen] = useState('Home');
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [isAddingSpot, setIsAddingSpot] = useState(false); // New state for adding a spot
  const [newSpotCoordinates, setNewSpotCoordinates] = useState(null); // New state for new spot coordinates
  const [showTimeOptionsModal, setShowTimeOptionsModal] = useState(false); // New state for time options modal
  const [showEditSpotMobileModal, setShowEditSpotMobileModal] = useState(false); // State for EditSpotMobileModal
  const [spotToEdit, setSpotToEdit] = useState(null); // State to hold spot data for editing
  const [spotRequests, setSpotRequests] = useState([]);
  const [hasNewRequests, setHasNewRequests] = useState(false);

  const handleFabPress = () => {
    if (isAddingSpot) {
      // If currently adding a spot, cancel it
      setIsAddingSpot(false);
      setNewSpotCoordinates(null);
    } else {
      // Otherwise, start adding a spot
      setIsAddingSpot(true);
      setLeavingModalVisible(false); // Close leaving modal if open
    }
  };

  const fetchUserData = async () => {
    if (isLoggedIn && userId && token) {
      try {
        const response = await fetch(`${serverUrl}/api/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data);
        } else {
          console.error('Failed to fetch user data');
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      } finally {
        setIsRefreshing(false);
      }
    }
  };

  useEffect(() => {
    fetchUserData();
  }, [isLoggedIn, userId, token]);

  const handleRefresh = () => {
    setIsRefreshing(true);
    fetchUserData();
  };

  const handleProfileUpdate = () => {
    fetchUserData();
    setIsEditingProfile(false); // Go back to details view after update
  };

  // Map related states
  const [userLocation, setUserLocation] = useState(null);
  const [locationPermissionGranted, setLocationPermissionGranted] = useState(false);
  const [parkingSpots, setParkingSpots] = useState([]); // New state for parking spots
  const [selectedSpot, setSelectedSpot] = useState(null);
  const [isSpotDetailsVisible, setSpotDetailsVisible] = useState(false);
  const [acceptedSpot, setAcceptedSpot] = useState(null); // New state for accepted spot
  const [arrivalConfirmed, setArrivalConfirmed] = useState(false); // To prevent multiple alerts

  // Helper function to calculate distance between two coordinates (Haversine formula)
  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371e3; // metres
    const φ1 = lat1 * Math.PI / 180; // φ, λ in radians
    const φ2 = lat2 * Math.PI / 180;
    const Δφ = (lat2 - lat1) * Math.PI / 180;
    const Δλ = (lon2 - lon1) * Math.PI / 180;

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    const d = R * c; // in metres
    return d;
  };

  // Check for existing token on app start
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
          setMessage('Logged in! Fetch your profile data.');
        }
      } catch (error) {
        console.error('Failed to load token from AsyncStorage', error);
      }
    };
    loadToken();
  }, []);

  // Fetch parking spots when logged in or location changes
  useEffect(() => {
    const fetchParkingSpots = async () => {
      if (!isLoggedIn || !token) {
        return;
      }
      try {
        const response = await fetch(`${serverUrl}/api/parkingspots`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });
        if (response.ok) {
          const data = await response.json();
          const transformedData = data.map(spot => ({ ...spot, ownerId: spot.user_id }));
          setParkingSpots(transformedData);
        } else if (response.status === 401 || response.status === 403) {
          console.error('Authentication failed. Logging out...', response.status);
          handleLogout(); // Log out user if token is invalid or expired
        } else {
          console.error('Failed to fetch parking spots:', response.status, response.statusText);
        }
      } catch (error) {
        console.error('Error fetching parking spots:', error);
      }
    };

    fetchParkingSpots();
  }, [isLoggedIn, token, userLocation]); // Depend on isLoggedIn, token, and userLocation

  // Socket.IO setup for real-time updates
  useEffect(() => {
    socket.current = io(serverUrl, { transports: ['websocket'] }); // Connect to your server

    socket.current.on('connect', () => {
      console.log('Connected to Socket.IO server!');
      if (userId && currentUsername) {
        console.log(`Emitting register event for userId: ${userId}, username: ${currentUsername}`);
        socket.current.emit('register', { userId, username: currentUsername });
      }
    });

    socket.current.on('newParkingSpot', (newSpot) => {
      console.log('newSpot received:', newSpot);
      const spotWithOwnerId = { ...newSpot, ownerId: newSpot.user_id }; // Map user_id to ownerId
      console.log('spotWithOwnerId:', spotWithOwnerId);
      setParkingSpots((prevSpots) => {
        const updatedSpots = [...prevSpots, spotWithOwnerId];
        return updatedSpots;
      });
    });

    socket.current.on('spotDeleted', ({ spotId }) => {
      setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== parseInt(spotId, 10)));
      setSpotRequests((prevRequests) => prevRequests.filter((request) => request.spotId !== parseInt(spotId, 10)));
    });

    socket.current.on('spotUpdated', (updatedSpot) => {
      console.log('Spot updated received:', updatedSpot);
      setParkingSpots((prevSpots) =>
        prevSpots.map((spot) => (spot.id === updatedSpot.id ? updatedSpot : spot))
      );
    });

    socket.current.on('spotRequest', (data) => {
      console.log('Spot request received:', data);
      setSpotRequests(prevRequests => [...prevRequests, data]);
      setHasNewRequests(true);
      addNotification(data.message);
      playSound();
    });

    socket.current.on('requestResponse', (data) => {
      console.log('Request response received:', data);
      Alert.alert('Spot Request Update', data.message);
      if (data.spot) {
        setAcceptedSpot(data.spot);
        setArrivalConfirmed(false); // Reset for new accepted spot
      } else {
        setAcceptedSpot(null); // Clear accepted spot if request was declined or cancelled
      }
    });

    socket.current.on('disconnect', () => {
      console.log('Disconnected from Socket.IO server.');
    });

    return () => {
      socket.current.disconnect(); // Clean up on component unmount
    };
  }, [serverUrl, userId, currentUsername]); // Reconnect if serverUrl changes

  // Request location permissions and get initial location
  useEffect(() => {
    (async () => {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission Denied', 'Permission to access location was denied. Map will show a default location.');
        setLocationPermissionGranted(false);
        setUserLocation({ // Default to London
          latitude: 51.505,
          longitude: -0.09,
          latitudeDelta: 0.0922,
          longitudeDelta: 0.0421,
        });
        return;
      }

      setLocationPermissionGranted(true);
      let location = await Location.getCurrentPositionAsync({});
      setUserLocation({
        latitude: location.coords.latitude,
        longitude: location.coords.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      });
    })();
  }, []);

  // Function to handle arrival confirmation
  const handleConfirmArrival = () => {
    if (socket.current && acceptedSpot && userId) {
      socket.current.emit('confirmArrival', {
        spotId: acceptedSpot.id,
        requesterId: userId,
      });
      Alert.alert('Arrival Confirmed', 'Spot owner has been notified of your arrival.');
      setAcceptedSpot(null); // Clear accepted spot after confirmation
      setArrivalConfirmed(true); // Prevent re-triggering
    }
  };

  // Effect for continuous location tracking and arrival confirmation
  useEffect(() => {
    let locationSubscription;

    const setupLocationTracking = async () => {
      if (locationPermissionGranted && acceptedSpot && !arrivalConfirmed) {
        locationSubscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 5, // Update every 5 meters
          },
          (newLocation) => {
            const { latitude, longitude } = newLocation.coords;
            setUserLocation({ ...newLocation.coords, latitudeDelta: 0.0922, longitudeDelta: 0.0421 });

            const spotLat = parseFloat(acceptedSpot.latitude);
            const spotLon = parseFloat(acceptedSpot.longitude);
            const distance = getDistance(latitude, longitude, spotLat, spotLon);

            console.log(`Distance to spot ${acceptedSpot.id}: ${distance.toFixed(2)} meters`);

            if (distance <= 10 && !arrivalConfirmed) { // Within 10 meters
              setArrivalConfirmed(true); // Set to true to prevent multiple alerts
              Alert.alert(
                'Confirm Arrival',
                'You are close to your spot. Confirm your arrival to notify the owner?',
                [
                  { text: 'Cancel', style: 'cancel', onPress: () => setAcceptedSpot(null) }, // Option to cancel and clear spot
                  { text: 'Confirm', onPress: handleConfirmArrival },
                ],
                { cancelable: false }
              );
            }
          }
        );
      }
    };

    setupLocationTracking();

    return () => {
      if (locationSubscription) {
        locationSubscription.remove();
      }
    };
  }, [locationPermissionGranted, acceptedSpot, arrivalConfirmed, userId]); // Dependencies

  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date().getTime();
      parkingSpots.forEach(spot => {
        const expirationTime = new Date(spot.declared_at).getTime() + spot.time_to_leave * 60 * 1000;
        if (now > expirationTime) {
          // Spot has expired
          setParkingSpots(prevSpots => prevSpots.filter(s => s.id !== spot.id));
          setSpotRequests(prevRequests => prevRequests.filter(req => req.spotId !== spot.id));
        }
      });
    }, 1000); // Run every second

    return () => clearInterval(interval);
  }, [parkingSpots]);

  const handleLogin = (data) => {
    setToken(data.token);
    setUserId(data.userId);
setCurrentUsername(data.username);
    setIsLoggedIn(true);
    addNotification(`Welcome ${data.username}!`);
  };

  const handleLogout = async () => {
    try {
      if (socket.current && userId) {
        socket.current.emit('unregister', userId);
      }
      await AsyncStorage.removeItem('userToken');
      await AsyncStorage.removeItem('userId');
      await AsyncStorage.removeItem('username');
      setToken(null);
      setUserId(null);
      setCurrentUsername(null);
      setIsLoggedIn(false);
      setMessage('Logged out. Please log in.');
      setNotifications([]); // Clear notifications on logout
      // Alert.alert('Logged Out', 'You have been logged out.'); // Removed logout notification
    } catch (error) {
      console.error('Error during logout:', error);
    }
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

      if (response.ok) {
        Alert.alert('Success', 'Spot requested successfully!');
      } else {
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

    try {
      const response = await fetch(`${serverUrl}/api/parkingspots/${spotId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        addNotification(`Spot ${spotId} deleted successfully!`);
        setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== spotId));
        setSpotDetailsVisible(false); // Close the modal after deletion
      } else if (response.status === 401 || response.status === 403) {
        console.error('Authentication failed for deleting spot. Logging out...');
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

  const handleEditSpot = (spot) => { // Pass the full spot object
    setSpotToEdit(spot);
    setShowEditSpotMobileModal(true);
    setSpotDetailsVisible(false); // Close the SpotDetails modal
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
        // Update the parkingSpots state to reflect the changes
        setParkingSpots((prevSpots) =>
          prevSpots.map((spot) => (spot.id === spotId ? { ...spot, ...updatedDetails } : spot))
        );
      } else if (response.status === 401 || response.status === 403) {
        console.error('Authentication failed for editing spot. Logging out...');
        handleLogout();
      } else {
        Alert.alert('Error', `Failed to update spot: ${data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error updating spot:', error);
      Alert.alert('Error', 'Could not connect to the server to update spot.');
    } finally {
      setShowEditSpotMobileModal(false); // Close the edit modal
      setSpotToEdit(null); // Clear the spot to edit
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
      setSpotRequests(prevRequests => prevRequests.filter(req => req.requestId !== request.requestId));
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

  const handleCenterMap = () => {
    if (mapViewRef.current && userLocation) {
      mapViewRef.current.animateToRegion({
        latitude: userLocation.latitude,
        longitude: userLocation.longitude,
        latitudeDelta: 0.0922,
        longitudeDelta: 0.0421,
      });
    }
  };

  const handleCreateSpot = async (duration) => {
    if (!token || !userId || !newSpotCoordinates) { // Use newSpotCoordinates
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
          latitude: newSpotCoordinates.latitude, // Use newSpotCoordinates
          longitude: newSpotCoordinates.longitude, // Use newSpotCoordinates
          timeToLeave: duration, // Duration in minutes
          costType: 'free',
          price: 0,
          declaredCarType: 'sedan', // Placeholder, ideally from user's profile
          comments: '',
        }),
      });

      const data = await response.json();

      if (response.ok) {
        addNotification(`Parking spot ${data.spotId} declared successfully by user ${currentUsername}`);
        setShowTimeOptionsModal(false); // Close the modal on success
        setNewSpotCoordinates(null); // Clear coordinates
      } else if (response.status === 401 || response.status === 403) {
        console.error('Authentication failed for creating spot. Logging out...');
        handleLogout();
      } else {
        Alert.alert('Error', `Failed to create spot: ${data.message || 'Unknown error'}`);
      }
    } catch (error) {
      console.error('Error creating spot:', error);
      Alert.alert('Error', 'Could not connect to the server to create spot.');
    }
  };

  if (!fontLoaded) {
    return null;
  }

  function WrappedHomeScreen(props) {
    return <HomeScreen {...props} userLocation={userLocation} locationPermissionGranted={locationPermissionGranted} parkingSpots={parkingSpots} userId={userId} handleSpotPress={handleSpotPress} handleCenterMap={handleCenterMap} mapViewRef={mapViewRef} setSpotDetailsVisible={setSpotDetailsVisible} notifications={notifications} isAddingSpot={isAddingSpot} setIsAddingSpot={setIsAddingSpot} setNewSpotCoordinates={setNewSpotCoordinates} setShowTimeOptionsModal={setShowTimeOptionsModal} />;
  }

  function WrappedChatTab(props) {
    return <ChatTab {...props} userId={userId} token={token} socket={socket} />;
  }


  function WrappedRequestsScreen(props) {
    return <RequestsScreen {...props} spotRequests={spotRequests} handleAcceptRequest={handleAcceptRequest} handleDeclineRequest={handleDeclineRequest} />;
  }

  function ProfileScreen() {
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
        onBack={() => {}} // Or handle back navigation if needed
        onEditProfile={() => setIsEditingProfile(true)}
        onLogout={handleLogout}
        refreshing={isRefreshing}
        onRefresh={handleRefresh}
      />
    );
  }

  return (
    <>
      <StatusBar style="auto" />
      <NavigationContainer>
        {isLoggedIn && currentUser ? (
          <View style={styles.fullContainer}>
            <View style={styles.header}>
              <TouchableOpacity onPress={() => setShowAboutScreen(true)}>
                <Image source={require('./assets/images/logo.png')} style={styles.logo} />
              </TouchableOpacity>
              <View style={{ flex: 1, alignItems: 'center' }}>
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
                  let showBadge = false;

                  if (route.name === 'Home') {
                    iconName = 'home';
                  } else if (route.name === 'Chat') {
                    iconName = 'comments';
                  } else if (route.name === 'Requests') {
                    iconName = 'list-alt';
                    if (hasNewRequests) {
                      showBadge = true;
                    }
                  } else if (route.name === 'Search') {
                    iconName = 'search';
                  } else if (route.name === 'Profile') {
                    return <Image source={{ uri: currentUser.avatar_url }} style={styles.tabBarIcon} />;
                  }

                  return (
                    <View>
                      <FontAwesome name={iconName} size={size} color={color} />
                      {showBadge && (
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
                        >
                        </View>
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
                  },
                }}
              />
              <Tab.Screen name="Search" component={SearchScreen} />
              <Tab.Screen name="Profile" component={ProfileScreen} />
            </Tab.Navigator>
            {activeScreen === 'Home' && (
              <>
                <TouchableOpacity 
                  style={styles.fab} 
                  onPress={handleFabPress}
                >
                  <Text style={isAddingSpot ? styles.fabTextSmall : styles.fabText}>{isAddingSpot ? 'X' : '+'}</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        ) : showRegister ? (
          <Register onBack={() => setShowRegister(false)} />
        ) : (
          <Login onLogin={handleLogin} onRegister={() => setShowRegister(true)} />
        )}
      </NavigationContainer>

      <LeavingModal
        visible={isLeavingModalVisible}
        onClose={() => setLeavingModalVisible(false)}
        onCreateSpot={handleCreateSpot}
      />
      <SpotDetails
        visible={isSpotDetailsVisible}
        spot={selectedSpot}
        onClose={() => setSpotDetailsVisible(false)}
        onRequestSpot={handleRequestSpot}
        currentUserId={userId} // Pass the current user's ID
        onDeleteSpot={handleDeleteSpot} // Pass the delete handler
        onEditSpot={handleEditSpot} // Pass the edit handler
        userLocation={userLocation} // Pass userLocation here
      />
      <Modal
        visible={showAboutScreen}
        animationType="slide"
        onRequestClose={() => setShowAboutScreen(false)}
      >
        <AboutScreen onClose={() => setShowAboutScreen(false)} />
      </Modal>
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
    </>
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
    justifyContent: 'space-between',
    padding: 10,
    paddingHorizontal: 20,
    backgroundColor: '#512da8',
    paddingTop: 50,
  },
  logo: {
    width: 44,
    height: 44,
    borderRadius: 28,
    marginRight: 10,
  },
  appName: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 21.12,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 0,
  },
  mapBorderWrapper: {
    flex: 1,
    borderWidth: 2,
    borderColor: 'blue',
    borderRadius: 10,
    margin: 5,
  },

  tagline: {
    fontSize: 12,
    color: 'white',
    marginTop: 5,
  },
  highlight: {
    color: '#00FFFF',
  },
  // Login Screen Styles
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
    // justifyContent: 'center', // Remove this
    // alignItems: 'center', // Remove this
  },
  imageStyle: {
    opacity: 0.6,
  },
  loginOverlay: {
    flex: 1,
    width: '100%',
    justifyContent: 'center', // Align content to the center vertically
    alignItems: 'center',
    backgroundColor: 'rgba(0,0,0,0.3)',
    // paddingBottom: 50, // Removed padding from the bottom
  },
  loginContainer: {
    width: '85%',
    maxWidth: 380,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    padding: 30,
    borderRadius: 17,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 10,
    elevation: 8,
    alignItems: 'center',
    // No marginTop needed here as it's aligned to flex-end
  },
  loginTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 30,
  },
  loggedInContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  messageText: {
    fontSize: 18,
    marginBottom: 20,
    textAlign: 'center',
    color: '#333',
  },
  input: {
    width: '100%',
    height: 50, // Taller input fields
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 9,
    paddingHorizontal: 15,
    marginBottom: 15,
    backgroundColor: '#fefefe',
    fontSize: 16,
    color: '#333',
  },
  loginButton: {
    width: '100%',
    backgroundColor: '#007bff', // Blue button
    paddingVertical: 15,
    borderRadius: 9,
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#007bff',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    elevation: 5,
  },
  loginButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  registerPrompt: {
    marginTop: 20,
    width: '100%',
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
  },
  registerText: {
    fontSize: 14,
    color: '#555',
  },
  registerLink: {
    fontSize: 14,
    color: '#007bff',
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  registerLink: {
    fontSize: 14,
    color: '#007bff',
    fontWeight: 'bold',
    textDecorationLine: 'underline',
  },
  registerScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
    padding: 20,
  },
  mapScreenContainer: {
    flex: 1, // Ensure it takes available space
    width: '100%',
    // alignItems: 'center', // Removed
    // justifyContent: 'center', // Removed
  },
  map: {
    flex: 1, // Map takes all available space within its container
    width: '100%', // Ensure it takes full width
  },
  mapControls: {
    position: 'absolute',
    top: 10,
    right: 10,
    flexDirection: 'column',
  },
  centerButton: {
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    borderRadius: 22,
    padding: 10,
    elevation: 2,
  },
  centerButtonText: {
    fontSize: 20,
    color: '#333',
  },
  tabBarIcon: {
    width: 24,
    height: 24,
    borderRadius: 13,
  },
  fab: {
    position: 'absolute',
    width: 79,
    height: 79,
    borderRadius: 44,
    backgroundColor: '#9b59b6',
    justifyContent: 'center',
    alignItems: 'center',
    bottom: 170,
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
    fontSize: 48,
    fontWeight: '300',
    lineHeight: 48,
  },
  fabTextSmall: {
    color: 'red',
    fontSize: 30,
    fontWeight: '300',
    lineHeight: 30,
    top: 3, // Lower the X symbol by 3 pixels
  },
  logoutText: {
    color: 'red',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'transparent', // Transparent so content below is visible
    zIndex: 0, // Ensure it's below the menu but above other content
  },
  notificationsOverlay: {
    position: 'absolute',
    top: 100, // Adjust as needed to be below the header
    left: 0,
    right: 0,
    zIndex: 1, // Ensure it's above the map
  },
});