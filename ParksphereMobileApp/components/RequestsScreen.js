import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import RequesterProfileModal from './RequesterProfileModal';

import { useAuth } from '../context/AuthContext';
import { useSpots } from '../context/SpotContext';
import { useChat } from '../context/ChatContext';
import { apiRequest } from '../utils/apiService';

const RequestsScreen = ({ navigation }) => {
  const { token, serverUrl } = useAuth();
  const { spotRequests, handleAcceptRequest, handleDeclineRequest } = useSpots();
  const { handleOpenChat } = useChat();
  const [modalVisible, setModalVisible] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [isRequestAccepted, setIsRequestAccepted] = useState(false);

  useEffect(() => {
    // If there's only one request and it's the accepted one
    if (spotRequests.length === 1 && spotRequests[0].isAccepted) {
      setIsRequestAccepted(true);
    } else {
      setIsRequestAccepted(false);
    }
  }, [spotRequests]);

  const handleUserPress = async (requesterId) => {
    try {
      const response = await apiRequest(`${serverUrl}/api/users/${requesterId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setSelectedUser(data);
        setModalVisible(true);
      } else {
        Alert.alert('Error', 'Failed to fetch user data.');
      }
    } catch (error) {
      Alert.alert('Error', 'Could not connect to the server.');
    }
  };

  const onAccept = (item) => {
    handleAcceptRequest({ ...item, isAccepted: true });
    setIsRequestAccepted(true);
  };

  const renderItem = ({ item }) => {
    if (isRequestAccepted) {
      return (
        <View style={styles.requestItem}>
          <TouchableOpacity onPress={() => handleUserPress(item.requesterId)}>
            <Text style={styles.requestText}>You have accepted the request from <Text style={styles.username}>{item.requesterUsername}</Text></Text>
          </TouchableOpacity>
        </View>
      );
    }

    return (
      <View style={styles.requestItem}>
        <TouchableOpacity onPress={() => handleUserPress(item.requesterId)}>
          <Text style={styles.requestText}><Text style={styles.username}>{item.requesterUsername}</Text> has requested your spot</Text>
        </TouchableOpacity>
        <View style={styles.buttonContainer}>
          <TouchableOpacity onPress={() => onAccept(item)} style={[styles.button, styles.acceptButton]}>
            <FontAwesome name="check" size={20} color="white" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => handleDeclineRequest(item)} style={[styles.button, styles.declineButton]}>
            <FontAwesome name="times" size={20} color="white" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <FlatList
        data={spotRequests}
        renderItem={renderItem}
        keyExtractor={(item) => item.requestId.toString()}
        // "Requests" lives here (not as a fixed sibling above the list) so the FlatList's own box
        // spans the full screen, including behind the floating header — matches the same pattern
        // used for "Messages" in ConversationsList.js.
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Requests</Text>
            {isRequestAccepted && <Text style={styles.acceptedText}>Request accepted</Text>}
          </>
        }
        ListEmptyComponent={<Text style={styles.emptyText}>No pending requests</Text>}
        contentContainerStyle={styles.listContent}
      />
      {selectedUser && (
        <RequesterProfileModal
          user={selectedUser}
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
          onOpenChat={(user) => handleOpenChat(navigation, user)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
    // No top padding here on purpose — it needs to be on the actual scrollable content (the
    // FlatList's contentContainerStyle below), not the outer container, so content can scroll up
    // underneath the floating header and actually show through the blur, the way Home's map does.
    // Padding on this non-scrolling container would just be permanent dead space instead.
  },
  title: {
    fontSize: 19,
    fontWeight: '600',
    color: '#222',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 12,
  },
  acceptedText: {
    fontSize: 15,
    color: '#666',
    textAlign: 'center',
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  emptyText: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginTop: 40,
  },
  listContent: {
    paddingTop: 110, // lets the list scroll up underneath the floating header
  },
  requestItem: {
    backgroundColor: 'white',
    padding: 15,
    marginVertical: 8,
    marginHorizontal: 16,
    borderRadius: 10,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  requestText: {
    fontSize: 16,
  },
  username: {
    fontWeight: 'bold',
  },
  buttonContainer: {
    flexDirection: 'row',
  },
  button: {
    padding: 10,
    borderRadius: 5,
    marginLeft: 10,
  },
  acceptButton: {
    backgroundColor: 'green',
  },
  declineButton: {
    backgroundColor: 'red',
  },
});

export default RequestsScreen;
