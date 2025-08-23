import React from 'react';
import './ProfileModal.css';
import logo from '../assets/images/logo.png'; // Assuming logo is accessible from here

const ProfileModal = ({ onClose, userData }) => {
  const getInitials = (username) => {
    if (!username) return '';
    const words = username.split(' ').filter(word => word.length > 0);
    if (words.length === 0) return '';
    if (words.length === 1) return words[0].charAt(0).toUpperCase();
    return (words[0].charAt(0) + words[1].charAt(0)).toUpperCase();
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
                    <div className="user-avatar">{getInitials(userData.username)}</div>
                  </div>
                  <span className="user-full-name-left-column">{userData.username}</span> {/* Username in left column */}
                </div>
                <div className="profile-right-column"> {/* Right column for details */}
                  <p><strong>Plate Number:</strong> {userData.plate_number.toUpperCase()}</p>
                  <p><strong>Car Color:</strong> {userData.car_color}</p>
                  <p><strong>Car Type:</strong> {userData.car_type}</p>
                  <p><strong>Account Created:</strong> {new Date(userData.created_at).toLocaleDateString()}</p>
                  <p><strong>Credits:</strong> {userData.credits}</p>
                </div>
              </div>
              <p className="my-stats-label">My Stats</p> {/* New element for "My Stats" */}
            </> /* End of React.Fragment */
          ) : (
            <p>Loading profile data...</p>
          )}
        </div>
      </div>
    </div>
  );
};

export default ProfileModal;