import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { io } from 'socket.io-client';
import Map from './components/Map';
import Filter from './components/Filter';
import DeclareSpot from './components/DeclareSpot'; // Re-import DeclareSpot
import Login from './components/Login';
import Register from './components/Register';
import SplashScreen from './components/SplashScreen';
import ProtectedRoute from './components/ProtectedRoute';
import Notification from './components/Notification'; // Import Notification component
import EditSpotModal from './components/EditSpotModal'; // NEW IMPORT
import LeavingFab from './components/LeavingFab'; // Add this import
import backgroundImage from './assets/images/parking_background.png'; // Import the image
import logo from './assets/images/logo.png';
import './App.css';

// establish a persistent connection from the UI client to the backend server
const socket = io('http://localhost:3001');

// NEW: Log socket connection status
socket.on('connect', () => {
  console.log('App.js: Socket connected:', socket.id);
});
socket.on('disconnect', () => {
  console.log('App.js: Socket disconnected:', socket.id);
});
socket.on('connect_error', (err) => {
  console.error('App.js: Socket connection error:', err);
});

// websocket flow
// 1. An anonymous connection is made first.
//   2. Then, once the person logs in, that anonymous connection is "upgraded" or "identified" by associating
//      it with their userId.

function MainAppContent() {
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [filteredParkingSpots, setFilteredParkingSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [showDeclareSpotForm, setShowDeclareSpotForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false); // NEW STATE for EditSpotModal visibility
  const [spotToEdit, setSpotToEdit] = useState(null); // NEW STATE to pass spot data to modal
  const [acceptedSpot, setAcceptedSpot] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [currentUserCarType, setCurrentUserCarType] = useState(null); // New state for user's car type
  const [notifications, setNotifications] = useState([]);
  const navigate = useNavigate();

  // Function to show the DeclareSpot form
  const handleShowDeclareSpotForm = useCallback(() => {
    setShowDeclareSpotForm(true);
  }, []);

  // NEW: Callback to open the EditSpotModal
  const handleOpenEditModal = useCallback((spot) => {
    setSpotToEdit(spot);
    setShowEditModal(true);
  }, []);

  const handleAccept = useCallback((notificationId, requesterId, spotId, ownerUsername) => {
    socket.emit('acceptRequest', { requesterId, spotId, ownerUsername, ownerId: currentUserId });
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, [currentUserId]);

  const handleDecline = useCallback((notificationId, requesterId, spotId, ownerUsername) => {
    socket.emit('declineRequest', { requesterId, spotId, ownerUsername });
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const handleCloseNotification = useCallback((notificationId) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  // Function to fetch parking spots
  const fetchParkingSpots = useCallback(async (filterValue, userCarType) => {
    let url = '/api/parkingspots';
    console.log(`App.js: fetchParkingSpots called with URL: ${url}`);
    const params = new URLSearchParams();
    if (filterValue && filterValue !== 'all') {
      params.append('filter', filterValue);
    }
    if (userCarType) {
      params.append('userCarType', userCarType);
    }
    if (params.toString()) {
      url += `?${params.toString()}`;
    }
    try {
      const token = localStorage.getItem('token');
      const headers = {};
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(url, {
        headers: headers,
        cache: 'no-store', // <--- ADD THIS LINE to prevent caching
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      console.log("App.js - Raw data from API:", data);
      const formattedSpots = data.map(spot => ({
        id: spot.id,
        user_id: spot.user_id,
        username: spot.username,
        lat: parseFloat(spot.latitude),
        lng: parseFloat(spot.longitude),
        status: spot.is_free ? 'available' : 'occupied',
        time_to_leave: spot.time_to_leave,
        price: parseFloat(spot.price),
        comments: spot.comments, // Ensure comments are passed through
        isExactLocation: spot.isExactLocation,
        is_free: spot.is_free, // <--- ADD THIS LINE
      }));
      console.log("App.js - Formatted spots for Map:", formattedSpots);
      setFilteredParkingSpots(formattedSpots); // Set filtered spots directly from fetched data
    } catch (error) {
      console.error('Error fetching parking spots:', error);
    }
  }, []);

  // Effect to handle authentication from token on initial load
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        setCurrentUserId(decodedToken.userId);
        setCurrentUsername(decodedToken.username);
        setCurrentUserCarType(decodedToken.carType);
      } catch (error) {
        console.error("Error decoding token:", error);
        localStorage.removeItem('token');
        setCurrentUserId(null);
        setCurrentUsername(null);
        setCurrentUserCarType(null);
      }
    }
  }, []); // Run only once on component mount

  // Effect to register the user with the socket and handle reconnections
  useEffect(() => {
    const handleRegister = () => {
      if (currentUserId && currentUsername) {
        console.log(`App.js: Attempting to register user ${currentUsername} (ID: ${currentUserId}) with socket ${socket.id}.`);
        socket.emit('register', { userId: currentUserId, username: currentUsername });
      }
    };

    // Register when the component mounts and user is logged in
    handleRegister();

    // Add listener for reconnection events
    socket.on('connect', handleRegister);

    // Cleanup listener when the component unmounts or userId changes
    return () => {
      console.log("App.js: Cleaning up socket connect listener.");
      socket.off('connect', handleRegister);
    };
  }, [currentUserId, currentUsername]); // Reruns when user info changes

  // Effect for fetching data and setting up socket listeners that depend on filters
  useEffect(() => {
    // Fetch initial data
    console.log("App.js: Initial fetchParkingSpots call.");
    fetchParkingSpots(selectedFilter, currentUserCarType);

    // Setup listeners
    const handleNewSpot = (newSpot) => {
      console.log('App.js: Received new parking spot via WebSocket:', newSpot);
      console.log('App.js: Calling fetchParkingSpots in response to newParkingSpot.');
      fetchParkingSpots(selectedFilter, currentUserCarType);
    };
    const handleSpotDeleted = (deletedSpotId) => {
      console.log('App.js: Received spot deleted via WebSocket:', deletedSpotId);
      console.log('App.js: Calling fetchParkingSpots in response to spotDeleted.');
      fetchParkingSpots(selectedFilter, currentUserCarType);
    };
    const handleSpotRequest = (data) => {
      console.log('App.js: Received spotRequest via WebSocket:', data);
      const { spotId, requesterId, message } = data;
      const ownerUsername = currentUsername;

      // Add a new notification to the state
      setNotifications(prev => [...prev, {
        id: Date.now(), // Unique ID for the notification
        spotId,
        requesterId,
        ownerUsername,
        message,
      }]);
    };

    const handleRequestResponse = (data) => {
      alert(data.message);
      // NEW: If the message indicates acceptance, refresh the map
      if (data.message.includes('ACCEPTED')) {
        console.log('App.js: Request accepted, refreshing map with delay...');
        setAcceptedSpot(data.spot);
        // Add a small delay before fetching to allow server to propagate changes
        setTimeout(() => {
          fetchParkingSpots(selectedFilter, currentUserCarType);
        }, 500); // 500ms delay
      }
    };
    const handleSpotUpdated = (updatedSpot) => {
      console.log('App.js: Received spot updated via WebSocket:', updatedSpot);
      console.log('App.js: Calling fetchParkingSpots in response to spotUpdated.');
      fetchParkingSpots(selectedFilter, currentUserCarType); // Re-fetch spots to update map
    };

    socket.on('newParkingSpot', handleNewSpot);
    socket.on('spotDeleted', handleSpotDeleted);
    socket.on('spotRequest', handleSpotRequest);
    socket.on('requestResponse', handleRequestResponse);
    socket.on('spotUpdated', handleSpotUpdated);

    // Cleanup listeners
    return () => {
      console.log("App.js: Cleaning up socket listeners.");
      socket.off('newParkingSpot', handleNewSpot);
      socket.off('spotDeleted', handleSpotDeleted);
      socket.off('spotRequest', handleSpotRequest);
      socket.off('requestResponse', handleRequestResponse);
      socket.off('spotUpdated', handleSpotUpdated);
    };
  }, [fetchParkingSpots, selectedFilter, currentUserCarType, currentUsername, handleAccept, handleDecline, handleCloseNotification]); // Reruns when filters change

  const handleLogout = useCallback(() => {
    if (currentUserId) {
      socket.emit('unregister', currentUserId);
    }
    localStorage.removeItem('token');
    setCurrentUserId(null);
    setCurrentUsername(null);
    setCurrentUserCarType(null);
    navigate('/');
  }, [currentUserId, navigate]);

  // Function to check token expiration
  const checkTokenExpiration = useCallback(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        const currentTime = Date.now() / 1000; // Convert to seconds
        if (decodedToken.exp < currentTime) {
          console.log('Token expired. Logging out...');
          handleLogout(); // Log out if token is expired
        }
      } catch (error) {
        console.error("Error decoding token during expiration check:", error);
        handleLogout(); // Log out if token is invalid
      }
    }
  }, [handleLogout]); // handleLogout is a dependency

  // Effect to handle authentication from token on initial load
  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        setCurrentUserId(decodedToken.userId);
        setCurrentUsername(decodedToken.username);
        setCurrentUserCarType(decodedToken.carType);
        checkTokenExpiration(); // Initial check on load
      } catch (error) {
        console.error("Error decoding token:", error);
        localStorage.removeItem('token');
        setCurrentUserId(null);
        setCurrentUsername(null);
        setCurrentUserCarType(null);
      }
    }

    // Set up periodic check
    const interval = setInterval(checkTokenExpiration, 5 * 60 * 1000); // Check every 5 minutes

    // Cleanup interval on component unmount
    return () => clearInterval(interval);

  }, [checkTokenExpiration]); // checkTokenExpiration is a dependency

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setUserLocation([pos.coords.latitude, pos.coords.longitude]);
        },
        (err) => {
          console.error("Error getting location: ", err);
          setUserLocation([51.505, -0.09]);
        }
      );
    } else {
      console.log("Geolocation is not supported by this browser.");
      setUserLocation([51.505, -0.09]);
    }
  }, [currentUserId]); // Add currentUserId to dependencies to re-fetch location on login

  return (
    <div className="App">
      <header className="App-header">
        <div className="logo-title-container">
          <img src={logo} className="logo-img" alt="Parksphere Logo" />
          <div className="logo-container">
            <h1 className="logo">PARKSPHERE</h1>
            <h2 className="tagline">the app you need to <span className="highlight">park in the city!</span></h2>
          </div>
        </div>
      </header>
      
      <Filter selectedFilter={selectedFilter} onFilterChange={setSelectedFilter} currentUsername={currentUsername} onLogout={handleLogout} />
      <div className="map-container">
        {console.log("App.js - userLocation before Map:", userLocation)}
        {console.log("App.js - filteredParkingSpots before Map:", filteredParkingSpots)}
        {userLocation && !isNaN(userLocation[0]) && !isNaN(userLocation[1]) ? (
          <Map
            parkingSpots={filteredParkingSpots}
            userLocation={userLocation}
            currentUserId={currentUserId}
            acceptedSpot={acceptedSpot}
            onSpotDeleted={() => {}} // No longer needed as Socket.IO handles updates
            onEditSpot={handleOpenEditModal} // NEW: Pass the callback to Map
          />
        ) : (
          <div>Loading map or getting your location...</div>
        )}
      </div>
      <LeavingFab
        userLocation={userLocation}
        currentUserCarType={currentUserCarType}
        currentUserId={currentUserId}
        onCustomDeclare={handleShowDeclareSpotForm} // Pass the new callback
      />

      {/* Re-add the conditional rendering for DeclareSpot */}
      {showDeclareSpotForm && (
        <DeclareSpot
          userLocation={userLocation}
          currentUserCarType={currentUserCarType}
          onClose={() => setShowDeclareSpotForm(false)}
        />
      )}

      {notifications.map(notification => (
        <Notification
          key={notification.id}
          message={notification.message}
          onAccept={() => handleAccept(notification.id, notification.requesterId, notification.spotId, notification.ownerUsername)}
          onDecline={() => handleDecline(notification.id, notification.requesterId, notification.spotId, notification.ownerUsername)}
          onClose={() => handleCloseNotification(notification.id)}
        />
      ))}

      {/* NEW: Conditional rendering for EditSpotModal */}
      {showEditModal && spotToEdit && (
        <EditSpotModal
          spotData={spotToEdit} // Pass the spot data to the modal
          onClose={() => {
            setShowEditModal(false);
            setSpotToEdit(null); // Clear spot data on close
          }}
        />
      )}

      <footer className="App-footer">
        <p>Konstantinos Dimou &copy; 2025</p>
      </footer>
    </div>
  );
}

function App() {
  useEffect(() => {
    document.body.style.setProperty('--background-image-url', `url(${backgroundImage})`);
  }, []);
  return (
    <Router>
      <Routes>
        <Route path="/" element={<SplashScreen />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        <Route
          path="/dashboard"
          element={
            <ProtectedRoute>
              <MainAppContent />
            </ProtectedRoute>
          }
        />
      </Routes>
    </Router>
  );
}

export default App;
