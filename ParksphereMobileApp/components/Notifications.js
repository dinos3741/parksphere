import React, { useState, useRef } from 'react';
import { StyleSheet, View, Text, ScrollView, PanResponder } from 'react-native';

const Notifications = ({ notifications }) => {
  const [height, setHeight] = useState(100);
  const startHeight = useRef(100);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        startHeight.current = height;
      },
      onPanResponderMove: (e, gestureState) => {
        // dy is negative when dragging up
        const newHeight = Math.max(80, Math.min(500, startHeight.current - gestureState.dy));
        setHeight(newHeight);
      },
      onPanResponderRelease: () => {
        startHeight.current = height;
      },
    })
  ).current;

  return (
    <View style={[styles.notificationArea, { height }]}>
      <View {...panResponder.panHandlers} style={styles.resizeHandle}>
        <View style={styles.handleBar} />
      </View>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {notifications.map((notification, index) => (
          <Text key={index} style={styles.notificationText}>
            [{notification.timestamp}] {notification.msg}
          </Text>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  notificationArea: {
    backgroundColor: '#ffffff',
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
  },
  resizeHandle: {
    width: '100%',
    height: 30, // Large touch area for easy grabbing
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f8f8f8',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  handleBar: {
    width: 40,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#ccc',
  },
  scrollContent: {
    padding: 10,
  },
  notificationText: {
    fontSize: 14,
    color: '#000000',
    fontWeight: '600',
    marginBottom: 4,
  },
});

export default Notifications;