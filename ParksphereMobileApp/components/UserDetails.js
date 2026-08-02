import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, RefreshControl, Alert,
  TextInput, Switch, KeyboardAvoidingView, Platform, Modal,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';

import { useAuth } from '../context/AuthContext';
import { useSpots } from '../context/SpotContext';
import { useDebugTools } from '../context/DebugToolsContext';
import { apiRequest } from '../utils/apiService';
import RangeSlider from './RangeSlider';
import AboutScreen from './AboutScreen';

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
  const { currentUser: user, token, logout: onLogout, serverUrl, updateToken } = useAuth();
  const { spotRadiusKm, setSpotRadiusKm } = useSpots();
  const {
    showHmmEngine, setShowHmmEngine,
    showFlightRecorder, setShowFlightRecorder,
    showFixesWindow, setShowFixesWindow,
  } = useDebugTools();
  const [avatarError, setAvatarError] = useState(false); // fall back to a placeholder if the avatar URL won't load
  const [carType, setCarType] = useState(user ? user.car_type : '');
  const [carColor, setCarColor] = useState(user ? user.car_color : '');
  const [plateNumber, setPlateNumber] = useState(user ? user.plate_number : '');
  const [autoDetectionEnabled, setAutoDetectionEnabled] = useState(user ? user.auto_detect : false);
  const [isEditingUsername, setIsEditingUsername] = useState(false);
  const [usernameDraft, setUsernameDraft] = useState(user ? user.username : '');
  const [showVehicleModal, setShowVehicleModal] = useState(false);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const [showAboutModal, setShowAboutModal] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    if (user) {
      setCarType(user.car_type);
      setCarColor(user.car_color);
      setPlateNumber(user.plate_number);
      setAutoDetectionEnabled(user.auto_detect);
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

  // Shared by the vehicle-edit sheet's Save button and the auto-detect switch — both PUT the same
  // endpoint, just with different fields changing. Overrides let a caller update one field without
  // having to know about the others.
  const saveCarDetails = async (overrides = {}) => {
    const body = {
      car_type: carType,
      car_color: carColor,
      plate_number: plateNumber,
      auto_detect: autoDetectionEnabled,
      ...overrides,
    };
    try {
      const response = await apiRequest(`${serverUrl}/api/users/${user.id}/car-details`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (response.ok) {
        if (onProfileUpdate) {
          onProfileUpdate();
        }
        return true;
      }
      Alert.alert('Error', data.message || 'Failed to update profile.');
      return false;
    } catch (error) {
      console.error('Error updating profile:', error);
      Alert.alert('Error', 'Could not connect to the server to update profile.');
      return false;
    }
  };

  const handleToggleAutoDetect = async (value) => {
    setAutoDetectionEnabled(value);
    const ok = await saveCarDetails({ auto_detect: value });
    if (!ok) setAutoDetectionEnabled(!value); // revert the optimistic flip on failure
  };

  const openVehicleModal = () => {
    setPlateNumber(user.plate_number);
    setCarColor(user.car_color);
    setCarType(user.car_type);
    setShowVehicleModal(true);
  };

  const cancelVehicleModal = () => {
    setPlateNumber(user.plate_number);
    setCarColor(user.car_color);
    setCarType(user.car_type);
    setShowVehicleModal(false);
  };

  const handleSaveVehicle = async () => {
    const ok = await saveCarDetails();
    if (ok) {
      setShowVehicleModal(false);
    }
  };

  const startEditingUsername = () => {
    setUsernameDraft(user.username);
    setIsEditingUsername(true);
  };

  const cancelEditingUsername = () => {
    setUsernameDraft(user.username);
    setIsEditingUsername(false);
  };

  const confirmEditingUsername = async () => {
    const trimmed = usernameDraft.trim();
    if (!trimmed) {
      Alert.alert('Invalid username', 'Username cannot be empty.');
      return;
    }
    if (trimmed === user.username) {
      setIsEditingUsername(false);
      return;
    }
    try {
      const response = await apiRequest(`${serverUrl}/api/users/${user.id}/username`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ username: trimmed }),
      });
      const data = await response.json();
      if (response.ok) {
        if (data.token) {
          await updateToken(data.token); // re-issued JWT's `username` claim must match going forward
        }
        if (onProfileUpdate) {
          onProfileUpdate();
        }
        setIsEditingUsername(false);
      } else {
        Alert.alert('Error', data.message || 'Failed to update username.');
      }
    } catch (error) {
      console.error('Error updating username:', error);
      Alert.alert('Error', 'Could not connect to the server to update username.');
    }
  };

  const openPasswordModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowPasswordModal(true);
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      Alert.alert('Missing fields', 'Please fill in all three fields.');
      return;
    }
    if (newPassword.length < 6) {
      Alert.alert('Password too short', 'New password must be at least 6 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert("Passwords don't match", 'New password and confirmation must match.');
      return;
    }
    try {
      const response = await apiRequest(`${serverUrl}/api/users/${user.id}/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await response.json();
      if (response.ok) {
        Alert.alert('Success', 'Password updated successfully.');
        setShowPasswordModal(false);
      } else {
        Alert.alert('Error', data.message || 'Failed to update password.');
      }
    } catch (error) {
      console.error('Error changing password:', error);
      Alert.alert('Error', 'Could not connect to the server to change password.');
    }
  };

  const averageArrivalTime = user.completed_transactions_count > 0
    ? (user.total_arrival_time / user.completed_transactions_count).toFixed(2) + ' min'
    : 'N/A';

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 60 : 0}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.hero}>
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
          {isEditingUsername ? (
            <View style={styles.usernameEditRow}>
              <TextInput
                style={styles.usernameInput}
                value={usernameDraft}
                onChangeText={setUsernameDraft}
                autoFocus
                autoCapitalize="none"
                autoCorrect={false}
              />
              <TouchableOpacity onPress={confirmEditingUsername} style={styles.usernameIconButton}>
                <Ionicons name="checkmark" size={22} color="#2e7d32" />
              </TouchableOpacity>
              <TouchableOpacity onPress={cancelEditingUsername} style={styles.usernameIconButton}>
                <Ionicons name="close" size={22} color="#c62828" />
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity onPress={startEditingUsername}>
              <Text style={styles.username}>{user.username}</Text>
            </TouchableOpacity>
          )}
          <Text style={styles.memberSince}>Member since {new Date(user.created_at).toLocaleDateString()}</Text>
        </View>

        <View style={styles.statsStrip}>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{user.spots_declared}</Text>
            <Text style={styles.statLabel}>Declared</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{user.spots_taken}</Text>
            <Text style={styles.statLabel}>Taken</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{user.rating !== null ? parseFloat(user.rating).toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{user.rank !== null && !isNaN(user.rank) ? `${user.rank}%` : '—'}</Text>
            <Text style={styles.statLabel}>Rank</Text>
          </View>
        </View>

        <Text style={styles.sectionHeader}>VEHICLE</Text>
        <TouchableOpacity style={styles.row} onPress={openVehicleModal}>
          <Text style={styles.rowLabel}>Plate number</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue}>{(user.plate_number || '—').toUpperCase()}</Text>
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
          </View>
        </TouchableOpacity>
        <View style={styles.rowDivider} />
        <TouchableOpacity style={styles.row} onPress={openVehicleModal}>
          <Text style={styles.rowLabel}>Car color</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue}>{user.car_color || '—'}</Text>
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
          </View>
        </TouchableOpacity>
        <View style={styles.rowDivider} />
        <TouchableOpacity style={styles.row} onPress={openVehicleModal}>
          <Text style={styles.rowLabel}>Car type</Text>
          <View style={styles.rowRight}>
            <Text style={styles.rowValue}>{user.car_type || '—'}</Text>
            <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
          </View>
        </TouchableOpacity>

        <Text style={styles.sectionHeader}>PREFERENCES</Text>
        <View style={styles.row}>
          <View style={styles.rowTextContainer}>
            <Text style={styles.rowLabel}>Auto spot detection</Text>
            <Text style={styles.rowDescription}>Automatically detect when you park or leave a spot.</Text>
          </View>
          <Switch
            trackColor={{ false: '#767577', true: '#512da8' }}
            thumbColor={autoDetectionEnabled ? '#fff' : '#f4f3f4'}
            onValueChange={handleToggleAutoDetect}
            value={autoDetectionEnabled}
          />
        </View>
        <View style={styles.rowDivider} />
        <View style={styles.radiusRow}>
          <Text style={styles.rowLabel}>Spot search radius</Text>
          <Text style={styles.rowDescription}>
            How far around your current position to show available spots from other users.
          </Text>
          <View style={styles.radiusSliderWrapper}>
            <RangeSlider min={1} max={10} step={1} value={spotRadiusKm} onValueChange={setSpotRadiusKm} />
          </View>
        </View>

        <Text style={styles.sectionHeader}>ACCOUNT</Text>
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Credits</Text>
          <Text style={styles.rowValue}>{user.credits}</Text>
        </View>
        <View style={styles.rowDivider} />
        <View style={styles.row}>
          <Text style={styles.rowLabel}>Average arrival time</Text>
          <Text style={styles.rowValue}>{averageArrivalTime}</Text>
        </View>
        <View style={styles.rowDivider} />
        <TouchableOpacity style={styles.row} onPress={openPasswordModal}>
          <Text style={styles.rowLabel}>Change password</Text>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </TouchableOpacity>
        <View style={styles.rowDivider} />
        <TouchableOpacity style={styles.row} onPress={() => setShowAboutModal(true)}>
          <Text style={styles.rowLabel}>About Venio</Text>
          <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
        </TouchableOpacity>

        {user.role === 'admin' && (
          <>
            <Text style={styles.sectionHeader}>DEBUG TOOLS</Text>
            <View style={styles.row}>
              <Text style={styles.rowLabel}>HMM Engine overlay</Text>
              <Switch
                trackColor={{ false: '#767577', true: '#512da8' }}
                thumbColor={showHmmEngine ? '#fff' : '#f4f3f4'}
                onValueChange={setShowHmmEngine}
                value={showHmmEngine}
              />
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Flight Recorder</Text>
              <Switch
                trackColor={{ false: '#767577', true: '#512da8' }}
                thumbColor={showFlightRecorder ? '#fff' : '#f4f3f4'}
                onValueChange={setShowFlightRecorder}
                value={showFlightRecorder}
              />
            </View>
            <View style={styles.rowDivider} />
            <View style={styles.row}>
              <Text style={styles.rowLabel}>Fixes window</Text>
              <Switch
                trackColor={{ false: '#767577', true: '#512da8' }}
                thumbColor={showFixesWindow ? '#fff' : '#f4f3f4'}
                onValueChange={setShowFixesWindow}
                value={showFixesWindow}
              />
            </View>
          </>
        )}

        <TouchableOpacity style={styles.logoutRow} onPress={handleLogout}>
          <Text style={styles.logoutText}>Log out</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal
        visible={showVehicleModal}
        animationType="fade"
        transparent
        onRequestClose={cancelVehicleModal}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Edit Vehicle Details</Text>

            <View style={styles.inputContainer}>
              <Text style={styles.label}>Plate Number</Text>
              <TextInput
                style={styles.input}
                value={plateNumber}
                onChangeText={setPlateNumber}
                placeholder="e.g., ABC-1234"
                autoCapitalize="characters"
              />
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

            <TouchableOpacity style={styles.button} onPress={handleSaveVehicle}>
              <Text style={styles.buttonText}>Save</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelLink} onPress={cancelVehicleModal}>
              <Text style={styles.modalCancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showPasswordModal}
        animationType="fade"
        transparent
        onRequestClose={() => setShowPasswordModal(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.sectionTitle}>Change Password</Text>
            <TextInput
              style={styles.input}
              placeholder="Current password"
              secureTextEntry
              value={currentPassword}
              onChangeText={setCurrentPassword}
            />
            <TextInput
              style={[styles.input, styles.modalInputSpacing]}
              placeholder="New password"
              secureTextEntry
              value={newPassword}
              onChangeText={setNewPassword}
            />
            <TextInput
              style={[styles.input, styles.modalInputSpacing]}
              placeholder="Confirm new password"
              secureTextEntry
              value={confirmPassword}
              onChangeText={setConfirmPassword}
            />
            <TouchableOpacity style={[styles.button, styles.modalInputSpacing]} onPress={handleChangePassword}>
              <Text style={styles.buttonText}>Change Password</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.modalCancelLink} onPress={() => setShowPasswordModal(false)}>
              <Text style={styles.modalCancelLinkText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <Modal
        visible={showAboutModal}
        animationType="slide"
        onRequestClose={() => setShowAboutModal(false)}
      >
        <AboutScreen onClose={() => setShowAboutModal(false)} />
      </Modal>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    // No top padding here — it belongs on the ScrollView's own contentContainerStyle (below) so
    // the content can scroll up underneath the floating header, not just sit permanently below it.
  },
  scrollContent: {
    paddingTop: 110, // lets the content scroll up underneath the floating header
    paddingBottom: 120, // clears the floating tab bar, since Log out is now the last item in-flow
  },
  hero: {
    alignItems: 'center',
    paddingTop: 12,
    paddingBottom: 20,
  },
  avatar: {
    width: 96,
    height: 96,
    borderRadius: 48,
  },
  username: {
    fontSize: 20,
    fontWeight: '700',
    marginTop: 12,
    color: '#222',
  },
  memberSince: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  usernameEditRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 12,
  },
  usernameInput: {
    fontSize: 18,
    fontWeight: 'bold',
    borderBottomWidth: 1,
    borderBottomColor: '#512da8',
    minWidth: 90,
    paddingVertical: 2,
    color: '#333',
  },
  usernameIconButton: {
    marginLeft: 6,
  },
  statsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: 16,
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#f7f6fa',
    borderRadius: 16,
  },
  statChip: {
    alignItems: 'center',
  },
  statNumber: {
    fontSize: 18,
    fontWeight: '700',
    color: '#512da8',
  },
  statLabel: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 28,
    marginBottom: 6,
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    minHeight: 48,
  },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rowTextContainer: {
    flex: 1,
    marginRight: 10,
  },
  rowLabel: {
    fontSize: 16,
    color: '#333',
  },
  rowValue: {
    fontSize: 15,
    color: '#888',
    marginRight: 6,
  },
  rowDescription: {
    fontSize: 12,
    color: '#888',
    marginTop: 2,
  },
  rowDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: '#e2e2e6',
    marginLeft: 20,
  },
  radiusRow: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
  },
  radiusSliderWrapper: {
    marginTop: 16,
    paddingHorizontal: 6,
  },
  logoutRow: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 28,
  },
  logoutText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#ff3b30',
  },
  sectionTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 15,
    color: '#512da8',
  },
  inputContainer: {
    marginBottom: 20,
    width: '100%',
  },
  label: {
    fontSize: 16,
    fontWeight: 'bold',
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
  // Pill-shaped, 80% width and 49pt tall — matches the floating tab bar's rounded aesthetic.
  button: {
    backgroundColor: '#512da8',
    width: '80%',
    height: 49,
    justifyContent: 'center',
    borderRadius: 24.5,
    alignItems: 'center',
    alignSelf: 'center',
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
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 20,
  },
  modalInputSpacing: {
    marginTop: 12,
  },
  modalCancelLink: {
    alignItems: 'center',
    marginTop: 12,
    paddingVertical: 8,
  },
  modalCancelLinkText: {
    color: '#666',
    fontSize: 15,
  },
});

export default UserDetails;
