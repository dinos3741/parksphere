import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ConversationsList from './ConversationsList';
import ConversationScreen from './ConversationScreen';

import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';

const ChatTab = ({ socket, onBack, route }) => {
  const { userId, token, serverUrl, currentUser } = useAuth();
  const { 
    unreadConversations, 
    handleMarkAsRead, 
    activeChatPartnerRef 
  } = useChat();
  const [selectedOtherUserId, setSelectedOtherUserId] = useState(null);
  const [selectedOtherUsername, setSelectedOtherUsername] = useState(null);

  // Sync the active chat partner ref whenever selectedOtherUserId changes
  useEffect(() => {
    activeChatPartnerRef.current = selectedOtherUserId;
  }, [selectedOtherUserId, activeChatPartnerRef]);

  useEffect(() => {
    if (route.params?.recipient) {
      setSelectedOtherUserId(route.params.recipient.id);
      setSelectedOtherUsername(route.params.recipient.username);
      handleMarkAsRead(route.params.recipient.id);
    }
  }, [route.params?.recipient, handleMarkAsRead]);

  const handleSelectConversation = useCallback((otherUserId, otherUsername) => {
    handleMarkAsRead(otherUserId);
    setSelectedOtherUserId(otherUserId);
    setSelectedOtherUsername(otherUsername);
  }, [handleMarkAsRead]);

  const handleBackToConversations = useCallback(() => {
    setSelectedOtherUserId(null);
    setSelectedOtherUsername(null);
  }, []);

  const handleNewMessageReceived = useCallback((fromUserId) => { 
    // This could still be used if we want internal updates, 
    // but global state is handled in App.js now.
  }, []);

  return (
    <View style={styles.container}>
      {selectedOtherUserId ? (
        <ConversationScreen
          onBack={handleBackToConversations}
          otherUserId={selectedOtherUserId}
          socket={socket}
          otherUsername={selectedOtherUsername}
          onNewMessageReceived={handleNewMessageReceived}
        />
      ) : (
        <ConversationsList
          onSelectConversation={handleSelectConversation}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});

export default ChatTab;
