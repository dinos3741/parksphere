import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, RefreshControl, Alert } from 'react-native';
import * as ImagePicker from 'expo-image-picker';

const UserDetails = ({ user, token, onBack, onEditProfile, onLogout, onRefresh, refreshing, onProfileUpdate, serverUrl }) => {
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
      const response = await fetch(`http://${process.env.EXPO_PUBLIC_EXPO_SERVER_IP}:3001/api/users/avatar`, {
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

  return (
    <View style={styles.container}>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.profileDetailsTwoColumn}>
          <View style={styles.profileLeftColumn}>
            <TouchableOpacity onPress={pickImage}>
              <Image source={{ uri: getAvatarUri() }} style={styles.avatar} />
            </TouchableOpacity>
            <Text style={styles.username}>{user.username}</Text>
            <TouchableOpacity style={styles.editButton} onPress={onEditProfile}>
              <Text style={styles.editButtonText}>Edit Car Details</Text>
            </TouchableOpacity>
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
      </ScrollView>
      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutButtonText}>Logout</Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 1,
  },
  backButtonText: {
    fontSize: 18,
    color: '#007bff',
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
  value: {
    fontSize: 18,
    marginBottom: 10,
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
  editButton: {
    marginTop: 10,
    marginLeft: 10, // Move button to the right
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#D8BFD8',
    borderRadius: 10,
  },
  editButtonText: {
    color: 'black',
    fontSize: 16,
  },
  logoutButton: {
    position: 'absolute',
    bottom: 20,
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
