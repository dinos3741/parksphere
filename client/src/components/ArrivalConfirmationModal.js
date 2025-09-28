import React from 'react';
import './ArrivalConfirmationModal.css';

const ArrivalConfirmationModal = ({ isOpen, onClose, onConfirm, isOwner, requesterUsername, spotId }) => {
  if (!isOpen) return null;

  const message = isOwner
    ? `User ${requesterUsername} has arrived at spot ${spotId}. Please confirm to complete the transaction.`
    : 'Are you sure you arrived at the correct spot location?';

  return (
    <div className="arrival-modal-overlay">
      <div className="arrival-modal-content">
        <div className="arrival-modal-header">
          <h2>Confirm Arrival</h2>
          <button className="arrival-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="arrival-modal-body">
          <p>{message}</p>
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