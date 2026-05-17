import { useRef, useEffect } from 'react';
import io from "socket.io-client";

export const useSocketConnection = (serverUrl, userId, currentUsername, isLoggedIn, token, onHandlersReady) => {
  const socket = useRef(null);

  useEffect(() => {
    if (isLoggedIn && token && userId && currentUsername) {
      if (!socket.current || !socket.current.connected) {
        const newSocket = io(serverUrl, { transports: ['websocket'] });
        socket.current = newSocket;

        newSocket.on('connect', () => {
          newSocket.emit('register', { userId, username: currentUsername });
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
