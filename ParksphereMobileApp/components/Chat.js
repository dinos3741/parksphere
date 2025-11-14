import React, { useState, useCallback, useEffect } from 'react';
import { GiftedChat } from 'react-native-gifted-chat';
import { View, Text, StyleSheet, TouchableOpacity, Alert } from 'react-native';

const Chat = ({ userId, token, onBack, otherUserId, socket }) => {
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
          setMessages(data);
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
      socket.current.on('privateMessage', (message) => {
        setMessages((previousMessages) =>
          GiftedChat.append(previousMessages, [
            {
              _id: message.from + Date.now(),
              text: message.message,
              createdAt: new Date(),
              user: {
                _id: message.from,
              },
            },
          ])
        );
      });
    }

    return () => {
      if (socket.current) {
        socket.current.off('privateMessage');
      }
    };
  }, [socket]);

  return (
    <View style={styles.container}>
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
});

export default Chat;
