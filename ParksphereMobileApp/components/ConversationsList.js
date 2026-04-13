import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert } from 'react-native';

const ConversationsList = ({ userId, token, onSelectConversation, serverUrl, unreadConversations, onMarkAsRead }) => {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    const fetchConversations = async () => {
      if (!token || !userId) {
        return;
      }
      try {
        const response = await fetch(`${serverUrl}/api/messages/conversations`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (response.ok) {
          // Augment data with unread status, defaulting to false if not provided by backend
          const conversationsWithUnreadStatus = data.map(convo => ({
            ...convo,
            isUnread: unreadConversations[convo.other_user_id] || false,
          }));
          setConversations(conversationsWithUnreadStatus);
        } else {
          Alert.alert('Error', data.message || 'Failed to fetch conversations.');
        }
      } catch (error) {
        console.error('Error fetching conversations:', error);
        Alert.alert('Error', 'Could not connect to the server to fetch conversations.');
      }
    };

    fetchConversations();
  }, [userId, token, serverUrl, unreadConversations]); // Re-fetch if unreadConversations changes to update the display

  const getAvatarUri = (avatarUrl, username) => {
    if (!avatarUrl) {
      return `https://i.pravatar.cc/150?u=${username}`;
    }

    if (avatarUrl.startsWith('http')) {
      if (avatarUrl.includes('localhost')) {
        return avatarUrl.replace('http://localhost:3001', serverUrl);
      }
      return avatarUrl;
    }

    return `${serverUrl}${avatarUrl}`;
  };

  const renderConversationItem = ({ item }) => (
    <TouchableOpacity 
      style={styles.conversationItem} 
      onPress={() => {
        onSelectConversation(item.other_user_id, item.other_username);
        onMarkAsRead(item.other_user_id); // Mark as read when selected
      }}
    >
      <Image source={{ uri: getAvatarUri(item.other_avatar_url, item.other_username) }} style={styles.avatar} />
      <View style={styles.conversationContent}>
        <Text style={styles.username}>{item.other_username}</Text>
        <Text style={styles.lastMessage} numberOfLines={1}>{item.message}</Text>
      </View>
      <View style={styles.rightContainer}>
        <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
        {item.isUnread && <View style={styles.unreadDot} />} 
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Messages</Text>
      <FlatList
        data={conversations}
        keyExtractor={(item) => item.other_user_id.toString()}
        renderItem={renderConversationItem}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  title: {
    fontSize: 19.2,
    fontWeight: 'bold',
    padding: 15,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  conversationItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#fff', // Added background for clarity
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  avatar: {
    width: 50,
    height: 50,
    borderRadius: 25,
    marginRight: 15,
  },
  conversationContent: {
    flex: 1,
    justifyContent: 'center',
  },
  username: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  lastMessage: {
    fontSize: 14,
    color: '#666',
  },
  rightContainer: {
    alignItems: 'flex-end',
  },
  timestamp: {
    fontSize: 12,
    color: '#999',
    marginBottom: 5,
  },
  unreadDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FF4136', // Red color for the dot
    marginTop: 5,
  },
});

export default ConversationsList;
