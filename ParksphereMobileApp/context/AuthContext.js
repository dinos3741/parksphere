import React, { createContext, useState, useEffect, useContext, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { resetAllAppData } from '../utils/dataReset';

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
          // Cache locally (no network needed to read it back) so the Login screen can offer an
          // offline mock-mode entry point on this device without requiring a live login first —
          // the whole point being to reach mock mode when there's no connectivity at all.
          if (data.role === 'admin') {
            await AsyncStorage.setItem('wasAdmin', 'true');
          }
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
      const response = await apiRequest(`${serverUrl}/api/users/rate`, {
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

  // Robust, shared avatar-URI builder (previously duplicated 4x + a naive version here). Handles:
  // no avatar → pravatar placeholder; a full http(s) URL (e.g. Google) as-is, rewriting a stale
  // localhost host to the current serverUrl; a relative /uploads/... path → prefixed with serverUrl.
  const getAvatarUri = (avatarPath, username) => {
    if (!avatarPath) return username ? `https://i.pravatar.cc/150?u=${username}` : null;
    if (avatarPath.startsWith('http')) {
      return avatarPath.includes('://localhost')
        ? avatarPath.replace(/http:\/\/localhost:3001/, serverUrl)
        : avatarPath;
    }
    return `${serverUrl}${avatarPath}`;
  };

  // The Login function
  // useCallback (both this and logout below): neither was memoized, so every AuthProvider re-render
  // handed out a fresh function reference. fetchParkingSpots (SpotContext.js) depends on `logout` in
  // its own useCallback deps, so that fresh reference cascaded into a fresh fetchParkingSpots every
  // render — which changed App.js's AppLayout effect's dependency array, re-firing
  // fetchUserData()/fetchParkingSpots() on every render, whose state updates caused the next
  // re-render, recreating `logout` again: an infinite fetch loop (2026-08-02 field report — the
  // console log showed "Fetching user data and spots..." repeating continuously). Both only close
  // over stable setters + module-level imports, so an empty dependency array is correct.
  const login = useCallback(async (data) => {
    setToken(data.token);
    setUserId(data.userId);
    setCurrentUsername(data.username);
    setIsLoggedIn(true);
    await AsyncStorage.setItem('userToken', data.token);
    await AsyncStorage.setItem('userId', data.userId.toString());
    await AsyncStorage.setItem('username', data.username);
  }, []);

  // Uses resetAllAppData() (not a plain AsyncStorage.multiRemove of just the auth keys) so a full
  // logout also clears park-detection state — otherwise a stale spot/geofence/parkedLocation from
  // THIS account survives into whoever logs in next (2026-07-26 incident: a Demo Login session's
  // native-owned spot leaked onto a real user's map as their own parked car).
  const logout = useCallback(async () => {
    setToken(null);
    setUserId(null);
    setCurrentUsername(null);
    setCurrentUser(null);
    setIsLoggedIn(false);
    await resetAllAppData();
  }, []);

  // A username change re-issues a JWT (its payload includes `username`), and the client needs to
  // start using it — car-details' own token re-issue is silently discarded today (a pre-existing
  // gap, not fixed here), but a stale username claim is more likely to actually bite, so this one is
  // persisted properly.
  const updateToken = useCallback(async (newToken) => {
    setToken(newToken);
    await AsyncStorage.setItem('userToken', newToken);
  }, []);

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
        updateToken,
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
