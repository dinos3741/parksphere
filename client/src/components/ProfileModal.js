import React, { useState, useRef } from 'react';
import './ProfileModal.css';
import logo from '../assets/images/logo.png'; // Assuming logo is accessible from here
import UpdateCredentialsModal from './UpdateCredentialsModal'; // Import the new modal
import ChangeCarTypeModal from './ChangeCarTypeModal'; // Import the new modal

const ProfileModal = ({ onClose, userData, currentUserId, addNotification, onCarDetailsUpdated, onProfileUpdate }) => {
  const [showUpdateCredentialsModal, setShowUpdateCredentialsModal] = useState(false);
  const [showChangeCarTypeModal, setShowChangeCarTypeModal] = useState(false); // New state
  const fileInputRef = useRef(null);

  const handleAvatarClick = () => {
    fileInputRef.current.click();
  };

  const handleFileChange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;

    // Basic validation
    if (!file.type.startsWith('image/')) {
      addNotification('Please select an image file.', 'red');
      return;
    }

    const formData = new FormData();
    formData.append('avatar', file);

    const token = localStorage.getItem('token');

    try {
      const response = await fetch('http://localhost:3001/api/users/avatar', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
        },
        body: formData,
      });

      if (response.ok) {
        addNotification('Avatar updated successfully!', 'green');
        if (onProfileUpdate) {
          onProfileUpdate();
        }
      } else {
        addNotification('Failed to update avatar.', 'red');
      }
    } catch (error) {
      console.error('Error uploading avatar:', error);
      addNotification('An error occurred during upload.', 'red');
    } finally {
      if (event.target) {
        event.target.value = '';
      }
    }
  };

  const handleUpdateCredentialsClick = () => {
    setShowUpdateCredentialsModal(true);
  };

  const handleCloseUpdateCredentialsModal = () => {
    setShowUpdateCredentialsModal(false);
  };

  const handleChangeCarTypeClick = () => { // New handler
    setShowChangeCarTypeModal(true);
  };

  const handleCloseChangeCarTypeModal = () => { // New handler
    setShowChangeCarTypeModal(false);
  };

  const getAvatarUri = () => {
    if (!userData.avatar_url) {
      return `https://i.pravatar.cc/150?u=${userData.username}`;
    }

    if (userData.avatar_url.startsWith('http')) {
      return userData.avatar_url;
    }

    // Relative path, prepend server URL (assuming it's the same host as the web app or hardcoded to localhost:3001)
    return `http://localhost:3001${userData.avatar_url}`;
  };

  return (
    <div className="profile-modal-overlay">
      <div className="profile-modal-content">
        <div className="profile-modal-header">
          <div className="profile-header-left"> {/* New container */}
            <img src={logo} alt="Parksphere Logo" className="profile-modal-logo" />
            <div className="profile-title-tagline-container"> {/* New container for title and tagline */}
              <h2 className="profile-modal-title">PARKSPHERE</h2>
              <h2 className="tagline">the app you need to <span className="highlight">park in the city!</span></h2>
            </div>
          </div>
          <button className="profile-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="profile-modal-body">
          {userData ? (
            <> {/* Start of React.Fragment */}
              <div className="profile-details-two-column"> {/* Main container for two columns */}
                <div className="profile-left-column"> {/* Left column for avatar and username */}
                  <div className="user-avatar-only" onClick={handleAvatarClick} title="Click to change avatar"> {/* Avatar circle only */}
                    <img 
                      src={getAvatarUri()} 
                      alt={userData.username} 
                      className="user-avatar" 
                    />
                    <div className="avatar-edit-overlay">Edit</div>
                  </div>
                  <input
                    type="file"
                    ref={fileInputRef}
                    style={{ display: 'none' }}
                    accept="image/*"
                    onChange={handleFileChange}
                  />
                  <span className="user-full-name-left-column">{userData.username}</span> {/* Username in left column */}
                </div>
                <div className="profile-right-column"> {/* Right column for details */}
                  <p><span className="profile-label">Plate Number:</span> <span className="profile-value">{userData.plate_number ? userData.plate_number.toUpperCase() : 'N/A'}</span></p>
                  <p><span className="profile-label">Car Color:</span> <span className="profile-value">{userData.car_color || 'N/A'}</span></p>
                  <p><span className="profile-label">Car Type:</span> <span className="profile-value">{userData.car_type || 'N/A'}</span></p>
                  <p><span className="profile-label">Account Created:</span> <span className="profile-value">{new Date(userData.created_at).toLocaleDateString()}</span></p>
                  <p><span className="profile-label">Credits:</span> <span className="profile-value">{userData.credits}</span></p>
                </div>
              </div>
              <div className="my-stats-section">
                <p className="my-stats-label">My Stats</p>
                <div></div>
                <p>Spots Declared:</p> <span className="my-stats-value">{userData.spots_declared}</span>
                <p>Spots Taken:</p> <span className="my-stats-value">{userData.spots_taken}</span>
                <p>Average Arrival Time:</p> <span className="my-stats-value">
                  {userData.completed_transactions_count > 0
                    ? `${(userData.total_arrival_time / userData.completed_transactions_count).toFixed(2)} min`
                    : 'N/A'}
                </span>
                <p>Rating:</p> <span className="my-stats-value">
                  {userData.rating_count > 0
                    ? `${Number(userData.rating).toFixed(2)} / 5.00 (${userData.rating_count} ratings)`
                    : 'No ratings yet'}
                </span>
                <p>Rank:</p> <span className="my-stats-value">top {userData.rank} %</span>
              </div>

              <div className="settings-section">
                <p className="settings-label">Settings</p>
                <div className="settings-menu-item" onClick={handleUpdateCredentialsClick}>
                  <span className="menu-item-text">Update email/password</span>
                  <span className="menu-item-arrow">&gt;</span>
                </div>
                <div className="settings-menu-item" onClick={handleChangeCarTypeClick}>
                  <span className="menu-item-text">Change car type</span>
                  <span className="menu-item-arrow">&gt;</span>
                </div>
              </div>

            </> /* End of React.Fragment */
          ) : (
            <p>Loading profile data...</p>
          )}
        </div>
      </div>
      {showUpdateCredentialsModal && <UpdateCredentialsModal onClose={handleCloseUpdateCredentialsModal} />}
      {showChangeCarTypeModal && <ChangeCarTypeModal 
        onClose={handleCloseChangeCarTypeModal}
        currentUserId={currentUserId}
        addNotification={addNotification}
        onCarDetailsUpdated={onCarDetailsUpdated}
      />}
    </div>
  );
};

export default ProfileModal;