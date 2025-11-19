import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Image } from 'react-native';
import FontAwesome from '@expo/vector-icons/FontAwesome'; // Import FontAwesome
import parkingBackground from '../assets/images/parking_background.png'; // Import the image

const AboutScreen = ({ onClose }) => {
  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.backButton} onPress={onClose}>
        <FontAwesome name="arrow-left" size={24} color="#4dd0e1" />
      </TouchableOpacity>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.title}>What is ParkSphere?</Text>
        <Image source={parkingBackground} style={styles.mainImage} />
        
        <Text style={styles.description}>
          Park Sphere is a peer-to-peer parking app that helps drivers find free parking spots in real time
          by connecting those who are about to leave with those looking to park. Simply open the app to view 
          nearby spots that will soon become available, reserve one, and head to the location while the other 
          driver waits for your arrival. 
          If you're parking out from a spot, siply notify those around you of your impending departure to earn 
          some extra cash and/or parking credit points!
          Whether you're leaving or arriving, Park Sphere makes city parking faster, easier, and stress-free.
        </Text>
        <Text style={styles.subtitle}>How ParkSphere works</Text>
        <View style={styles.stepContainer}>
          <Text style={styles.step}><Text style={styles.highlight}>Step 1:</Text> Find nearby parking spots that will soon be free — updated in real time on the map.</Text>
          <Text style={styles.step}><Text style={styles.highlight}>Step 2:</Text> Request the spot by sending a small tip to reserve it.</Text>
          <Text style={styles.step}><Text style={styles.highlight}>Step 3:</Text> Get confirmation from the current driver and temporarily block the amount.</Text>
          <Text style={styles.step}><Text style={styles.highlight}>Step 4:</Text> Arrive and confirm the handoff — the spot is yours to park!</Text>
        </View>
      </ScrollView>
      <View style={styles.footer}>
        <Text style={styles.footerText}>© 2025 Konstantinos Dimou</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#512da8',
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
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 32,
    color: '#df1a83',
    textAlign: 'center',
    marginBottom: 20,
    letterSpacing: 2,
  },
  mainImage: {
    width: '100%',
    height: 200, // Adjust height as needed
    resizeMode: 'contain', // or 'cover', 'stretch'
    marginBottom: 20,
    borderRadius: 10,
  },
  subtitle: {
    fontFamily: 'AdventPro-SemiBold',
    fontSize: 24,
    color: '#df1a83',
    textAlign: 'center',
    marginTop: 20,
    marginBottom: 10,
    letterSpacing: 1,
  },
  description: {
    fontSize: 16,
    color: 'white',
    textAlign: 'center',
    marginBottom: 15,
    lineHeight: 24,
  },
  stepContainer: {
    marginTop: 10,
  },
  step: {
    fontSize: 16,
    color: 'white',
    textAlign: 'left',
    marginBottom: 10,
    lineHeight: 24,
  },
  highlight: {
    color: '#4dd0e1',
    fontWeight: 'bold',
  },
  accent: {
    color: '#ef306f',
    fontWeight: 'bold',
  },
  footer: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#547abb',
    paddingVertical: 10,
    borderTopLeftRadius: 10,
    borderTopRightRadius: 10,
  },
  footerText: {
    textAlign: 'center',
    fontSize: 12,
    color: 'blue',
  },
});

export default AboutScreen;
