import React from 'react';
import './RequestDetailsModal.css';

const RequestDetailsModal = ({ request, onClose, onAccept, onDecline }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close-modal-x" onClick={onClose}>&times;</span>
        <h2>Request Details</h2>
        <p><strong>Requester:</strong> {request.requester_username}</p>
        <p><strong>Car Type:</strong> {request.requester_car_type}</p>
        <p><strong>Requested At:</strong> {new Date(request.requested_at).toLocaleTimeString()}</p>
        <p><strong>Distance:</strong> {typeof request.distance === 'number' && !isNaN(request.distance) ? `${request.distance.toFixed(2)} km` : 'N/A'}</p>
        <div className="modal-actions">
          <button className="accept-button" onClick={() => onAccept(request.id)}>Accept</button>
          <button className="decline-button" onClick={() => onDecline(request.id)}>Decline</button>
        </div>
      </div>
    </div>
  );
};

export default RequestDetailsModal;