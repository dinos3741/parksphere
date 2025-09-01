import React, { useState, useEffect, useRef } from 'react';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, Text, View, Button, Alert, TextInput, Image, ImageBackground, TouchableOpacity, TouchableWithoutFeedback, Keyboard, ScrollView } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import MapView, { Marker, Circle } from 'react-native-maps'; // Import MapView and Marker
import * as Location from 'expo-location'; // Import Location
import * as Font from 'expo-font';
import { io } from "socket.io-client"; // Import socket.io-client
import LeavingModal from './components/LeavingModal';
import SpotDetailsModal from './components/SpotDetailsModal';

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

export default function App() {
  const [fontLoaded, setFontLoaded] = useState(false);
  const [isLeavingModalVisible, setLeavingModalVisible] = useState(false);
  const [isMenuVisible, setMenuVisible] = useState(false);
  const socket = useRef(null);
  const mapViewRef = useRef(null);

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

  const [username, setUsername] = useState('');
  const [currentUsername, setCurrentUsername] = useState(null);
  const [password, setPassword] = useState('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [message, setMessage] = useState('Please log in.');
  const [notifications, setNotifications] = useState([]); // New state for notifications
  const addNotification = (msg) => {
    setNotifications((prevNotifications) => [...prevNotifications, msg]);
  };
  const [showRegister, setShowRegister] = useState(false); // New state for register screen

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
          setUserId(storedUserId);
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
          const transformedData = data.map(spot => ({ ...spot, ownerId: String(spot.user_id) }));
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
        socket.current.emit('register', { userId, username: currentUsername });
      }
    });

    socket.current.on('newParkingSpot', (newSpot) => {
      console.log('newSpot received:', newSpot);
      const spotWithOwnerId = { ...newSpot, ownerId: String(newSpot.user_id) }; // Map user_id to ownerId
      console.log('spotWithOwnerId:', spotWithOwnerId);
      setParkingSpots((prevSpots) => {
        const updatedSpots = [...prevSpots, spotWithOwnerId];
        return updatedSpots;
      });
    });

    socket.current.on('spotDeleted', (spotId) => {
      setParkingSpots((prevSpots) => prevSpots.filter((spot) => spot.id !== spotId));
    });

    socket.current.on('spotUpdated', (updatedSpot) => {
      console.log('Spot updated received:', updatedSpot);
      setParkingSpots((prevSpots) =>
        prevSpots.map((spot) => (spot.id === updatedSpot.id ? updatedSpot : spot))
      );
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

  const handleLogin = async () => {
    try {
      const response = await fetch(serverUrl + '/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      const data = await response.json();

      if (response.ok) {
        await AsyncStorage.setItem('userToken', data.token);
        await AsyncStorage.setItem('userId', String(data.userId));
        await AsyncStorage.setItem('username', data.username);
        setToken(data.token);
        setUserId(data.userId);
        setCurrentUsername(data.username);
        setIsLoggedIn(true);
        addNotification(`Welcome ${data.username}!`);
        // Alert.alert('Success', 'Logged in!'); // Removed success notification
      } else {
        setMessage(`Login failed: ${data.message || 'Invalid credentials'}`);
        Alert.alert('Login Failed', data.message || 'Invalid credentials');
      }
    } catch (error) {
      console.error('Error during login:', error);
      Alert.alert('Error', 'Could not connect to the server for login.');
      setMessage('Login failed due to network error.');
    }
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

  const handleRequestSpot = async (spotId) => {
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
        body: JSON.stringify({ spotId }),
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

  const handleEditSpot = (spotId) => {
    Alert.alert('Edit Spot', `Editing functionality for spot ${spotId} is not yet implemented.`);
    // In the future, this would open an edit modal or navigate to an edit screen
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

  const fetchProfileData = async () => {
    if (!token || !userId) {
      setMessage('Please log in first to fetch profile data.');
      return;
    }
    try {
      const response = await fetch(`${serverUrl}/api/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (response.ok) {
        setMessage(`Profile Data: ${JSON.stringify(data.username)}`);
        Alert.alert('Profile Data', `Username: ${data.username}\nCredits: ${data.credits}`);
      } else if (response.status === 401 || response.status === 403) {
        console.error('Authentication failed for profile data. Logging out...');
        handleLogout();
      } else {
        setMessage(`Failed to fetch profile: ${data.message || 'Error'}`);
        Alert.alert('Error', data.message || 'Failed to fetch profile data.');
      }
    }
    catch (error) {
      console.error('Error fetching profile data:', error);
      Alert.alert('Error', 'Could not connect to the server for profile data.');
      setMessage('Failed to fetch profile due to network error.');
    }
  };

  const handleCreateSpot = async (duration) => {
    if (!token || !userId || !userLocation) {
      Alert.alert('Error', 'Please log in and ensure location is available to create a spot.');
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
          latitude: userLocation.latitude,
          longitude: userLocation.longitude,
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
        setLeavingModalVisible(false); // Close the modal on success
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

  return (
    <View style={styles.fullContainer}>
      <View style={styles.header}>
        <Image source={require('./assets/images/logo.png')} style={styles.logo} />
        <View style={styles.titleContainer}>
          <Text style={styles.appName}>PARKSPHERE</Text>
          <Text style={styles.tagline}>the app you need to <Text style={styles.highlight}>park in the city!</Text></Text>
        </View>
        <TouchableOpacity style={styles.hamburger} onPress={() => setMenuVisible(!isMenuVisible)}>
          <View style={styles.hamburgerLine} />
          <View style={styles.hamburgerLine} />
          <View style={styles.hamburgerLine} />
        </TouchableOpacity>
      </View>

      {isMenuVisible ? (
        <React.Fragment>
          <View style={styles.menu}>
            <TouchableOpacity onPress={() => { /* Handle Profile */ setMenuVisible(false); }}>
              <Text style={styles.menuItem}>Profile</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={() => { handleLogout(); setMenuVisible(false); }}>
              <Text style={styles.menuItem}>Logout</Text>
            </TouchableOpacity>
          </View>
        </React.Fragment>
      ) : null}

      {isLoggedIn ? (
        <View style={styles.mapScreenContainer}> {/* New container for map screen */}
          {userLocation ? (
            <MapView
              ref={mapViewRef}
              style={styles.map}
              initialRegion={parkingSpots.length > 0 ? {
                latitude: parseFloat(parkingSpots[0].latitude),
                longitude: parseFloat(parkingSpots[0].longitude),
                latitudeDelta: 0.0922,
                longitudeDelta: 0.0421,
              } : userLocation}
              showsUserLocation={locationPermissionGranted} // Show blue dot if permission granted
              onPress={(e) => {
                if (e.nativeEvent.action !== 'marker-press') {
                  setSpotDetailsVisible(false);
                }
              }}
            >
              {/* Add a marker for the user's location */}
              {locationPermissionGranted && userLocation && (
                <Marker
                  coordinate={{ latitude: userLocation.latitude, longitude: userLocation.longitude }}
                  title="Your Location"
                  pinColor="blue"
                />
              )}

              {/* Render parking spots */}
              {parkingSpots.map((spot) => {
                console.log('spot.id:', spot.id, 'spot.ownerId:', spot.ownerId, 'userId:', userId, 'match:', spot.ownerId == userId);
                return (
                <React.Fragment key={spot.id}>
                  {spot.ownerId == userId ? ( // If the current user is the owner of the spot
                    <Marker
                      coordinate={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                      onPress={() => handleSpotPress(spot)}
                      pinColor="red" // Red pin for owner's spot
                    />
                  ) : ( // Otherwise, render as a fuzzy circle and a transparent marker for clickability
                    <>
                      <Circle
                        center={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                        radius={200} // Example radius in meters
                        fillColor="rgba(255,0,0,0.2)" // Red with more transparency
                        strokeColor="rgba(255,0,0,0.8)"
                        strokeWidth={2}
                      />
                      <Marker
                        coordinate={{ latitude: parseFloat(spot.latitude), longitude: parseFloat(spot.longitude) }}
                        onPress={() => handleSpotPress(spot)}
                        tracksViewChanges={false}
                      >
                        <View style={{width: 20, height: 20, backgroundColor: 'transparent'}}></View>
                      </Marker>
                    </>
                  )}
                </React.Fragment>
                );
              })}
            </MapView>
          ) : (
            <Text style={styles.messageText}>Getting your location...</Text>
          )}
          <View style={styles.mapControls}>
            <TouchableOpacity style={styles.centerButton} onPress={handleCenterMap}>
              <Text style={styles.centerButtonText}>⌖</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={styles.fab} onPress={() => setLeavingModalVisible(true)}>
            <Text style={styles.fabText}>+</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <ImageBackground 
          source={require('./assets/images/parking_background.png')} 
          style={styles.backgroundImage} 
          imageStyle={styles.imageStyle}
        >
          <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
            <View style={styles.loginOverlay}>
            <View style={styles.loginContainer}>
              <Text style={styles.loginTitle}>Login</Text> 
              <TextInput
                style={styles.input}
                placeholder="Username"
                placeholderTextColor="#888" 
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
              />
              <TextInput
                style={styles.input}
                placeholder="Password"
                placeholderTextColor="#888" 
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <TouchableOpacity style={styles.loginButton} onPress={handleLogin}> 
                <Text style={styles.loginButtonText}>Login</Text>
              </TouchableOpacity>
              <View style={styles.registerPrompt}> 
                <Text style={styles.registerText}>Don't have an account?</Text>
                <TouchableOpacity onPress={() => setShowRegister(true)}>
                  <Text style={styles.registerLink}>Register here</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
          </TouchableWithoutFeedback>
        </ImageBackground>
      )}
      <StatusBar style="auto" />
      <LeavingModal
        visible={isLeavingModalVisible}
        onClose={() => setLeavingModalVisible(false)}
        onCreateSpot={handleCreateSpot}
      />
      <SpotDetailsModal
        visible={isSpotDetailsVisible}
        spot={selectedSpot}
        onClose={() => setSpotDetailsVisible(false)}
        onRequestSpot={handleRequestSpot}
        currentUserId={userId} // Pass the current user's ID
        onDeleteSpot={handleDeleteSpot} // Pass the delete handler
        onEditSpot={handleEditSpot} // Pass the edit handler
      />
      {isLoggedIn && (
        <View style={styles.notificationArea}>
          <ScrollView>
            {notifications.map((notification, index) => (
              <Text key={index} style={styles.notificationText}>{notification}</Text>
            ))}
          </ScrollView>
        </View>
      )}
      <View style={styles.footer}>
        <Text style={styles.footerText}>© 2025 Konstantinos Dimou</Text>
      </View>
    </View>
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
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 10,
  },
  titleContainer: {
    alignItems: 'center',
  },
  appName: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 24,
    fontWeight: '600',
    color: 'white',
    letterSpacing: 5.5,
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
    borderRadius: 15,
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
    borderRadius: 8,
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
    borderRadius: 8,
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
    borderRadius: 20,
    padding: 10,
    elevation: 2,
  },
  centerButtonText: {
    fontSize: 20,
    color: '#333',
  },
  footer: {
    backgroundColor: '#547abb',
    padding: 10,
    alignItems: 'center',
  },
  footerText: {
    color: 'white',
    fontSize: 12,
  },
  fab: {
    position: 'absolute',
    width: 66,
    height: 66,
    borderRadius: 30,
    backgroundColor: '#007bff',
    justifyContent: 'center',
    alignItems: 'center',
    bottom: 30,
    alignSelf: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabText: {
    color: 'white',
    fontSize: 40,
    fontWeight: 'normal',
    lineHeight: 40,
  },
  hamburger: {
    padding: 10,
  },
  hamburgerLine: {
    width: 25,
    height: 2,
    backgroundColor: 'white',
    marginVertical: 4,
  },
  menu: {
    position: 'absolute',
    top: 100,
    right: 20,
    backgroundColor: 'white',
    borderRadius: 5,
    padding: 10,
    zIndex: 1,
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
  },
  menuItem: {
    fontSize: 16,
    paddingVertical: 5,
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
  notificationArea: {
    backgroundColor: 'transparent', // Changed to transparent
    padding: 10,
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 8,
    height: 100, // Fixed height
    overflow: 'hidden', // Hide overflow content
  },
  notificationText: {
    fontSize: 14,
    color: '#333',
  },
});