import React, { useState } from 'react';
import './OwnerSpotPopup.css';

const OwnerSpotPopup = ({ spot, onEdit, onDelete, formatRemainingTime }) => {
  const [activeTab, setActiveTab] = useState('details');

  return (
    <div className="popup-content-container">
      <div className="tab-buttons">
        <button
          className={activeTab === 'details' ? 'active' : ''}
          onClick={() => setActiveTab('details')}
        >
          Details
        </button>
        <button
          className={activeTab === 'requests' ? 'active' : ''}
          onClick={() => setActiveTab('requests')}
        >
          Requests
        </button>
      </div>
      <div className="tab-content">
        {activeTab === 'details' && (
          <div>
            Parking Spot ID: {spot.id} <br />
            Declared by: {spot.username} <br />
            Cost Type: {spot.cost_type} <br />
            Price: €{ (spot.price ?? 0).toFixed(2) } <br />
            Time until expiration: {formatRemainingTime(spot.declared_at, spot.time_to_leave)} <br />
            Comments: {spot.comments}
            <hr />
            <div className="owner-actions-container">
              <button onClick={() => onEdit(spot.id)} className="delete-spot-button edit-button-color">
                Edit
              </button>
              <button onClick={() => onDelete(spot.id)} className="delete-spot-button">
                Delete
              </button>
            </div>
          </div>
        )}
        {activeTab === 'requests' && (
          <div>
            {/* Placeholder for requests list */}
            <p>No requests yet.</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OwnerSpotPopup;
