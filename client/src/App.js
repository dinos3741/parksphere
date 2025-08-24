import React, { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { emitter } from './emitter';
import { emitAcceptRequest, emitDeclineRequest, emitAcknowledgeArrival, emitRegister, emitUnregister, socket } from './socket';
import { getToken, isTokenExpired, logout } from './utils/auth';
import Map from './components/Map';
import Filter from './components/Filter';
import DeclareSpot from './components/DeclareSpot';
import Login from './components/Login';
import Register from './components/Register';
import SplashScreen from './components/SplashScreen';
import ProtectedRoute from './components/ProtectedRoute';
import Notification from './components/Notification';
import EditSpotModal from './components/EditSpotModal';
import LeavingFab from './components/LeavingFab';
import backgroundImage from './assets/images/parking_background.png';
import logo from './assets/images/logo.png';
import ProfileModal from './components/ProfileModal'; // Import ProfileModal
import './App.css';

function MainAppContent() {
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [showProfileModal, setShowProfileModal] = useState(false); // State for ProfileModal
  const [profileUserData, setProfileUserData] = useState(null); // State for profile data
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

  // Hamburger menu state
  const [menuOpen, setMenuOpen] = useState(false);

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
      const token = getToken();
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
    const token = getToken();
    if (token) {
      if (isTokenExpired(token)) {
        logout();
      } else {
        try {
          const decodedToken = jwtDecode(token);
          setCurrentUserId(decodedToken.userId);
          setCurrentUsername(decodedToken.username);
          setCurrentUserCarType(decodedToken.carType);
        } catch (error) {
          console.error("Error decoding token:", error);
          logout();
        }
      }
    }
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      const token = getToken();
      if (token && isTokenExpired(token)) {
        logout();
      }
    }, 60000); // Check every minute

    return () => clearInterval(interval);
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

  const handleLogout = useCallback(() => {
    if (currentUserId) {
      emitUnregister(currentUserId);
    }
    logout();
    navigate('/');
  }, [currentUserId, navigate]);

  const fetchProfileData = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3001/api/users/${currentUserId}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      const data = await response.json();
      setProfileUserData(data);
    } catch (error) {
      console.error('Error fetching profile data:', error);
      setProfileUserData(null); // Clear data on error
    }
  }, [currentUserId]);

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

        <div className="hamburger-menu" onClick={() => setMenuOpen(!menuOpen)}>
          <div className="bar"></div>
          <div className="bar"></div>
          <div className="bar"></div>
        </div>

        {menuOpen && (
          <div className="hamburger-dropdown">
            <button onClick={() => { setShowProfileModal(true); setMenuOpen(false); fetchProfileData(); }}>Profile</button>
            <button onClick={() => alert("Settings clicked")}>Settings</button>
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}

      </header>
      
      <Filter 
        selectedFilter={selectedFilter} 
        onFilterChange={setSelectedFilter} 
        currentUsername={currentUsername} 
         
      />

      <div className="map-container">
        {userLocation ? (
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

      {showProfileModal && (
        <ProfileModal
          onClose={() => setShowProfileModal(false)}
          userData={profileUserData}
        />
      )}
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
