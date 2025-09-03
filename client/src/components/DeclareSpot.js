import React, { useState, useEffect } from 'react'; // Import useEffect
import './DeclareSpot.css';

// Accept new props: spotData and isEditing
const DeclareSpot = ({ userLocation, onClose, currentUserCarType, spotData, isEditing, addNotification }) => {
  // Initialize state based on spotData if editing, otherwise empty
  const [timeToLeave, setTimeToLeave] = useState(spotData?.time_to_leave || '');
  const [costType, setCostType] = useState(spotData?.cost_type || 'paid'); // Changed from isFree to costType
  const [price, setPrice] = useState(spotData?.price ?? '');
  const [comments, setComments] = useState(spotData?.comments || '');

  // useEffect to update state if spotData changes (e.g., when opening for a different spot)
  useEffect(() => {
    if (isEditing && spotData) {
      setTimeToLeave(spotData.time_to_leave);
      setCostType(spotData.cost_type); // Changed from setIsFree
      setPrice(spotData.price);
      setComments(spotData.comments);
    } else if (!isEditing) {
      // Clear form if switching to declare mode
      setTimeToLeave('');
      setCostType('paid'); // Default to Paid
      setPrice('');
      setComments('');
    }
  }, [spotData, isEditing]);


  const handleSubmit = async () => {
    if (!userLocation && !isEditing) { // userLocation is not needed for editing existing spot
      addNotification("Cannot declare spot: User location not available.", 'default');
      return;
    }

    if (!currentUserCarType) {
      addNotification("Cannot declare spot: User car type not available. Please log in again.");
      onClose();
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to declare a spot.");
      onClose();
      return;
    }

    const parsedTimeToLeave = parseInt(timeToLeave, 10);
    if (isNaN(parsedTimeToLeave) || parsedTimeToLeave < 1) {
      addNotification("Please enter a valid number of minutes to leave (at least 1).\n");
      return;
    }

    const parsedPrice = parseFloat(price);
    if (costType === 'paid' && (isNaN(parsedPrice) || parsedPrice < 0)) {
      addNotification("Please enter a valid price for a Paid spot.\n");
      return;
    }


    let url = '/api/declare-spot';
    let method = 'POST';
    let body = {
      latitude: userLocation ? userLocation[0] : undefined, // Only send if declaring
      longitude: userLocation ? userLocation[1] : undefined, // Only send if declaring
      timeToLeave: parsedTimeToLeave,
      price: costType === 'free' ? 0.00 : parsedPrice, // Set price to 0 if Free
      declaredCarType: currentUserCarType,
      comments,
      costType, // Changed from isFree
    };

    if (isEditing && spotData?.id) {
      url = `/api/parkingspots/${spotData.id}`; // Use spot ID for PUT request
      method = 'PUT';
      // For editing, only send fields that can be updated
      body = {
        timeToLeave: parsedTimeToLeave,
        price: costType === 'free' ? 0.00 : parsedPrice, // Set price to 0 if Free
        comments,
        costType, // Changed from isFree
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
        const responseData = await response.json(); // Parse JSON response
        addNotification(`Spot ${responseData.spotId} ${isEditing ? 'updated' : 'declared'} successfully!`);
        onClose();
      } else if (response.status === 401 || response.status === 403) {
        addNotification("Authentication failed. Please log in again.");
        localStorage.removeItem('token');
        onClose();
      } else if (response.status === 409) { // Handle 409 Conflict specifically
        const errorData = await response.json();
        alert(errorData.message); // Show as pop-up
        addNotification(errorData.message); // Also add to log
        onClose(); // Close the form
      } else {
        const errorData = await response.json();
        addNotification(`Failed to ${isEditing ? 'update' : 'declare'} spot: ${errorData.message}`);
      }
    } catch (error) {
      console.error(`Error ${isEditing ? 'updating' : 'declaring'} spot:`, error);
      addNotification(`An error occurred while ${isEditing ? 'updating' : 'declaring'} the spot.`);
    }
  };

  return (
    <div className="declare-spot-container">
      <h2>{isEditing ? 'Edit Your Parking Spot' : 'Declare Your Parking Spot'}</h2>
      {!isEditing && userLocation ? ( // Only show location if declaring
        <p>Your current location: ${userLocation[0].toFixed(4)}, ${userLocation[1].toFixed(4)}</p>
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
        <label>Cost Type:</label>
        <select
          value={costType}
          onChange={(e) => setCostType(e.target.value)}
        >
          <option value="paid">Paid</option>
          <option value="free">Free</option>
        </select>
      </div>

      {costType === 'paid' && ( // Show price input only if costType is Paid
        <div className="form-row">
          <label>Price:</label>
          <input
            type="number"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            min="0"
            step="0.01"
          />
        </div>
      )}

      <div className="form-row">
        <label>Comments (optional):</label>
        <textarea
          value={comments}
          onChange={(e) => setComments(e.target.value)}
          placeholder="e.g., Spot is suitable for small cars only"
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
