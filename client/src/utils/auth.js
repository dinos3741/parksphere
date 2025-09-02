
import { jwtDecode } from 'jwt-decode';
import { emitter } from '../emitter';

export const getToken = () => {
  return localStorage.getItem('token');
};

export const setToken = (token) => {
  localStorage.setItem('token', token);
};

export const removeToken = () => {
  localStorage.removeItem('token');
};

export const isTokenExpired = (token) => {
  try {
    const decoded = jwtDecode(token);
    const currentTime = Date.now() / 1000;
    return decoded.exp < currentTime;
  } catch (error) {
    return true;
  }
};

export const logout = () => {
  removeToken();
  sessionStorage.removeItem('notificationLog'); // Clear notifications from session storage
  emitter.emit('clear-notifications'); // Emit event to clear notifications in UI
  // You might want to redirect the user to the login page here
  window.location.href = '/login';
};
