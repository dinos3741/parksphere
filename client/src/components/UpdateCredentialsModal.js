import React, { useState } from 'react';
import './UpdateCredentialsModal.css';

const UpdateCredentialsModal = ({ onClose }) => {
  const [email, setEmail] = useState('');
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');

  const handleSubmit = (e) => {
    e.preventDefault();
    // Here you would typically send a request to your backend
    console.log('Update credentials submitted:', { email, currentPassword, newPassword });
    onClose(); // Close modal after submission (for now)
  };

  return (
    <div className="update-credentials-modal-overlay">
      <div className="update-credentials-modal-content">
        <div className="update-credentials-modal-header">
          <h2>Update Email/Password</h2>
          <button className="update-credentials-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="update-credentials-modal-body">
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label htmlFor="email">New Email (optional):</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter new email"
              />
            </div>
            <div className="form-group">
              <label htmlFor="current-password">Current Password:</label>
              <input
                type="password"
                id="current-password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Enter current password"
                required
              />
            </div>
            <div className="form-group">
              <label htmlFor="new-password">New Password (optional):</label>
              <input
                type="password"
                id="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Enter new password"
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

export default UpdateCredentialsModal;