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
    backgroundColor: '#ffffff',
    padding: 10,
    marginHorizontal: 10,
    marginBottom: 10,
    borderRadius: 8,
    height: 100,
    borderWidth: 1,
    borderColor: '#ddd',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.2,
    shadowRadius: 2,
  },
  notificationText: {
    fontSize: 14,
    color: '#000000',
    fontWeight: '600',
    marginBottom: 4,
  },
});

export default Notifications;
