import React, { useState } from 'react';
import { StyleSheet, View, Text, TouchableOpacity } from 'react-native';
import { handleLocationUpdate, resetParkDetection, simulateMotionActivity } from '../utils/parkDetectionService';

const DebugSimulator = ({ userLocation }) => {
  const [offsetLat, setOffsetLat] = useState(0);
  const [offsetLon, setOffsetLon] = useState(0);

  const simulate = async (type) => {
    if (type === 'RESET') {
      setOffsetLat(0);
      setOffsetLon(0);
      await resetParkDetection();
      return;
    }

    if (type === 'STEP') {
      // Shift roughly 20 meters North-East
      setOffsetLat(prev => prev + 0.0002);
      setOffsetLon(prev => prev + 0.0002);
      type = 'WALKING'; // After stepping, we simulate a walking update
    }

    if (!userLocation) return;

    let mockLocation = {
      coords: {
        latitude: userLocation.latitude + offsetLat,
        longitude: userLocation.longitude + offsetLon,
        speed: 0,
      },
      timestamp: Date.now(),
    };

    switch (type) {
      case 'DRIVING':
        mockLocation.coords.speed = 13.8; // 50 km/h
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        // Auto-stop after 5 seconds
        setTimeout(async () => {
          console.log('[Debug] Auto-triggering STOPPED...');
          await simulate('STOPPED');
        }, 5000);
        break;
      case 'STOPPED':
        mockLocation.coords.speed = 0.1;
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        break;
      case 'WALKING':
        mockLocation.coords.speed = 1.4; // 5 km/h
        simulateMotionActivity('WALKING', 'HIGH');
        // Auto-idle after 3 seconds
        setTimeout(async () => {
          console.log('[Debug] Auto-triggering STATIONARY...');
          await simulate('STATIONARY');
        }, 3000);
        break;
      case 'STATIONARY':
        mockLocation.coords.speed = 0;
        simulateMotionActivity('STATIONARY', 'HIGH');
        break;
      case 'PARKED':
        mockLocation.coords.speed = 0;
        simulateMotionActivity('STATIONARY', 'HIGH');
        mockLocation.forcePark = true; // Signal to service to force-set parked location
        break;
    }

    console.log(`[Debug] Simulating ${type} at offset ${offsetLat.toFixed(5)}...`);
    await handleLocationUpdate(mockLocation);
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>HMM Simulator</Text>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('DRIVING')}>
          <Text style={styles.btnText}>🚗 Drive</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('STOPPED')}>
          <Text style={styles.btnText}>🛑 Stop</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('PARKED')}>
          <Text style={styles.btnText}>🅿️ Parked</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('STEP')}>
          <Text style={styles.btnText}>🚶 Step Out</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, {width: '100%'}]} onPress={() => simulate('RESET')}>
          <Text style={styles.btnText}>🔄 Reset Engine</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    bottom: 100,
    left: 10,
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 10,
    borderRadius: 10,
    width: 160,
  },
  title: {
    color: 'white',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 5,
    textAlign: 'center',
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 5,
  },
  btn: {
    backgroundColor: '#444',
    padding: 5,
    borderRadius: 5,
    width: 65,
    alignItems: 'center',
  },
  btnText: {
    color: 'white',
    fontSize: 10,
  },
});

export default DebugSimulator;