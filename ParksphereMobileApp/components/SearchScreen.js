import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const SearchScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>Search Screen</Text>
      <Text>This is the search screen content.</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 20,
  },
  backButton: {
    marginTop: 20,
    padding: 10,
    backgroundColor: '#007bff',
    borderRadius: 5,
  },
  backButtonText: {
    color: 'white',
    fontSize: 16,
  },
});

export default SearchScreen;
