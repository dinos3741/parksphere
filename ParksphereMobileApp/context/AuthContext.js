import React, { createContext, useState, useEffect, useContext } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
          // Note: You would also fetch the full currentUser profile from the API here
        }
      } catch (error) {
        console.error('Failed to load auth data', error);
      } finally {
        setIsLoading(false);
      }
    };
    loadToken();
  }, []);

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

  const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

  // 3. Expose the data and functions
  return (
    <AuthContext.Provider 
      value={{ 
        token, 
        userId, 
        currentUsername, 
        currentUser, 
        setCurrentUser, // Added to allow updating user profile from other components
        isLoggedIn, 
        isLoading, 
        login, 
        logout,
        serverUrl
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

// 4. Create a custom hook for easy access
export const useAuth = () => useContext(AuthContext);
