import React, { useRef, useEffect, useState } from 'react';
import './ChatSideDrawer.css';
import { socket } from '../socket';

const ChatSideDrawer = ({ isOpen, onClose, title, messages, recipient }) => {
  const drawerRef = useRef(null);
  const [message, setMessage] = useState('');

  const handleSendMessage = () => {
    if (message.trim() && recipient) {
      socket.emit('privateMessage', { to: recipient.id, message });
      setMessage('');
    }
  };

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  return (
    <div ref={drawerRef} className={`chat-side-drawer ${isOpen ? 'open' : ''}`}>
      <div className="chat-side-drawer-header">
        <h3>{title}</h3>
        <button className="close-button" onClick={onClose}>X</button>
      </div>
      <div className="chat-side-drawer-content">
        {messages.map((msg, index) => (
          <div key={index} className={`chat-message ${msg.from === recipient.id ? 'received' : 'sent'}`}>
            <p>{msg.message}</p>
          </div>
        ))}
      </div>
      <div className="chat-side-drawer-footer">
        <textarea 
          className="chat-input" 
          placeholder="Type your message..." 
          value={message} 
          onChange={(e) => setMessage(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && handleSendMessage()}
        />
        <button className="send-button" onClick={handleSendMessage}>Send</button>
      </div>
    </div>
  );
};

export default ChatSideDrawer;
