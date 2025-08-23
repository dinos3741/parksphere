import React from 'react';
import './ProfileModal.css';
import logo from '../assets/images/logo.png'; // Assuming logo is accessible from here

const ProfileModal = ({ onClose, userData }) => {
  return (
    <div className="profile-modal-overlay">
      <div className="profile-modal-content">
        <div className="profile-modal-header">
          <img src={logo} alt="Parksphere Logo" className="profile-modal-logo" />
          <h2 className="profile-modal-title">PARKSPHERE</h2>
          <button className="profile-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="profile-modal-body">
          {userData ? (
            <>
              <p><strong>Username:</strong> {userData.username}</p>
              <p><strong>Plate Number:</strong> {userData.plate_number}</p>
              <p><strong>Car Color:</strong> {userData.car_color}</p>
              <p><strong>Car Type:</strong> {userData.car_type}</p>
              <p><strong>Account Created:</strong> {new Date(userData.created_at).toLocaleDateString()}</p>
              <p><strong>Credits:</strong> {userData.credits}</p>
            </>
          ) : (
            <p>Loading profile data...</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;