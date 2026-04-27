import React, { useState, useEffect } from 'react';
import { StyleSheet, View, Text, DeviceEventEmitter } from 'react-native';

const HMMOverlay = () => {
  const [hmmStatus, setHmmStatus] = useState({
    state: 'INITIALIZING',
    bestState: '...',
    confidence: 0
  });

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('parkDetectionDetailedUpdate', (data) => {
      setHmmStatus(data);
    });
    return () => subscription.remove();
  }, []);

  return (
    <View style={styles.statusOverlay}>
      <Text style={styles.statusTitle}>HMM Engine</Text>
      <Text style={styles.statusText}>State: <Text style={styles.statusValue}>{hmmStatus.state}</Text></Text>
      <Text style={styles.statusText}>Conf: <Text style={styles.statusValue}>{Math.round(hmmStatus.confidence * 100)}%</Text></Text>
      <Text style={styles.statusText}>Best: <Text style={styles.statusValue}>{hmmStatus.bestState}</Text></Text>
    </View>
  );
};

const styles = StyleSheet.create({
  statusOverlay: {
    position: 'absolute',
    top: 50,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 10,
    borderRadius: 8,
    width: 150,
    zIndex: 9999, // Ensure it's above everything
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  statusTitle: {
    color: '#00ff00',
    fontSize: 10,
    fontWeight: 'bold',
    marginBottom: 4,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  statusText: {
    color: 'white',
    fontSize: 12,
    marginBottom: 2,
    fontFamily: 'monospace',
  },
  statusValue: {
    fontWeight: 'bold',
    color: '#4ade80',
  },
});

export default HMMOverlay;
