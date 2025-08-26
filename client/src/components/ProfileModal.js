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
              </div>
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