import React, { useEffect } from 'react';
import './OwnerDetailsModal.css';

const OwnerDetailsModal = ({ owner, onClose, onOpenChat }) => {
  const handleMessageIconClick = (e) => {
    e.stopPropagation();
    onOpenChat(owner);
    onClose();
  };

  useEffect(() => {
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  if (!owner) {
    return null;
  }

  return (
    <div className="owner-details-modal-overlay" onClick={onClose}>
      <div className="owner-details-modal-content" onClick={e => e.stopPropagation()}>
        <span className="close-modal" onClick={onClose}>&times;</span>
        <h2>Owner Details</h2>
        <div className="owner-details-separator"></div>
        <div className="owner-details-grid">
          <div className="owner-details-left">
            <img 
              src={owner.avatar_url ? (owner.avatar_url.startsWith('http') ? owner.avatar_url : `http://localhost:3001${owner.avatar_url}`) : "https://i.pravatar.cc/80"} 
              alt="Owner Avatar" 
              className="owner-avatar" 
            />
            <div className="username-and-message-icon-owner">
              <p><strong>{owner.username}</strong></p>
              <span className="send-message-icon-owner" onClick={handleMessageIconClick}>✉️</span>
            </div>
          </div>
          <div className="owner-details-right">
            <p><strong>Joined on:</strong> {owner.created_at ? new Date(owner.created_at).toLocaleDateString() : 'N/A'}</p>
            <p><strong>Credits:</strong> <span style={{ color: '#603aac' }}>{owner.credits}</span></p>
            <p><strong>Car Type:</strong> {owner.car_type}</p>
            <p><strong>Spots Declared:</strong> {owner.spots_declared}</p>
            <p><strong>Spots Taken:</strong> {owner.spots_taken}</p>
            <p><strong>Average Rating:</strong> {owner.average_rating ? parseFloat(owner.average_rating).toFixed(1) : 'N/A'}</p>
            <p><strong>Rank:</strong> top {owner.rank} %</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OwnerDetailsModal;
