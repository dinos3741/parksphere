import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, DeviceEventEmitter, Animated, PanResponder } from 'react-native';

const HMMOverlay = () => {
  const [hmmStatus, setHmmStatus] = useState({
    state: 'INITIALIZING',
    bestState: '...',
    confidence: 0,
    metrics: {}
  });

  const pan = useRef(new Animated.ValueXY({ x: 10, y: 100 })).current;
  
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
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

  const getMotionText = () => {
    const act = hmmStatus.metrics?.motionActivity;
    if (!act) return '❓ Loading...';
    if (act.automotive) return `🚗 Auto (${act.confidence})`;
    if (act.walking) return `🚶 Walk (${act.confidence})`;
    if (act.stationary) return `💤 Still (${act.confidence})`;
    if (act.unknown) return `📱 Active (${act.confidence})`;
    return '❓ Unknown';
  };

  return (
    <Animated.View 
      style={[
        styles.statusOverlay,
        {
          transform: [{ translateX: pan.x }, { translateY: pan.y }],
        },
      ]}
      {...panResponder.panHandlers}
    >
      <Text style={styles.statusTitle}>HMM Engine</Text>
      <Text style={styles.statusText}>State: <Text style={styles.statusValue}>{hmmStatus.state}</Text></Text>
      <Text style={styles.statusText}>Conf: <Text style={styles.statusValue}>{Math.round(hmmStatus.confidence * 100)}%</Text></Text>
      <Text style={styles.statusText}>Sensor: <Text style={styles.statusValue}>{getMotionText()}</Text></Text>
      <Text style={styles.statusText}>Step: <Text style={styles.statusValue}>{(hmmStatus.metrics?.stepRate || 0).toFixed(2)}</Text></Text>
      <Text style={styles.statusText}>Move: <Text style={styles.statusValue}>{(hmmStatus.metrics?.acceleration || 1.0).toFixed(2)}</Text></Text>
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
