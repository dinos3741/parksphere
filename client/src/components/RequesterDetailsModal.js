import React, { useEffect, useState } from 'react';
import './RequesterDetailsModal.css';
import MessageComposerModal from './MessageComposerModal';

const RequesterDetailsModal = ({ isOpen, onClose, requester }) => {
  const [showMessageModal, setShowMessageModal] = useState(false);

  const handleMessageIconClick = (e) => {
    e.stopPropagation(); // Prevent the modal from closing
    setShowMessageModal(true);
  };

  const handleCloseMessageComposerModal = () => {
    setShowMessageModal(false);
  };

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
    }

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen || !requester) {
    return null;
  }

  return (
    <div className="RequesterDetailsModal__overlay" onClick={onClose}>
      <div className="RequesterDetailsModal__content" onClick={e => e.stopPropagation()}>
        <span className="RequesterDetailsModal__close" onClick={onClose}>&times;</span>
        <h2>User Details</h2>
        <div className="RequesterDetailsModal__separator"></div>
        <div className="RequesterDetailsModal__grid">
          <div className="RequesterDetailsModal__left">
            <img src={requester.avatar_url || "https://i.pravatar.cc/80"} alt="Requester Avatar" className="RequesterDetailsModal__avatar" />
            <div className="username-and-message-icon-requester">
              <p><strong>{requester.username}</strong></p>
              <span className="send-message-icon-requester" onClick={handleMessageIconClick}>✉️</span>
            </div>
          </div>
          <div className="RequesterDetailsModal__right">
            <p><strong>Joined on:</strong> {requester.created_at ? new Date(requester.created_at).toLocaleDateString() : 'N/A'}</p>
            <p><strong>Credits:</strong> <span style={{ color: '#603aac' }}>{requester.credits}</span></p>
            <p><strong>Car Type:</strong> {requester.car_type}</p>
            <p><strong>Spots Declared:</strong> {requester.spots_declared}</p>
            <p><strong>Spots Taken:</strong> {requester.spots_taken}</p>
            <p><strong>Average Rating:</strong> {requester.average_rating ? parseFloat(requester.average_rating).toFixed(1) : 'N/A'}</p>
          </div>
        </div>
      </div>
      {showMessageModal && <MessageComposerModal 
        isOpen={showMessageModal} 
        onClose={handleCloseMessageComposerModal} 
        recipientUsername={requester.username} 
      />}
    </div>
  );
};

export default RequesterDetailsModal;
