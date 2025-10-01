import React from 'react';
import './DistanceWarningModal.css'; // Create this CSS file as well

const DistanceWarningModal = ({ isOpen, onClose, message }) => {
  if (!isOpen) return null;

  return (
    <div className="distance-warning-modal-overlay">
      <div className="distance-warning-modal-content">
        <h2>Warning</h2>
        <p>{message}</p>
        <button onClick={onClose}>OK</button>
      </div>
    </div>
  );
};

export default DistanceWarningModal;