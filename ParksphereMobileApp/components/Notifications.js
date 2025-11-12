import React from 'react';
import { StyleSheet, View, Text, ScrollView } from 'react-native';

const Notifications = ({ notifications }) => {
  return (
    <View style={styles.notificationArea}>
      <ScrollView>
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
    backgroundColor: 'transparent',
    padding: 10,
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 8,
    height: 100,
    overflow: 'hidden',
  },
  notificationText: {
    fontSize: 14,
    color: '#333',
  },
});

export default Notifications;
