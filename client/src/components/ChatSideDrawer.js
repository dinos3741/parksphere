import React, { useRef, useEffect } from 'react';
import emitter from '../utils/emitter';
import messageSound from '../assets/sounds/message-sound.wav';
import './ChatSideDrawer.css';

const ChatSideDrawer = ({ isOpen, onClose, title, messages, recipient, onSendMessage, chatInput, onChatInputChange }) => {
  const drawerRef = useRef(null);
  const audioRef = useRef(new Audio(messageSound));

  useEffect(() => {
    const playSound = (data) => {
      // Only play sound if the message is from the recipient, not the current user
      if (recipient && data.from === recipient.id) {
        audioRef.current.play();
      }
    };

    emitter.on('chatMessage', playSound);

    return () => {
      emitter.off('chatMessage', playSound);
    };
  }, [recipient]);

  return (
    <div ref={drawerRef} className={`chat-side-drawer ${isOpen ? 'open' : ''}`}>
      <div className="chat-side-drawer-header">
        <h3>{title}</h3>
        <button className="close-button" onClick={onClose}>X</button>
      </div>
      <div className="chat-side-drawer-content">
        {recipient && messages.map((msg, index) => (
          <div key={index} className={`chat-message ${msg.from === recipient.id ? 'received' : 'sent'}`}>
            <p>{msg.message}</p>
          </div>
        ))}
      </div>
      <div className="chat-side-drawer-footer">
        <textarea 
          className="chat-input" 
          placeholder="Type your message..." 
          value={chatInput} 
          onChange={(e) => onChatInputChange(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && !e.shiftKey && onSendMessage()}
        />
        <button className="send-button" onClick={onSendMessage}>Send</button>
      </div>
    </div>
  );
};

export default ChatSideDrawer;
