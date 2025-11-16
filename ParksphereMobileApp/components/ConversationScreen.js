import React, { useState, useCallback, useEffect } from 'react';
import { GiftedChat } from 'react-native-gifted-chat';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';

const ConversationScreen = ({ userId, token, onBack, otherUserId, socket, otherUsername }) => {
  const [messages, setMessages] = useState([]);

  useEffect(() => {
    const fetchMessages = async () => {
      if (!token || !otherUserId) {
        return;
      }
      try {
        const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/messages/conversations/${otherUserId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (response.ok) {
          // GiftedChat expects messages in a specific format:
          // { _id, text, createdAt, user: { _id, name, avatar } }
          // Assuming your backend returns messages with sender_id, receiver_id, message, created_at
          const formattedMessages = data.map(msg => ({
            _id: msg.created_at + msg.sender_id, // Unique ID for the message
            text: msg.message,
            createdAt: new Date(msg.created_at),
            user: {
              _id: msg.sender_id, // The sender of the message
            },
          })).reverse(); // GiftedChat displays messages in reverse order (newest at bottom)
          setMessages(formattedMessages);
        } else {
          Alert.alert('Error', data.message || 'Failed to fetch messages.');
        }
      } catch (error) {
        console.error('Error fetching messages:', error);
        Alert.alert('Error', 'Could not connect to the server to fetch messages.');
      }
    };

    fetchMessages();
  }, [otherUserId, token]);

  const onSend = useCallback((messages = []) => {
    const { _id, text, user } = messages[0];
    const message = {
      from: userId,
      to: otherUserId,
      message: text,
    };
    socket.current.emit('privateMessage', message);
    setMessages((previousMessages) =>
      GiftedChat.append(previousMessages, messages)
    );
  }, []);

  useEffect(() => {
    if (socket.current) {
      const handlePrivateMessage = (message) => {
        // Only append if the message is for the current conversation
        if ((message.from === otherUserId && message.to === userId) || (message.from === userId && message.to === otherUserId)) {
          setMessages((previousMessages) =>
            GiftedChat.append(previousMessages, [
              {
                _id: message.created_at + message.from,
                text: message.message,
                createdAt: new Date(message.created_at),
                user: {
                  _id: message.from,
                },
              },
            ])
          );
        }
      };
      socket.current.on('privateMessage', handlePrivateMessage);
    }

    return () => {
      if (socket.current) {
        socket.current.off('privateMessage');
      }
    };
  }, [socket, userId, otherUserId]);

  return (
    <View style={styles.fullContainer}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>{'< Back'}</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{otherUsername}</Text>
      </View>
      <GiftedChat
        messages={messages}
        onSend={(messages) => onSend(messages)}
        user={{
          _id: userId,
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    fullContainer: {
        flex: 1,
        backgroundColor: '#f0f0f0',
    },
    header: {
        flexDirection: 'row',
        alignItems: 'center',
        padding: 10,
        paddingTop: 50,
        backgroundColor: '#512da8',
        borderBottomWidth: 1,
        borderBottomColor: '#ddd',
    },
    backButton: {
        paddingHorizontal: 10,
    },
    backButtonText: {
        color: 'white',
        fontSize: 18,
        fontWeight: 'bold',
    },
    headerTitle: {
        flex: 1,
        textAlign: 'center',
        color: 'white',
        fontSize: 20,
        fontWeight: 'bold',
        marginRight: 50, // Offset for the back button
    },
});

export default ConversationScreen;
