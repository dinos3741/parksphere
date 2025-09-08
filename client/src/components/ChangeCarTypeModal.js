import React, { useState } from 'react';
import './ChangeCarTypeModal.css';

const CAR_TYPES = ['Sedan', 'SUV', 'Truck', 'Van', 'Motorcycle', 'Coupe', 'Hatchback', 'Convertible', 'Wagon', 'Minivan', 'Pickup'];

const ChangeCarTypeModal = ({ onClose, currentUserId, addNotification, onCarDetailsUpdated }) => {
  const [carType, setCarType] = useState('');
  const [carColor, setCarColor] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to change car type.", 'default');
      return;
    }

    try {
      const response = await fetch(`/api/users/${currentUserId}/car-details`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ car_type: carType, car_color: carColor }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('token', data.token); // Store the new token
        addNotification("Car type and color updated successfully!", 'green');
        onCarDetailsUpdated(); // Trigger update in App.js
        onClose();
      } else {
        const errorData = await response.json();
        addNotification(`Failed to update car details: ${errorData.message}`, 'default');
      }
    } catch (error) {
      console.error('Error updating car details:', error);
      addNotification('An error occurred while updating car details.', 'default');
    }
  };

  return (
    <div className="change-car-type-modal-overlay">
      <div className="change-car-type-modal-content">
        <div className="change-car-type-modal-header">
          <h2>Change Car Type</h2>
          <button className="change-car-type-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="change-car-type-modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="car-type">New Car Type:</label>
              <select
                id="car-type"
                value={carType}
                onChange={(e) => setCarType(e.target.value)}
                required
              >
                <option value="">Select Car Type</option>
                {CAR_TYPES.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-group">
              <label htmlFor="car-color">New Car Color:</label>
              <input
                type="text"
                id="car-color"
                value={carColor}
                onChange={(e) => setCarColor(e.target.value)}
                placeholder="e.g., Red, Blue, Black"
              />
            </div>
            <div className="form-actions">
              <button type="submit" className="update-button">Update</button>
              <button type="button" className="cancel-button" onClick={onClose}>Cancel</button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default ChangeCarTypeModal;