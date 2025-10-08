
import React, { useState } from 'react';
import './MessageComposerModal.css';

const MessageComposerModal = ({ isOpen, onClose, recipientUsername }) => {
  const [message, setMessage] = useState('');

  if (!isOpen) {
    return null;
  }

  const handleSend = () => {
    console.log(`Sending message to ${recipientUsername}: ${message}`);
    onClose();
  };

  return (
    <div className="message-composer-modal-overlay" onClick={onClose}>
      <div className="message-composer-modal-content" onClick={e => e.stopPropagation()}>
        <div className="message-composer-modal-header">
          <h2>Send a message to {recipientUsername}</h2>
          <button onClick={onClose} className="message-composer-modal-close-button">&times;</button>
        </div>
        <div className="message-composer-modal-body">
          <textarea
            className="message-composer-textarea"
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="Type your message here..."
          />
        </div>
        <div className="message-composer-modal-footer">
          <button onClick={handleSend} className="message-composer-send-button">Send</button>
        </div>
      </div>
    </div>
  );
};

export default MessageComposerModal;
