import React from 'react';
import './Notification.css';

const Notification = ({ message, onAccept, onDecline, onClose }) => {
  return (
    <div className="notification-overlay">
      <div className="notification-card">
        <p>{message}</p>
        <div className="notification-actions">
          <button onClick={onAccept} className="notification-button accept">Accept</button>
          <button onClick={onDecline} className="notification-button decline">Decline</button>
        </div>
        <button onClick={onClose} className="notification-close-button">X</button>
      </div>
    </div>
  );
};

export default Notification;