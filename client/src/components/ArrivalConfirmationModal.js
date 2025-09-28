import React from 'react';
import './ArrivalConfirmationModal.css';

const ArrivalConfirmationModal = ({ isOpen, onClose, onConfirm }) => {
  if (!isOpen) return null;

  return (
    <div className="arrival-modal-overlay">
      <div className="arrival-modal-content">
        <div className="arrival-modal-header">
          <h2>Confirm Arrival</h2>
          <button className="arrival-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="arrival-modal-body">
          <p>Are you sure you arrived at the correct spot location?</p>
        </div>
        <div className="arrival-modal-footer">
          <button className="arrival-confirm-button" onClick={onConfirm}>Confirm</button>
          <button className="arrival-cancel-button" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
};

export default ArrivalConfirmationModal;