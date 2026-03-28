import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';

const SpotDetailsModal = ({ visible, spot, onClose, onRequestSpot, currentUserId, onDeleteSpot, onEditSpot, userLocation, acceptedSpot, arrivalConfirmed, onOpenChat, onConfirmArrival }) => {
  if (!spot) return null;

  const isOwner = String(currentUserId) === String(spot.user_id); // Ensure type consistency
  const isAccepted = acceptedSpot && spot.id === acceptedSpot.id;

  const handleUsernameClick = () => {
    onClose();
    onOpenChat({ id: spot.user_id, username: spot.username });
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
            <Text style={styles.modalText}>Spot Details</Text>
          <Text>Time to leave: {spot.time_to_leave} minutes</Text>
          <Text>Price: {spot.price} credits</Text>
          <Text>Car Type: {spot.declared_car_type}</Text>
          <Text>Comments: {spot.comments}</Text>

          {isAccepted && (
            <>
              <Text style={{fontWeight: 'bold', marginTop: 10}}>Owner Details:</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text>Username: </Text>
                <TouchableOpacity onPress={handleUsernameClick}>
                  <Text style={{ color: '#007AFF', textDecorationLine: 'underline' }}>{spot.username}</Text>
                </TouchableOpacity>
              </View>
              <Text>Car Color: {spot.car_color}</Text>
              <Text>Plate Number: {spot.plate_number}</Text>
            </>
          )}

          {!isOwner && !isAccepted && ( // Only show Request Spot button if not the owner and not accepted
            <TouchableOpacity
              style={{ ...styles.openButton, backgroundColor: '#2196F3' }}
              onPress={() => onRequestSpot(spot.id, userLocation.latitude, userLocation.longitude)}
            >
              <Text style={styles.textStyle}>Request Spot</Text>
            </TouchableOpacity>
          )}

          {isOwner && (
            <>
              <TouchableOpacity
                style={{ ...styles.openButton, backgroundColor: '#4CAF50' }} // Green color for Edit
                onPress={() => onEditSpot(spot)} // Call onEditSpot for owner
              >
                <Text style={styles.textStyle}>Edit Spot</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={{ ...styles.openButton, backgroundColor: '#f44336' }}
                onPress={() => onDeleteSpot(spot.id)} // Call onDeleteSpot for owner
              >
                <Text style={styles.textStyle}>Delete Spot</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
        {isAccepted && !arrivalConfirmed && (
          <TouchableOpacity 
            style={styles.fab} 
            onPress={onConfirmArrival}
          >
            <Text style={styles.fabTextArrived}>Arrived</Text>
          </TouchableOpacity>
        )}
      </View>
      </TouchableWithoutFeedback>
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
  fab: {
    position: 'absolute',
    width: 91,
    height: 91,
    borderRadius: 46,
    backgroundColor: '#9b59b6',
    justifyContent: 'center',
    alignItems: 'center',
    bottom: 170,
    alignSelf: 'center',
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
  },
  fabTextArrived: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default SpotDetailsModal;
