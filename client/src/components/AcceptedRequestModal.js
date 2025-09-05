import React from 'react';
import './AcceptedRequestModal.css';

const AcceptedRequestModal = ({ onClose }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close-modal-x" onClick={onClose}>&times;</span>
        <h2 className="title">Request Accepted!</h2>
        <p>Please get to the spot before the expiration time.</p>
        <div className="modal-actions">
          <button className="accept-button" onClick={onClose}>OK</button>
        </div>
      </div>
    </div>
  );
};

export default AcceptedRequestModal;
