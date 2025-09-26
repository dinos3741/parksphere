import React from 'react';
import './OwnerDetailsModal.css';

const OwnerDetailsModal = ({ owner, onClose }) => {
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
            <img src={owner.avatar_url || "https://i.pravatar.cc/80"} alt="Owner Avatar" className="owner-avatar" />
            <p><strong>{owner.username}</strong></p>
          </div>
          <div className="owner-details-right">
            <p><strong>Joined on:</strong> {owner.created_at ? new Date(owner.created_at).toLocaleDateString() : 'N/A'}</p>
            <p><strong>Credits:</strong> <span style={{ color: '#603aac' }}>{owner.credits}</span></p>
            <p><strong>Car Type:</strong> {owner.car_type}</p>
            <p><strong>Spots Declared:</strong> {owner.spots_declared}</p>
            <p><strong>Spots Taken:</strong> {owner.spots_taken}</p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default OwnerDetailsModal;
