import React, { createContext, useState, useEffect, useContext, useCallback, useRef } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { apiRequest } from '../utils/apiService';
import { resetParkDetectionState, clearAuthKeys } from '../utils/dataReset';

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
  // True once at least one fetchUserData() attempt has failed to reach the server (network error,
  // not a real 401/403 rejection) while still waiting on the first successful profile fetch — lets
  // App.js show "can't reach the server" instead of an unexplained infinite spinner.
  const [profileFetchFailed, setProfileFetchFailed] = useState(false);

  // Kept in sync via the effect below, read from logout() — a ref (not a `userId` closure/dep) so
  // logout() itself can stay referentially stable (empty deps array; see its own comment for why
  // that stability matters — a 2026-08-02 infinite-fetch-loop bug from `logout` being recreated).
  const userIdRef = useRef(userId);
  useEffect(() => { userIdRef.current = userId; }, [userId]);

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
          // 2026-08-08: currentUser used to be plain in-memory state — always null on a cold start
          // regardless of how recently it was last fetched successfully, forcing every launch to
          // block on a live fetchUserData() round-trip before the app would render at all. Hydrating
          // from a cached copy here means a valid token can get you into the app immediately; a
          // stale/unreachable server just means the cached profile might be a bit out of date
          // (App.js shows a banner via profileFetchFailed), not a blocked launch.
          const cachedUser = await AsyncStorage.getItem('cachedCurrentUser');
          if (cachedUser) {
            try { setCurrentUser(JSON.parse(cachedUser)); } catch (e) { /* corrupt cache, ignore */ }
          }
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
          setProfileFetchFailed(false);
          await AsyncStorage.setItem('cachedCurrentUser', JSON.stringify(data));
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
        setProfileFetchFailed(true);
      }
    }
  }, [isLoggedIn, userId, token, serverUrl]);

  // Keeps retrying while stuck in "have a token, no profile yet" — complements the AppState
  // foreground retry below with a bounded interval so recovery doesn't require backgrounding and
  // refore-grounding the app by hand. Stops itself the moment currentUser lands.
  useEffect(() => {
    if (!isLoggedIn || currentUser) return;
    const interval = setInterval(() => { fetchUserData(); }, 5000);
    return () => clearInterval(interval);
  }, [isLoggedIn, currentUser, fetchUserData]);

  // 2026-08-07: fetchUserData() otherwise only ran once, at the isLoggedIn transition (App.js's
  // effect) — if that one attempt hit bad connectivity, currentUser stayed null for the rest of
  // the session with no way to recover short of a full relaunch, and (before the App.js render-gate
  // fix) looked exactly like being logged out even though the token itself was still perfectly
  // valid. Same fix, same reasoning, as SpotContext.js's fetchParkingSpots re-fetch-on-foreground.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') fetchUserData();
    });
    return () => sub.remove();
  }, [fetchUserData]);

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
        await AsyncStorage.setItem('cachedCurrentUser', JSON.stringify(updatedData));
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
  // 2026-08-04: the park-detection wipe used to run unconditionally on every logout (see logout()
  // below), including a routine session hiccup with no real account change — e.g. a lost/stale
  // token after a force-quit relaunch — destroying a live, legitimate parked-car geofence and
  // return-tracking state for no reason, even though the very next thing that happened was logging
  // right back into the SAME account. The wipe's actual purpose (2026-07-26: stop a Demo Login
  // session's native-owned spot from leaking into a real user's next session) only requires wiping
  // when the account is actually CHANGING — so that decision moves here, compared against whoever
  // logout() last recorded leaving. No recorded marker (e.g. this device's first-ever login) still
  // wipes, preserving the original safety net; only a confirmed SAME account skips it.
  const login = useCallback(async (data) => {
    const lastLoggedOutUserId = await AsyncStorage.getItem('lastLoggedOutUserId');
    if (lastLoggedOutUserId !== String(data.userId)) {
      await resetParkDetectionState();
    }
    await AsyncStorage.removeItem('lastLoggedOutUserId');

    setToken(data.token);
    setUserId(data.userId);
    setCurrentUsername(data.username);
    setIsLoggedIn(true);
    setProfileFetchFailed(false);
    await AsyncStorage.setItem('userToken', data.token);
    await AsyncStorage.setItem('userId', data.userId.toString());
    await AsyncStorage.setItem('username', data.username);
  }, []);

  // Only clears auth/app-preference keys now — the park-detection wipe is decided in login() above
  // (see its comment), based on whether the NEXT login is actually a different account from the
  // userId recorded here.
  const logout = useCallback(async () => {
    if (userIdRef.current != null) {
      await AsyncStorage.setItem('lastLoggedOutUserId', String(userIdRef.current));
    }
    setToken(null);
    setUserId(null);
    setCurrentUsername(null);
    setCurrentUser(null);
    setIsLoggedIn(false);
    setProfileFetchFailed(false);
    await clearAuthKeys();
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
        profileFetchFailed,
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
