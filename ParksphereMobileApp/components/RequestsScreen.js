import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import RequesterProfileModal from './RequesterProfileModal';

const RequestsScreen = ({ spotRequests, handleAcceptRequest, handleDeclineRequest, token, serverUrl }) => {
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
      const response = await fetch(`${serverUrl}/api/users/${requesterId}`, {
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
          <Text style={styles.requestText}>You have accepted the request from <Text style={styles.username}>{item.requesterUsername}</Text></Text>
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
      {isRequestAccepted && (
        <Text style={styles.text}>Request accepted</Text>
      )}
      {spotRequests.length > 0 ? (
        <FlatList
          data={spotRequests}
          renderItem={renderItem}
          keyExtractor={(item) => item.requestId.toString()}
        />
      ) : (
        <Text style={styles.text}>No pending requests</Text>
      )}
      {selectedUser && (
        <RequesterProfileModal
          user={selectedUser}
          visible={modalVisible}
          onClose={() => setModalVisible(false)}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  text: {
    fontSize: 20,
    textAlign: 'center',
    marginTop: 20,
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
