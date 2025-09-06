import React from 'react';
import './SpotDeclinedModal.css';

const SpotDeclinedModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="spot-declined-modal-overlay">
      <div className="spot-declined-modal-content">
        <h2>Request Declined</h2>
        <p>The spot owner accepted another request... keep looking!</p>
        <button onClick={onClose}>OK</button>
      </div>
    </div>
  );
};

export default SpotDeclinedModal;