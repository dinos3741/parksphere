import React from 'react';
import './OwnerDetailsModal.css';

const OwnerDetailsModal = ({ owner, onClose }) => {
  if (!owner) {
    return null;
  }

  return (
    <div className="owner-details-modal-overlay">
      <div className="owner-details-modal-content">
        <h2>Owner Details</h2>
        <p><strong>Username:</strong> {owner.username}</p>
        {/* Add more owner details here as they become available */}
        <button onClick={onClose}>Close</button>
      </div>
    </div>
  );
};

export default OwnerDetailsModal;
