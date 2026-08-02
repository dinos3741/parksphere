import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ChatContext = createContext();

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

export const ChatProvider = ({ children, socket, userId, triggerNotification }) => {
  const [unreadConversations, setUnreadConversations] = useState({});
  const [totalUnreadMessagesCount, setTotalUnreadMessagesCount] = useState(0);
  const activeChatPartnerRef = useRef(null);

  useEffect(() => {
    if (socket && socket.current) {
      const s = socket.current;
      const onPrivateMessage = (message) => {
        if (message.to === userId && message.from !== userId) {
          triggerNotification(null, 'message');
          if (activeChatPartnerRef.current !== message.from) {
            handleMarkAsUnread(message.from);
          }
        }
      };

      s.on('privateMessage', onPrivateMessage);

      return () => {
        s.off('privateMessage', onPrivateMessage);
      };
    }
  }, [socket, userId, triggerNotification]);

  useEffect(() => {
    const currentTotalUnread = Object.keys(unreadConversations).length;
    setTotalUnreadMessagesCount(currentTotalUnread);
  }, [unreadConversations]);

  const handleMarkAsRead = useCallback((otherUserId) => {
    setUnreadConversations(prev => {
      const newState = { ...prev };
      if (newState[otherUserId]) {
        delete newState[otherUserId];
      }
      return newState;
    });
  }, []);

  const handleMarkAsUnread = useCallback((otherUserId) => {
    setUnreadConversations(prev => {
      return { ...prev, [otherUserId]: true };
    });
  }, []);

  // Opens a conversation with `user` from anywhere in the app — navigates to the Chat tab with
  // `route.params.recipient`, which ChatTab.js already watches for and opens directly. Takes the
  // caller's own `navigation` prop rather than holding one itself, since this context is mounted
  // above the navigator and has no navigation object of its own.
  const handleOpenChat = useCallback((navigation, user) => {
    if (!navigation || !user) return;
    handleMarkAsRead(user.id);
    navigation.navigate('Chat', {
      recipient: { id: user.id, username: user.username, avatar_url: user.avatar_url },
    });
  }, [handleMarkAsRead]);

  const value = {
    unreadConversations,
    setUnreadConversations,
    totalUnreadMessagesCount,
    setTotalUnreadMessagesCount,
    activeChatPartnerRef,
    handleMarkAsRead,
    handleMarkAsUnread,
    handleOpenChat,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};
