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
      <Text style={styles.title}>Edit Profile</Text>
      <Text style={styles.label}>Car Type:</Text>
      <Picker
        selectedValue={carType}
        style={styles.picker}
        onValueChange={(itemValue) => setCarType(itemValue)}
      >
        {carTypes.map((type) => (
          <Picker.Item key={type} label={type} value={type} />
        ))}
      </Picker>
      <Text style={styles.label}>Car Color:</Text>
      <TextInput
        style={styles.input}
        value={carColor}
        onChangeText={setCarColor}
      />
      <TouchableOpacity style={styles.button} onPress={handleUpdate}>
        <Text style={styles.buttonText}>Save</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  label: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 10,
  },
  input: {
    width: '80%',
    height: 40,
    borderColor: 'gray',
    borderWidth: 1,
    borderRadius: 5,
    padding: 10,
    marginBottom: 10,
  },
  picker: {
    width: '80%',
    height: 150,
  },
  button: {
    backgroundColor: '#007bff',
    padding: 10,
    borderRadius: 5,
    marginTop: 10,
  },
  buttonText: {
    color: 'white',
    fontWeight: 'bold',
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 20,
  },
  backButtonText: {
    fontSize: 18,
    color: '#007bff',
  },
});

export default Profile;
