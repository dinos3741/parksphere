import React from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, TouchableWithoutFeedback } from 'react-native';

const LeavingModal = ({ visible, onClose, onCreateSpot }) => {
  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={onClose}>
        <View style={styles.centeredView}>
          <View style={styles.modalView} onStartShouldSetResponder={() => true}>
            <TouchableOpacity style={styles.closeButton} onPress={onClose}>
              <Text style={styles.closeButtonText}>X</Text>
            </TouchableOpacity>
            <Text style={styles.modalText}>Leaving in...</Text>
            <View style={styles.buttonContainer}>
              <View style={styles.rowContainer}>
                <TouchableOpacity style={styles.optionButton} onPress={() => onCreateSpot(1)}>
                  <Text style={styles.optionButtonText}>1 min</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionButton} onPress={() => onCreateSpot(2)}>
                  <Text style={styles.optionButtonText}>2 min</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionButton} onPress={() => onCreateSpot(5)}>
                  <Text style={styles.optionButtonText}>5 min</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.optionButton} onPress={() => onCreateSpot(10)}>
                  <Text style={styles.optionButtonText}>10 min</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
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
    backgroundColor: 'transparent',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 20,
    padding: 28,
    alignItems: 'flex-start',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 2,
    },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    width: '80%',
  },
  modalText: {
    marginBottom: 30,
    textAlign: 'center',
    fontSize: 18,
    fontWeight: 'bold',
  },
  buttonContainer: {
    width: '100%',
    marginBottom: 20,
  },
  rowContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    width: '100%',
    marginBottom: 10,
    alignSelf: 'center',
  },
  optionButton: {
    backgroundColor: '#87CEEB',
    borderRadius: 20,
    padding: 10,
    elevation: 2,
    minWidth: 60,
    alignItems: 'center',
    marginHorizontal: 5,
  },
  optionButtonText: {
    color: '#333',
    fontWeight: 'bold',
    textAlign: 'center',
    fontSize: 12.6,
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
  closeButtonText: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#888',
  },
});

export default LeavingModal;