import React, { useState, useRef, useEffect } from 'react';
import { StyleSheet, View, Text, ScrollView, PanResponder, Animated, Dimensions } from 'react-native';

const Notifications = ({ notifications, onHeightChange }) => {
  const windowHeight = Dimensions.get('window').height;
  const initialHeight = 100; // Starting height
  const minHeight = 50;
  const maxHeight = windowHeight * 0.5; // Max 50% of screen height

  const [currentHeight, setCurrentHeight] = useState(initialHeight);
  const animatedHeight = useRef(new Animated.Value(initialHeight)).current;
  // startDragHeight will be used to store the height at the moment the drag begins
  const startDragHeight = useRef(initialHeight);

  // Sync animatedHeight with currentHeight state (optional, but good for initial setup)
  useEffect(() => {
    animatedHeight.setValue(currentHeight);
    if (onHeightChange) {
      onHeightChange(currentHeight); // Notify parent of initial height
    }
  }, [currentHeight, onHeightChange]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        // When drag starts, store the current height as the base
        startDragHeight.current = animatedHeight._value;
      },
      onPanResponderMove: (evt, gestureState) => {
        let newHeight = startDragHeight.current - gestureState.dy;

        // Clamp the new height within min/max bounds
        newHeight = Math.max(minHeight, Math.min(maxHeight, newHeight));

        // Update the animated value directly
        animatedHeight.setValue(newHeight);
      },
      onPanResponderRelease: () => {
        // Once the drag is released, save the final animated height to the state
        const finalHeight = animatedHeight._value;
        setCurrentHeight(finalHeight);
        if (onHeightChange) {
          onHeightChange(finalHeight); // Notify parent of final height change
        }
      },
    })
  ).current;

  return (
    <Animated.View style={[styles.notificationArea, { height: animatedHeight }]}>
      <View style={styles.resizeHandle} {...panResponder.panHandlers}>
        <View style={styles.handleIndicator} />
      </View>
      <ScrollView style={styles.scrollViewContent}>
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
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    paddingHorizontal: 10,
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 8,
    overflow: 'hidden',
    flexDirection: 'column', // Stack children vertically
    borderWidth: 1, // Add border to make container visible
    borderColor: '#ddd',
  },
  resizeHandle: {
    width: '100%',
    height: 20, // Make handle taller for easier touch
    backgroundColor: '#f0f0f0',
    borderTopLeftRadius: 8,
    borderTopRightRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 5, // Space between handle and content
    // Position handle at the very top of the padding area
    marginTop: -10,
    marginHorizontal: -10,
    paddingTop: 10, // Create a clickable area on top of the border
  },
  handleIndicator: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ccc',
  },
  scrollViewContent: {
    flex: 1, // Take remaining space
    paddingBottom: 10, // Add some bottom padding to the scroll view
  },
  notificationText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 5,
  },
});

export default Notifications;
