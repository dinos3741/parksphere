import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Alert, Image } from 'react-native';

const ConversationScreen = ({ userId, token, onBack, otherUserId, socket, otherUsername, serverUrl, currentUser, onNewMessageReceived }) => { // Added onNewMessageReceived
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef(null);

  const getAvatarUri = (avatarUrl, username) => {
    if (!avatarUrl) return `https://i.pravatar.cc/150?u=${username}`;
    if (avatarUrl.startsWith('http')) {
      if (avatarUrl.includes('localhost')) return avatarUrl.replace('http://localhost:3001', serverUrl);
      return avatarUrl;
    }
    return `${serverUrl}${avatarUrl}`;
  };

  useEffect(() => {
    const fetchMessages = async () => {
      if (!token || !otherUserId) return;
      try {
        const response = await fetch(`${serverUrl}/api/messages/conversations/${otherUserId}`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        const data = await response.json();
        if (response.ok) {
          const formattedMessages = data.map(msg => ({
            id: msg.created_at + msg.sender_id,
            text: msg.message,
            senderId: msg.sender_id,
            senderUsername: msg.sender_username,
            avatar: getAvatarUri(msg.sender_avatar_url, msg.sender_username),
            createdAt: new Date(msg.created_at),
          }));
          setMessages(formattedMessages);
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
      }
    };
    fetchMessages();
  }, [otherUserId, token, serverUrl]);

  useEffect(() => {
    if (socket && socket.current) {
      const handleIncomingMessage = (message) => {
        if (message.from === otherUserId && message.to === userId) {
          setMessages((prev) => [...prev, {
            id: Date.now().toString(),
            text: message.message,
            senderId: message.from,
            senderUsername: otherUsername,
            avatar: getAvatarUri(null, otherUsername), // Avatar will be fetched via helper
            createdAt: new Date(),
          }]);
        }
      };

      socket.current.on('privateMessage', handleIncomingMessage);
      return () => {
        socket.current.off('privateMessage', handleIncomingMessage);
      };
    }
  }, [socket, otherUserId, userId, otherUsername]);

  const onSend = () => {
    if (!inputText.trim()) return;
    const message = { from: userId, to: otherUserId, message: inputText };
    if (socket && socket.current) { // Ensure socket.current is available
      socket.current.emit('privateMessage', message);
    }
    setMessages((prev) => [...prev, {
      id: Date.now().toString(),
      text: inputText,
      senderId: userId,
      senderUsername: currentUser?.username,
      avatar: getAvatarUri(currentUser?.avatar_url, currentUser?.username),
      createdAt: new Date(),
    }]);
    setInputText('');
  };

  const renderMessage = ({ item }) => {
    const isCurrentUser = item.senderId === userId;
    return (
      <View style={[styles.messageRow, isCurrentUser ? styles.myMessageRow : styles.otherMessageRow]}>
        {!isCurrentUser && <Image source={{ uri: item.avatar }} style={styles.avatar} />}
        <View style={[styles.bubble, isCurrentUser ? styles.myBubble : styles.otherBubble]}>
          <Text style={isCurrentUser ? styles.myText : styles.otherText}>{item.text}</Text>
        </View>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView 
      style={styles.fullContainer} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'padding'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 105 : 125}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}><Text style={styles.backButtonText}>{'< Back'}</Text></TouchableOpacity>
        <Text style={styles.headerTitle}>{otherUsername}</Text>
      </View>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })} // Added animated for smoother scrolling
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })} // Ensure scroll on initial layout
        contentContainerStyle={{ flexGrow: 1 }}
      />
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
        />
        <TouchableOpacity style={styles.sendButton} onPress={onSend}><Text style={styles.sendButtonText}>Send</Text></TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fullContainer: { flex: 1, backgroundColor: '#f0f0f0' },
  header: { flexDirection: 'row', alignItems: 'center', padding: 15, paddingTop: 10, backgroundColor: '#512da8' },
  backButtonText: { color: 'white', fontSize: 18 },
  headerTitle: { flex: 1, textAlign: 'center', color: 'white', fontSize: 20, fontWeight: 'bold' },
  messageRow: { flexDirection: 'row', margin: 10, alignItems: 'flex-end' },
  myMessageRow: { justifyContent: 'flex-end' },
  avatar: { width: 35, height: 35, borderRadius: 17.5, marginRight: 5 },
  bubble: { padding: 10, borderRadius: 15, maxWidth: '75%' },
  myBubble: { backgroundColor: '#512da8' },
  otherBubble: { backgroundColor: '#fff' },
  myText: { color: 'white' },
  otherText: { color: 'black' },
  inputContainer: { flexDirection: 'row', padding: 10, backgroundColor: '#fff', borderTopWidth: 1, borderTopColor: '#ddd' },
  input: { flex: 1, height: 40, borderWidth: 1, borderColor: '#ddd', borderRadius: 20, paddingHorizontal: 15 },
  sendButton: { marginLeft: 10, justifyContent: 'center', paddingHorizontal: 15, backgroundColor: '#512da8', borderRadius: 20 },
  sendButtonText: { color: 'white', fontWeight: 'bold' }
});

export default ConversationScreen;
