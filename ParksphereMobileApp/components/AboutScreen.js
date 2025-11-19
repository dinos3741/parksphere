import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome'; // Import FontAwesome

const AboutScreen = ({ onClose }) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onClose}>
        <FontAwesome name="arrow-left" size={24} color="#007bff" />
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>Welcome to Parksphere</Text>
        
        <Text style={styles.description}>
          Park Sphere helps drivers find free parking spots in real time by connecting those who are about to leave with those looking to park. Simply open the app to view nearby spots that will soon become available, reserve one with a small tip, and head to the location while the other driver waits. Whether you're leaving or arriving, 
          Park Sphere makes city parking faster, easier, and stress-free.
        </Text>
        <Text style={styles.title}>How ParkSphere works</Text>
        <View style={styles.stepContainer}>
          <Text style={styles.step}>Step 1: Find nearby parking spots that will soon be free — updated in real time on the map.</Text>
          <Text style={styles.step}>Step 2: Request the spot by sending a small tip to reserve it.</Text>
          <Text style={styles.step}>Step 3: Get confirmation from the current driver and temporarily block the amount.</Text>
          <Text style={styles.step}>Step 4: Arrive and confirm the handoff — the spot is yours to park!</Text>
        </View>
      </ScrollView>
      <Text style={styles.footerText}>© 2025 Konstantinos Dimou</Text>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: 'white',
  },
  backButton: {
    position: 'absolute',
    top: 40,
    left: 20,
    zIndex: 1,
  },
  scrollContent: {
    padding: 20,
    paddingTop: 80, // Adjust for back button
    paddingBottom: 60, // Adjust for footer
  },
  title: {
    fontSize: 24,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
  },
  subtitle: {
    fontSize: 20,
    fontWeight: '600',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 10,
  },
  description: {
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 15,
  },
  stepContainer: {
    marginTop: 10,
  },
  step: {
    fontSize: 16,
    textAlign: 'left',
    marginBottom: 10,
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
