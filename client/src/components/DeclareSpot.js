import React, { useState, useEffect } from 'react'; // Import useEffect
import './DeclareSpot.css';

// Accept new props: spotData and isEditing
const DeclareSpot = ({ userLocation, onClose, currentUserCarType, spotData, isEditing }) => {
  // Initialize state based on spotData if editing, otherwise empty
  const [timeToLeave, setTimeToLeave] = useState(spotData?.time_to_leave || '');
  const [isFree, setIsFree] = useState(spotData?.is_free ?? false); // Use nullish coalescing for boolean
  const [price, setPrice] = useState(spotData?.price ?? '');
  const [comments, setComments] = useState(spotData?.comments || '');

  // useEffect to update state if spotData changes (e.g., when opening for a different spot)
  useEffect(() => {
    if (isEditing && spotData) {
      setTimeToLeave(spotData.time_to_leave);
      setIsFree(spotData.is_free);
      setPrice(spotData.price);
      setComments(spotData.comments);
    } else if (!isEditing) {
      // Clear form if switching to declare mode
      setTimeToLeave('');
      setIsFree(false);
      setPrice('');
      setComments('');
    }
  }, [spotData, isEditing]);


  const handleSubmit = async () => {
    if (!userLocation && !isEditing) { // userLocation is not needed for editing existing spot
      alert("Cannot declare spot: User location not available.");
      return;
    }

    if (!currentUserCarType) {
      alert("Cannot declare spot: User car type not available. Please log in again.");
      onClose();
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert("You must be logged in to declare a spot.");
      onClose();
      return;
    }

    const parsedTimeToLeave = parseInt(timeToLeave, 10);
    if (isNaN(parsedTimeToLeave) || parsedTimeToLeave < 1) {
      alert("Please enter a valid number of minutes to leave (at least 1).");
      return;
    }

    const parsedPrice = parseFloat(price);

    let url = '/api/declare-spot';
    let method = 'POST';
    let body = {
      latitude: userLocation ? userLocation[0] : undefined, // Only send if declaring
      longitude: userLocation ? userLocation[1] : undefined, // Only send if declaring
      timeToLeave: parsedTimeToLeave,
      price: parsedPrice,
      declaredCarType: currentUserCarType,
      comments,
      isFree,
    };

    if (isEditing && spotData?.id) {
      url = `/api/parkingspots/${spotData.id}`; // Use spot ID for PUT request
      method = 'PUT';
      // For editing, only send fields that can be updated
      body = {
        timeToLeave: parsedTimeToLeave,
        price: parsedPrice,
        comments,
        isFree,
      };
    }

    try {
      const response = await fetch(url, {
        method: method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify(body),
      });

      if (response.ok) {
        onClose();
      } else if (response.status === 401 || response.status === 403) {
        alert("Authentication failed. Please log in again.");
        localStorage.removeItem('token');
        onClose();
      } else {
        const errorText = await response.text();
        alert(`Failed to ${isEditing ? 'update' : 'declare'} spot: ${errorText}`);
      }
    } catch (error) {
      console.error(`Error ${isEditing ? 'updating' : 'declaring'} spot:`, error);
      alert(`An error occurred while ${isEditing ? 'updating' : 'declaring'} the spot.`);
    }
  };

  return (
    <div className="declare-spot-container">
      <h2>{isEditing ? 'Edit Your Parking Spot' : 'Declare Your Parking Spot'}</h2>
      {!isEditing && userLocation ? ( // Only show location if declaring
        <p>Your current location: {userLocation[0].toFixed(4)}, {userLocation[1].toFixed(4)}</p>
      ) : (
        !isEditing && <p>Getting your location...</p> // Only show if declaring and no location
      )}

      <div className="form-row">
        <label>Time to leave (minutes):</label>
        <input
          type="number"
          value={timeToLeave}
          onChange={(e) => setTimeToLeave(e.target.value)}
          min="1"
        />
      </div>

      <div className="form-row">
        <label>Price to reveal details (€):</label>
        <input
          type="number"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          min="0"
          step="0.01"
        />
      </div>

      <div className="form-row">
        <label>Comments (optional):</label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="e.g., Spot is suitable for small cars only"
        />
      </div>

      <div className="form-row">
        <label>Free Spot:</label>
        <input
          type="checkbox"
          checked={isFree}
          onChange={(e) => setIsFree(e.target.checked)}
        />
      </div>

      <div className="declare-spot-buttons">
        <button onClick={handleSubmit}>{isEditing ? 'Update Spot' : 'Declare Spot'}</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
};

export default DeclareSpot;
