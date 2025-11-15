import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image } from 'react-native';

const UserDetails = ({ user, onBack, onEditProfile }) => {
  if (!user) {
    return null;
  }

  return (
    <View style={styles.container}>
      <View style={styles.profileDetailsTwoColumn}>
        <View style={styles.profileLeftColumn}>
          <Image source={{ uri: user.avatar_url }} style={styles.avatar} />
          <Text style={styles.username}>{user.username}</Text>
          <TouchableOpacity style={styles.editButton} onPress={onEditProfile}>
            <Text style={styles.editButtonText}>Edit Profile</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.profileRightColumn}>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Plate number:</Text>
            <Text style={styles.profileValue}>{user.plate_number.toUpperCase()}</Text>
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
  },
  profileRightColumn: {
    flexDirection: 'column',
    width: '50%', // Adjust as needed
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
    paddingVertical: 5,
    paddingHorizontal: 10,
    backgroundColor: '#007bff',
    borderRadius: 5,
  },
  editButtonText: {
    color: 'white',
    fontSize: 16,
  },
});

export default UserDetails;
