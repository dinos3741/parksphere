import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, Modal } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome'; // Import FontAwesome

const RequesterProfileModal = ({ user, visible, onClose }) => {
  if (!user) {
    return null;
  }

  return (
    <Modal
      animationType="fade" // Changed to fade for a smoother transition
      transparent={true} // Make the modal transparent to show the overlay
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <View style={styles.userDetailsContainer}>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <FontAwesome name="close" size={24} color="gray" />
          </TouchableOpacity>
          <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
          <Text style={styles.username}>{user.username}</Text>
          <Text>Member since: {new Date(user.created_at).toLocaleDateString()}</Text>
          <Text>Average Rating: {parseFloat(user.average_rating).toFixed(2) || 'Not rated yet'}</Text>
          <Text>Rank: Top {user.rank}%</Text>
          <Text>Car Type: {user.car_type}</Text>
          <Text>Spots Declared: {user.spots_declared}</Text>
          <Text>Spots Taken: {user.spots_taken}</Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)', // Dim the background
  },
  userDetailsContainer: {
    marginTop: 0, // Adjusted for modal
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    width: '90%', // Adjust width as needed
    maxWidth: 350, // Max width for larger screens
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
  },
  username: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 5,
  },
  profileLabel: {
    fontWeight: 'bold',
    marginRight: 5,
  },
  profileValue: {
    // No specific style for now, will inherit from Text
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
    padding: 5,
  },
});

export default RequesterProfileModal;
