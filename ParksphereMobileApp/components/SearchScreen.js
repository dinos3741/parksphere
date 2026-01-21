import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, TouchableOpacity, Platform, Keyboard, FlatList, Alert, Image } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';
import { useIsFocused } from '@react-navigation/native';

const SearchScreen = ({ token, serverUrl }) => {
  const [username, setUsername] = useState('');
  const [recentSearches, setRecentSearches] = useState([
    { id: '1', username: 'john_doe' },
    { id: '2', username: 'jane_doe' },
    { id: '3', username: 'peter_jones' },
  ]);
  const [interactions, setInteractions] = useState([]);
  const [searchedUser, setSearchedUser] = useState(null);
  const isFocused = useIsFocused();

  useEffect(() => {
    const fetchInteractions = async () => {
      if (!token || !serverUrl) return;

      try {
        const response = await fetch(`${serverUrl}/api/users/interactions`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          const data = await response.json();
          setInteractions(data);
        } else {
          const errorText = await response.text();
          console.error('Failed to fetch interactions:', response.status, errorText);
          Alert.alert('Error', 'Failed to fetch interactions.');
        }
      } catch (error) {
        console.error('Error fetching interactions:', error);
        Alert.alert('Error', 'Could not connect to the server to fetch interactions.');
      }
    };

    if (isFocused) {
      fetchInteractions();
      setSearchedUser(null); // Reset search when screen is focused
      setUsername(''); // Also clear the username input
    }
  }, [isFocused, token, serverUrl]);

  const handleSearch = async () => {
    if (!username.trim()) {
      Alert.alert('Please enter a username to search.');
      return;
    }
    Keyboard.dismiss();
    if (username && !recentSearches.find(item => item.username === username)) {
      setRecentSearches(prev => [{ id: Date.now().toString(), username }, ...prev]);
    }

    try {
      const response = await fetch(`${serverUrl}/api/users/username/${username.trim()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSearchedUser(data);
      } else if (response.status === 404) {
        setSearchedUser({ notFound: true });
      } else {
        const errorText = await response.text();
        console.error('Failed to search user:', response.status, errorText);
        Alert.alert('Error', 'Failed to search for the user.');
        setSearchedUser(null);
      }
    } catch (error) {
      console.error('Error searching user:', error);
      Alert.alert('Error', 'Could not connect to the server to perform the search.');
      setSearchedUser(null);
    }
  };

  const renderUserDetails = () => {
    if (!searchedUser) return null;

    if (searchedUser.notFound) {
      return (
        <View style={styles.userDetailsContainer}>
          <TouchableOpacity onPress={() => setSearchedUser(null)} style={styles.closeButton}>
<FontAwesome name="close" size={24} color="gray" />
          </TouchableOpacity>
          <Text style={styles.notFoundText}>User not found.</Text>
        </View>
      );
    }

    return (
      <View style={styles.userDetailsContainer}>
        <TouchableOpacity onPress={() => setSearchedUser(null)} style={styles.closeButton}>
          <FontAwesome name="close" size={24} color="gray" />
        </TouchableOpacity>
        <Image source={{ uri: searchedUser.avatar_url }} style={styles.avatar} />
        <Text style={styles.userUsername}>{searchedUser.username}</Text>
        <Text>Member since: {new Date(searchedUser.created_at).toLocaleDateString()}</Text>
        <Text>Average Rating: {parseFloat(searchedUser.average_rating).toFixed(2) || 'Not rated yet'}</Text>
        <Text>Rank: Top {searchedUser.rank}%</Text>
        <Text>Car Type: {searchedUser.car_type}</Text>
        <Text>Spots Declared: {searchedUser.spots_declared}</Text>
        <Text>Spots Taken: {searchedUser.spots_taken}</Text>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === "ios" ? "padding" : "height"}
      style={styles.container}
    >
      <View style={styles.inner}>
        <Text style={styles.title}>Search for a User</Text>
        <View style={styles.searchContainer}>
          <TextInput
            style={styles.input}
            placeholder="enter username"
            value={username}
            onChangeText={setUsername}
            autoCapitalize="none"
          />
          <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
            <FontAwesome name="search" size={20} color="white" />
          </TouchableOpacity>
        </View>

        {searchedUser ? renderUserDetails() : (
          <>
            <View style={styles.recentSearchesContainer}>
              <Text style={styles.recentSearchesTitle}>Recent searches</Text>
              <FlatList
                data={recentSearches}
                keyExtractor={item => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => setUsername(item.username)}>
                    <Text style={styles.recentSearchItem}>{item.username}</Text>
                  </TouchableOpacity>
                )}
              />
              <View style={styles.horizontalLine} />
            </View>

            <View style={styles.interactionsContainer}>
              <Text style={styles.interactionsTitle}>Interactions</Text>
              <FlatList
                data={interactions}
                keyExtractor={item => item.id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity onPress={() => setUsername(item.username)}>
                    <Text style={styles.interactionItem}>{item.username}</Text>
                  </TouchableOpacity>
                )}
              />
            </View>
          </>
        )}
        <View style={{ flex : 1 }} />
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  inner: {
    flex: 1,
    justifyContent: 'flex-start',
    alignItems: 'center',
    padding: 20,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    width: '100%',
    alignItems: 'center',
  },
  input: {
    flex: 1,
    height: 50,
    borderColor: '#ddd',
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 15,
    backgroundColor: '#fefefe',
    fontSize: 16,
    color: '#333',
  },
  searchButton: {
    backgroundColor: '#007bff',
    padding: 15,
    borderRadius: 8,
    marginLeft: 10,
  },
  recentSearchesContainer: {
    width: '100%',
    marginTop: 20,
  },
  recentSearchesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  recentSearchItem: {
    fontSize: 16,
    paddingVertical: 13,
  },
  horizontalLine: {
    borderBottomColor: '#ddd',
    borderBottomWidth: 1,
    marginVertical: 10,
  },
  interactionsContainer: {
    width: '100%',
    marginTop: 20,
  },
  interactionsTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  interactionItem: {
    fontSize: 16,
    paddingVertical: 13,
  },
  userDetailsContainer: {
    marginTop: 20,
    padding: 20,
    backgroundColor: 'white',
    borderRadius: 8,
    width: '100%',
    alignItems: 'center',
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    marginBottom: 10,
  },
  userUsername: {
    fontSize: 22,
    fontWeight: 'bold',
    marginBottom: 10,
  },
  notFoundText: {
    marginTop: 20,
    fontSize: 18,
    color: 'red',
  },
  closeButton: {
    position: 'absolute',
    top: 10,
    right: 10,
  },
});

export default SearchScreen;