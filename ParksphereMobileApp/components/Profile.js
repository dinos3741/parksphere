import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TextInput, TouchableOpacity } from 'react-native';
import { Picker } from '@react-native-picker/picker';

const carTypes = [
  'motorcycle',
  'city car',
  'hatchback',
  'sedan',
  'family car',
  'SUV',
  'van',
  'truck',
];

const Profile = ({ user, token, onBack, onProfileUpdate }) => {
  const [carType, setCarType] = useState(user ? user.car_type : '');
  const [carColor, setCarColor] = useState(user ? user.car_color : '');

  useEffect(() => {
    if (user) {
      setCarType(user.car_type);
      setCarColor(user.car_color);
    }
  }, [user]);

  const handleUpdate = async () => {
    try {
      const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/users/${user.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ car_type: carType, car_color: carColor }),
      });

      const data = await response.json();

      if (response.ok) {
        if(onProfileUpdate) {
          onProfileUpdate(data);
        }
        Alert.alert('Success', 'Profile updated successfully.');
        onBack();
      } else {
        Alert.alert('Error', data.message || 'Failed to update profile.');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Could not connect to the server to update profile.');
    }
  };

  if (!user) {
    return (
      <View style={styles.container}>
        <Text>Loading profile...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onBack}>
        <Text style={styles.backButtonText}>{'< Back'}</Text>
      </TouchableOpacity>
      <Text style={styles.title}>Edit Your Car Details</Text>
      
      <View style={styles.inputContainer}>
        <Text style={styles.label}>Car Type</Text>
        <View style={styles.pickerWrapper}>
          <Picker
            selectedValue={carType}
            style={styles.picker}
            onValueChange={(itemValue) => setCarType(itemValue)}
          >
            {carTypes.map((type) => (
              <Picker.Item key={type} label={type.charAt(0).toUpperCase() + type.slice(1)} value={type} />
            ))}
          </Picker>
        </View>
      </View>

      <View style={styles.inputContainer}>
        <Text style={styles.label}>Car Color</Text>
        <TextInput
          style={styles.input}
          value={carColor}
          onChangeText={setCarColor}
          placeholder="e.g., Blue"
        />
      </View>

      <TouchableOpacity style={styles.button} onPress={handleUpdate}>
        <Text style={styles.buttonText}>Save Changes</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f4f4f8',
    padding: 20,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#333',
    marginTop: 60,
    marginBottom: 30,
    textAlign: 'center',
  },
  inputContainer: {
    marginBottom: 20,
    width: '100%',
  },
  label: {
    fontSize: 16,
    color: '#666',
    marginBottom: 8,
  },
  input: {
    backgroundColor: '#fff',
    paddingHorizontal: 15,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    fontSize: 16,
    color: '#333',
  },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden', // Ensures the picker respects the border radius
  },
  picker: {
    width: '100%',
    height: 180, // Standard height for picker
    color: '#333',
  },
  button: {
    backgroundColor: '#512da8',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 1,
  },
  backButtonText: {
    fontSize: 18,
    color: '#512da8',
    fontWeight: 'bold',
  },
});

export default Profile;
