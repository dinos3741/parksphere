import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, PanResponder, Animated, Dimensions } from 'react-native';

const Notifications = ({ notifications, onHeightChange }) => {
  const windowHeight = Dimensions.get('window').height;
  const initialHeight = 150; // Use the 150 from park-detection
  const minHeight = 80;      // From park-detection
  const maxHeight = 500;     // From park-detection

  const [currentHeight, setCurrentHeight] = useState(initialHeight);
  const animatedHeight = useRef(new Animated.Value(initialHeight)).current;
  const startDragHeight = useRef(initialHeight);

  useEffect(() => {
    animatedHeight.setValue(currentHeight);
    if (onHeightChange) {
      onHeightChange(currentHeight);
    }
  }, [currentHeight, onHeightChange]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startDragHeight.current = animatedHeight._value;
      },
      onPanResponderMove: (evt, gestureState) => {
        let newHeight = startDragHeight.current - gestureState.dy;
        newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));
        animatedHeight.setValue(newHeight);
      },
      onPanResponderRelease: () => {
        const finalHeight = animatedHeight._value;
        setCurrentHeight(finalHeight);
        if (onHeightChange) {
          onHeightChange(finalHeight);
        }
      },
    })
  ).current;

  return (
    <Animated.View style={[styles.notificationArea, { height: animatedHeight }]}>
      <View style={styles.resizeHandle} {...panResponder.panHandlers}>
        <View style={styles.handleIndicator} />
      </View>
      <ScrollView style={styles.scrollViewContent} contentContainerStyle={styles.scrollContent}>
        {notifications.map((notification, index) => (
          <Text key={index} style={styles.notificationText}>
            [{notification.timestamp}] {notification.msg}
          </Text>
        ))}
      </ScrollView>
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  notificationArea: {
    backgroundColor: '#ffffff', // From park-detection
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
    overflow: 'hidden',
    flexDirection: 'column',
  },
  resizeHandle: {
    width: '100%',
    height: 30, // Large touch area from park-detection
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f8f8',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  handleIndicator: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
  },
  scrollViewContent: {
    flex: 1,
  },
  scrollContent: {
    padding: 10,
  },
  notificationText: {
    fontSize: 14,
    color: '#000000', // From park-detection
    fontWeight: '600', // From park-detection
    marginBottom: 4,
  },
});

export default Notifications;
