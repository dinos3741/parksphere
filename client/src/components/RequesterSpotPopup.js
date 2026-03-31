import React, { useState } from 'react';
import './RequesterSpotPopup.css';
import OwnerDetailsModal from './OwnerDetailsModal';

const RequesterSpotPopup = ({ spot, onClose, onArrived, userLocation, getDistance, addNotification }) => {
  const [isOwnerModalOpen, setIsOwnerModalOpen] = useState(false);

  const handleUsernameClick = () => {
    setIsOwnerModalOpen(true);
  };

  const handleCloseOwnerModal = () => {
    setIsOwnerModalOpen(false);
  };

  const handleArrivedClick = () => {
    if (!userLocation) {
      addNotification("Your location is not available.", "red");
      return;
    }

    const spotLat = spot.lat ?? parseFloat(spot.latitude);
    const spotLng = spot.lng ?? parseFloat(spot.longitude);

    const distance = getDistance(userLocation[0], userLocation[1], spotLat, spotLng);
    const distanceThreshold = 0.1; // 100 meters

    if (distance > distanceThreshold) {
      addNotification("You are too far to confirm arrival from here. Please get closer (within 100 meters).", "default");
      return;
    }
    
    onArrived(spot.id);
  };

  return (
    <div className="requester-spot-popup">
      <h2 className="title">Spot Details</h2>
      <p><strong>Spot ID:</strong> {spot.id}</p>
      <p><strong>Declared by:</strong> <span className="username-link" onClick={handleUsernameClick}>{spot.username}</span></p>
      <p><strong>Price:</strong> €{ (spot.price ?? 0).toFixed(2) }</p>
      <p><strong>Comments:</strong> {spot.comments}</p>
      <div className="modal-actions">
        <button className="decline-button" onClick={handleArrivedClick}>Arrived</button>
      </div>
      {isOwnerModalOpen && <OwnerDetailsModal owner={spot} onClose={handleCloseOwnerModal} />}
    </div>
  );
};

export default RequesterSpotPopup;
