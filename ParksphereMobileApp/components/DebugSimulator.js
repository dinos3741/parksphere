import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, TouchableOpacity, Animated, PanResponder, Alert } from 'react-native';
import { shareHeartbeatLog, setManualLabel } from '../utils/telemetryService';
import { useOverlay } from '../context/OverlayContext';
import { resetParkDetectionState } from '../utils/dataReset';

const pan = new Animated.ValueXY({ x: 10, y: 400 });

// "Flight Recorder" — was also a control panel for a legacy JS detection engine (start/stop,
// simulated drive/walk/park, ground-truth-fed simulation), superseded entirely by the native
// (Swift) engine which now owns detection on iOS for both foreground and background. Those
// controls were removed 2026-08-03 after one of them (Start Engine) got tapped during a field
// test, started that legacy engine running alongside native, and suppressed real detection for
// the rest of the drive — dead weight that was actively dangerous to leave around. What's left
// (heartbeat export, ground-truth labeling) is independent of that engine and still genuinely
// useful for field-test analysis.
const DebugSimulator = () => {
  const { activeOverlay, setActiveOverlay } = useOverlay();
  const zIndex = activeOverlay === 'Debug' ? 11 : 10;

  const [groundTruth, setGroundTruth] = useState(null);

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

  const updateGroundTruth = (label) => {
    const nextLabel = groundTruth === label ? null : label;
    setGroundTruth(nextLabel);
    setManualLabel(nextLabel);
  };

  // For an orphaned local park (parkedLocation set, geofence armed, but nothing to show it —
  // e.g. a declare that failed offline before the retry fix existed, so there's nothing pending to
  // retry either) with no real spot id to run the normal delete-spot flow against. Same function
  // AuthContext.js's login()/logout() use for an actual account change — reused here as a manual
  // escape hatch for field-test cleanup, not exposed anywhere a regular user could hit it.
  const handleResetSpot = () => {
    Alert.alert(
      'Reset spot detection?',
      'Clears your parked-car marker, geofence, and any pending spot state on this device. Does not touch other spots.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Reset',
          style: 'destructive',
          onPress: async () => {
            const ok = await resetParkDetectionState();
            Alert.alert(ok ? 'Reset' : 'Error', ok ? 'Spot detection state cleared.' : 'Reset failed — check the console.');
          },
        },
      ]
    );
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
        <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#8b5cf6' }]} onPress={shareHeartbeatLog}>
          <Text style={styles.btnText}>💓 EXPORT HEARTBEAT</Text>
        </TouchableOpacity>
      </View>
      <View style={styles.row}>
        <TouchableOpacity style={[styles.btn, { width: '100%', backgroundColor: '#dc2626' }]} onPress={handleResetSpot}>
          <Text style={styles.btnText}>🗑️ RESET SPOT</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.divider} />
      <Text style={styles.headerTitle}>GROUND TRUTH</Text>

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
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    backgroundColor: 'rgba(0,0,0,0.75)',
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
