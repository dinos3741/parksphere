import React from 'react';
import { Navigate } from 'react-router-dom';
import { getToken, isTokenExpired } from '../utils/auth';

const ProtectedRoute = ({ children }) => {
  const token = getToken();

  if (!token || isTokenExpired(token)) {
    // User is not authenticated, redirect to the splash screen
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
