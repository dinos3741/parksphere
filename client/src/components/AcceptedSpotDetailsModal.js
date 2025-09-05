import React from 'react';
import './AcceptedSpotDetailsModal.css';

const AcceptedSpotDetailsModal = ({ spot, onClose, onArrived }) => {
  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <span className="close-modal-x" onClick={onClose}>&times;</span>
        <h2 className="title">Spot Details</h2>
        <p><strong>Spot ID:</strong> {spot.id}</p>
        <p><strong>Declared by:</strong> {spot.username}</p>
        <p><strong>Price:</strong> €{ (spot.price ?? 0).toFixed(2) }</p>
        <p><strong>Comments:</strong> {spot.comments}</p>
        <div className="modal-actions">
          <button className="accept-button" onClick={onClose}>OK</button>
          <button className="decline-button" onClick={() => onArrived(spot.id)}>Arrived</button>
        </div>
      </div>
    </div>
  );
};

export default AcceptedSpotDetailsModal;
