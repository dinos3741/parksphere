import React, { createContext, useContext, useState, useCallback } from 'react';
import { useAudioPlayer } from 'expo-audio';

const NotificationContext = createContext();

export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationProvider');
  }
  return context;
};

export const NotificationProvider = ({ children }) => {
  const [notifications, setNotifications] = useState([]);

  const newRequestPlayer = useAudioPlayer(require('../assets/sounds/new-request.wav'));
  const arrivedPlayer = useAudioPlayer(require('../assets/sounds/arrived.wav'));
  const messagePlayer = useAudioPlayer(require('../assets/sounds/message-sound.wav'));

  const addNotification = useCallback((msg) => {
    const timestamp = new Date().toLocaleTimeString();
    setNotifications((prevNotifications) => [...prevNotifications, { msg, timestamp }]);
  }, []);

  const triggerNotification = useCallback((message, type) => {
    if (message) {
      addNotification(message);
    }

    switch (type) {
      case 'newRequest':
        newRequestPlayer.play();
        break;
      case 'arrived':
        arrivedPlayer.play();
        break;
      case 'message':
        messagePlayer.play();
        break;
      default:
        // No specific sound triggered if type doesn't match
        break;
    }
  }, [addNotification, newRequestPlayer, arrivedPlayer, messagePlayer]);

  const value = {
    notifications,
    addNotification,
    triggerNotification,
    playSound: () => newRequestPlayer.play(),
    playSoundArrived: () => arrivedPlayer.play(),
    playSoundMessage: () => messagePlayer.play(),
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};
