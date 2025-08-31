import React from 'react';
import './NotificationLog.css';

const NotificationLog = ({ messages }) => {
  return (
    <div className="notification-log-container">
      <div className="notification-log">
        {messages.map((msg, index) => (
          <div key={index} className="notification-message">
            {msg}
          </div>
        ))}
      </div>
    </div>
  );
};

export default NotificationLog;
