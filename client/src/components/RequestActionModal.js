import React from 'react';
import './RequestActionModal.css';

const RequestActionModal = ({ request, onConfirm, onReject, onClose }) => {
  if (!request) return null;

  return (
    <div className="request-action-modal-overlay">
      <div className="request-action-modal-content">
        <div className="request-action-modal-header">
          <h2>Request from {request.requester_username}</h2>
          <button className="request-action-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="request-action-modal-body">
          <p>Car Type: {request.requester_car_type || 'N/A'}</p>
          <p>Distance: {typeof request.distance === 'number' && !isNaN(request.distance) ? `${request.distance.toFixed(2)} km` : 'N/A'}</p>
        </div>
        <div className="request-action-modal-footer">
          <button className="confirm-button" onClick={() => onConfirm(request)}>Confirm</button>
          <button className="reject-button" onClick={() => onReject(request)}>Reject</button>
        </div>
      </div>
    </div>
  );
};

export default RequestActionModal;
