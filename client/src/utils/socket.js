import io from 'socket.io-client';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';
const socket = io(SERVER_URL);

export const register = (userId, username) => {
  socket.emit('register', { userId, username });
};

export const unregister = (userId) => {
  socket.emit('unregister', userId);
};

export default socket;