import React, { useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import ConversationsList from './ConversationsList';
import ConversationScreen from './ConversationScreen';

const ChatTab = ({ userId, token, socket, onBack, route, serverUrl, currentUser, setTotalUnreadMessagesCount }) => { // Added setTotalUnreadMessagesCount prop
  const [selectedOtherUserId, setSelectedOtherUserId] = useState(null);
  const [selectedOtherUsername, setSelectedOtherUsername] = useState(null);
  const [unreadConversations, setUnreadConversations] = useState({}); // State to manage unread conversations
  
  const selectedOtherUserIdRef = useRef(selectedOtherUserId); // Ref to track the latest selectedOtherUserId

  // Update ref whenever selectedOtherUserId changes
  useEffect(() => {
    selectedOtherUserIdRef.current = selectedOtherUserId;
  }, [selectedOtherUserId]);

  // Update total unread count whenever unreadConversations changes
  useEffect(() => {
    const currentTotalUnread = Object.keys(unreadConversations).length;
    // console.log('ChatTab: useEffect for unread count. Current unreadConversations state:', JSON.stringify(unreadConversations), 'Recalculated count:', currentTotalUnread); // Removed log
    setTotalUnreadMessagesCount(currentTotalUnread);
  }, [unreadConversations, setTotalUnreadMessagesCount]); // Depend only on unreadConversations and the setter

  useEffect(() => {
    if (route.params?.recipient) {
      // console.log('ChatTab: Route params recipient detected:', route.params.recipient.id); // Removed log
      setSelectedOtherUserId(route.params.recipient.id);
      setSelectedOtherUsername(route.params.recipient.username);
      // Mark this conversation as read if it's opened via route params
      handleMarkAsRead(route.params.recipient.id);
    }
  }, [route.params?.recipient]);

  // --- Socket Listener for incoming messages ---
  useEffect(() => {
    if (socket && socket.current) {
      const handleGlobalPrivateMessage = (message) => {
        // console.log('ChatTab: Entered handleGlobalPrivateMessage.'); // Removed log
        // Access the latest selectedOtherUserId from the ref
        const currentSelectedOtherUserId = selectedOtherUserIdRef.current;
        // console.log(`ChatTab: Global socket listener received message. From: ${message.from}, To: ${message.to}, CurrentUserId: ${userId}`); // Removed log
        
        // Ensure the message is for the current user and not from themselves
        if (message.to === userId && message.from !== userId) {
          // console.log(`ChatTab: Message is for me (${userId}) from someone else (${message.from}).`); // Removed log
          
          // Check if this message is from someone NOT in the currently viewed chat
          if (currentSelectedOtherUserId !== message.from) {
            // console.log(`ChatTab: Condition (currentSelectedOtherUserId !== message.from) is true. Calling handleMarkAsUnread for ${message.from}.`); // Removed log
            handleMarkAsUnread(message.from);
          } else {
            // console.log('ChatTab: Message received from current chat partner, not marking as unread globally.'); // Removed log
          }
        } else {
          // console.log(`ChatTab: Message not for me or from myself. From: ${message.from}, To: ${message.to}`); // Removed log
        }
      };

      socket.current.on('privateMessage', handleGlobalPrivateMessage);
      console.log('ChatTab: Set up socket listener for "privateMessage".'); // Keep this log for confirmation
      console.log('ChatTab: Listener attached. Handler reference should be valid.'); // Keep this log for confirmation

      return () => {
        socket.current.off('privateMessage', handleGlobalPrivateMessage);
        console.log('ChatTab: Cleaned up socket listener for "privateMessage".'); // Keep this log for confirmation
      };
    } else {
        console.log('ChatTab: Socket or socket.current is not valid, listener not set up.'); // Log if socket is not ready
    }
  }, [socket, userId, handleMarkAsUnread]); // Removed selectedOtherUserId from dependency array

  // Function to mark a specific conversation as read
  const handleMarkAsRead = useCallback((otherUserId) => { // Added useCallback
    console.log('ChatTab: Marking conversation as read for userId:', otherUserId);
    setUnreadConversations(prev => {
      const newState = { ...prev };
      if (newState[otherUserId]) {
        delete newState[otherUserId]; // Remove the entry to signify it's read
      }
      console.log('ChatTab: unreadConversations after marking as read:', JSON.stringify(newState));
      return newState;
    });
  }, []); // Added useCallback

  // Function to mark a specific conversation as unread
  const handleMarkAsUnread = useCallback((otherUserId) => { // Added useCallback
    console.log('ChatTab: Marking conversation as unread for userId:', otherUserId);
    setUnreadConversations(prev => {
      const newState = { ...prev, [otherUserId]: true }; // Mark as unread
      console.log('ChatTab: unreadConversations after marking as unread:', JSON.stringify(newState));
      return newState;
    });
  }, []); // Added useCallback

  const handleSelectConversation = useCallback((otherUserId, otherUsername) => { // Added useCallback
    console.log('ChatTab: Selecting conversation with userId:', otherUserId);
    handleMarkAsRead(otherUserId); // Mark as read when selected
    setSelectedOtherUserId(otherUserId);
    setSelectedOtherUsername(otherUsername);
  }, [handleMarkAsRead]); // Added handleMarkAsRead to dependency array

  const handleBackToConversations = useCallback(() => { // Added useCallback
    console.log('ChatTab: Navigating back to conversations.');
    setSelectedOtherUserId(null);
    setSelectedOtherUsername(null);
  }, []);

  // onNewMessageReceived handler is no longer needed in ChatTab for global unread logic,
  // as the global socket listener handles it directly.
  const handleNewMessageReceived = useCallback((fromUserId) => { 
    console.log('ChatTab: onNewMessageReceived callback was invoked (should not be used for global unread count now). FromUserId:', fromUserId);
  }, []); // Empty dependencies array as it's not strictly needed if not used.

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
          onNewMessageReceived={handleNewMessageReceived} // Pass down the handler (though not used for global unread logic anymore)
        />
      ) : (
        <ConversationsList
          userId={userId}
          token={token}
          onSelectConversation={handleSelectConversation}
          serverUrl={serverUrl}
          unreadConversations={unreadConversations} // Pass unread status down
          onMarkAsRead={handleMarkAsRead} // Pass handler to mark as read
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
