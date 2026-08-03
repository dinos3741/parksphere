import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TextInput, KeyboardAvoidingView, TouchableOpacity, Platform, Keyboard, FlatList, Alert, Image } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useIsFocused } from '@react-navigation/native';

import { useAuth } from '../context/AuthContext';
import { useChat } from '../context/ChatContext';
import { apiRequest } from '../utils/apiService';

const RECENT_SEARCHES_KEY = 'recentSearchedUsers';
const MAX_RECENT_SEARCHES = 15;

const SearchScreen = ({ navigation }) => {
  const { token, serverUrl } = useAuth();
  const { handleOpenChat } = useChat();
  const [username, setUsername] = useState('');
  const [interactions, setInteractions] = useState([]);
  const [recentSearches, setRecentSearches] = useState([]);
  const [searchedUser, setSearchedUser] = useState(null);
  const isFocused = useIsFocused();

  const getAvatarUri = (avatarUrl, forUsername) => {
    if (!avatarUrl) {
      return `https://i.pravatar.cc/150?u=${forUsername}`;
    }
    if (avatarUrl.startsWith('http')) {
      if (avatarUrl.includes('localhost')) {
        return avatarUrl.replace('http://localhost:3001', serverUrl);
      }
      return avatarUrl;
    }
    return `${serverUrl}${avatarUrl}`;
  };

  useEffect(() => {
    const loadRecentSearches = async () => {
      try {
        const saved = await AsyncStorage.getItem(RECENT_SEARCHES_KEY);
        if (saved) setRecentSearches(JSON.parse(saved));
      } catch (e) {
        console.error('[SearchScreen] Failed to load recent searches:', e);
      }
    };
    loadRecentSearches();
  }, []);

  const recordRecentSearch = async (user) => {
    setRecentSearches((prev) => {
      const next = [
        { id: user.id, username: user.username, avatar_url: user.avatar_url },
        ...prev.filter((u) => u.id !== user.id),
      ].slice(0, MAX_RECENT_SEARCHES);
      AsyncStorage.setItem(RECENT_SEARCHES_KEY, JSON.stringify(next)).catch((e) =>
        console.error('[SearchScreen] Failed to persist recent searches:', e)
      );
      return next;
    });
  };

  useEffect(() => {
    const fetchInteractions = async () => {
      if (!token || !serverUrl) return;

      try {
        const response = await apiRequest(`${serverUrl}/api/users/interactions`, {
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

  const performSearch = async (searchUsername) => {
    if (!searchUsername.trim()) {
      Alert.alert('Please enter a username to search.');
      return;
    }
    Keyboard.dismiss();

    try {
      const response = await apiRequest(`${serverUrl}/api/users/username/${searchUsername.trim()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        setSearchedUser(data);
        recordRecentSearch(data);
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

  const handleSearch = () => {
    performSearch(username);
  };

  // Explicit searches are a stronger recency signal than passive interaction history, so they lead
  // the list; interaction-history entries fill in after, skipping anyone already covered above.
  const recentSearchIds = new Set(recentSearches.map((u) => u.id));
  const recentList = [...recentSearches, ...interactions.filter((u) => !recentSearchIds.has(u.id))];

  const renderUserDetails = () => {
    if (!searchedUser) return null;

    if (searchedUser.notFound) {
      return (
        <View style={styles.resultCard}>
          <TouchableOpacity onPress={() => setSearchedUser(null)} style={styles.closeButton}>
            <Ionicons name="close" size={24} color="#999" />
          </TouchableOpacity>
          <Ionicons name="person-outline" size={40} color="#ccc" style={styles.notFoundIcon} />
          <Text style={styles.notFoundText}>No user found with that username.</Text>
        </View>
      );
    }

    return (
      <View style={styles.resultCard}>
        <TouchableOpacity onPress={() => setSearchedUser(null)} style={styles.closeButton}>
          <Ionicons name="close" size={24} color="#999" />
        </TouchableOpacity>
        <Image source={{ uri: getAvatarUri(searchedUser.avatar_url, searchedUser.username) }} style={styles.resultAvatar} />
        <Text style={styles.resultUsername}>{searchedUser.username}</Text>
        <Text style={styles.resultSubtitle}>Member since {new Date(searchedUser.created_at).toLocaleDateString()}</Text>

        <View style={styles.statsStrip}>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{searchedUser.average_rating ? parseFloat(searchedUser.average_rating).toFixed(1) : '—'}</Text>
            <Text style={styles.statLabel}>Rating</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{searchedUser.rank != null ? `${searchedUser.rank}%` : '—'}</Text>
            <Text style={styles.statLabel}>Rank</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{searchedUser.spots_declared}</Text>
            <Text style={styles.statLabel}>Declared</Text>
          </View>
          <View style={styles.statChip}>
            <Text style={styles.statNumber}>{searchedUser.spots_taken}</Text>
            <Text style={styles.statLabel}>Taken</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.messageButton} onPress={() => handleOpenChat(navigation, searchedUser)}>
          <Ionicons name="chatbubble" size={16} color="#fff" style={styles.messageButtonIcon} />
          <Text style={styles.messageButtonText}>Message</Text>
        </TouchableOpacity>
      </View>
    );
  };

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      style={styles.container}
    >
      <Text style={styles.title}>Search for users</Text>

      <View style={styles.inner}>
        <View style={styles.searchContainer}>
          <Ionicons name="search" size={18} color="#999" style={styles.searchIcon} />
          <TextInput
            style={styles.input}
            placeholder="Enter a username"
            placeholderTextColor="#999"
            value={username}
            onChangeText={setUsername}
            onSubmitEditing={handleSearch}
            autoCapitalize="none"
            returnKeyType="search"
          />
          <TouchableOpacity style={styles.searchButton} onPress={handleSearch}>
            <Ionicons name="arrow-forward" size={20} color="#fff" />
          </TouchableOpacity>
        </View>

        {searchedUser ? renderUserDetails() : (
          <View style={styles.recentContainer}>
            <Text style={styles.sectionHeader}>RECENT</Text>
            {recentList.length > 0 ? (
              <FlatList
                data={recentList}
                keyExtractor={item => item.id.toString()}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={styles.recentRow}
                    onPress={() => {
                      setUsername(item.username);
                      performSearch(item.username);
                    }}
                  >
                    <Image source={{ uri: getAvatarUri(item.avatar_url, item.username) }} style={styles.recentAvatar} />
                    <Text style={styles.recentUsername}>{item.username}</Text>
                    <Ionicons name="chevron-forward" size={18} color="#c7c7cc" />
                  </TouchableOpacity>
                )}
              />
            ) : (
              <Text style={styles.emptyText}>No recent searches yet.</Text>
            )}
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    paddingTop: 110, // clears the floating header (RootNavigator.js)
  },
  title: {
    fontSize: 19,
    fontWeight: '600',
    color: '#222',
    paddingHorizontal: 20,
    paddingTop: 15,
    paddingBottom: 12,
  },
  inner: {
    flex: 1,
    paddingHorizontal: 20,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  searchIcon: {
    position: 'absolute',
    left: 14,
    zIndex: 1,
  },
  input: {
    flex: 1,
    height: 44,
    backgroundColor: '#f0f0f4',
    borderRadius: 22,
    paddingHorizontal: 40,
    fontSize: 15.5,
    color: '#222',
  },
  searchButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    marginLeft: 8,
    backgroundColor: '#512da8',
    justifyContent: 'center',
    alignItems: 'center',
  },
  sectionHeader: {
    fontSize: 13,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 28,
    marginBottom: 6,
  },
  recentContainer: {
    flex: 1,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e6',
  },
  recentAvatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    marginRight: 12,
  },
  recentUsername: {
    flex: 1,
    fontSize: 16,
    color: '#333',
  },
  emptyText: {
    fontSize: 15,
    color: '#888',
    textAlign: 'center',
    marginTop: 40,
  },
  resultCard: {
    marginTop: 20,
    paddingVertical: 28,
    paddingHorizontal: 20,
    backgroundColor: '#fff',
    borderRadius: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  resultAvatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  resultUsername: {
    fontSize: 20,
    fontWeight: '700',
    color: '#222',
    marginTop: 12,
  },
  resultSubtitle: {
    fontSize: 13,
    color: '#888',
    marginTop: 4,
  },
  statsStrip: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    width: '100%',
    paddingVertical: 16,
    marginTop: 20,
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
  messageButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#512da8',
    paddingVertical: 12,
    paddingHorizontal: 28,
    borderRadius: 22,
    marginTop: 20,
  },
  messageButtonIcon: {
    marginRight: 8,
  },
  messageButtonText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  notFoundIcon: {
    marginTop: 10,
  },
  notFoundText: {
    marginTop: 12,
    fontSize: 15,
    color: '#888',
  },
  closeButton: {
    position: 'absolute',
    top: 12,
    right: 12,
  },
});

export default SearchScreen;
