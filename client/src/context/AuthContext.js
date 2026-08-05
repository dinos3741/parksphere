import React, { createContext, useContext } from 'react';
import { useLocation } from 'react-router-dom';
import { jwtDecode } from 'jwt-decode';
import { getToken, isTokenExpired } from '../utils/auth';

// Mirrors ParksphereMobileApp/context/AuthContext.js's role — kept minimal here (no fetchUserData/
// login/logout, those still live in App.js's existing state) since the only thing new admin-only
// UI (AdminRoute, the Ops Center nav entry, OpsMap) needs is `role`, which the JWT already carries
// (server/index.js's /api/login, :1702-1714) but nothing in this client ever decoded before.
const AuthContext = createContext({ userId: null, username: null, role: null });

export const AuthProvider = ({ children }) => {
  // Subscribing to useLocation (value unused otherwise) is what makes this re-render — and so
  // re-decode the token below — on every navigation, not just once at mount. Needed because
  // Login.js:55 does a client-side navigate('/dashboard') right after setting the token, with no
  // page reload; without this, AuthProvider would stay stuck on the pre-login value. Requires
  // AuthProvider to render inside <Router> (see App.js).
  useLocation();

  const token = getToken();
  let value = { userId: null, username: null, role: null };
  if (token && !isTokenExpired(token)) {
    try {
      const decoded = jwtDecode(token);
      value = { userId: decoded.userId, username: decoded.username, role: decoded.role || 'user' };
    } catch (error) {
      // value stays the logged-out default
    }
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export const useAuth = () => useContext(AuthContext);
