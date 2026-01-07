import React from 'react';
import { Modal, View, Text, Button, StyleSheet } from 'react-native';

const ArrivalConfirmationModal = ({ isOpen, onClose, onConfirm, onNotIdentified, requesterUsername, spotId }) => {
  return (
    <Modal
      visible={isOpen}
      animationType="slide"
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
            <Button title="Confirm" onPress={onConfirm} />
            <Button title="Not Identified" onPress={onNotIdentified} color="red" />
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
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
  },
  modalText: {
    marginBottom: 15,
    textAlign: 'center',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
  },
});

export default ArrivalConfirmationModal;
