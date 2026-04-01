import React from 'react';
import './AboutModal.css';
import logo from '../assets/images/logo.png';
import parkingBackground from '../assets/images/parking_background.png';

const AboutModal = ({ onClose }) => {
  return (
    <div className="about-modal-overlay">
      <div className="about-modal-content">
        <div className="about-modal-header">
          <div className="about-header-left">
            <img src={logo} alt="Parksphere Logo" className="about-modal-logo" />
            <div className="about-title-tagline-container">
              <h2 className="about-modal-title">PARKSPHERE</h2>
              <h2 className="tagline">the app you need to <span className="highlight">park in the city!</span></h2>
            </div>
          </div>
          <button className="about-modal-close-button" onClick={onClose}>&times;</button>
        </div>
        <div className="about-modal-body">
          <h3 className="about-section-title">What is ParkSphere?</h3>
          <img src={parkingBackground} alt="Parking Background" className="about-main-image" />
          
          <p className="about-description">
            Park Sphere is a peer-to-peer parking app that helps drivers find free parking spots in real time
            by connecting those who are about to leave with those looking to park. Simply open the app to view 
            nearby spots that will soon become available, reserve one, and head to the location while the other 
            driver waits for your arrival. 
            If you're parking out from a spot, simply notify those around you of your impending departure to earn 
            some extra cash and/or parking credit points!
            Whether you're leaving or arriving, Park Sphere makes city parking faster, easier, and stress-free.
          </p>

          <h3 className="about-section-subtitle">How ParkSphere works</h3>
          <div className="about-steps">
            <p className="about-step"><span className="about-step-highlight">Step 1:</span> Find nearby parking spots that will soon be free — updated in real time on the map.</p>
            <p className="about-step"><span className="about-step-highlight">Step 2:</span> Request the spot by sending a small tip to reserve it.</p>
            <p className="about-step"><span className="about-step-highlight">Step 3:</span> Get confirmation from the current driver and temporarily block the amount.</p>
            <p className="about-step"><span className="about-step-highlight">Step 4:</span> Arrive and confirm the handoff — the spot is yours to park!</p>
          </div>
        </div>
        <div className="about-modal-footer">
          <p className="about-footer-text">© 2025 Konstantinos Dimou</p>
        </div>
      </div>
    </div>
  );
};

export default AboutModal;
