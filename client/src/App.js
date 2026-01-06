import React, { useState, useEffect, useCallback, useRef } from 'react';
import { BrowserRouter as Router, Routes, Route, useNavigate } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import io from 'socket.io-client';

import { getToken, isTokenExpired, logout } from './utils/auth';
import emitter from './utils/emitter';

import Map from './components/Map';
import Filter from './components/Filter';
import Login from './components/Login';
import Register from './components/Register';
import SplashScreen from './components/SplashScreen';
import ProtectedRoute from './components/ProtectedRoute';
import EditSpotModal from './components/EditSpotModal';
import LeavingFab from './components/LeavingFab';
import backgroundImage from './assets/images/parking_background.png';
import logo from './assets/images/logo.png';

import ProfileModal from './components/ProfileModal';
import SettingsModal from './components/SettingsModal';
import NotificationLog from './components/NotificationLog';
import AcceptedRequestModal from './components/AcceptedRequestModal';
import ArrivalConfirmationModal from './components/ArrivalConfirmationModal';
import ChatSideDrawer from './components/ChatSideDrawer';
import MessagesSideDrawer from './components/MessagesSideDrawer';

import newRequestSound from './assets/sounds/new-request.wav';
import removeRequestSound from './assets/sounds/remove-request.wav';
import acceptedRequestSound from './assets/sounds/accepted-request.wav';
import arrivedSound from './assets/sounds/arrived.wav';
import RatingModal from './components/RatingModal';
import RequesterDetailsModal from './components/RequesterDetailsModal';
import SearchDropdown from './components/SearchDropdown';
import './App.css';

function MainAppContent() {
  const [isChatOpen, setChatOpen] = useState(false);
  const [showSearchUserModal, setShowSearchUserModal] = useState(false);
  const [isMessagesDrawerOpen, setIsMessagesDrawerOpen] = useState(false);
  const [showRequesterDetailsModal, setShowRequesterDetailsModal] = useState(false);
  const [selectedRequester, setSelectedRequester] = useState(null);
  const [chatRecipient, setChatRecipient] = useState(null);
  const [allChatMessages, setAllChatMessages] = useState({});
  const [chatInput, setChatInput] = useState('');
  const [unreadMessages, setUnreadMessages] = useState({});
  const audioContextRef = useRef(null);
  const audioBufferRef = useRef(null);
  const removeRequestAudioBufferRef = useRef(null);
  const acceptedRequestAudioBufferRef = useRef(null);
  const arrivedAudioBufferRef = useRef(null);
  const [selectedFilter, setSelectedFilter] = useState('all');
  const [selectedRadius, setSelectedRadius] = useState(5);
  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showAcceptedRequestModal, setShowAcceptedRequestModal] = useState(false);
  const [isArrivalConfirmationModalOpen, setArrivalConfirmationModalOpen] = useState(false);
  const [arrivalConfirmationData, setArrivalConfirmationData] = useState(null);
  const [showRatingModal, setShowRatingModal] = useState(false);
  const [userToRate, setUserToRate] = useState(null);
  const [acceptedRequestOwnerUsername, setAcceptedRequestOwnerUsername] = useState('');
  const [profileUserData, setProfileUserData] = useState(null);
  const [filteredParkingSpots, setFilteredParkingSpots] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
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
  const [pendingRequests, setPendingRequests] = useState([]);
  const [isPinDropMode, setPinDropMode] = useState(false);
  const [pinnedLocation, setPinnedLocation] = useState(null);
  const [showLeavingOverlay, setShowLeavingOverlay] = useState(false);
  const requesterEta = null;
  const [menuOpen, setMenuOpen] = useState(false);
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const dropdownRef = useRef(null);
  const navigate = useNavigate();
  const [spotRequests, setSpotRequests] = useState([]);
  const [isLogoAnimating, setIsLogoAnimating] = useState(false);
  const [hasDeclaredSpot, setHasDeclaredSpot] = useState(false);

  console.log('MainAppContent: After useState declarations.'); // NEW LOG HERE

  const socket = useRef(null);

  const formatTimestamp = (date) => {
    const year = date.getFullYear();
    const month = (date.getMonth() + 1).toString().padStart(2, '0');
    const day = date.getDate().toString().padStart(2, '0');
    const hours = date.getHours().toString().padStart(2, '0');
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const seconds = date.getSeconds().toString().padStart(2, '0');
    return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
  };

  const addNotification = useCallback((message, color = 'default') => {
    const timestamp = formatTimestamp(new Date());
    setNotificationLog(prevLog => [...prevLog, { id: Date.now(), timestamp, message, color }]);
  }, []);

  const handleLogout = useCallback(() => {
    if (socket.current && currentUserId) {
      socket.current.emit('unregister', currentUserId);
    }
    logout();
    navigate('/');
    setNotificationLog([]);
  }, [currentUserId, navigate, setNotificationLog]);

  const handleShowRequesterDetails = useCallback((requesterData) => {
    setSelectedRequester(requesterData);
    setShowRequesterDetailsModal(true);
  }, []);

  const currentUserIdRef = useRef(currentUserId);
  useEffect(() => {
    currentUserIdRef.current = currentUserId;
  }, [currentUserId]);

  const handleNewSpot = useCallback((newSpotFromServer) => {
    const formattedSpot = {
      id: newSpotFromServer.id,
      user_id: newSpotFromServer.user_id,
      username: newSpotFromServer.username,
      lat: parseFloat(newSpotFromServer.latitude),
      lng: parseFloat(newSpotFromServer.longitude),
      status: newSpotFromServer.cost_type === 'free' ? 'available' : 'occupied',
      time_to_leave: newSpotFromServer.time_to_leave,
      price: parseFloat(newSpotFromServer.price),
      comments: newSpotFromServer.comments || '',
      isExactLocation: newSpotFromServer.user_id === currentUserIdRef.current,
      is_free: newSpotFromServer.cost_type === 'free',
      declared_at: newSpotFromServer.declared_at,
      cost_type: newSpotFromServer.cost_type,
    };
    setFilteredParkingSpots(prevSpots => [...prevSpots, formattedSpot]);
  }, []);

  const handleSpotDeleted = useCallback((data) => {
    const spotIdToDelete = data?.spotId;
    if (spotIdToDelete) {
      const spotIdInt = parseInt(spotIdToDelete, 10);
      setFilteredParkingSpots(prevSpots => prevSpots.filter(spot => spot.id !== spotIdInt));
      emitter.emit('spotDeleted', data);
      const { ownerId, requesterIds } = data;
      const participants = [ownerId, ...(requesterIds || [])];
      if (requesterIds && requesterIds.includes(currentUserIdRef.current)) {
        setPendingRequests(prevRequests => prevRequests.filter(id => id !== spotIdInt));
        addNotification(`Spot #${spotIdToDelete} is no longer available.`, 'red');
      }
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
      if (chatRecipient && participants.includes(chatRecipient.id)) {
        setChatOpen(false);
        setChatRecipient(null);
      }
    }
  }, [chatRecipient, addNotification]);

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
    socket.current = io('http://localhost:3001');

    socket.current.on('connect', () => {
      console.log('Socket.IO client connected!'); // Re-added log
      if (currentUserId && currentUsername) {
        socket.current.emit('register', { userId: currentUserId, username: currentUsername });
      }
    });

    socket.current.on('disconnect', () => {
      console.log('Socket.IO client disconnected!'); // Re-added log
    });

    socket.current.on('connect_error', (error) => {
      console.error('Socket.IO connection error:', error); // Re-added log
    });

    socket.current.on('newParkingSpot', handleNewSpot);
    socket.current.on('spotDeleted', handleSpotDeleted);

    // All other listeners
    socket.current.on('spotUpdated', (updatedSpotFromServer) => {
      setFilteredParkingSpots(prevSpots =>
        prevSpots.map(spot =>
          spot.id === updatedSpotFromServer.id
            ? {
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
                isExactLocation: updatedSpotFromServer.user_id === currentUserId,
              }
            : spot
        )
      );
    });

    socket.current.on('spotRequest', (data) => {
      addNotification(data.message, 'blue');
      playSound();
      fetchPendingRequests();
      fetchSpotRequests(); // Call the new function
    });

    socket.current.on('requestResponse', (data) => {
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
      if (data.message.includes('DECLINED') || data.message.includes('CANCELLED')) {
        setPendingRequests(prevRequests => prevRequests.filter(id => id !== data.spotId));
      } else if (data.requestId) {
        if (data.message.includes('reactivated') || data.message.includes('ACCEPTED')) {
          setPendingRequests(prevRequests => [...prevRequests, data.spotId || data.spot.id]);
        }
      }
    });

    socket.current.on('requesterArrived', (data) => {
      const message = `User ${data.requesterUsername} has arrived at spot ${data.spotId}. Please confirm to complete the transaction.`;
      addNotification(message, 'default');
      playSoundArrived();
      setArrivalConfirmationData(data);
      setArrivalConfirmationModalOpen(true);
    });

    socket.current.on('requestCancelled', (data) => {
      const message = `User ${data.requesterUsername} has cancelled their request for your spot ${data.spotId}.`;
      addNotification(message, 'purple');
      playSoundRemoveRequest();
      setSpotRequests(prevRequests => prevRequests.filter(req => req.id !== data.requestId));
    });

    socket.current.on('transactionComplete', (data) => {
      fetchProfileData();
      if (data.ownerId && data.ownerUsername) {
        handleRateRequester({ requester_id: data.ownerId, requester_username: data.ownerUsername });
      }
    });

    socket.current.on('privateMessage', (message) => {
      const fromId = message.from;
      const messageWithTimestamp = { ...message, timestamp: message.created_at || new Date().toISOString() };
      setAllChatMessages(prev => ({ ...prev, [fromId]: [...(prev[fromId] || []), messageWithTimestamp] }));
      if (!isChatOpen || (chatRecipient && chatRecipient.id !== fromId)) {
        setUnreadMessages(prev => ({ ...prev, [fromId]: (prev[fromId] || 0) + 1 }));
      }
    });

    return () => {
      socket.current.disconnect();
    };
  }, []); // This effect runs only once on mount

  useEffect(() => {
    if (socket.current && currentUserId && currentUsername) {
      socket.current.emit('register', { userId: currentUserId, username: currentUsername });
    }
  }, [currentUserId, currentUsername]);


  useEffect(() => {
    sessionStorage.setItem('notificationLog', JSON.stringify(notificationLog));
  }, [notificationLog]);

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
    }, 1000);
    return () => clearInterval(interval);
  }, [filteredParkingSpots, expiredNotifiedSpots, addNotification]);

  const handleClickOutside = useCallback((event) => {
    if (dropdownRef.current && !dropdownRef.current.contains(event.target) && !event.target.closest('.hamburger-menu')) {
      setMenuOpen(false);
    }
  }, []);

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
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      const data = await response.json();
      setProfileUserData({
        ...data,
        total_arrival_time: parseFloat(data.total_arrival_time),
        completed_transactions_count: parseInt(data.completed_transactions_count, 10),
      });
    } catch (error) {
      console.error('Error fetching profile data:', error);
      setProfileUserData(null);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (currentUserId) {
      fetchProfileData();
    }
  }, [currentUserId, fetchProfileData]);

  const handleCarDetailsUpdated = useCallback(() => {
    const token = getToken();
    if (token) {
      try {
        const decodedToken = jwtDecode(token);
        setCurrentUserId(decodedToken.userId);
        setCurrentUsername(decodedToken.username);
        setCurrentUserCarType(decodedToken.carType);
        fetchProfileData();
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
        headers: { 'Authorization': `Bearer ${token}` }
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
      const response = await fetch(url, { headers: headers, cache: 'no-store' });
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
        isExactLocation: spot.user_id === currentUserId,
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
    const interval = setInterval(() => {
      const token = getToken();
      if (token && isTokenExpired(token)) {
        logout();
      }
    }, 60000);
    return () => clearInterval(interval);
  }, []);

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

  const handleConfirmArrival = () => {
    if (arrivalConfirmationData) {
      socket.current.emit('confirm-transaction', {
        spotId: arrivalConfirmationData.spotId,
        requesterId: arrivalConfirmationData.requesterId,
      });
      setArrivalConfirmationModalOpen(false);
      addNotification('Arrival confirmed!', 'green');
      handleRateRequester({ requester_id: arrivalConfirmationData.requesterId, requester_username: arrivalConfirmationData.requesterUsername });
      setArrivalConfirmationData(null);
    }
  };

  const handleCloseArrivalModal = () => {
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  const handleNotIdentified = () => {
    if (arrivalConfirmationData) {
      console.log(`Owner did not identify requester for spot ${arrivalConfirmationData.spotId}`);
      addNotification(`You have indicated that the requester was not identified.`, 'default');
    }
    setArrivalConfirmationModalOpen(false);
    setArrivalConfirmationData(null);
  };

  const handleRateRequester = useCallback((requester) => {
    setUserToRate(requester);
    setShowRatingModal(true);
  }, []);

  const handleRate = async (rating) => {
    if (!userToRate) return;
    try {
      const token = getToken();
      const response = await fetch(`http://localhost:3001/api/users/rate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ rated_user_id: userToRate.requester_id, rating }),
      });
      if (!response.ok) {
        throw new Error('Failed to submit rating');
      }
      addNotification('Rating submitted successfully!', 'green');
      setShowRatingModal(false);
      setUserToRate(null);
    } catch (error) {
      console.error('Error submitting rating:', error);
      addNotification('Failed to submit rating', 'red');
    }
  };

  const handleSendMessage = () => {
    if (chatInput.trim() && chatRecipient) {
      const newMessage = {
        from: currentUserId,
        to: chatRecipient.id,
        message: chatInput,
        timestamp: new Date().toISOString(),
      };
      socket.current.emit('privateMessage', newMessage);
      setAllChatMessages((prev) => ({ ...prev, [chatRecipient.id]: [...(prev[chatRecipient.id] || []), newMessage] }));
      setChatInput('');
    }
  };

  const clearUnreadMessages = (userId) => {
    setUnreadMessages((prev) => {
      const newUnread = { ...prev };
      delete newUnread[userId];
      return newUnread;
    });
  };

  const handleOpenChat = useCallback(async (recipient) => { // Make it async
    setChatRecipient(recipient);
    setChatOpen(true);
    setUnreadMessages((prev) => {
      const newUnread = { ...prev };
      delete newUnread[recipient.id];
      return newUnread;
    });

    // Fetch historical messages
    try {
      const token = getToken();
      const response = await fetch(`http://localhost:3001/api/messages/conversations/${recipient.id}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (response.ok) {
        const historicalMessages = await response.json();
        setAllChatMessages(prev => ({
          ...prev,
          [recipient.id]: historicalMessages.map(msg => ({
            ...msg,
            timestamp: msg.created_at // Use created_at from DB as timestamp
          }))
        }));
      } else {
        console.error('Failed to fetch historical messages:', response.statusText);
      }
    } catch (error) {
      console.error('Error fetching historical messages:', error);
    }
  }, []);

  const handleDeleteSpot = useCallback(async (spotId) => {
    try {
      const token = getToken();
      const response = await fetch(`http://localhost:3001/api/parkingspots/${spotId}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
      }
      addNotification(`Spot #${spotId} deleted successfully.`, 'green');
      setFilteredParkingSpots(prevSpots => prevSpots.filter(spot => spot.id !== spotId));
    } catch (error) {
      console.error('Error deleting spot:', error);
      addNotification(`Failed to delete spot: ${error.message}`, 'red');
    }
  }, [addNotification]);

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
  }, []);

  useEffect(() => {
    if (currentUserId && filteredParkingSpots.length > 0) {
      const userHasDeclaredSpot = filteredParkingSpots.some(spot => spot.user_id === currentUserId);
      setHasDeclaredSpot(userHasDeclaredSpot);
    } else {
      setHasDeclaredSpot(false);
    }
  }, [filteredParkingSpots, currentUserId]);

  const handleLogoClick = () => {
    setIsLogoAnimating(true);
    setTimeout(() => {
      setIsLogoAnimating(false);
    }, 1000);
  };

  return (
    <div className="App">
      <header className="App-header">
        <div className="logo-title-container">
          <img
            src={logo}
            className={`logo-img ${isLogoAnimating ? 'logo-animate' : ''}`}
            alt="Parksphere Logo"
            onClick={handleLogoClick}
          />
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
          <div className="hamburger-dropdown" ref={dropdownRef}>
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
          onAvatarClick={() => { setShowProfileModal(true); fetchProfileData(); }}
          showSearchUserModal={showSearchUserModal}
          setShowSearchUserModal={setShowSearchUserModal}
          setIsMessagesDrawerOpen={setIsMessagesDrawerOpen}
          unreadMessages={unreadMessages}
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
              spotRequests={spotRequests}
              onOpenChat={handleOpenChat}
              unreadMessages={unreadMessages}
              isPinDropMode={isPinDropMode}
              setPinDropMode={setPinDropMode}
              pinnedLocation={pinnedLocation}
              setPinnedLocation={setPinnedLocation}
              setShowLeavingOverlay={setShowLeavingOverlay}
              onRateRequester={handleRateRequester}
              isMessagesDrawerOpen={isMessagesDrawerOpen}
              setIsMessagesDrawerOpen={setIsMessagesDrawerOpen}
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
          pendingRequests={pendingRequests}
          hasDeclaredSpot={hasDeclaredSpot}
        />
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
      {currentUserId && (
        <MessagesSideDrawer
          isOpen={isMessagesDrawerOpen}
          onClose={() => setIsMessagesDrawerOpen(false)}
          allChatMessages={allChatMessages}
          unreadMessages={unreadMessages}
          currentUserId={currentUserId}
          clearUnreadMessages={clearUnreadMessages}
        />
      )}
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
      <>
        {showRatingModal && (
          <RatingModal
            isOpen={showRatingModal}
            onClose={() => setShowRatingModal(false)}
            requester={userToRate}
            onRate={handleRate}
          />
        )}
        {showSearchUserModal && (
          <SearchDropdown
            isOpen={showSearchUserModal}
            onClose={() => setShowSearchUserModal(false)}
            pendingRequests={pendingRequests}
            onUserSelect={handleShowRequesterDetails}
          />
        )}
        {showRequesterDetailsModal && selectedRequester && (
          <RequesterDetailsModal
            isOpen={showRequesterDetailsModal}
            onClose={() => setShowRequesterDetailsModal(false)}
            requester={selectedRequester}
          />
        )}
      </>
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
