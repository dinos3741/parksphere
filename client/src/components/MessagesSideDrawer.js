import React, { useState, useEffect } from 'react';
import { sendAuthenticatedRequest } from '../utils/api'; // Corrected import path
import './MessagesSideDrawer.css';

// Helper function to format the timestamp
const formatMessageTimestamp = (timestamp) => {
  const date = new Date(timestamp);
  // Check if date is valid
  if (isNaN(date.getTime())) {
    return 'Invalid Date';
  }

  const options = {
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true // Use 12-hour format with AM/PM
  };
  return date.toLocaleString([], options);
};


const MessagesSideDrawer = ({ isOpen, onClose, onConversationClick, allChatMessages, unreadMessages, currentUserId }) => {
  const [conversations, setConversations] = useState([]);

  useEffect(() => {
    console.log('MessagesSideDrawer useEffect triggered.');
    console.log('isOpen:', isOpen, 'currentUserId:', currentUserId);
    console.log('allChatMessages:', allChatMessages);
    console.log('unreadMessages:', unreadMessages);

    if (isOpen && currentUserId) {
      const fetchConversations = async () => {
        try {
          console.log('Fetching conversations from /messages/conversations...');
          const fetchedData = await sendAuthenticatedRequest('/messages/conversations');
          console.log('Fetched data:', fetchedData);

          const combinedConversationsMap = new Map();

          // 1. Add all fetched conversations to the map
          fetchedData.forEach(convo => {
            combinedConversationsMap.set(convo.other_user_id, {
              otherUser: {
                id: convo.other_user_id,
                username: convo.other_username,
                avatar_url: convo.other_avatar_url || 'https://via.placeholder.com/50'
              },
              lastMessage: convo.message,
              timestamp: convo.created_at,
              unreadCount: unreadMessages[convo.other_user_id] || 0,
            });
          });
          console.log('After adding fetched data:', combinedConversationsMap);


          // 2. Iterate through allChatMessages and update/add to the map
          //    This ensures real-time messages are reflected and take precedence for the 'lastMessage' and 'timestamp'
          Object.entries(allChatMessages).forEach(([otherUserIdStr, messages]) => {
            const otherUserId = parseInt(otherUserIdStr, 10);
            if (messages.length > 0) {
              const lastMessage = messages[messages.length - 1];
              const existingConvo = combinedConversationsMap.get(otherUserId);

              // Determine username and avatar_url: prefer existing fetched data, otherwise derive from lastMessage
              const username = existingConvo?.otherUser.username || (lastMessage.from === currentUserId ? lastMessage.to_username : lastMessage.from_username);
              const avatar_url = existingConvo?.otherUser.avatar_url || 'https://via.placeholder.com/50'; // Placeholder if not in fetched data

              combinedConversationsMap.set(otherUserId, {
                otherUser: {
                  id: otherUserId,
                  username: username,
                  avatar_url: avatar_url
                },
                lastMessage: lastMessage.message,
                timestamp: lastMessage.timestamp,
                unreadCount: unreadMessages[otherUserId] || 0,
              });
            }
          });
          console.log('After merging with allChatMessages:', combinedConversationsMap);


          // Sort conversations by timestamp (latest first)
          const sortedConversations = Array.from(combinedConversationsMap.values()).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
          console.log('Sorted conversations:', sortedConversations);
          setConversations(sortedConversations);

        } catch (error) {
          console.error('Error in fetchConversations:', error);
        }
      };

      fetchConversations();
    } else if (isOpen && !currentUserId) {
      console.log('MessagesSideDrawer is open but currentUserId is not available.');
    } else if (!isOpen) {
      console.log('MessagesSideDrawer is closed.');
    }
  }, [isOpen, currentUserId, allChatMessages, unreadMessages]);


  return (
    <div className={`messages-side-drawer ${isOpen ? 'open' : ''}`}>
      <div className="messages-side-drawer-header">
        <h3>Messages</h3>
        <button className="close-button" onClick={onClose}>X</button>
      </div>
      <div className="messages-side-drawer-content">
        {conversations.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#666' }}>No messages yet.</p>
        ) : (
          conversations.map((convo) => (
            <div
              key={convo.otherUser.id}
              className="message-item"
              onClick={() => onConversationClick(convo.otherUser)}
            >
              {/* <img src={convo.otherUser.avatar_url} alt={convo.otherUser.username} /> */}
              <div className="message-details">
                <p className="username">{convo.otherUser.username}</p>
                <p className="last-message">{convo.lastMessage}</p>
              </div>
              <span className="timestamp">{formatMessageTimestamp(convo.timestamp)}</span>
              {convo.unreadCount > 0 && (
                <span className="unread-messages-badge">{convo.unreadCount}</span>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
};

export default MessagesSideDrawer;
