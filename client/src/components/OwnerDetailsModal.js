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
        <div className="owner-details-grid">
          <div className="owner-details-left">
            <img src="https://i.pravatar.cc/80" alt="Owner Avatar" className="owner-avatar" />
            <p><strong>{owner.username}</strong></p>
          </div>
          <div className="owner-details-right">
            {/* Blank for now */}
          </div>
        </div>
      </div>
    </div>
  );
};

export default OwnerDetailsModal;
