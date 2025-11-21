import React, { useState, useEffect } from 'react';
import { Modal, View, Text, TextInput, TouchableOpacity, StyleSheet, Dimensions, Keyboard, TouchableWithoutFeedback } from 'react-native';
import { Picker } from '@react-native-picker/picker';

const { width } = Dimensions.get('window');

const EditSpotMobileModal = ({ visible, onClose, spotData, onSave }) => {
  const [timeToLeave, setTimeToLeave] = useState(String(spotData?.time_to_leave || ''));
  const [costType, setCostType] = useState(spotData?.cost_type || 'free');
  const [comments, setComments] = useState(spotData?.comments || '');

  useEffect(() => {
    if (spotData) {
      setTimeToLeave(String(spotData.time_to_leave));
      setCostType(spotData.cost_type);
      setComments(spotData.comments);
    }
  }, [spotData]);

  const handleSave = () => {
    const parsedTimeToLeave = parseInt(timeToLeave, 10);
    if (isNaN(parsedTimeToLeave) || parsedTimeToLeave < 1) {
      alert("Please enter a valid number of minutes to leave (at least 1).");
      return;
    }

    onSave(spotData.id, {
      timeToLeave: parsedTimeToLeave,
      costType,
      comments,
    });
    onClose();
  };

  return (
    <Modal
      animationType="slide"
      transparent={true}
      visible={visible}
      onRequestClose={onClose}
    >
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.centeredView}>
          <View style={styles.modalView}>
          <Text style={styles.modalTitle}>Update Parking Spot</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Time to leave (minutes):</Text>
            <TextInput
              style={styles.input}
              keyboardType="numeric"
              value={timeToLeave}
              onChangeText={setTimeToLeave}
              placeholder="e.g., 10"
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Cost Type:</Text>
            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  costType === 'free' && styles.toggleButtonActive,
                ]}
                onPress={() => setCostType('free')}
              >
                <Text style={[styles.toggleButtonText, costType === 'free' && styles.toggleButtonTextActive]}>Free</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleButton,
                  costType === 'paid' && styles.toggleButtonActive,
                ]}
                onPress={() => setCostType('paid')}
              >
                <Text style={[styles.toggleButtonText, costType === 'paid' && styles.toggleButtonTextActive]}>Paid</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Comments (optional):</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              multiline
              numberOfLines={4}
              value={comments}
              onChangeText={setComments}
              placeholder="e.g., Spot is suitable for small cars only"
            />
          </View>

          <View style={styles.buttonContainer}>
            <TouchableOpacity style={[styles.button, styles.saveButton]} onPress={handleSave}>
              <Text style={styles.buttonText}>Update Spot</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.button, styles.cancelButton]} onPress={onClose}>
              <Text style={styles.buttonText}>Cancel</Text>
            </TouchableOpacity>
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
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
  },
  modalView: {
    margin: 20,
    backgroundColor: 'white',
    borderRadius: 25,
    padding: 35,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: {
      width: 0,
      height: 4,
    },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    width: width * 0.9, // 90% of screen width
  },
  modalTitle: {
    marginBottom: 20,
    textAlign: 'center',
    fontSize: 22,
    fontWeight: 'bold',
    color: '#333',
  },
  inputGroup: {
    width: '100%',
    marginBottom: 15,
  },
  label: {
    fontSize: 16,
    color: '#333',
    marginBottom: 5,
    fontWeight: 'bold',
  },
  input: {
    width: '100%',
    // borderWidth: 1, // Removed border
    // borderColor: '#ddd', // Removed border
    borderRadius: 10,
    padding: 10,
    fontSize: 16,
    backgroundColor: '#f9f9f9',
    shadowColor: '#000', // Subtle shadow
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  textArea: {
    height: 100,
    textAlignVertical: 'top', // For Android
  },
  picker: {
    width: '100%',
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 10,
    backgroundColor: '#f9f9f9',
  },
  toggleContainer: {
    flexDirection: 'row',
    borderRadius: 10,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#ddd',
    shadowColor: '#000', // Subtle shadow
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  toggleButton: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#f9f9f9',
  },
  toggleButtonActive: {
    backgroundColor: '#2ecc71', // Green for active
  },
  toggleButtonText: {
    fontSize: 16,
    color: '#333',
    fontWeight: 'bold',
  },
  toggleButtonTextActive: {
    color: 'white',
  },
  buttonContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginTop: 20,
  },
  button: {
    flex: 1,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center', // Vertically center the content
    marginHorizontal: 5,
    shadowColor: '#000', // Subtle shadow
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 3,
    elevation: 3,
  },
  cancelButton: {
    backgroundColor: '#e74c3c',
  },
  saveButton: {
    backgroundColor: '#2ecc71',
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default EditSpotMobileModal;
