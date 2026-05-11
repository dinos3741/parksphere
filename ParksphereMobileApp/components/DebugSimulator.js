import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { handleLocationUpdate, simulateMotionActivity, startParkDetection, stopParkDetection } from '../utils/parkDetectionService';
import { resetAllAppData } from '../utils/dataReset';

const DebugSimulator = ({ userLocation }) => {
  const [offsetLat, setOffsetLat] = useState(0);
  const [offsetLon, setOffsetLon] = useState(0);
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  
  const pan = useRef(new Animated.ValueXY({ x: 10, y: 500 })).current; // Initial position
  
  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.extractOffset();
      },
    })
  ).current;

  const toggleEngine = async () => {
    if (isEngineRunning) {
      await stopParkDetection();
      setIsEngineRunning(false);
    } else {
      await startParkDetection();
      setIsEngineRunning(true);
    }
  };

  const simulate = async (type) => {
    // ... (rest of simulation logic)
    if (type === 'RESET') {
      setOffsetLat(0);
      setOffsetLon(0);
      await resetAllAppData();
      setIsEngineRunning(false);
      return;
    }

    if (type === 'STEP') {
      setOffsetLat(prev => prev + 0.0002);
      setOffsetLon(prev => prev + 0.0002);
      type = 'WALKING';
    }

    if (!userLocation) return;
    let mockLocation = {
      coords: {
        latitude: userLocation.latitude + offsetLat,
        longitude: userLocation.longitude + offsetLon,
        speed: 0,
        accuracy: 5,
      },
      isFromSimulator: true,
      timestamp: Date.now(),
    };

    switch (type) {
      case 'DRIVING':
        mockLocation.coords.speed = 13.8;
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        for (let i = 0; i < 3; i++) {
          await handleLocationUpdate(mockLocation);
        }
        setTimeout(async () => {
          console.log('[Debug] Auto-triggering STOPPED...');
          await simulate('STOPPED');
        }, 5000);
        return;
      case 'STOPPED':
        mockLocation.coords.speed = 0.1;
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        break;
      case 'WALKING':
        mockLocation.coords.speed = 1.4;
        simulateMotionActivity('WALKING', 'HIGH');
        for (let i = 0; i < 4; i++) {
          await handleLocationUpdate(mockLocation);
        }
        setTimeout(async () => {
          console.log('[Debug] Auto-triggering STATIONARY...');
          await simulate('STATIONARY');
        }, 3000);
        return;
      case 'STATIONARY':
        mockLocation.coords.speed = 0;
        simulateMotionActivity('STATIONARY', 'HIGH');
        break;
      case 'PARKED':
        mockLocation.coords.speed = 0;
        simulateMotionActivity('STATIONARY', 'HIGH');
        mockLocation.forcePark = true;
        break;
    }
    console.log(`[Debug] Simulating ${type} at offset ${offsetLat.toFixed(5)}...`);
    await handleLocationUpdate(mockLocation);
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Text style={styles.title}>HMM Simulator (Drag me!)</Text>
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
        <TouchableOpacity style={[styles.btn, {width: '100%', backgroundColor: isEngineRunning ? '#d9534f' : '#5cb85c'}]} onPress={toggleEngine}>
          <Text style={styles.btnText}>{isEngineRunning ? '⏹ Stop Engine' : '▶ Start Engine'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, {width: '100%', backgroundColor: '#d9534f'}]} onPress={() => simulate('RESET')}>
          <Text style={styles.btnText}>🛑 Stop & Reset</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.8)',
    padding: 10,
    borderRadius: 10,
    width: 160,
  },
// ... (keep rest of styles)
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