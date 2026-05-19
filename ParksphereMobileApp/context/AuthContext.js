import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';

// 1. Create the Context
const AuthContext = createContext({});

// 2. Create the Provider Component
export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [userId, setUserId] = useState(null);
  const [currentUsername, setCurrentUsername] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [isLoading, setIsLoading] = useState(true); // To show a spinner while checking storage

  const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

  // Check AsyncStorage when the app boots
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
        }
      } catch (error) {
        console.error('Failed to load auth data', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadToken();
  }, []);

  const fetchUserData = useCallback(async () => {
    if (isLoggedIn && userId && token) {
      try {
        const response = await apiRequest(`${serverUrl}/api/users/${userId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          setCurrentUser(data);
        } else if (response.status === 401 || response.status === 403) {
          await logout();
        }
      } catch (error) {
        console.error('Error fetching user data:', error);
      }
    }
  }, [isLoggedIn, userId, token, serverUrl]);

  const rateUser = async (ratedUserId, rating) => {
    if (!token || !ratedUserId) return;
    try {
      const response = await fetch(`${serverUrl}/api/users/rate`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ rated_user_id: ratedUserId, rating }),
      });
      return response.ok;
    } catch (error) {
      console.error('Error submitting rating:', error);
      return false;
    }
  };

  const updateProfile = async (userData) => {
    if (!token || !userId) return;
    try {
      const response = await apiRequest(`${serverUrl}/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(userData),
      });
      if (response.ok) {
        const updatedData = await response.json();
        setCurrentUser(updatedData);
        return true;
      }
      return false;
    } catch (error) {
      console.error('Error updating profile:', error);
      return false;
    }
  };

  const getAvatarUri = (avatarPath) => {
    return avatarPath ? `${serverUrl}${avatarPath}` : null;
  };

  // The Login function
  const login = async (data) => {
    setToken(data.token);
    setUserId(data.userId);
    setCurrentUsername(data.username);
    setIsLoggedIn(true);
    await AsyncStorage.setItem('userToken', data.token);
    await AsyncStorage.setItem('userId', data.userId.toString());
    await AsyncStorage.setItem('username', data.username);
  };

  // The Logout function
  const logout = async () => {
    setToken(null);
    setUserId(null);
    setCurrentUsername(null);
    setCurrentUser(null);
    setIsLoggedIn(false);
    await AsyncStorage.multiRemove(['userToken', 'userId', 'username']);
  };

  // 3. Expose the data and functions
  return (
    <AuthContext.Provider 
      value={{ 
        token, 
        userId, 
        currentUsername, 
        currentUser, 
        setCurrentUser,
        isLoggedIn, 
        isLoading, 
        login, 
        logout,
        serverUrl,
        fetchUserData,
        rateUser,
        updateProfile,
        getAvatarUri
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// 4. Create a custom hook for easy access
export const useAuth = () => useContext(AuthContext);
