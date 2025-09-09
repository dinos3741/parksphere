import React, { useState, useEffect } from 'react';
import './EditSpotModal.css';

const EditSpotModal = ({ spotData, onClose, currentUserCarType }) => {
  const [timeToLeave, setTimeToLeave] = useState(spotData?.time_to_leave || '');
  const [costType, setCostType] = useState(spotData?.cost_type || 'paid');
  const [price, setPrice] = useState(spotData?.price ?? '');
  const [comments, setComments] = useState(spotData?.comments || '');
  const [declaredCarType, setDeclaredCarType] = useState(spotData?.declared_car_type || currentUserCarType);

  useEffect(() => {
    if (spotData) {
      setTimeToLeave(spotData.time_to_leave);
      setCostType(spotData.cost_type);
      setPrice(spotData.price);
      setComments(spotData.comments);
      setDeclaredCarType(spotData.declared_car_type || currentUserCarType);
    }
  }, [spotData, currentUserCarType]);

  const handleSubmit = async () => {
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
    if (costType === 'paid' && (isNaN(parsedPrice) || parsedPrice < 0)) {
      alert("Please enter a valid price for a Paid spot.");
      return;
    }

    try {
      const response = await fetch(`/api/parkingspots/${spotData.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          timeToLeave: parsedTimeToLeave,
          costType,
          price: costType === 'free' ? 0.00 : parsedPrice,
          comments,
          declaredCarType,
        }),
      });

      if (response.ok) {
        console.log('Spot updated successfully!');
        onClose(); // Close the modal on success
      } else if (response.status === 401 || response.status === 403) {
        alert("Authentication failed or not authorized to update this spot.");
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
              <label>Cost Type:</label>
              <select
                value={costType}
                onChange={(e) => setCostType(e.target.value)}
              >
                <option value="paid">Paid</option>
                <option value="free">Free</option>
              </select>
            </div>

            {costType === 'paid' && (
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
            )}

            <div className="form-row">
              <label>Comments (optional):</label>
              <textarea
                value={comments}
                onChange={(e) => setComments(e.target.value)}
                placeholder="e.g., Spot is suitable for small cars only"
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