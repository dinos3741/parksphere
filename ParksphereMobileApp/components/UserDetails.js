import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, RefreshControl, Alert,
  TextInput, Switch, KeyboardAvoidingView, Platform,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '../context/AuthContext';
import { apiRequest } from '../utils/apiService';

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

const UserDetails = ({ onRefresh, refreshing, onProfileUpdate }) => {
  const { currentUser: user, token, logout: onLogout, serverUrl } = useAuth();
  const [avatarError, setAvatarError] = useState(false); // fall back to a placeholder if the avatar URL won't load
  const [carType, setCarType] = useState(user ? user.car_type : '');
  const [carColor, setCarColor] = useState(user ? user.car_color : '');
  const [autoDetectionEnabled, setAutoDetectionEnabled] = useState(user ? user.auto_detect : false);
  const [notificationsEnabled, setNotificationsEnabled] = useState(user ? user.notifications_enabled : true);
  const [isMockMode, setIsMockMode] = useState(false);

  useEffect(() => {
    const loadMockMode = async () => {
      const mode = await AsyncStorage.getItem('mockModeEnabled');
      setIsMockMode(mode === 'true');
    };
    loadMockMode();

    if (user) {
      setCarType(user.car_type);
      setCarColor(user.car_color);
      setAutoDetectionEnabled(user.auto_detect);
      setNotificationsEnabled(user.notifications_enabled !== undefined ? user.notifications_enabled : true);
    }
  }, [user]);

  if (!user) {
    return null;
  }

  const getAvatarUri = () => {
    if (!user.avatar_url) {
      return `https://i.pravatar.cc/150?u=${user.username}`;
    }

    // If it's already a full URL but contains localhost, replace it with serverUrl
    if (user.avatar_url.startsWith('http')) {
      if (user.avatar_url.includes('localhost')) {
        return user.avatar_url.replace('http://localhost:3001', serverUrl);
      }
      return user.avatar_url;
    }

    // If it's a relative path, prepend serverUrl
    return `${serverUrl}${user.avatar_url}`;
  };

  const pickImage = async () => {
    // Ask for permissions
    const { status: cameraStatus } = await ImagePicker.requestCameraPermissionsAsync();
    const { status: libraryStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (cameraStatus !== 'granted' || libraryStatus !== 'granted') {
      Alert.alert('Permission Denied', 'Permissions to access camera and library are required.');
      return;
    }

    Alert.alert(
      'Update Avatar',
      'Choose an option',
      [
        {
          text: 'Camera',
          onPress: () => launchImagePicker(true),
        },
        {
          text: 'Gallery',
          onPress: () => launchImagePicker(false),
        },
        {
          text: 'Cancel',
          style: 'cancel',
        },
      ],
      { cancelable: true }
    );
  };

  const launchImagePicker = async (isCamera) => {
    let result;
    if (isCamera) {
      result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
    } else {
      result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.5,
      });
    }

    if (!result.canceled) {
      uploadImage(result.assets[0].uri);
    }
  };

  const uploadImage = async (uri) => {
    const formData = new FormData();
    const uriParts = uri.split('.');
    const fileType = uriParts[uriParts.length - 1];

    formData.append('avatar', {
      uri,
      name: `avatar.${fileType}`,
      type: `image/${fileType}`,
    });

    try {
      const response = await apiRequest(`${serverUrl}/api/users/avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'multipart/form-data',
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.ok) {
        Alert.alert('Success', 'Avatar updated successfully.');
        if (onProfileUpdate) {
          onProfileUpdate();
        }
      } else {
        const errorText = await response.text();
        console.error('Failed to upload image:', errorText);
        Alert.alert('Error', 'Failed to update avatar.');
      }
    } catch (error) {
      console.error('Error uploading image:', error);
      Alert.alert('Error', 'An error occurred during upload.');
    }
  };

  const handleLogout = () => {
    Alert.alert(
      'Confirm Logout',
      'Are you sure you want to log out?',
      [
        {
          text: 'Cancel',
          style: 'cancel',
        },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: onLogout,
        },
      ],
      { cancelable: true }
    );
  };

  const toggleMockMode = async (value) => {
    setIsMockMode(value);
    if (value) {
      await AsyncStorage.setItem('mockModeEnabled', 'true');
    } else {
      await AsyncStorage.removeItem('mockModeEnabled');
    }
  };

  const handleUpdate = async () => {
    try {
      const response = await apiRequest(`${serverUrl}/api/users/${user.id}/car-details`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          car_type: carType,
          car_color: carColor,
          auto_detect: autoDetectionEnabled,
          notifications_enabled: notificationsEnabled,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        if (onProfileUpdate) {
          onProfileUpdate();
        }
        Alert.alert('Success', 'Profile updated successfully.');
      } else {
        Alert.alert('Error', data.message || 'Failed to update profile.');
      }
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Could not connect to the server to update profile.');
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.profileDetailsTwoColumn}>
          <View style={styles.profileLeftColumn}>
            <TouchableOpacity onPress={pickImage}>
              <Image
                source={{ uri: avatarError ? `https://i.pravatar.cc/150?u=${user.username}` : getAvatarUri() }}
                style={styles.avatar}
                onError={(e) => {
                  console.log('[Avatar] load FAILED for', getAvatarUri(), '→', e?.nativeEvent?.error);
                  setAvatarError(true);
                }}
              />
            </TouchableOpacity>
            <Text style={styles.username}>{user.username}</Text>
          </View>
          <View style={styles.profileRightColumn}>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Plate number:</Text>
              <Text style={styles.profileValue}>{(user.plate_number || '').toUpperCase()}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Car color:</Text>
              <Text style={styles.profileValue}>{user.car_color}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Car type:</Text>
              <Text style={styles.profileValue}>{user.car_type}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Credits:</Text>
              <Text style={styles.profileValue}>{user.credits}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Account created:</Text>
              <Text style={styles.profileValue}>{new Date(user.created_at).toLocaleDateString()}</Text>
            </View>
          </View>
        </View>
        <View style={styles.myStatsSection}>
          <Text style={styles.myStatsLabel}>My Stats</Text>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Spots declared:</Text>
            <Text style={styles.profileValue}>{user.spots_declared}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Spots taken:</Text>
            <Text style={styles.profileValue}>{user.spots_taken}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Average arrival time:</Text>
            <Text style={styles.profileValue}>
              {user.completed_transactions_count > 0
                ? (user.total_arrival_time / user.completed_transactions_count).toFixed(2) + ' min'
                : 'N/A'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Rating:</Text>
            <Text style={styles.profileValue}>
              {user.rating !== null ? parseFloat(user.rating).toFixed(1) + '/5 (' + user.rating_count + ' ratings)' : 'N/A'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Rank:</Text>
            <Text style={styles.profileValue}>{user.rank !== null && !isNaN(user.rank) ? 'top ' + user.rank + '%' : 'N/A'}</Text>
          </View>
        </View>

        <View style={styles.divider} />

        <View style={styles.editSection}>
          <Text style={styles.sectionTitle}>Edit Your Car Details</Text>

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

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingLabel}>Auto spot detection</Text>
              <Text style={styles.settingDescription}>Automatically detect when you park or leave a spot.</Text>
            </View>
            <Switch
              trackColor={{ false: '#767577', true: '#512da8' }}
              thumbColor={autoDetectionEnabled ? '#fff' : '#f4f3f4'}
              onValueChange={setAutoDetectionEnabled}
              value={autoDetectionEnabled}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingLabel}>Enable Notifications</Text>
              <Text style={styles.settingDescription}>Ask user to confirm spot assessment</Text>
            </View>
            <Switch
              trackColor={{ false: '#767577', true: '#512da8' }}
              thumbColor={notificationsEnabled ? '#fff' : '#f4f3f4'}
              onValueChange={setNotificationsEnabled}
              value={notificationsEnabled}
            />
          </View>

          <View style={styles.settingRow}>
            <View style={styles.settingTextContainer}>
              <Text style={styles.settingLabel}>Mock Mode</Text>
              <Text style={styles.settingDescription}>Use mock data instead of real backend</Text>
            </View>
            <Switch
              trackColor={{ false: '#767577', true: '#512da8' }}
              thumbColor={isMockMode ? '#fff' : '#f4f3f4'}
              onValueChange={toggleMockMode}
              value={isMockMode}
            />
          </View>

          <TouchableOpacity style={styles.button} onPress={handleUpdate}>
            <Text style={styles.buttonText}>Save Changes</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  username: {
    fontSize: 22,
    fontWeight: 'bold',
    marginTop: 10,
  },
  profileDetailsTwoColumn: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'flex-start',
    paddingVertical: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  profileLeftColumn: {
    flexDirection: 'column',
    alignItems: 'center',
    marginLeft: -10, // Shifted another 5px left
  },
  profileRightColumn: {
    flexDirection: 'column',
    width: '60%',
    marginLeft: -15, // Shifted another 5px left
  },
  profileLabel: {
    fontWeight: 'bold',
    marginRight: 5,
  },
  profileValue: {
    // No specific style for now, will inherit from Text
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    marginBottom: 5,
  },
  myStatsSection: {
    padding: 20,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  myStatsLabel: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  divider: {
    height: 8,
    backgroundColor: '#f4f4f8',
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: '#ddd',
  },
  editSection: {
    padding: 20,
    paddingBottom: 140, // clears the floating tab bar + logout button below the scroll content
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
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
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    padding: 15,
    borderRadius: 10,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  settingTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  settingLabel: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
  },
  settingDescription: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  button: {
    backgroundColor: '#512da8',
    paddingVertical: 15,
    borderRadius: 10,
    alignItems: 'center',
    marginTop: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 5,
  },
  buttonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: '600',
  },
  logoutButton: {
    position: 'absolute',
    bottom: 100, // clears the floating tab bar (bottom: 20, height: 64) with room to spare
    alignSelf: 'center',
    paddingVertical: 10,
    paddingHorizontal: 20,
    backgroundColor: '#ff3b30',
    borderRadius: 10,
  },
  logoutButtonText: {
    color: 'white',
    fontSize: 18,
    fontWeight: 'bold',
  },
});

export default UserDetails;
