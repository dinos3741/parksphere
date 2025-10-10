
import React, { useState } from 'react';
import './MessageComposerModal.css';

const MessageComposerModal = ({ recipient, onClose, onSend }) => {
  const [message, setMessage] = useState('');

  const handleSend = () => {
    onSend(message);
    onClose();
  };

  if (!recipient) {
    return null;
  }

  return (
    <div className="message-composer-modal-overlay" onClick={onClose}>
      <div className="message-composer-modal-content" onClick={e => e.stopPropagation()}>
        <span className="close-modal" onClick={onClose}>&times;</span>
        <h2>Send a message to {recipient.username}</h2>
        <div className="message-composer-separator"></div>
        <textarea
          className="message-textarea"
          value={message}
          onChange={e => setMessage(e.target.value)}
          placeholder="Type your message here..."
        />
        <div className="message-composer-actions">
          <button className="send-button" onClick={handleSend}>Send</button>
          <button className="cancel-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default MessageComposerModal;

