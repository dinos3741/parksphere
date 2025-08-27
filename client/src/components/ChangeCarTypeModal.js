import React, { useState } from 'react';
import './ChangeCarTypeModal.css';

const ChangeCarTypeModal = ({ onClose }) => {
  const [carType, setCarType] = useState('');
  const [carColor, setCarColor] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Here you would typically send a request to your backend to update car type and color
    console.log('Change car type submitted:', { carType, carColor });
    onClose(); // Close modal after submission (for now)
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
              <input
                type="text"
                id="car-type"
                value={carType}
                onChange={(e) => setCarType(e.target.value)}
                placeholder="e.g., Sedan, SUV, Truck"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="car-color">New Car Color:</label>
              <input
                type="text"
                id="car-color"
                value={carColor}
                onChange={(e) => setCarColor(e.target.value)}
                placeholder="e.g., Red, Blue, Black"
                required
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