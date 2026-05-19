import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { handleLocationUpdate, simulateMotionActivity, startParkDetection, stopParkDetection, isDetectionEngineRunning } from '../utils/parkDetectionService';
import { resetAllAppData } from '../utils/dataReset';
import { useOverlay } from '../context/OverlayContext';

const pan = new Animated.ValueXY({ x: 10, y: 500 });

const DebugSimulator = ({ userLocation }) => {
  const { activeOverlay, setActiveOverlay } = useOverlay();
  const zIndex = activeOverlay === 'Debug' ? 11 : 10;
  
  const [offsetLat, setOffsetLat] = useState(0);
  const [offsetLon, setOffsetLon] = useState(0);
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const autoTriggerRef = useRef(null);

  useEffect(() => {
    setIsEngineRunning(isDetectionEngineRunning());
    return () => {
      if (autoTriggerRef.current) clearTimeout(autoTriggerRef.current);
    };
  }, []);
  
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setActiveOverlay('Debug');
        pan.setOffset({
          x: pan.x._value,
          y: pan.y._value,
        });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
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
    // Clear any pending auto-triggers to prevent race conditions
    if (autoTriggerRef.current) {
      clearTimeout(autoTriggerRef.current);
      autoTriggerRef.current = null;
    }

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
    
    const getMockLocation = (speed = 0) => ({
      coords: {
        latitude: userLocation.latitude + offsetLat,
        longitude: userLocation.longitude + offsetLon,
        speed: speed / 3.6, // Convert km/h back to m/s
        accuracy: 5,
      },
      isFromSimulator: true,
      timestamp: Date.now(),
    });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    switch (type) {
      case 'DRIVING':
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        for (let i = 0; i < 5; i++) {
          await handleLocationUpdate(getMockLocation(50));
          await sleep(500);
        }
        autoTriggerRef.current = setTimeout(async () => {
          console.log('[Debug] Auto-triggering STOPPED...');
          await simulate('STOPPED');
        }, 5000);
        return;

      case 'STOPPED':
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        for (let i = 0; i < 5; i++) {
          await handleLocationUpdate(getMockLocation(0.5));
          await sleep(500);
        }
        return;

      case 'WALKING':
        simulateMotionActivity('WALKING', 'HIGH');
        for (let i = 0; i < 6; i++) {
          await handleLocationUpdate(getMockLocation(5));
          await sleep(500);
        }
        autoTriggerRef.current = setTimeout(async () => {
          console.log('[Debug] Auto-triggering STATIONARY...');
          await simulate('STATIONARY');
        }, 3000);
        return;

      case 'STATIONARY':
        simulateMotionActivity('STATIONARY', 'HIGH');
        for (let i = 0; i < 4; i++) {
          await handleLocationUpdate(getMockLocation(0));
          await sleep(500);
        }
        return;

      case 'PARKED':
        simulateMotionActivity('STATIONARY', 'HIGH');
        const parkedLoc = getMockLocation(0);
        parkedLoc.forcePark = true;
        for (let i = 0; i < 3; i++) {
          await handleLocationUpdate(parkedLoc);
          await sleep(500);
        }
        return;
    }
    
    console.log(`[Debug] Simulating ${type} at offset ${offsetLat.toFixed(5)}...`);
    await handleLocationUpdate(getMockLocation(0));
  };

  return (
    <Animated.View
      style={[
        styles.container,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
          zIndex: zIndex
        },
      ]}
      {...panResponder.panHandlers}
    >
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
          <Text style={styles.btnText}>🅿️ Park</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('STEP')}>
          <Text style={styles.btnText}>🚶 Walk</Text>
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
    zIndex: 9999,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
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