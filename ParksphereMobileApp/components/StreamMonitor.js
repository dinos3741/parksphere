// Dev-only on-screen readout for the VisitMonitor location stream. Metro's log channel dies when the
// app deep-suspends and resumes, so console logs can't tell us whether the stream is actually alive
// after a background→foreground cycle. This overlay updates on the DEVICE (no Metro needed): if the
// fix count keeps climbing after you foreground, the stream resumed; if it's frozen, it didn't.
import React, { useEffect, useState, useRef } from 'react';
import { Text, StyleSheet, AppState, Animated, PanResponder } from 'react-native';

let VM = null;
try {
  VM = require('../modules/visit-monitor');
} catch (_) {}

export default function StreamMonitor() {
  const [count, setCount] = useState(0);
  const [last, setLast] = useState('—');
  const [appState, setAppState] = useState(AppState.currentState);

  // Draggable — this box's default position (top-right) sits right on top of the header's "+"
  // action button (RootNavigator.js), so it needs to be movable out of the way rather than fixed.
  const pan = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        pan.setOffset({ x: pan.x._value, y: pan.y._value });
        pan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: Animated.event([null, { dx: pan.x, dy: pan.y }], { useNativeDriver: false }),
      onPanResponderRelease: () => {
        pan.flattenOffset();
      },
    })
  ).current;

  useEffect(() => {
    if (!VM) return;
    const locSub = VM.addLocationBatchListener((batch) => {
      const n = batch?.locations?.length || 0;
      if (!n) return;
      setCount((c) => c + n);
      setLast(new Date().toLocaleTimeString());
    });
    const asSub = AppState.addEventListener('change', (s) => setAppState(s));
    const t = setInterval(() => setAppState(AppState.currentState), 1000); // keep the label live
    return () => {
      try { locSub?.remove(); } catch (_) {}
      try { asSub?.remove(); } catch (_) {}
      clearInterval(t);
    };
  }, []);

  return (
    <Animated.View
      style={[styles.box, { transform: pan.getTranslateTransform() }]}
      {...panResponder.panHandlers}
    >
      <Text style={styles.txt}>📡 fixes: {count}</Text>
      <Text style={styles.txt}>last: {last}</Text>
      <Text style={styles.txt}>app: {appState}</Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  box: {
    position: 'absolute',
    top: 55,
    right: 10,
    backgroundColor: 'rgba(0,0,0,0.75)',
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 8,
    zIndex: 9999,
  },
  txt: { color: '#4ade80', fontSize: 11, fontWeight: '700' },
});
