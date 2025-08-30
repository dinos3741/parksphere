import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity } from 'react-native';

const SpotDetailsModal = ({ visible, spot, onClose, onRequestSpot }) => {
  if (!spot) return null;

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <View style={styles.centeredView}>
        <View style={styles.modalView}>
          <Text style={styles.modalText}>Spot Details</Text>
          <Text>Time to leave: {spot.time_to_leave} minutes</Text>
          <Text>Price: {spot.price} credits</Text>
          <Text>Car Type: {spot.declared_car_type}</Text>
          <Text>Comments: {spot.comments}</Text>

          <TouchableOpacity
            style={{ ...styles.openButton, backgroundColor: '#2196F3' }}
            onPress={() => onRequestSpot(spot.id)}
          >
            <Text style={styles.textStyle}>Request Spot</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={{ ...styles.openButton, backgroundColor: '#f44336' }}
            onPress={onClose}
          >
            <Text style={styles.textStyle}>Close</Text>
          </TouchableOpacity>
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
    marginTop: 22,
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
  openButton: {
    backgroundColor: '#F194FF',
    borderRadius: 20,
    padding: 10,
    elevation: 2,
    marginTop: 10,
    width: 150,
  },
  textStyle: {
    color: 'white',
    fontWeight: 'bold',
    textAlign: 'center',
  },
  modalText: {
    marginBottom: 15,
    textAlign: 'center',
    fontWeight: 'bold',
    fontSize: 20,
  },
});

export default SpotDetailsModal;
