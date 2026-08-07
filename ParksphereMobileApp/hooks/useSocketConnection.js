import { useRef, useEffect } from 'react';
import io from "socket.io-client";

export const useSocketConnection = (serverUrl, userId, currentUsername, isLoggedIn, token, onHandlersReady) => {
  const socket = useRef(null);

  useEffect(() => {
    if (isLoggedIn && token && userId && currentUsername) {
      if (!socket.current || !socket.current.connected) {
        // 2026-08-08: the server now requires a verified token at handshake time (io.use on the
        // server) instead of trusting whatever userId a 'register' payload claims — auth: { token }
        // is how socket.io-client actually sends it (read server-side via socket.handshake.auth).
        const newSocket = io(serverUrl, { transports: ['websocket'], auth: { token } });
        socket.current = newSocket;

        newSocket.on('connect', () => {
          newSocket.emit('register', { username: currentUsername });
        });

        if (onHandlersReady) {
          onHandlersReady(newSocket);
        }
      }
    } else {
      if (socket.current) {
        socket.current.disconnect();
        socket.current = null;
      }
    }

    return () => {
      if (socket.current) {
        socket.current.disconnect();
        socket.current = null;
      }
    };
  }, [isLoggedIn, token, userId, currentUsername, serverUrl]);

  return socket;
};
