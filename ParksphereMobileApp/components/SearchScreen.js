import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, TouchableOpacity, Platform, Keyboard, FlatList, Alert } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome';

const SearchScreen = ({ token, serverUrl }) => {
  const [username, setUsername] = useState('');
  const [recentSearches, setRecentSearches] = useState([
    { id: '1', username: 'john_doe' },
    { id: '2', username: 'jane_doe' },
    { id: '3', username: 'peter_jones' },
  ]);
  const [interactions, setInteractions] = useState([]); // Initialize as empty array

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

    fetchInteractions();
  }, [token, serverUrl]); // Re-fetch if token or serverUrl changes

  const handleSearch = () => {
    // Handle the search logic here
    console.log('Searching for:', username);
    if (username && !recentSearches.find(item => item.username === username)) {
      setRecentSearches(prev => [{ id: Date.now().toString(), username }, ...prev]);
    }
    Keyboard.dismiss();
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
          />
          <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
            <FontAwesome name="search" size={20} color="white" />
          </TouchableOpacity>
        </View>

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
});

export default SearchScreen;