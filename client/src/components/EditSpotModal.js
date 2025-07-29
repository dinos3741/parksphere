import React, { useState, useEffect } from 'react';
import './EditSpotModal.css';

const EditSpotModal = ({ spotData, onClose }) => {
  const [timeToLeave, setTimeToLeave] = useState(spotData?.time_to_leave || '');
  const [isFree, setIsFree] = useState(spotData?.is_free ?? false);
  const [price, setPrice] = useState(spotData?.price ?? '');
  const [comments, setComments] = useState(spotData?.comments || '');

  useEffect(() => {
    if (spotData) {
      setTimeToLeave(spotData.time_to_leave);
      setIsFree(spotData.is_free);
      setPrice(spotData.price);
      setComments(spotData.comments);
    }
  }, [spotData]);

  const handleSubmit = async () => { // Make function async
    if (!spotData || !spotData.id) {
      alert("Error: No spot data available for update.");
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert("You must be logged in to update a spot.");
      return;
    }

    const parsedTimeToLeave = parseInt(timeToLeave, 10);
    if (isNaN(parsedTimeToLeave) || parsedTimeToLeave < 1) {
      alert("Please enter a valid number of minutes to leave (at least 1).");
      return;
    }

    const parsedPrice = parseFloat(price);

    // NEW: Log the value of isFree before sending
    console.log("EditSpotModal: Value of isFree before sending:", isFree);

    try {
      const response = await fetch(`/api/parkingspots/${spotData.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          timeToLeave: parsedTimeToLeave,
          isFree,
          price: parsedPrice,
          comments,
        }),
      });

      if (response.ok) {
        console.log('Spot updated successfully!');
        onClose(); // Close the modal on success
      } else if (response.status === 401 || response.status === 403) {
        alert("Authentication failed or not authorized to update this spot.");
        // Optionally, force logout or redirect to login
      } else {
        const errorText = await response.text();
        alert(`Failed to update spot: ${errorText}`);
      }
    } catch (error) {
      console.error('Error updating spot:', error);
      alert('An error occurred while updating the spot.');
    }
  };

  return (
    <div className="edit-modal-backdrop">
      <div className="edit-modal-content">
        <h2>Edit Your Parking Spot</h2>
        {spotData && (
          <>
            <p>Spot ID: {spotData.id}</p>
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

            <div className="modal-buttons">
              <button onClick={handleSubmit}>Update Spot</button>
              <button onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
        {!spotData && <p>Loading spot data...</p>}
        <button className="close-modal-button" onClick={onClose}>
          X
        </button>
      </div>
    </div>
  );
};

export default EditSpotModal;
