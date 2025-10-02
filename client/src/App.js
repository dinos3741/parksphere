import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';

import { getToken, isTokenExpired, logout } from './utils/auth';
import { getDistance } from './utils/geoUtils';
import { emitRegister, emitUnregister, socket } from './socket';
import Map from './components/Map';
import Filter from './components/Filter';
// import DeclareSpot from './components/DeclareSpot'; // Removed DeclareSpot import
import Login from './components/Login';
import Register from './components/Register';
import SplashScreen from './components/SplashScreen';
import ProtectedRoute from './components/ProtectedRoute';
import EditSpotModal from './components/EditSpotModal';
import LeavingFab from './components/LeavingFab';
import backgroundImage from './assets/images/parking_background.png';
import logo from './assets/images/logo.png';
import ProfileModal from './components/ProfileModal'; // Import ProfileModal
import SettingsModal from './components/SettingsModal';
import NotificationLog from './components/NotificationLog';
import AcceptedRequestModal from './components/AcceptedRequestModal'; // Import AcceptedRequestModal
import ArrivalConfirmationModal from './components/ArrivalConfirmationModal';
import ChatSideDrawer from './components/ChatSideDrawer';
import { emitter } from './emitter';
import newRequestSound from './assets/sounds/new-request.wav';
import removeRequestSound from './assets/sounds/remove-request.wav';
import acceptedRequestSound from './assets/sounds/accepted-request.wav';
import arrivedSound from './assets/sounds/arrived.wav';
import './App.css';

function MainAppContent() {
  const [isChatOpen, setChatOpen] = useState(false);
  const [chatRecipient, setChatRecipient] = useState(null);
  const [allChatMessages, setAllChatMessages] = useState({}); // Stores messages for all chats
  const [chatInput, setChatInput] = useState('');
  const [unreadMessages, setUnreadMessages] = useState({});
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);
  const removeRequestAudioBufferRef = useRef(null);
  const acceptedRequestAudioBufferRef = useRef(null);
  const arrivedAudioBufferRef = useRef(null);
  useEffect(() => {
    const initAudio = async () => {
      try {
        audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
        const response = await fetch(newRequestSound);
        const arrayBuffer = await response.arrayBuffer();
        audioBufferRef.current = await audioContextRef.current.decodeAudioData(arrayBuffer);

        const removeRequestResponse = await fetch(removeRequestSound);
        const removeRequestArrayBuffer = await removeRequestResponse.arrayBuffer();
        removeRequestAudioBufferRef.current = await audioContextRef.current.decodeAudioData(removeRequestArrayBuffer);

        const acceptedRequestResponse = await fetch(acceptedRequestSound);
        const acceptedRequestArrayBuffer = await acceptedRequestResponse.arrayBuffer();
        acceptedRequestAudioBufferRef.current = await audioContextRef.current.decodeAudioData(acceptedRequestArrayBuffer);

        const arrivedResponse = await fetch(arrivedSound);
        const arrivedArrayBuffer = await arrivedResponse.arrayBuffer();
        arrivedAudioBufferRef.current = await audioContextRef.current.decodeAudioData(arrivedArrayBuffer);
      } catch (error) {
        console.error("Error initializing audio:", error);
      }
    };
    initAudio();
  }, []);

  const playSound = useCallback(() => {
    if (audioContextRef.current && audioBufferRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBufferRef.current;
      source.connect(audioContextRef.current.destination);
      source.start(0);
    }
  }, []);

  const playSoundRemoveRequest = useCallback(() => {
    if (audioContextRef.current && removeRequestAudioBufferRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      const source = audioContextRef.current.createBufferSource();
      source.buffer = removeRequestAudioBufferRef.current;
      source.connect(audioContextRef.current.destination);
      source.start(0);
    }
  }, []);

  const playSoundAcceptedRequest = useCallback(() => {
    if (audioContextRef.current && acceptedRequestAudioBufferRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      const source = audioContextRef.current.createBufferSource();
      source.buffer = acceptedRequestAudioBufferRef.current;
      source.connect(audioContextRef.current.destination);
      source.start(0);
    }
  }, []);

  const playSoundArrived = useCallback(() => {
    if (audioContextRef.current && arrivedAudioBufferRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      const source = audioContextRef.current.createBufferSource();
      source.buffer = arrivedAudioBufferRef.current;
      source.connect(audioContextRef.current.destination);
      source.start(0);
    }
  }, []);

  const [selectedFilter, setSelectedFilter] = useState('all');
  const [selectedRadius, setSelectedRadius] = useState(5);

  useEffect(() => {
    const unlockAudio = () => {
      if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
        audioContextRef.current.resume();
      }
      document.body.removeEventListener('click', unlockAudio);
    };

    document.body.addEventListener('click', unlockAudio);

    return () => {
      document.body.removeEventListener('click', unlockAudio);
    };
  }, []);
  const [showProfileModal, setShowProfileModal] = useState(false); // State for ProfileModal
  const [showAcceptedRequestModal, setShowAcceptedRequestModal] = useState(false); // State for AcceptedRequestModal
  const [isArrivalConfirmationModalOpen, setArrivalConfirmationModalOpen] = useState(false);
  const [arrivalConfirmationData, setArrivalConfirmationData] = useState(null);
  const [acceptedRequestOwnerUsername, setAcceptedRequestOwnerUsername] = useState(''); // State for the username of the owner who accepted the request
  const [profileUserData, setProfileUserData] = useState(null); // State for profile data
  const [filteredParkingSpots, setFilteredParkingSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  // const [showDeclareSpotForm, setShowDeclareSpotForm] = useState(false); // Removed DeclareSpotForm state
  const [showEditModal, setShowEditModal] = useState(false);
  const [spotToEdit, setSpotToEdit] = useState(null);
  const [acceptedSpot, setAcceptedSpot] = useState(null);
  const [currentUserId, setCurrentUserId] = useState(null);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [currentUserCarType, setCurrentUserCarType] = useState(null);
  const [notificationLog, setNotificationLog] = useState(() => {
    const savedLog = sessionStorage.getItem('notificationLog');
    return savedLog ? JSON.parse(savedLog) : [];
  });

  const formatTimestamp = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };
  const [pendingRequests, setPendingRequests] = useState([]); // New state for pending requests
  const [isPinDropMode, setPinDropMode] = useState(false);
  const [pinnedLocation, setPinnedLocation] = useState(null);
  const [showLeavingOverlay, setShowLeavingOverlay] = useState(false);
  const requesterEta = null;

  useEffect(() => {
    sessionStorage.setItem('notificationLog', JSON.stringify(notificationLog));
  }, [notificationLog]);

  const addNotification = useCallback((message, color = 'default') => {
    const timestamp = formatTimestamp(new Date());
    setNotificationLog(prevLog => [...prevLog, { id: Date.now(), timestamp, message, color }]);
  }, [setNotificationLog]);

  const [expiredNotifiedSpots, setExpiredNotifiedSpots] = useState([]);

  useEffect(() => {
    const interval = setInterval(() => {
      filteredParkingSpots.forEach(spot => {
        if (spot.time_to_leave && !expiredNotifiedSpots.includes(spot.id)) {
          const declaredAt = new Date(spot.declared_at);
          const now = new Date();
          const minutesSinceDeclared = (now - declaredAt) / 60000;
          if (minutesSinceDeclared > spot.time_to_leave) {
            addNotification(`Spot ${spot.id} expired`, 'red');
            setExpiredNotifiedSpots(prev => [...prev, spot.id]);
          }
        }
      });
    }, 1000); // Check every second

    return () => clearInterval(interval);
  }, [filteredParkingSpots, expiredNotifiedSpots, addNotification]);

  // Hamburger menu state
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const dropdownRef = useRef(null); // Create a ref for the dropdown

  const navigate = useNavigate();

  // Function to handle clicks outside the dropdown
  const handleClickOutside = useCallback((event) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target) && !event.target.closest('.hamburger-menu')) {
      setMenuOpen(false);
    }
  }, []);

  // Effect to add and remove the event listener
  useEffect(() => {
    if (menuOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [menuOpen, handleClickOutside]);

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
      console.log('Fetched profile data:', data); // Add this console.log
      setProfileUserData({
        ...data,
        total_arrival_time: parseFloat(data.total_arrival_time),
        completed_transactions_count: parseInt(data.completed_transactions_count, 10),
      });
    } catch (error) {
      console.error('Error fetching profile data:', error);
      setProfileUserData(null); // Clear data on error
    }
  }, [currentUserId]);

  const handleCarDetailsUpdated = useCallback(() => {
    const token = getToken();
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        setCurrentUserId(decodedToken.userId);
        setCurrentUsername(decodedToken.username);
        setCurrentUserCarType(decodedToken.carType);
        fetchProfileData(); // Refresh profile data as well
      } catch (error) {
        console.error("Error decoding token after car details update:", error);
        logout();
      }
    }
  }, [fetchProfileData]);

  const fetchPendingRequests = useCallback(async () => {
    if (!currentUserId) return;
    try {
      const token = getToken();
      const response = await fetch(`http://localhost:3001/api/user/pending-requests`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setPendingRequests(data);
    } catch (error) {
      console.error('Error fetching pending requests:', error);
    }
  }, [currentUserId]);

  // const handleShowDeclareSpotForm = useCallback(() => {
  //   setShowDeclareSpotForm(true);
  // }, []); // Removed handleShowDeclareSpotForm

  const handleOpenEditModal = useCallback((spot) => {
    setSpotToEdit(spot);
    setShowEditModal(true);
  }, []);

  const handleRequestStatusChange = useCallback((spotId, status) => {
    return new Promise(resolve => {
      setPendingRequests(prevRequests => {
        if (status === 'requested') {
          resolve(spotId);
          return [...prevRequests, spotId];
        } else if (status === 'cancelled') {
          resolve(spotId);
          return prevRequests.filter(id => id !== spotId);
        }
        resolve(null);
        return prevRequests;
      });
    });
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
        cost_type: spot.cost_type,
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
          fetchProfileData(); // Fetch profile data after setting user info
        } catch (error) {
          console.error("Error decoding token:", error);
          logout();
        }
      }
    }
  }, [fetchProfileData]);

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

  useEffect(() => {
    fetchPendingRequests();
  }, [fetchPendingRequests]);

  const handleCloseChat = useCallback(() => {
    setChatOpen(false);
    setChatRecipient(null);
  }, []);

  useEffect(() => {
    const handleNewSpot = () => {
      fetchParkingSpots(selectedFilter, currentUserCarType);
    };

    const handleSpotDeleted = (data) => {
      fetchParkingSpots(selectedFilter, currentUserCarType);

      // The data can be either a spotId or an object with spotId, ownerId, and requesterIds
      if (typeof data === 'object' && data.spotId) {
        const { ownerId, requesterIds } = data;
        const participants = [ownerId, ...(requesterIds || [])];

        setAllChatMessages(prevAllMessages => {
          const newAllChatMessages = { ...prevAllMessages };
          participants.forEach(userId => {
            delete newAllChatMessages[userId];
          });
          return newAllChatMessages;
        });

        setUnreadMessages(prevUnread => {
          const newUnreadMessages = { ...prevUnread };
          participants.forEach(userId => {
            delete newUnreadMessages[userId];
          });
          return newUnreadMessages;
        });

        // If the open chat is with one of the participants, close it
        if (chatRecipient && participants.includes(chatRecipient.id)) {
          handleCloseChat();
        }
      }
    };

    socket.on('newParkingSpot', handleNewSpot);
    socket.on('spotDeleted', handleSpotDeleted);

    return () => {
      socket.off('newParkingSpot', handleNewSpot);
      socket.off('spotDeleted', handleSpotDeleted);
    };
  }, [fetchParkingSpots, selectedFilter, currentUserCarType, chatRecipient, handleCloseChat]);

  useEffect(() => {
    const handleSpotUpdated = (updatedSpotFromServer) => {
      setFilteredParkingSpots(prevSpots => {
        return prevSpots.map(spot => {
          if (spot.id === updatedSpotFromServer.id) {
            return {
              ...spot,
              lat: parseFloat(updatedSpotFromServer.latitude),
              lng: parseFloat(updatedSpotFromServer.longitude),
              time_to_leave: updatedSpotFromServer.time_to_leave,
              price: parseFloat(updatedSpotFromServer.price),
              comments: updatedSpotFromServer.comments || '',
              cost_type: updatedSpotFromServer.cost_type,
              declared_at: updatedSpotFromServer.declared_at,
              declared_car_type: updatedSpotFromServer.declared_car_type,
              status: updatedSpotFromServer.cost_type === 'free' ? 'available' : 'occupied',
              is_free: updatedSpotFromServer.cost_type === 'free',
            };
          }
          return spot;
        });
      });
    };

    socket.on('spotUpdated', handleSpotUpdated);

    return () => {
      socket.off('spotUpdated', handleSpotUpdated);
    };
  }, [setFilteredParkingSpots]);

  useEffect(() => {
    const handleSpotRequest = (data) => {
      addNotification(data.message, 'blue');
      playSound();
      fetchPendingRequests();
      emitter.emit('new-request');
    };

    socket.on('spotRequest', handleSpotRequest);

    return () => {
      socket.off('spotRequest', handleSpotRequest);
    };
  }, [addNotification, playSound, fetchPendingRequests]);

  useEffect(() => {
    const handleRequestResponse = (data) => {
      if (data.message.includes('ACCEPTED')) {
        setAcceptedRequestOwnerUsername(data.ownerUsername);
        setShowAcceptedRequestModal(true);
        playSoundAcceptedRequest();
      }
      addNotification(data.message, 'default');
      if (data.spot) {
        setAcceptedSpot(data.spot);
        setFilteredParkingSpots(prevSpots => {
          const index = prevSpots.findIndex(s => s.id === data.spot.id);
          if (index !== -1) {
            const newSpots = [...prevSpots];
            newSpots[index] = {
              ...newSpots[index],
              lat: parseFloat(data.spot.latitude),
              lng: parseFloat(data.spot.longitude),
              isExactLocation: true,
            };
            return newSpots;
          }
          return prevSpots;
        });
      }
      // New logic to update pendingRequests based on request status
      if (data.message.includes('DECLINED') || data.message.includes('CANCELLED')) {
        setPendingRequests(prevRequests => prevRequests.filter(id => id !== data.spotId));
        emitter.emit('request-rejected', { spotId: data.spotId, ownerUsername: data.ownerUsername });
      } else if (data.requestId) { // Assuming requestId is present for relevant responses
        // If the message indicates reactivation or acceptance, add to pending
        if (data.message.includes('reactivated') || data.message.includes('ACCEPTED')) {
          setPendingRequests(prevRequests => [...prevRequests, data.spotId || data.spot.id]); // Use spotId or spot.id
        }
      }
    };

    socket.on('requestResponse', handleRequestResponse);

    return () => {
      socket.off('requestResponse', handleRequestResponse);
    };
  }, [addNotification, playSoundAcceptedRequest]);

  useEffect(() => {
    const handleRequesterArrived = (data) => {
      const message = `User ${data.requesterUsername} has arrived at spot ${data.spotId}. Please confirm to complete the transaction.`;
      addNotification(message, 'default');
      playSoundArrived();
      setArrivalConfirmationData(data);
      setArrivalConfirmationModalOpen(true);
    };

    socket.on('requesterArrived', handleRequesterArrived);

    return () => {
      socket.off('requesterArrived', handleRequesterArrived);
    };
  }, [addNotification, playSoundArrived]);

  const handleConfirmArrival = () => {
    if (arrivalConfirmationData && userLocation) {
      const spot = filteredParkingSpots.find(s => s.id === arrivalConfirmationData.spotId);

      if (spot) {
        const distance = getDistance(
          userLocation[0],
          userLocation[1],
          spot.lat,
          spot.lng
        );

        const distanceThreshold = 0.02; // 20 meters in kilometers

        if (distance < distanceThreshold) {
          socket.emit('confirm-transaction', {
            spotId: arrivalConfirmationData.spotId,
            requesterId: arrivalConfirmationData.requesterId,
          });
          setArrivalConfirmationModalOpen(false);
          setArrivalConfirmationData(null);
          addNotification('Arrival confirmed!', 'green');
        } else {
          addNotification('You are too far from the spot to confirm arrival. Please get closer (within 20 meters).', 'red');
          setArrivalConfirmationModalOpen(false);
          setArrivalConfirmationData(null);
        }
      } else {
        addNotification('Spot data not found for arrival confirmation.', 'red');
        setArrivalConfirmationModalOpen(false);
        setArrivalConfirmationData(null);
      }
    }
  };

  const handleCloseArrivalModal = () => {
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  const handleNotIdentified = () => {
    if (arrivalConfirmationData) {
      // For now, just log it and notify the owner.
      console.log(`Owner did not identify requester for spot ${arrivalConfirmationData.spotId}`);
      addNotification(`You have indicated that the requester was not identified.`, 'default');
    }
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  useEffect(() => {
    const handleRequestCancelled = (data) => {
      const message = `User ${data.requesterUsername} has cancelled their request for your spot ${data.spotId}.`;
      addNotification(message, 'purple');
      playSoundRemoveRequest();
    };

    socket.on('requestCancelled', handleRequestCancelled);

    return () => {
      socket.off('requestCancelled', handleRequestCancelled);
    };
  }, [addNotification, playSoundRemoveRequest]);

  useEffect(() => {
    const handleTransactionComplete = () => {
      fetchProfileData();
    };

    socket.on('transactionComplete', handleTransactionComplete);

    return () => {
      socket.off('transactionComplete', handleTransactionComplete);
    };
  }, [fetchProfileData]);

  useEffect(() => {
    const handleRequestAcceptedOrDeclined = (data) => {
      // Re-fetch spot requests for the currently open spot (if any)
      // This assumes that when a request is accepted/declined, the owner's drawer is open
      // and we need to update the requests list for that specific spot.
      // The spotRequests are fetched in handleOwnerSpotClick in Map.js
      // We need a way to trigger that fetch again or update the state directly.
      // For simplicity, let's re-fetch all parking spots, which will also update the requests for the open drawer.
      fetchParkingSpots(selectedFilter, currentUserCarType); // This will re-fetch all spots and their requests
    };

    socket.on('requestAcceptedOrDeclined', handleRequestAcceptedOrDeclined);

    return () => {
      socket.off('requestAcceptedOrDeclined', handleRequestAcceptedOrDeclined);
    };
  }, [fetchParkingSpots, selectedFilter, currentUserCarType]);

  // Effect to handle welcome message from sessionStorage and emitter
  useEffect(() => {
    const checkAndDisplayWelcomeMessage = () => {
      const welcomeMessage = sessionStorage.getItem('welcomeMessage');
      if (welcomeMessage) {
        addNotification(welcomeMessage, 'default');
        sessionStorage.removeItem('welcomeMessage');
      }
    };

    // Check on mount
    checkAndDisplayWelcomeMessage();

    // Listen for login-success event
    emitter.on('login-success', checkAndDisplayWelcomeMessage);

    return () => {
      emitter.off('login-success', checkAndDisplayWelcomeMessage);
    };
  }, [addNotification]);

  // Effect to clear notifications on logout
  useEffect(() => {
    const handleClearNotifications = () => {
      setNotificationLog([]);
    };

    emitter.on('clear-notifications', handleClearNotifications);

    return () => {
      emitter.off('clear-notifications', handleClearNotifications);
    };
  }, [setNotificationLog]);

  const handleSendMessage = () => {
    if (chatInput.trim() && chatRecipient) {
      const newMessage = {
        from: currentUserId,
        to: chatRecipient.id,
        message: chatInput,
      };
      socket.emit('privateMessage', newMessage);
      setAllChatMessages((prevAllMessages) => ({
        ...prevAllMessages,
        [chatRecipient.id]: [...(prevAllMessages[chatRecipient.id] || []), newMessage],
      }));
      setChatInput(''); // Clear the input after sending
    }
  };

  useEffect(() => {
    const handlePrivateMessage = (message) => {
      const fromId = message.from;
      setAllChatMessages((prevAllMessages) => ({
        ...prevAllMessages,
        [fromId]: [...(prevAllMessages[fromId] || []), message],
      }));

      // If chat is not open with the sender, mark as unread
      if (!isChatOpen || (chatRecipient && chatRecipient.id !== fromId)) {
        setUnreadMessages((prevUnread) => ({
          ...prevUnread,
          [fromId]: (prevUnread[fromId] || 0) + 1,
        }));
      }
    };

    socket.on('privateMessage', handlePrivateMessage);

    return () => {
      socket.off('privateMessage', handlePrivateMessage);
    };
  }, [isChatOpen, chatRecipient]);

  const handleLogout = useCallback(() => {
    if (currentUserId) {
      emitUnregister(currentUserId);
    }
    logout();
    navigate('/');
  }, [currentUserId, navigate]);

  const handleOpenChat = useCallback((recipient) => {
    setChatRecipient(recipient);
    setChatOpen(true);
    // Clear unread messages for this recipient
    setUnreadMessages((prevUnread) => {
      const newUnread = { ...prevUnread };
      delete newUnread[recipient.id];
      return newUnread;
    });
  }, []);

  const handleDeleteSpot = useCallback(async (spotId) => {
    try {
      const token = getToken();
      const response = await fetch(`http://localhost:3001/api/parkingspots/${spotId}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }

      addNotification(`Spot #${spotId} deleted successfully.`, 'green');
      fetchParkingSpots(selectedFilter, currentUserCarType); // Re-fetch spots to update the map
    } catch (error) {
      console.error('Error deleting spot:', error);
      addNotification(`Failed to delete spot: ${error.message}`, 'red');
    }
  }, [addNotification, fetchParkingSpots, selectedFilter, currentUserCarType]);

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
          <div className="hamburger-dropdown" ref={dropdownRef}> {/* Add ref here */}
            <button onClick={() => { setShowProfileModal(true); setMenuOpen(false); fetchProfileData(); }}>Profile</button>
            <button onClick={() => { setShowSettingsModal(true); setMenuOpen(false); }}>Settings</button>
            <button onClick={handleLogout}>Logout</button>
          </div>
        )}

      </header>
      
      <div className="main-content">
        <Filter 
          selectedFilter={selectedFilter} 
          onFilterChange={setSelectedFilter} 
          currentUsername={currentUsername} 
          currentUserAvatarUrl={profileUserData?.avatar_url}
        />

        <div className="map-container">
          {userLocation ? (
            <Map
              parkingSpots={filteredParkingSpots}
              userLocation={userLocation}
              currentUserId={currentUserId}
              acceptedSpot={acceptedSpot}
              requesterEta={requesterEta}
              onSpotDeleted={handleDeleteSpot}
              onEditSpot={handleOpenEditModal}
              addNotification={addNotification}
              onRequestStatusChange={handleRequestStatusChange}
              currentUsername={currentUsername}
              pendingRequests={pendingRequests}
              onOpenChat={handleOpenChat}
              unreadMessages={unreadMessages}
              isPinDropMode={isPinDropMode}
              setPinDropMode={setPinDropMode}
              pinnedLocation={pinnedLocation}
              setPinnedLocation={setPinnedLocation}
              setShowLeavingOverlay={setShowLeavingOverlay}
            />
          ) : (
            <div>Loading map or getting your location...</div>
          )}
        </div>

        <LeavingFab
          userLocation={userLocation}
          currentUserCarType={currentUserCarType}
          currentUserId={currentUserId}
          addNotification={addNotification}
          setPinDropMode={setPinDropMode}
          setShowLeavingOverlay={setShowLeavingOverlay}
          showLeavingOverlay={showLeavingOverlay}
          setPinnedLocation={setPinnedLocation}
          pinnedLocation={pinnedLocation}
        />

        {/* Removed DeclareSpot component rendering */}

        {showEditModal && spotToEdit && (
          <EditSpotModal
            spotData={spotToEdit}
            currentUserCarType={currentUserCarType}
            onClose={() => {
              setShowEditModal(false);
              setSpotToEdit(null);
            }}
          />
        )}
      </div>

      <NotificationLog messages={notificationLog} />

      {isChatOpen && (
        <ChatSideDrawer
          isOpen={isChatOpen}
          onClose={handleCloseChat}
          title={chatRecipient ? `Chat with ${chatRecipient.username}` : 'Chat'}
          messages={allChatMessages[chatRecipient?.id] || []}
          recipient={chatRecipient}
          onSendMessage={handleSendMessage}
          chatInput={chatInput}
          onChatInputChange={setChatInput}
        />
      )}

      <footer className="App-footer">
        <p>Konstantinos Dimou &copy; 2025</p>
      </footer>

      {showAcceptedRequestModal && (
        <AcceptedRequestModal 
          onClose={() => setShowAcceptedRequestModal(false)} 
          ownerUsername={acceptedRequestOwnerUsername} 
        />
      )}

      {showProfileModal && (
        <ProfileModal
          onClose={() => setShowProfileModal(false)}
          userData={profileUserData}
          currentUserId={currentUserId}
          addNotification={addNotification}
          onCarDetailsUpdated={handleCarDetailsUpdated}
        />
      )}

      <ArrivalConfirmationModal
        isOpen={isArrivalConfirmationModalOpen}
        onClose={handleCloseArrivalModal}
        onConfirm={handleConfirmArrival}
        onNotIdentified={handleNotIdentified}
        isOwner={true}
        requesterUsername={arrivalConfirmationData?.requesterUsername}
        spotId={arrivalConfirmationData?.spotId}
      />

      {showSettingsModal && (
        <SettingsModal 
          onClose={() => setShowSettingsModal(false)} 
          selectedFilter={selectedFilter} 
          onFilterChange={setSelectedFilter} 
          selectedRadius={selectedRadius} 
          onRadiusChange={setSelectedRadius} 
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
