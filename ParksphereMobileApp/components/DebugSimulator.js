import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { handleLocationUpdate, simulateMotionActivity, startParkDetection, stopParkDetection, isDetectionEngineRunning, resetParkDetection } from '../utils/parkDetectionService';
import { startTelemetry, stopTelemetry, shareTelemetryLog, clearTelemetryLog, getTelemetryStatus } from '../utils/telemetryService';
import { resetAllAppData } from '../utils/dataReset';
import { useOverlay } from '../context/OverlayContext';
import { SCENARIOS } from '../tests/simulationScenarios';
import { runScenario, stopScenario } from '../tests/scenarioRunner';

const pan = new Animated.ValueXY({ x: 10, y: 500 });

const DebugSimulator = ({ userLocation }) => {
  const { activeOverlay, setActiveOverlay } = useOverlay();
  const zIndex = activeOverlay === 'Debug' ? 11 : 10;
  
  const [offsetLat, setOffsetLat] = useState(0);
  const [offsetLon, setOffsetLon] = useState(0);
  const [isEngineRunning, setIsEngineRunning] = useState(false);
  const [selectedScenario, setSelectedScenario] = useState('HAPPY_PATH');
  const [isScenarioRunning, setIsScenarioRunning] = useState(false);
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

  const handleRunScenario = async () => {
    if (!userLocation) return;
    setIsScenarioRunning(true);
    await runScenario(selectedScenario, userLocation);
  };

  const handleStopScenario = () => {
    stopScenario();
    setIsScenarioRunning(false);
  };

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
    setIsRecording(getTelemetryStatus());
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
      setIsScenarioRunning(false);
      stopScenario();
      return;
    }

    if (type === 'STEP') {
      setOffsetLat(prev => prev + 0.0002);
      setOffsetLon(prev => prev + 0.0002);
      type = 'WALKING';
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
        autoTriggerRef.current = setTimeout(async () => {
          await simulate('STOPPED');
        }, 5000);
        return;

      case 'STOPPED':
        simulateMotionActivity('AUTOMOTIVE', 'HIGH');
        for (let i = 0; i < 8; i++) {
          await handleLocationUpdate(getMockLocation(0.2, currentLatOff, currentLonOff));
          await sleep(500);
        }
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
    }
    
    await handleLocationUpdate(getMockLocation(0, currentLatOff, currentLonOff));
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
      <Text style={styles.title}>HMM Debug Simulator</Text>
      
      <View style={styles.pickerContainer}>
        <Picker
          selectedValue={selectedScenario}
          onValueChange={(itemValue) => setSelectedScenario(itemValue)}
          style={styles.picker}
          itemStyle={styles.pickerItem}
        >
          {Object.keys(SCENARIOS).map(key => (
            <Picker.Item key={key} label={SCENARIOS[key].name} value={key} />
          ))}
        </Picker>
      </View>

      <View style={styles.row}>
        {!isScenarioRunning ? (
          <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#0275d8' }]} onPress={handleRunScenario}>
            <Text style={styles.btnText}>🚀 Run Selected</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#d9534f' }]} onPress={handleStopScenario}>
            <Text style={styles.btnText}>🛑 Stop Scenario</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={[styles.divider, { marginVertical: 5 }]} />

      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('WALKING')}>
          <Text style={styles.btnText}>🏃 Walk</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, {backgroundColor: isBluetoothSimulated ? '#5cb85c' : '#444'}]} onPress={toggleBluetooth}>
          <Text style={styles.btnText}>BT: {isBluetoothSimulated ? 'ON' : 'OFF'}</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('STATIONARY')}>
          <Text style={styles.btnText}>🛑 Still</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.btn} onPress={() => simulate('STEP')}>
          <Text style={styles.btnText}>🚶 Step</Text>
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

      <View style={[styles.divider, { marginVertical: 5 }]} />
      <Text style={styles.title}>Flight Recorder</Text>
      
      <View style={styles.row}>
        {!isRecording ? (
          <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#5cb85c' }]} onPress={handleStartRecording}>
            <Text style={styles.btnText}>⏺ Start Recording</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#d9534f' }]} onPress={handleStopRecording}>
            <Text style={styles.btnText}>⏹ Stop & Save</Text>
          </TouchableOpacity>
        )}
      </View>

      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, { width: '48%', backgroundColor: '#0275d8' }]} onPress={shareTelemetryLog}>
          <Text style={styles.btnText}>📤 Export</Text>
        </TouchableOpacity>
        <TouchableOpacity style={[styles.btn, { width: '48%', backgroundColor: '#f0ad4e' }]} onPress={clearTelemetryLog}>
          <Text style={styles.btnText}>🗑️ Clear</Text>
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
    width: 180, // 🚀 Slightly wider for picker
    zIndex: 9999,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  pickerContainer: {
    backgroundColor: '#333',
    borderRadius: 5,
    marginBottom: 5,
    height: 40,
    justifyContent: 'center',
    overflow: 'hidden',
  },
  picker: {
    color: 'white',
    height: 40,
  },
  pickerItem: {
    fontSize: 10,
    height: 40,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.2)',
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
    width: 75, // 🚀 Slightly wider
    alignItems: 'center',
  },
  btnText: {
    color: 'white',
    fontSize: 10,
  },
});

export default DebugSimulator;