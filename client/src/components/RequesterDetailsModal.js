import React from 'react';
import './RequesterDetailsModal.css';

const RequesterDetailsModal = ({ isOpen, onClose, requester }) => {
  if (!isOpen || !requester) {
    return null;
  }

  return (
    <div className="RequesterDetailsModal__overlay" onClick={onClose}>
      <div className="RequesterDetailsModal__content" onClick={e => e.stopPropagation()}>
        <span className="RequesterDetailsModal__close" onClick={onClose}>&times;</span>
        <h2>Requester Details</h2>
        <div className="RequesterDetailsModal__separator"></div>
        <div className="RequesterDetailsModal__grid">
          <div className="RequesterDetailsModal__left">
            <img src={requester.avatar_url || "https://i.pravatar.cc/80"} alt="Requester Avatar" className="RequesterDetailsModal__avatar" />
            <p><strong>{requester.username}</strong></p>
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
    </div>
  );
};

export default RequesterDetailsModal;
