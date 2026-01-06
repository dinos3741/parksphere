import React from 'react';
import { View, Text, StyleSheet, FlatList, TouchableOpacity } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

const RequestsScreen = ({ spotRequests, handleAcceptRequest, handleDeclineRequest }) => {
  const renderItem = ({ item }) => (
    <View style={styles.requestItem}>
      <Text style={styles.requestText}>{item.requesterUsername} has requested your spot</Text>
      <View style={styles.buttonContainer}>
        <TouchableOpacity onPress={() => handleAcceptRequest(item)} style={[styles.button, styles.acceptButton]}>
          <FontAwesome name="check" size={20} color="white" />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => handleDeclineRequest(item)} style={[styles.button, styles.declineButton]}>
          <FontAwesome name="times" size={20} color="white" />
        </TouchableOpacity>
      </View>
    </View>
  );

  return (
    <View style={styles.container}>
      {spotRequests.length > 0 ? (
        <FlatList
          data={spotRequests}
          renderItem={renderItem}
          keyExtractor={(item) => item.requestId.toString()}
        />
      ) : (
        <Text style={styles.text}>No pending requests</Text>
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