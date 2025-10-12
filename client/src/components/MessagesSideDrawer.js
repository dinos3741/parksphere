import React, { useState, useEffect, useCallback } from 'react';
import { sendAuthenticatedRequest } from '../utils/api'; // Corrected import path
import { socket } from '../socket';
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


const MessagesSideDrawer = ({ isOpen, onClose, allChatMessages, unreadMessages, currentUserId, clearUnreadMessages }) => {
  const [conversations, setConversations] = useState([]);
  const [selectedConversation, setSelectedConversation] = useState(null);
  const [messageHistory, setMessageHistory] = useState([]);
  // State for chat input and handlers
  const [chatInput, setChatInput] = useState('');

  const handleConversationSelect = async (otherUser) => {
    const convo = conversations.find(c => c.otherUser.id === otherUser.id);
    const unreadCount = convo ? convo.unreadCount : 0;

    if (clearUnreadMessages) {
      clearUnreadMessages(otherUser.id);
    }

    setSelectedConversation(otherUser);
    try {
      const messages = await sendAuthenticatedRequest(`/messages/conversations/${otherUser.id}`);
      const messagesWithReadStatus = messages.map((msg, index) => ({
        ...msg,
        is_new: index >= messages.length - unreadCount,
      }));
      setMessageHistory(messagesWithReadStatus);
    } catch (error) {
      console.error('Error fetching message history:', error);
    }
  };

  useEffect(() => {
    if (messageHistory.some(msg => msg.is_new)) {
      const timer = setTimeout(() => {
        setMessageHistory(prevHistory =>
          prevHistory.map(msg => ({ ...msg, is_new: false }))
        );
      }, 2000); // 2 seconds

      return () => clearTimeout(timer);
    }
  }, [messageHistory]);

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


  const handleChatInputChange = useCallback((e) => {
    setChatInput(e.target.value);
  }, []);

  const handleSendMessage = useCallback(() => {
    if (chatInput.trim() && selectedConversation) {
      const newMessage = {
        from: currentUserId,
        to: selectedConversation.id,
        message: chatInput,
        timestamp: new Date().toISOString(),
      };
      socket.emit('privateMessage', newMessage);
      setMessageHistory((prevHistory) => [...prevHistory, newMessage]);
      setChatInput('');
    }
  }, [chatInput, selectedConversation, currentUserId]);


  return (
    <div className={`messages-side-drawer ${isOpen ? 'open' : ''}`}>
      <div className="messages-side-drawer-header">
        {selectedConversation ? (
          <>
            <button className="back-button" onClick={() => setSelectedConversation(null)}><i className="fas fa-arrow-left"></i></button>
            <h3>{selectedConversation.username}</h3>
          </>
        ) : (
          <>
            <h3>Messages</h3>
            <button className="close-button" onClick={onClose}>X</button>
          </>
        )}
      </div>
      <div className="messages-side-drawer-content">
        {selectedConversation ? (
          <div>
            <div className="message-history-container">
              {messageHistory.map((msg, index) => (
                <div key={index} className={`message ${msg.sender_id === currentUserId ? 'sent' : 'received'} ${msg.is_new ? 'new-message' : ''}`}>
                  <p>{msg.message}</p>
                  <span className="timestamp">{formatMessageTimestamp(msg.created_at)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : conversations.length === 0 ? (
          <p style={{ textAlign: 'center', color: '#666' }}>No messages yet.</p>
        ) : (
          conversations.map((convo) => (
            <div
              key={convo.otherUser.id}
              className={`message-item ${convo.unreadCount > 0 ? 'unread' : ''}`}
              onClick={() => handleConversationSelect(convo.otherUser)}
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
      {selectedConversation && (
        <div className="message-input-container">
          <input
            type="text"
            value={chatInput}
            onChange={handleChatInputChange}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleSendMessage();
              }
            }}
            placeholder="Type a message..."
          />
          <button onClick={handleSendMessage}>Send</button>
        </div>
      )}
    </div>
  );
};

export default MessagesSideDrawer;