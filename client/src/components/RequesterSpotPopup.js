import React from 'react';
import './RequesterSpotPopup.css';

const RequesterSpotPopup = ({ spot, onClose, onArrived }) => {
  return (
    <div className="requester-spot-popup">
      <h2 className="title">Spot Details</h2>
      <p><strong>Spot ID:</strong> {spot.id}</p>
      <p><strong>Declared by:</strong> {spot.username}</p>
      <p><strong>Price:</strong> €{ (spot.price ?? 0).toFixed(2) }</p>
      <p><strong>Comments:</strong> {spot.comments}</p>
      <div className="modal-actions">
        <button className="decline-button" onClick={() => onArrived(spot.id)}>Arrived</button>
      </div>
    </div>
  );
};

export default RequesterSpotPopup;
