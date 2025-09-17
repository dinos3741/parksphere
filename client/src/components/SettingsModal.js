import React from 'react';
import './SettingsModal.css';
import logo from '../assets/images/logo.png';

const SettingsModal = ({ onClose, selectedFilter, onFilterChange }) => {
  return (
    <div className="settings-modal-overlay">
      <div className="settings-modal-content">
        <div className="settings-modal-header">
          <div className="settings-header-left">
            <img src={logo} alt="Parksphere Logo" className="settings-modal-logo" />
            <div className="settings-title-tagline-container">
              <h2 className="settings-modal-title">PARKSPHERE</h2>
              <h2 className="tagline">the app you need to <span className="highlight">park in the city!</span></h2>
            </div>
          </div>
          <button className="settings-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="settings-modal-body">
          <label htmlFor="filter">Show spots free in:</label>
          <select id="filter" className="filter-dropdown" value={selectedFilter} onChange={(e) => onFilterChange(e.target.value)}>
            <option value="all">All</option>
            <option value="5">5 minutes</option>
            <option value="10">10 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
          </select>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
