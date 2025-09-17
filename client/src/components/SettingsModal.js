import React from 'react';
import './SettingsModal.css';
import logo from '../assets/images/logo.png';

const SettingsModal = ({ onClose }) => {
  return (
    <div className="settings-modal-overlay">
      <div className="settings-modal-content">
        <div className="settings-modal-header">
          <div className="settings-header-left">
            <img src={logo} alt="Parksphere Logo" className="settings-modal-logo" />
            <div className="settings-title-tagline-container">
              <h2 className="settings-modal-title">SETTINGS</h2>
              <h2 className="tagline">the app you need to <span className="highlight">park in the city!</span></h2>
            </div>
          </div>
          <button className="settings-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="settings-modal-body">
          <p>Settings will be here.</p>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
