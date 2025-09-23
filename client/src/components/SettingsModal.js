import React from 'react';
import './SettingsModal.css';
import logo from '../assets/images/logo.png';

const SettingsModal = ({ onClose, selectedFilter, onFilterChange, selectedRadius, onRadiusChange }) => {
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
          <div className="filter-row">
            <label htmlFor="filter" className="filter-label">Show spots free in:</label>
            <select id="filter" className="filter-dropdown" value={selectedFilter} onChange={(e) => onFilterChange(e.target.value)}>
              <option value="all">All</option>
              <option value="5">5 minutes</option>
              <option value="10">10 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
            </select>
          </div>
          <div className="filter-row">
            <label htmlFor="radius" className="filter-label">Show spots around radius of:</label>
            <select id="radius" className="filter-dropdown" value={selectedRadius} onChange={(e) => onRadiusChange(e.target.value)}>
              <option value="2">2km</option>
              <option value="5">5km</option>
              <option value="10">10km</option>
              <option value="20">20km</option>
              <option value="30">30km</option>
            </select>
          </div>
        </div>
      </div>
    </div>
  );
};

export default SettingsModal;
