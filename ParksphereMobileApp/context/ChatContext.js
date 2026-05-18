import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';

const ChatContext = createContext();

export const useChat = () => {
  const context = useContext(ChatContext);
  if (!context) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};

export const ChatProvider = ({ children }) => {
  const [unreadConversations, setUnreadConversations] = useState({});
  const [totalUnreadMessagesCount, setTotalUnreadMessagesCount] = useState(0);
  const activeChatPartnerRef = useRef(null);

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

  const value = {
    unreadConversations,
    setUnreadConversations,
    totalUnreadMessagesCount,
    setTotalUnreadMessagesCount,
    activeChatPartnerRef,
    handleMarkAsRead,
    handleMarkAsUnread,
  };

  return (
    <ChatContext.Provider value={value}>
      {children}
    </ChatContext.Provider>
  );
};
