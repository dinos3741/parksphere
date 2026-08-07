import io from 'socket.io-client';
import { getToken } from './auth';

const SERVER_URL = process.env.REACT_APP_SERVER_URL || 'http://localhost:3001';
// 2026-08-08: the server now requires a verified token at handshake time (io.use on the server)
// instead of trusting whatever userId a 'register' payload claims. This module connects at import
// time — before login — so a static { token } would freeze in whatever (likely absent) token
// existed at that moment. auth as a function is re-evaluated on every (re)connection attempt,
// including socket.io-client's automatic retries, so it picks up the real token once one exists.
const socket = io(SERVER_URL, { auth: (cb) => cb({ token: getToken() }) });

export const register = (userId, username) => {
  console.log(`Web App: Emitting register event for userId: ${userId}, username: ${username}`);
  // A fresh login likely already burned through the initial (pre-token) connection attempt, which
  // io.use on the server would have rejected — force a reconnect now instead of waiting on
  // socket.io-client's backoff timer, so the auth function above gets a chance to pick up the
  // token immediately rather than after a delay.
  if (!socket.connected) socket.connect();
  socket.emit('register', { username });
};

export const unregister = (userId) => {
  socket.emit('unregister', userId);
};

export default socket;