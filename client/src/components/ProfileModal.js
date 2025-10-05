import React, { useState } from 'react';
import './ProfileModal.css';
import logo from '../assets/images/logo.png'; // Assuming logo is accessible from here
import UpdateCredentialsModal from './UpdateCredentialsModal'; // Import the new modal
import ChangeCarTypeModal from './ChangeCarTypeModal'; // Import the new modal

const ProfileModal = ({ onClose, userData, currentUserId, addNotification, onCarDetailsUpdated }) => {
  const [showUpdateCredentialsModal, setShowUpdateCredentialsModal] = useState(false);
  const [showChangeCarTypeModal, setShowChangeCarTypeModal] = useState(false); // New state

  

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
                  <div className="user-avatar-only"> {/* Avatar circle only */}
                    <img src={`https://i.pravatar.cc/150?u=${userData.username}`} alt={userData.username} className="user-avatar" />
                  </div>
                  <span className="user-full-name-left-column">{userData.username}</span> {/* Username in left column */}
                </div>
                <div className="profile-right-column"> {/* Right column for details */}
                  <p><span className="profile-label">Plate Number:</span> <span className="profile-value">{userData.plate_number.toUpperCase()}</span></p>
                  <p><span className="profile-label">Car Color:</span> <span className="profile-value">{userData.car_color}</span></p>
                  <p><span className="profile-label">Car Type:</span> <span className="profile-value">{userData.car_type}</span></p>
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