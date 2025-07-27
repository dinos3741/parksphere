import React from 'react';
import { Navigate } from 'react-router-dom';

const ProtectedRoute = ({ children }) => {
  const token = localStorage.getItem('token');

  if (!token) {
    // User is not authenticated, redirect to the splash screen
    return <Navigate to="/" replace />;
  }

  return children;
};

export default ProtectedRoute;
