import React, { useState } from 'react';
import './RequesterSpotPopup.css';
import OwnerDetailsModal from './OwnerDetailsModal';

const RequesterSpotPopup = ({ spot, onClose, onArrived }) => {
  const [isOwnerModalOpen, setIsOwnerModalOpen] = useState(false);

  const handleUsernameClick = () => {
    setIsOwnerModalOpen(true);
  };

  const handleCloseOwnerModal = () => {
    setIsOwnerModalOpen(false);
  };

  return (
    <div className="requester-spot-popup">
      <h2 className="title">Spot Details</h2>
      <p><strong>Spot ID:</strong> {spot.id}</p>
      <p><strong>Declared by:</strong> <span className="username-link" onClick={handleUsernameClick}>{spot.username}</span></p>
      <p><strong>Price:</strong> €{ (spot.price ?? 0).toFixed(2) }</p>
      <p><strong>Comments:</strong> {spot.comments}</p>
      <div className="modal-actions">
        <button className="decline-button" onClick={() => onArrived(spot.id)}>Arrived</button>
      </div>
      {isOwnerModalOpen && <OwnerDetailsModal owner={spot} onClose={handleCloseOwnerModal} />}
    </div>
  );
};

export default RequesterSpotPopup;
