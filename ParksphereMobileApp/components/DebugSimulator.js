import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { handleLocationUpdate, simulateMotionActivity, startParkDetection, stopParkDetection, isDetectionEngineRunning } from '../utils/parkDetectionService';
import { startTelemetry, stopTelemetry, shareTelemetryLog, clearTelemetryLog, getTelemetryStatus, setManualLabel } from '../utils/telemetryService';
import { resetAllAppData } from '../utils/dataReset';
import { useOverlay } from '../context/OverlayContext';

const pan = new Animated.ValueXY({ x: 10, y: 400 });

const DebugSimulator = ({ userLocation }) => {
  const { activeOverlay, setActiveOverlay } = useOverlay();
  const zIndex = activeOverlay === 'Debug' ? 11 : 10;
  
  const [offsetLat, setOffsetLat] = useState(0);
  const [offsetLon, setOffsetLon] = useState(0);
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [groundTruth, setGroundTruth] = useState(null); 
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

  const [isBluetoothSimulated, setIsBluetoothSimulated] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  useEffect(() => {
    const interval = setInterval(() => {
        setIsRecording(getTelemetryStatus());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleStartRecording = async () => {
    await startTelemetry();
    setIsRecording(true);
  };

  const handleStopRecording = async () => {
    await stopTelemetry();
    setIsRecording(false);
  };

  const toggleBluetooth = () => {
    const newState = !isBluetoothSimulated;
    setIsBluetoothSimulated(newState);
    handleLocationUpdate({ bluetoothConnected: newState }, null, true);
  };

  const updateGroundTruth = (label) => {
    const nextLabel = groundTruth === label ? null : label;
    setGroundTruth(nextLabel);
    setManualLabel(nextLabel);
  };

  const simulate = async (type) => {
    if (autoTriggerRef.current) {
      clearTimeout(autoTriggerRef.current);
      autoTriggerRef.current = null;
    }

    if (type === 'RESET') {
      setOffsetLat(0);
      setOffsetLon(0);
      await resetAllAppData();
      setIsEngineRunning(false);
      setIsBluetoothSimulated(false);
      setGroundTruth(null);
      setManualLabel(null);
      return;
    }

    if (!userLocation) return;
    
    const getMockLocation = (speed = 0, latOff = offsetLat, lonOff = offsetLon) => ({
      coords: {
        latitude: userLocation.latitude + latOff,
        longitude: userLocation.longitude + lonOff,
        speed: speed / 3.6,
        accuracy: 5,
      },
      isFromSimulator: true,
      timestamp: Date.now(),
    });

    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
    let currentLatOff = offsetLat;
    let currentLonOff = offsetLon;

    switch (type) {
      case 'DRIVING':
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        for (let i = 0; i < 20; i++) {
          currentLatOff += 0.0001;
          await handleLocationUpdate(getMockLocation(40, currentLatOff, currentLonOff));
          await sleep(500);
        }
        setOffsetLat(currentLatOff);
        return;

      case 'WALKING':
        simulateMotionActivity('WALKING', 'HIGH');
        for (let i = 0; i < 15; i++) {
          currentLatOff += 0.00005;
          await handleLocationUpdate(getMockLocation(1.5, currentLatOff, currentLonOff));
          await sleep(500);
        }
        setOffsetLat(currentLatOff);
        return;

      case 'STATIONARY':
        simulateMotionActivity('STATIONARY', 'HIGH');
        for (let i = 0; i < 4; i++) {
          await handleLocationUpdate(getMockLocation(0, currentLatOff, currentLonOff));
          await sleep(500);
        }
        return;
      case 'FORCE_PARK':
        if (userLocation) {
           await handleLocationUpdate({
              coords: { ...userLocation, speed: 0, accuracy: 5 },
              forcePark: true,
              isFromSimulator: true,
              timestamp: Date.now()
           });
        }
        return;
    }
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
      <Text style={styles.headerTitle}>FLIGHT RECORDER</Text>
      
      <View style={styles.row}>
        {!isRecording ? (
          <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#22c55e' }]} onPress={handleStartRecording}>
            <Text style={styles.btnText}>⏺ START RECORDING</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#ef4444' }]} onPress={handleStopRecording}>
            <Text style={styles.btnText}>⏹ STOP & SAVE</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, { width: '48%', backgroundColor: '#3b82f6' }]} onPress={shareTelemetryLog}>
          <Text style={styles.btnText}>📤 EXPORT</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { width: '48%', backgroundColor: '#f59e0b' }]} onPress={clearTelemetryLog}>
          <Text style={styles.btnText}>🗑️ CLEAR</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />
      <Text style={styles.headerTitle}>GROUND TRUTH (ACTUAL STATE)</Text>
      
      <View style={styles.grid}>
        {['DRIVING', 'WALKING', 'STOPPED', 'RETURNING'].map(state => (
          <TouchableOpacity 
            key={state}
            style={[
              styles.gridBtn, 
              { backgroundColor: groundTruth === state ? '#22c55e' : '#333' }
            ]} 
            onPress={() => updateGroundTruth(state)}
          >
            <Text style={[styles.btnText, { fontSize: 8 }]}>{state}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <View style={styles.divider} />
      <Text style={styles.headerTitle}>ENGINE & SIMULATION</Text>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, { backgroundColor: isEngineRunning ? '#ef4444' : '#22c55e', width: '100%' }]} onPress={toggleEngine}>
          <Text style={styles.btnText}>{isEngineRunning ? '⏹ STOP ENGINE' : '▶ START ENGINE'}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('DRIVING')}>
          <Text style={styles.btnText}>🚗 DRIVE</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('WALKING')}>
          <Text style={styles.btnText}>🏃 WALK</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('STATIONARY')}>
          <Text style={styles.btnText}>🛑 STILL</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { backgroundColor: '#f59e0b' }]} onPress={() => simulate('FORCE_PARK')}>
          <Text style={styles.btnText}>🅿️ PARK</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, {width: '100%', backgroundColor: '#ef4444', marginTop: 5}]} onPress={() => simulate('RESET')}>
          <Text style={styles.btnText}>🔥 FACTORY RESET</Text>
        </TouchableOpacity>
      </View>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'rgba(15, 15, 15, 0.95)',
    padding: 12,
    borderRadius: 16,
    width: 200,
    zIndex: 9999,
    elevation: 10,
    borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.15)',
    marginVertical: 10,
  },
  headerTitle: {
    color: '#4ade80',
    fontSize: 9,
    fontWeight: '900',
    marginBottom: 8,
    textAlign: 'center',
    letterSpacing: 1,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  gridBtn: {
    width: '48%',
    height: 30,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 6,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  btn: {
    backgroundColor: '#333',
    paddingVertical: 8,
    borderRadius: 8,
    width: 85,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
  },
  btnText: {
    color: 'white',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default DebugSimulator;
