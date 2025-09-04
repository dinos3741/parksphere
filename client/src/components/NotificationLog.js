import React from 'react';
import './NotificationLog.css';

const NotificationLog = ({ messages }) => {
  return (
    <div className="notification-log-container">
      <div className="notification-log">
        {messages.map(notification => (
          <div key={notification.id} className="notification-message" style={{ color: notification.color === 'blue' ? 'blue' : notification.color === 'purple' ? 'purple' : 'black' }}>
            [{notification.timestamp}] {notification.message}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationLog;
