import React, { useRef, useState } from 'react';
import { View, Text, StyleSheet, PanResponder } from 'react-native';

const THUMB_SIZE = 26;
const TOUCH_AREA_HEIGHT = 32; // taller than the visual line, so the track is easy to grab
const LINE_HEIGHT = 6;

// Custom-built rather than a native slider library — avoids a new native dependency (and the
// pod install + rebuild that comes with it) for what's otherwise a simple drag-to-select control.
const RangeSlider = ({ min, max, step = 1, value, onValueChange }) => {
  const [trackWidth, setTrackWidth] = useState(0);
  const containerRef = useRef(null);
  const containerPageX = useRef(0);

  const valueFromAbsoluteX = (pageX, width) => {
    const x = pageX - containerPageX.current;
    const ratio = Math.max(0, Math.min(1, x / width));
    const raw = min + ratio * (max - min);
    const stepped = Math.round(raw / step) * step;
    return Math.max(min, Math.min(max, stepped));
  };

  // Re-measure on every touch-down (not just once at layout time) so a parent ScrollView having
  // scrolled since mount doesn't throw off the absolute-position math.
  const measureAndApply = (pageX) => {
    containerRef.current?.measure((_x, _y, width, _height, absX) => {
      containerPageX.current = absX;
      if (width > 0) onValueChange(valueFromAbsoluteX(pageX, width));
    });
  };

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      // Capture-phase claims: without these, a vertical ScrollView ancestor (this slider lives in
      // one, on the Profile screen) can win the gesture negotiation before this responder gets a
      // chance to, making the slider un-draggable.
      onStartShouldSetPanResponderCapture: () => true,
      onMoveShouldSetPanResponderCapture: () => true,
      onPanResponderGrant: (evt) => measureAndApply(evt.nativeEvent.pageX),
      onPanResponderMove: (evt, gestureState) => measureAndApply(gestureState.moveX),
    })
  ).current;

  const ratio = max > min ? (value - min) / (max - min) : 0;

  return (
    <View>
      <Text style={styles.valueLabel}>{value} km</Text>
      <View
        ref={containerRef}
        collapsable={false}
        style={styles.touchArea}
        onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
        {...panResponder.panHandlers}
      >
        <View style={styles.trackLine} />
        <View style={[styles.filledTrack, { width: ratio * trackWidth }]} />
        <View style={[styles.thumb, { left: ratio * trackWidth - THUMB_SIZE / 2 }]} />
      </View>
      <View style={styles.endLabels}>
        <Text style={styles.endLabel}>{min} km</Text>
        <Text style={styles.endLabel}>{max} km</Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  valueLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#512da8',
    textAlign: 'center',
    marginBottom: 12,
  },
  touchArea: {
    height: TOUCH_AREA_HEIGHT,
    justifyContent: 'center',
  },
  trackLine: {
    height: LINE_HEIGHT,
    borderRadius: LINE_HEIGHT / 2,
    backgroundColor: '#e0e0e0',
  },
  filledTrack: {
    position: 'absolute',
    top: (TOUCH_AREA_HEIGHT - LINE_HEIGHT) / 2,
    left: 0,
    height: LINE_HEIGHT,
    borderRadius: LINE_HEIGHT / 2,
    backgroundColor: '#512da8',
  },
  thumb: {
    position: 'absolute',
    top: (TOUCH_AREA_HEIGHT - THUMB_SIZE) / 2,
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_SIZE / 2,
    backgroundColor: '#fff',
    borderWidth: 2,
    borderColor: '#512da8',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.25,
    shadowRadius: 2,
  },
  endLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  endLabel: {
    fontSize: 12,
    color: '#666',
  },
});

export default RangeSlider;
