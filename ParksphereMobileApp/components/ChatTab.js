import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ConversationsList from './ConversationsList';
import ConversationScreen from './ConversationScreen';

const ChatTab = ({ userId, token, socket, onBack }) => {
  const [selectedOtherUserId, setSelectedOtherUserId] = useState(null);
  const [selectedOtherUsername, setSelectedOtherUsername] = useState(null);

  const handleSelectConversation = (otherUserId, otherUsername) => {
    setSelectedOtherUserId(otherUserId);
    setSelectedOtherUsername(otherUsername);
  };

  const handleBackToConversations = () => {
    setSelectedOtherUserId(null);
    setSelectedOtherUsername(null);
  };

  return (
    <View style={styles.container}>
      {selectedOtherUserId ? (
        <ConversationScreen
          userId={userId}
          token={token}
          onBack={handleBackToConversations}
          otherUserId={selectedOtherUserId}
          socket={socket}
          otherUsername={selectedOtherUsername} // Pass username to ConversationScreen
        />
      ) : (
        <ConversationsList
          userId={userId}
          token={token}
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
