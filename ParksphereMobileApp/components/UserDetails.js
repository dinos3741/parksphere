import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, ScrollView, RefreshControl, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome'; // Import FontAwesome for the back icon

const UserDetails = ({ token, serverUrl, route, navigation }) => {
  const { userId } = route.params;
  const [displayedUser, setDisplayedUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const fetchUserDetails = async () => {
    if (!token || !serverUrl || !userId) {
      setLoading(false);
      return;
    }
    try {
      const response = await fetch(`${serverUrl}/api/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        setDisplayedUser(data);
      } else {
        const errorText = await response.text();
        console.error('Failed to fetch user details:', response.status, errorText);
        Alert.alert('Error', 'Failed to fetch user details.');
      }
    } catch (error) {
      console.error('Error fetching user details:', error);
      Alert.alert('Error', 'Could not connect to the server to fetch user details.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchUserDetails();
  }, [userId, token, serverUrl]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchUserDetails();
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <Text>Loading user details...</Text>
      </View>
    );
  }

  if (!displayedUser) {
    return (
      <View style={styles.errorContainer}>
        <Text>User not found or an error occurred.</Text>
        <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
          <FontAwesome name="arrow-left" size={24} color="#007bff" />
          <Text style={styles.backButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={() => navigation.goBack()}>
        <FontAwesome name="arrow-left" size={24} color="#007bff" />
        <Text style={styles.backButtonText}>Back</Text>
      </TouchableOpacity>
      <ScrollView
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
        }
      >
        <View style={styles.profileDetailsTwoColumn}>
          <View style={styles.profileLeftColumn}>
            <Image source={{ uri: displayedUser.avatar_url }} style={styles.avatar} />
            <Text style={styles.username}>{displayedUser.username}</Text>
          </View>
          <View style={styles.profileRightColumn}>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Plate number:</Text>
              <Text style={styles.profileValue}>{(displayedUser.plate_number || '').toUpperCase()}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Car color:</Text>
              <Text style={styles.profileValue}>{displayedUser.car_color}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Car type:</Text>
              <Text style={styles.profileValue}>{displayedUser.car_type}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Credits:</Text>
              <Text style={styles.profileValue}>{displayedUser.credits}</Text>
            </View>
            <View style={styles.infoRow}>
              <Text style={styles.profileLabel}>Account created:</Text>
              <Text style={styles.profileValue}>{new Date(displayedUser.created_at).toLocaleDateString()}</Text>
            </View>
          </View>
        </View>
        <View style={styles.myStatsSection}>
          <Text style={styles.myStatsLabel}>User Stats</Text>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Spots declared:</Text>
            <Text style={styles.profileValue}>{displayedUser.spots_declared}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Spots taken:</Text>
            <Text style={styles.profileValue}>{displayedUser.spots_taken}</Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Average arrival time:</Text>
            <Text style={styles.profileValue}>
              {displayedUser.completed_transactions_count > 0
                ? (displayedUser.total_arrival_time / displayedUser.completed_transactions_count).toFixed(2) + ' min'
                : 'N/A'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Rating:</Text>
            <Text style={styles.profileValue}>
              {displayedUser.rating !== null ? parseFloat(displayedUser.rating).toFixed(1) + '/5 (' + displayedUser.rating_count + ' ratings)' : 'N/A'}
            </Text>
          </View>
          <View style={styles.infoRow}>
            <Text style={styles.profileLabel}>Rank:</Text>
            <Text style={styles.profileValue}>{displayedUser.rank !== null && !isNaN(displayedUser.rank) ? 'top ' + displayedUser.rank + '%' : 'N/A'}</Text>
          </View>
        </View>
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 50, // Add padding for the back button
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 50,
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 18,
    color: '#007bff',
    marginLeft: 5,
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
