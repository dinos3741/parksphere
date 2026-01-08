import React from 'react';
import { Modal, View, Text, TouchableOpacity, StyleSheet, Dimensions } from 'react-native';

const { width } = Dimensions.get('window');

const ArrivalConfirmationModal = ({ isOpen, onClose, onConfirm, onNotIdentified, requesterUsername, spotId }) => {
  return (
    <Modal
      visible={isOpen}
      animationType="fade"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <Text style={styles.modalTitle}>Confirm Arrival</Text>
          <Text style={styles.modalText}>
            User {requesterUsername} has arrived at spot {spotId}. Please confirm to complete the transaction.
          </Text>
          <View style={styles.buttonContainer}>
            <TouchableOpacity style={styles.confirmButton} onPress={onConfirm}>
              <Text style={styles.confirmButtonText}>Confirm</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.notIdentifiedButton} onPress={onNotIdentified}>
              <Text style={styles.notIdentifiedButtonText}>Can't Confirm</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  centeredView: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.6)', // Darker overlay
  },
  modalView: {
    width: width * 0.75, // Approximately 20% smaller than default full width
    backgroundColor: 'white',
    borderRadius: 12, // Slightly less rounded for a modern look
    padding: 25, // Reduced padding
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4, // More pronounced shadow
    },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 22, // Slightly larger title
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#333', // Darker text for better contrast
  },
  modalText: {
    marginBottom: 20, // Increased spacing
    textAlign: 'center',
    fontSize: 16,
    color: '#555',
    lineHeight: 22,
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between', // Space out buttons
    width: '100%',
    marginTop: 10,
  },
  confirmButton: {
    backgroundColor: '#4CAF50', // Green for confirm
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    flex: 1, // Take equal space
    marginRight: 10, // Space between buttons
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
  notIdentifiedButton: {
    backgroundColor: '#F44336', // Red for not identified
    paddingVertical: 12,
    paddingHorizontal: 15,
    borderRadius: 8,
    flex: 1, // Take equal space
    marginLeft: 10, // Space between buttons
    alignItems: 'center',
    justifyContent: 'center',
  },
  notIdentifiedButtonText: {
    color: 'white',
    fontSize: 16,
    fontWeight: 'bold',
  },
});

export default ArrivalConfirmationModal;
