
import React from 'react';
import './ArrivalConfirmationModal.css';

const ArrivalConfirmationModal = ({ isOpen, onClose, onConfirm, requesterUsername, spotId }) => {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="close-button" onClick={onClose}>&times;</div>
        <h2>Arrival Confirmation</h2>
        <p>{requesterUsername} has arrived at spot {spotId}. Please confirm to complete the transaction.</p>
        <div className="modal-actions">
          <button onClick={onConfirm} className="confirm-button">Confirm</button>
        </div>
      </div>
    </div>
  );
};

export default ArrivalConfirmationModal;
