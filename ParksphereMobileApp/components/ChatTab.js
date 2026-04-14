import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ConversationsList from './ConversationsList';
import ConversationScreen from './ConversationScreen';

const ChatTab = ({ userId, token, socket, onBack, route, serverUrl, currentUser, setTotalUnreadMessagesCount, unreadConversations, onMarkAsRead, activeChatPartnerRef }) => {
  const [selectedOtherUserId, setSelectedOtherUserId] = useState(null);
  const [selectedOtherUsername, setSelectedOtherUsername] = useState(null);

  // Sync the active chat partner ref whenever selectedOtherUserId changes
  useEffect(() => {
    if (activeChatPartnerRef) {
      activeChatPartnerRef.current = selectedOtherUserId;
    }
  }, [selectedOtherUserId, activeChatPartnerRef]);

  useEffect(() => {
    if (route.params?.recipient) {
      setSelectedOtherUserId(route.params.recipient.id);
      setSelectedOtherUsername(route.params.recipient.username);
      if (onMarkAsRead) {
        onMarkAsRead(route.params.recipient.id);
      }
    }
  }, [route.params?.recipient, onMarkAsRead]);

  const handleSelectConversation = useCallback((otherUserId, otherUsername) => {
    if (onMarkAsRead) {
      onMarkAsRead(otherUserId);
    }
    setSelectedOtherUserId(otherUserId);
    setSelectedOtherUsername(otherUsername);
  }, [onMarkAsRead]);

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
          userId={userId}
          token={token}
          onBack={handleBackToConversations}
          otherUserId={selectedOtherUserId}
          socket={socket}
          otherUsername={selectedOtherUsername}
          serverUrl={serverUrl}
          currentUser={currentUser}
          onNewMessageReceived={handleNewMessageReceived}
        />
      ) : (
        <ConversationsList
          userId={userId}
          token={token}
          onSelectConversation={handleSelectConversation}
          serverUrl={serverUrl}
          unreadConversations={unreadConversations}
          onMarkAsRead={onMarkAsRead}
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
