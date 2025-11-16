import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Image, Alert } from 'react-native';

const ConversationsList = ({ userId, token, onSelectConversation }) => {
  const [conversations, setConversations] = useState([]);
  const serverUrl = `http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001`;

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
          setConversations(data);
        } else {
          Alert.alert('Error', data.message || 'Failed to fetch conversations.');
        }
      } catch (error) {
        console.error('Error fetching conversations:', error);
        Alert.alert('Error', 'Could not connect to the server to fetch conversations.');
      }
    };

    fetchConversations();
  }, [userId, token]);

  const renderConversationItem = ({ item }) => (
    <TouchableOpacity style={styles.conversationItem} onPress={() => onSelectConversation(item.other_user_id, item.other_username)}>
      <Image source={{ uri: item.other_avatar_url }} style={styles.avatar} />
      <View style={styles.conversationContent}>
        <Text style={styles.username}>{item.other_username}</Text>
        <Text style={styles.lastMessage} numberOfLines={1}>{item.message}</Text>
      </View>
      <Text style={styles.timestamp}>{new Date(item.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</Text>
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
  timestamp: {
    fontSize: 12,
    color: '#999',
  },
});

export default ConversationsList;
