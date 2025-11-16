import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const AboutScreen = () => {
  return (
    <View style={styles.container}>
      <Text style={styles.title}>About Parksphere</Text>
      <Text style={styles.description}>
        Parksphere is a mobile application that helps you find parking spots in the city.
        You can declare your parking spot when you are about to leave, and other users can request it.
        This creates a community of drivers helping each other to find parking faster.
      </Text>
      <Text style={styles.footerText}>© 2025 Konstantinos Dimou</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 20,
    backgroundColor: 'white',
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
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
    marginTop: 30,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
  },
  footerText: {
    position: 'absolute',
    bottom: 20,
    left: 0,
    right: 0,
    textAlign: 'center',
    fontSize: 12,
    color: 'grey',
  },
});

export default AboutScreen;
