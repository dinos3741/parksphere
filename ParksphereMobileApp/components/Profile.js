import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Alert, TextInput, TouchableOpacity } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const Profile = ({ userId, token, onBack }) => {
  const [user, setUser] = useState(null);
  const [isEditMode, setIsEditMode] = useState(false);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [carType, setCarType] = useState('');

  useEffect(() => {
    const fetchProfileData = async () => {
      if (!token || !userId) {
        return;
      }
      try {
        const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/users/${userId}`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        const data = await response.json();

        if (response.ok) {
          setUser(data);
          setUsername(data.username);
          setEmail(data.email);
          setCarType(data.car_type);
        } else {
          Alert.alert('Error', data.message || 'Failed to fetch profile data.');
        }
      } catch (error) {
        console.error('Error fetching profile data:', error);
        Alert.alert('Error', 'Could not connect to the server for profile data.');
      }
    };

    fetchProfileData();
  }, [userId, token]);

  const handleUpdate = async () => {
    try {
      const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/users/${userId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ username, email, car_type: carType }),
      });

      const data = await response.json();

      if (response.ok) {
        setUser(data);
        setIsEditMode(false);
        Alert.alert('Success', 'Profile updated successfully.');
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
      <Text style={styles.title}>Profile</Text>
      {isEditMode ? (
        <>
          <TextInput style={styles.input} value={username} onChangeText={setUsername} />
          <TextInput style={styles.input} value={email} onChangeText={setEmail} />
          <TextInput style={styles.input} value={carType} onChangeText={setCarType} />
          <TouchableOpacity style={styles.button} onPress={handleUpdate}>
            <Text style={styles.buttonText}>Save</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.button} onPress={() => setIsEditMode(false)}>
            <Text style={styles.buttonText}>Cancel</Text>
          </TouchableOpacity>
        </>
      ) : (
        <>
          <Text style={styles.label}>Username:</Text>
          <Text style={styles.value}>{user.username}</Text>
          <Text style={styles.label}>Email:</Text>
          <Text style={styles.value}>{user.email}</Text>
          <Text style={styles.label}>Car Type:</Text>
          <Text style={styles.value}>{user.car_type}</Text>
          <Text style={styles.label}>Credits:</Text>
          <Text style={styles.value}>{user.credits}</Text>
          <TouchableOpacity style={styles.button} onPress={() => setIsEditMode(true)}>
            <Text style={styles.buttonText}>Edit</Text>
          </TouchableOpacity>
        </>
      )}
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
  value: {
    fontSize: 18,
    marginBottom: 10,
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
