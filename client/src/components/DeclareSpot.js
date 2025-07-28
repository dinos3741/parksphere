import React, { useState } from 'react';
import './DeclareSpot.css';

const DeclareSpot = ({ userLocation, onClose, currentUserCarType }) => {
  const [timeToLeave, setTimeToLeave] = useState('');
  const [isFree, setIsFree] = useState(false); // Initialize as false (not free by default)
  const [price, setPrice] = useState('');
  const [comments, setComments] = useState('');

  const handleSubmit = async () => {
    if (!userLocation) {
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

    try {
      const response = await fetch('/api/declare-spot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          latitude: userLocation[0],
          longitude: userLocation[1],
          timeToLeave: parsedTimeToLeave,
          price: parsedPrice,
          declaredCarType: currentUserCarType,
          comments,
          isFree, // Add isFree to the request body
        }),
      });

      if (response.ok) {
        onClose();
      } else if (response.status === 401 || response.status === 403) {
        alert("Authentication failed. Please log in again.");
        localStorage.removeItem('token');
        onClose();
      } else {
        const errorText = await response.text();
        alert(`Failed to declare spot: ${errorText}`);
      }
    } catch (error) {
      console.error('Error declaring spot:', error);
      alert('An error occurred while declaring the spot.');
    }
  };

  return (
    <div className="declare-spot-container">
      <h2>Declare Your Parking Spot</h2>
      {userLocation ? (
        <p>Your current location: {userLocation[0].toFixed(4)}, {userLocation[1].toFixed(4)}</p>
      ) : (
        <p>Getting your location...</p>
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
        <button onClick={handleSubmit}>Declare Spot</button>
        <button onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
};

export default DeclareSpot;
