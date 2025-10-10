import React, { useState, useEffect } from 'react';
import { sendAuthenticatedRequest } from '../utils/api';
import './ConversationsSideDrawer.css';

const ConversationsSideDrawer = ({ isOpen, onClose, onConversationClick }) => {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    if (isOpen) {
      const fetchConversations = async () => {
        try {
          const data = await sendAuthenticatedRequest('/messages/conversations');
          setConversations(data);
        } catch (error) {
          console.error('Error fetching conversations:', error);
        }
      };

      fetchConversations();
    }
  }, [isOpen]);

  return (
    <div className={`conversations-side-drawer ${isOpen ? 'open' : ''}`}>
      <div className="conversations-side-drawer-header">
        <h3>Conversations</h3>
        <button className="close-button" onClick={onClose}>X</button>
      </div>
      <div className="conversations-side-drawer-content">
        {conversations.map((convo) => (
          <div key={convo.other_user_id} className="conversation-item" onClick={() => onConversationClick({ id: convo.other_user_id, username: convo.other_username })}>
            <img src={convo.other_avatar_url} alt={convo.other_username} />
            <div className="conversation-details">
              <p className="username">{convo.other_username}</p>
              <p className="last-message">{convo.message}</p>
            </div>
            <span className="timestamp">{new Date(convo.created_at).toLocaleTimeString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ConversationsSideDrawer;
