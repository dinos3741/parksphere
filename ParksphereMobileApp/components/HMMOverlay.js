import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, View, Text, DeviceEventEmitter, Animated, PanResponder, Platform } from 'react-native';
import { useOverlay } from '../context/OverlayContext';
import { getTelemetryStatus } from '../utils/telemetryService';
import { formatEta } from '../utils/returnBoundary';

const HMMOverlay = ({ isVisible }) => {
  const { activeOverlay, setActiveOverlay } = useOverlay();
  const zIndex = activeOverlay === 'HMM' ? 11 : 10;

  const [hmmStatus, setHmmStatus] = useState({
    state: 'INITIALIZING',
    bestState: '...',
    confidence: 0,
    metrics: {}
  });

  // R3: native's authoritative current-state (persisted in the background), read on foreground. Shown
  // until the live HMM produces a real (non-INITIALIZING) state, so foreground is in sync instantly.
  const [nativeState, setNativeState] = useState(null);

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
    // R3: seed from native's authoritative state on foreground (in sync, no stale flash).
    const nativeSub = DeviceEventEmitter.addListener('nativeCurrentState', (s) => {
      if (s?.state) setNativeState(String(s.state).toUpperCase());
    });
    return () => { subscription.remove(); nativeSub.remove(); };
  }, []);

  if (!isVisible) return null;

  // Show the live HMM state once it's real; until then (foreground resume / cold HMM) show native's
  // authoritative state so the user always sees the TRUE current state, in sync with the background.
  const displayState = (hmmStatus.state && hmmStatus.state !== 'INITIALIZING')
    ? hmmStatus.state
    : (nativeState || hmmStatus.state);

  const getZoneColor = (zone) => {
    switch (zone) {
      case 'COMMIT': return '#4ade80'; // green
      case 'SOFT': return '#fbbf24';   // amber
      default: return '#ff4444';       // red (WAIT)
    }
  };

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
        <View style={styles.titleContainer}>
          <Text style={styles.statusTitle}>HMM Engine</Text>
        </View>
        {isRecording && (
          <Animated.View style={[styles.recIndicator, { opacity: blinkAnim }]}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>REC</Text>
          </Animated.View>
        )}
      </View>
      <Text style={styles.statusText}>State: <Text style={styles.statusValue}>{displayState}</Text></Text>
      <Text style={styles.statusText}>Conf: <Text style={styles.statusValue}>{Math.round(hmmStatus.confidence * 100)}%</Text></Text>
      <Text style={styles.statusText}>Sensor: <Text style={styles.statusValue}>{getMotionText()}</Text></Text>
      {Platform.OS === 'android' && (
        <View style={styles.btRow}>
          <Text style={styles.statusText}>Bluetooth:</Text>
          <View style={[
            styles.btDot, 
            { backgroundColor: hmmStatus.metrics?.bluetoothConnected ? '#4ade80' : '#ff4444' }
          ]} />
        </View>
      )}
      <Text style={styles.statusText}>steps/sec: <Text style={styles.statusValue}>{(hmmStatus.metrics?.stepRate || 0).toFixed(2)}</Text></Text>
      <Text style={styles.statusText}>G-acc: <Text style={styles.statusValue}>{(hmmStatus.metrics?.acceleration || 1.0).toFixed(2)}</Text></Text>
      
      <View style={styles.surenessRow}>
        <Text style={styles.surenessText}>RETURN SURENESS:</Text>
        <Text style={styles.surenessValue}>{Math.round((hmmStatus.returningConfidence || 0) * 100)}%</Text>
      </View>

      <Text style={styles.statusText}>Zone: <Text style={[styles.statusValue, { color: getZoneColor(hmmStatus.zone) }]}>{hmmStatus.zone || 'WAIT'}</Text></Text>
      <Text style={styles.statusText}>Dist: <Text style={styles.statusValue}>{(hmmStatus.metrics?.distToParked ?? 0).toFixed(0)}m</Text></Text>
      <Text style={styles.statusText}>ETA: <Text style={styles.statusValue}>{formatEta(hmmStatus.etaSeconds)}</Text></Text>
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
  titleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  btIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#3b82f6', // bright blue dot for BT
    marginLeft: 4,
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
  btRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 2,
  },
  btDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: 6,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  surenessRow: {
    marginTop: 6,
    paddingTop: 4,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.1)',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  surenessText: {
    color: '#fbbf24',
    fontSize: 8,
    fontWeight: '900',
  },
  surenessValue: {
    color: '#fbbf24',
    fontSize: 10,
    fontWeight: 'bold',
  },
});

export default HMMOverlay;
