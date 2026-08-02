import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, FlatList, TextInput, KeyboardAvoidingView, Platform, Keyboard, Image } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';

import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../utils/apiService';

// Top of the floating tab bar sits at bottom:20 + height:58 = 78pt from the screen edge (see
// RootNavigator.js) — the input bar needs at least that much clearance when the keyboard is
// closed, or the tab bar covers it. Only applied while the keyboard is hidden (tracked below),
// since KeyboardAvoidingView's own padding already lifts the bar clear of an open keyboard, and
// stacking both would leave an ugly gap above the keyboard.
const TAB_BAR_CLEARANCE = 90;

const ConversationScreen = ({ onBack, otherUserId, socket, otherUsername, otherUserAvatarUrl, onNewMessageReceived }) => {
  const { userId, token, serverUrl, currentUser } = useAuth();
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [isKeyboardVisible, setIsKeyboardVisible] = useState(false);
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
    const showSub = Keyboard.addListener('keyboardDidShow', () => setIsKeyboardVisible(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setIsKeyboardVisible(false));
    return () => { showSub.remove(); hideSub.remove(); };
  }, []);

  useEffect(() => {
    const fetchMessages = async () => {
      if (!token || !otherUserId) return;
      try {
        const response = await apiRequest(`${serverUrl}/api/messages/conversations/${otherUserId}`, {
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
            avatar: getAvatarUri(otherUserAvatarUrl, otherUsername),
            createdAt: new Date(),
          }]);
        }
      };

      socket.current.on('privateMessage', handleIncomingMessage);
      return () => {
        socket.current.off('privateMessage', handleIncomingMessage);
      };
    }
  }, [socket, otherUserId, userId, otherUsername, otherUserAvatarUrl]);

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
      // This screen's own container actually starts at the true top of the screen — the floating
      // Venio header (RootNavigator.js) is a pure position:'absolute' overlay, not an in-flow
      // header pushing this content down (Tab.Navigator has headerShown:false, no
      // sceneContainerStyle offset). A nonzero offset here was telling KeyboardAvoidingView there
      // was space above it that didn't need padding, which overcompensated and left a gap between
      // the input bar and the keyboard.
      keyboardVerticalOffset={0}
    >
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="chevron-back" size={26} color="#512da8" />
        </TouchableOpacity>
        <Image source={{ uri: getAvatarUri(otherUserAvatarUrl, otherUsername) }} style={styles.headerAvatar} />
        <Text style={styles.headerTitle}>{otherUsername}</Text>
      </View>
      <FlatList
        ref={flatListRef}
        data={messages}
        renderItem={renderMessage}
        keyExtractor={(item) => item.id}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd({ animated: true })} // Added animated for smoother scrolling
        onLayout={() => flatListRef.current?.scrollToEnd({ animated: true })} // Ensure scroll on initial layout
        contentContainerStyle={styles.messageListContent}
      />
      <View style={[styles.inputContainer, !isKeyboardVisible && { marginBottom: TAB_BAR_CLEARANCE }]}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder="Type a message..."
          placeholderTextColor="#999"
        />
        <TouchableOpacity
          style={[styles.sendButton, !inputText.trim() && styles.sendButtonDisabled]}
          onPress={onSend}
          disabled={!inputText.trim()}
        >
          <Ionicons name="arrow-up" size={20} color="#fff" />
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  fullContainer: { flex: 1, backgroundColor: '#f7f6fa' },
  // marginTop clears the app-wide floating header (RootNavigator.js) — this screen has its own
  // in-thread header underneath it, so unlike a plain list, there's no sense in trying to
  // scroll messages through both header layers; this one just needs to sit below the outer one.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 110,
    backgroundColor: '#fff',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e6',
  },
  backButton: {
    width: 34,
    height: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerAvatar: {
    width: 32,
    height: 32,
    borderRadius: 16,
    marginLeft: 2,
    marginRight: 8,
  },
  headerTitle: { fontSize: 17, fontWeight: '700', color: '#222' },
  messageListContent: { flexGrow: 1, paddingVertical: 8 },
  messageRow: { flexDirection: 'row', marginHorizontal: 12, marginVertical: 4, alignItems: 'flex-end' },
  myMessageRow: { justifyContent: 'flex-end' },
  avatar: { width: 30, height: 30, borderRadius: 15, marginRight: 6 },
  bubble: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
    maxWidth: '75%',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 2,
    elevation: 1,
  },
  myBubble: { backgroundColor: '#512da8', borderBottomRightRadius: 6 },
  otherBubble: { backgroundColor: '#fff', borderBottomLeftRadius: 6 },
  myText: { color: 'white', fontSize: 15.5 },
  otherText: { color: '#222', fontSize: 15.5 },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#e2e2e6',
  },
  input: {
    flex: 1,
    height: 42,
    backgroundColor: '#f0f0f4',
    borderRadius: 21,
    paddingHorizontal: 16,
    fontSize: 15.5,
    color: '#222',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 8,
    backgroundColor: '#512da8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sendButtonDisabled: {
    backgroundColor: '#c7bfe0',
  },
});

export default ConversationScreen;
