import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { emitter } from './emitter';
import { emitAcceptRequest, emitDeclineRequest, emitAcknowledgeArrival, emitRegister, emitUnregister, socket } from './socket';
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



// NEW: Log socket connection status


// websocket flow
// 1. An anonymous connection is made first.
//   2. Then, once the person logs in, that anonymous connection is "upgraded" or "identified" by associating
//      it with their userId.

function MainAppContent() {
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [filteredParkingSpots, setFilteredParkingSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [showDeclareSpotForm, setShowDeclareSpotForm] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [spotToEdit, setSpotToEdit] = useState(null);
  const [acceptedSpot, setAcceptedSpot] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [currentUserCarType, setCurrentUserCarType] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [requesterEta, setRequesterEta] = useState(null);
  const [requesterArrived, setRequesterArrived] = useState(null);
  const navigate = useNavigate();

  const handleShowDeclareSpotForm = useCallback(() => {
    setShowDeclareSpotForm(true);
  }, []);

  const handleOpenEditModal = useCallback((spot) => {
    setSpotToEdit(spot);
    setShowEditModal(true);
  }, []);

  const handleAccept = useCallback((notificationId, requesterId, spotId, ownerUsername, requestId) => {
    emitAcceptRequest({ requestId, requesterId, spotId, ownerUsername, ownerId: currentUserId });
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, [currentUserId]);

  const handleDecline = useCallback((notificationId, requesterId, spotId, ownerUsername, requestId) => {
    emitDeclineRequest({ requestId, requesterId, spotId, ownerUsername });
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const handleCloseNotification = useCallback((notificationId) => {
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const handleAcknowledgeArrival = useCallback((notificationId, spotId, requesterId) => {
    emitAcknowledgeArrival({ spotId, requesterId });
    setNotifications(prev => prev.filter(n => n.id !== notificationId));
  }, []);

  const fetchParkingSpots = useCallback(async (filterValue, userCarType) => {
    let url = '/api/parkingspots';
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
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const formattedSpots = data.map(spot => ({
        id: spot.id,
        user_id: spot.user_id,
        username: spot.username,
        lat: parseFloat(spot.latitude),
        lng: parseFloat(spot.longitude),
        status: spot.is_free ? 'available' : 'occupied',
        time_to_leave: spot.time_to_leave,
        price: parseFloat(spot.price),
        comments: spot.comments || '',
        isExactLocation: spot.isExactLocation,
        is_free: spot.is_free,
        declared_at: spot.declared_at,
      }));
      setFilteredParkingSpots(formattedSpots);
    } catch (error) {
      console.error('Error fetching parking spots:', error);
    }
  }, []);

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
  }, []);

  useEffect(() => {
    const handleRegister = () => {
      if (currentUserId && currentUsername) {
        emitRegister({ userId: currentUserId, username: currentUsername });
      }
    };
    handleRegister();
    socket.on('connect', handleRegister);
    return () => {
      socket.off('connect', handleRegister);
    };
  }, [currentUserId, currentUsername]);

  useEffect(() => {
    fetchParkingSpots(selectedFilter, currentUserCarType);
  }, [fetchParkingSpots, selectedFilter, currentUserCarType]);

  useEffect(() => {
    const onNewSpot = (newSpot) => {
      if (newSpot.user_id !== currentUserId) {
        setFilteredParkingSpots(prevSpots => [...prevSpots, {
          id: newSpot.id,
          user_id: newSpot.user_id,
          username: newSpot.username,
          lat: parseFloat(newSpot.latitude),
          lng: parseFloat(newSpot.longitude),
          status: newSpot.is_free ? 'available' : 'occupied',
          time_to_leave: newSpot.time_to_leave,
          price: parseFloat(newSpot.price),
          comments: newSpot.comments || '',
          isExactLocation: newSpot.isExactLocation,
          is_free: newSpot.is_free,
          declared_at: newSpot.declared_at,
        }]);
      }
    };
    const onSpotDeleted = () => fetchParkingSpots(selectedFilter, currentUserCarType);
    const onSpotUpdated = () => fetchParkingSpots(selectedFilter, currentUserCarType);

    emitter.on('newParkingSpot', onNewSpot);
    emitter.on('spotDeleted', onSpotDeleted);
    emitter.on('spotUpdated', onSpotUpdated);

    const handleSpotRequest = (data) => {
      const { spotId, requesterId, message, requestId } = data;
      setNotifications(prev => [...prev, { id: Date.now(), type: 'request', spotId, requesterId, ownerUsername: currentUsername, message, requestId }]);
    };
    const handleRequestResponse = (data) => {
      alert(data.message);
      if (data.message.includes('ACCEPTED')) {
        setAcceptedSpot(data.spot);
        setTimeout(() => fetchParkingSpots(selectedFilter, currentUserCarType), 500);
      }
    };
    const handleEtaUpdate = (data) => setRequesterEta(data);
    const handleRequesterArrived = (data) => {
      const { spotId, requesterId } = data;
      setNotifications(prev => [...prev, { id: Date.now(), type: 'arrival', spotId, requesterId, message: `User ${requesterId} has arrived at spot ${spotId}.` }]);
    };
    const handleTransactionComplete = (data) => alert(data.message);

    emitter.on('spotRequest', handleSpotRequest);
    emitter.on('requestResponse', handleRequestResponse);
    emitter.on('etaUpdate', handleEtaUpdate);
    emitter.on('requesterArrived', handleRequesterArrived);
    emitter.on('transactionComplete', handleTransactionComplete);

    return () => {
      emitter.off('newParkingSpot', onNewSpot);
      emitter.off('spotDeleted', onSpotDeleted);
      emitter.off('spotUpdated', onSpotUpdated);
      emitter.off('spotRequest', handleSpotRequest);
      emitter.off('requestResponse', handleRequestResponse);
      emitter.off('etaUpdate', handleEtaUpdate);
      emitter.off('requesterArrived', handleRequesterArrived);
      emitter.off('transactionComplete', handleTransactionComplete);
    };
  }, [selectedFilter, currentUserCarType, fetchParkingSpots, currentUsername, currentUserId]);

  const handleLogout = useCallback(() => {
    if (currentUserId) {
      emitUnregister(currentUserId);
    }
    localStorage.removeItem('token');
    setCurrentUserId(null);
    setCurrentUsername(null);
    setCurrentUserCarType(null);
    navigate('/');
  }, [currentUserId, navigate]);

  const checkTokenExpiration = useCallback(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        const currentTime = Date.now() / 1000;
        if (decodedToken.exp < currentTime) {
          handleLogout();
        }
      } catch (error) {
        console.error("Error decoding token during expiration check:", error);
        handleLogout();
      }
    }
  }, [handleLogout]);

  useEffect(() => {
    const token = localStorage.getItem('token');
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        setCurrentUserId(decodedToken.userId);
        setCurrentUsername(decodedToken.username);
        setCurrentUserCarType(decodedToken.carType);
        checkTokenExpiration();
      } catch (error) {
        console.error("Error decoding token:", error);
        localStorage.removeItem('token');
        setCurrentUserId(null);
        setCurrentUsername(null);
        setCurrentUserCarType(null);
      }
    }
    const interval = setInterval(checkTokenExpiration, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [checkTokenExpiration]);

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
  }, [currentUserId]);

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
        {userLocation && !isNaN(userLocation[0]) && !isNaN(userLocation[1]) ? (
          <Map
            parkingSpots={filteredParkingSpots}
            userLocation={userLocation}
            currentUserId={currentUserId}
            acceptedSpot={acceptedSpot}
            requesterEta={requesterEta}
            onAcknowledgeArrival={handleAcknowledgeArrival}
            onSpotDeleted={() => {}}
            onEditSpot={handleOpenEditModal}
          />
        ) : (
          <div>Loading map or getting your location...</div>
        )}
      </div>
      <LeavingFab
        userLocation={userLocation}
        currentUserCarType={currentUserCarType}
        currentUserId={currentUserId}
        onCustomDeclare={handleShowDeclareSpotForm}
      />

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
          type={notification.type}
          onAccept={() => handleAccept(notification.id, notification.requesterId, notification.spotId, notification.ownerUsername, notification.requestId)}
          onDecline={() => handleDecline(notification.id, notification.requesterId, notification.spotId, notification.ownerUsername, notification.requestId)}
          onAcknowledge={() => handleAcknowledgeArrival(notification.id, notification.spotId, notification.requesterId)}
          onClose={() => handleCloseNotification(notification.id)}
        />
      ))}

      {showEditModal && spotToEdit && (
        <EditSpotModal
          spotData={spotToEdit}
          onClose={() => {
            setShowEditModal(false);
            setSpotToEdit(null);
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
