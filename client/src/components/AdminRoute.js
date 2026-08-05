import React from 'react';
import { Navigate } from 'react-router-dom';
import { getToken, isTokenExpired } from '../utils/auth';
import { useAuth } from '../context/AuthContext';

// Same token gate as ProtectedRoute.js, plus a role check — kept as its own component rather than
// a `allowedRoles` prop on ProtectedRoute since the redirect targets differ (non-admin lands on
// the regular dashboard, not the splash screen a logged-out user gets).
const AdminRoute = ({ children }) => {
  const { role } = useAuth();
  const token = getToken();

  if (!token || isTokenExpired(token)) {
    return <Navigate to="/" replace />;
  }
  if (role !== 'admin') {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
};

export default AdminRoute;
