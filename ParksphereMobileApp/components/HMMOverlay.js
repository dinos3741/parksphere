import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, DeviceEventEmitter, Animated, PanResponder } from 'react-native';
import { useOverlay } from '../context/OverlayContext';
import { getTelemetryStatus } from '../utils/telemetryService';

const HMMOverlay = ({ isVisible }) => {
  const { activeOverlay, setActiveOverlay } = useOverlay();
  const zIndex = activeOverlay === 'HMM' ? 11 : 10;

  const [hmmStatus, setHmmStatus] = useState({
    state: 'INITIALIZING',
    bestState: '...',
    confidence: 0,
    metrics: {}
  });

  const [isRecording, setIsRecording] = useState(false);
  const blinkAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      setIsRecording(getTelemetryStatus());
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (isRecording) {
      Animated.loop(
        Animated.sequence([
          Animated.timing(blinkAnim, { toValue: 0.3, duration: 800, useNativeDriver: true }),
          Animated.timing(blinkAnim, { toValue: 1, duration: 800, useNativeDriver: true }),
        ])
      ).start();
    } else {
      blinkAnim.setValue(1);
    }
  }, [isRecording]);

  const pan = useRef(new Animated.ValueXY({ x: 10, y: 100 })).current;

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        setActiveOverlay('HMM');
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

  useEffect(() => {
    const subscription = DeviceEventEmitter.addListener('parkDetectionDetailedUpdate', (data) => {
      setHmmStatus(data);
    });
    return () => subscription.remove();
  }, []);

  if (!isVisible) return null;

  const getMotionText = () => {
    const act = hmmStatus.metrics?.motionActivity;
    if (!act) return '❓ Loading...';
    if (act.automotive) return '🚗 Auto';
    if (act.walking) return '🚶 Walk';
    if (act.stationary) return '💤 Still';
    if (act.unknown) return '📱 Active';
    return '❓ Unknown';
  };

  return (
    <Animated.View 
      style={[
        styles.statusOverlay,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
          zIndex: zIndex
        },
      ]}
      {...panResponder.panHandlers}
    >
      <View style={styles.headerRow}>
        <Text style={styles.statusTitle}>HMM Engine</Text>
        {isRecording && (
          <Animated.View style={[styles.recIndicator, { opacity: blinkAnim }]}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>REC</Text>
          </Animated.View>
        )}
      </View>
      <Text style={styles.statusText}>State: <Text style={styles.statusValue}>{hmmStatus.state}</Text></Text>
      <Text style={styles.statusText}>Conf: <Text style={styles.statusValue}>{Math.round(hmmStatus.confidence * 100)}%</Text></Text>
      <Text style={styles.statusText}>Sensor: <Text style={styles.statusValue}>{getMotionText()}</Text></Text>
      <Text style={styles.statusText}>steps/sec: <Text style={styles.statusValue}>{(hmmStatus.metrics?.stepRate || 0).toFixed(2)}</Text></Text>
      <Text style={styles.statusText}>G-acc: <Text style={styles.statusValue}>{(hmmStatus.metrics?.acceleration || 1.0).toFixed(2)}</Text></Text>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  statusOverlay: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.75)',
    padding: 10,
    borderRadius: 8,
    width: 150,
    zIndex: 9999,
    elevation: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  statusTitle: {
    color: '#00ff00',
    fontSize: 10,
    fontWeight: 'bold',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  recIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  recDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#ff4444',
    marginRight: 3,
  },
  recText: {
    color: '#ff4444',
    fontSize: 8,
    fontWeight: 'bold',
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
