import React from 'react';
import { Link } from 'react-router-dom';
import './SplashScreen.css';
import parkingBackground from '../assets/images/parking_background.png';
import logo from '../assets/images/logo.png';


const SplashScreen = () => {
  return (
    <div className="container">
      <div className="top-header">
        <div className="logo-container">
          <div className="logo-and-title">
            <img src={logo} className="logo-img" alt="Parksphere Logo" />
            <h1 className="logo">PARKSPHERE</h1>
          </div>
          <h2 className="tagline-splash">the app you need to <span className="highlight">park in the city!</span></h2>
        </div>
        <div className="auth-buttons">
          <Link to="/login" className="btn signin">Sign In</Link>
          <Link to="/register" className="btn signup">Sign Up</Link>
        </div>
      </div>

      <main className="main-content-area">
        <div className="image">
          <img src={parkingBackground} alt="App preview" />
        </div>
        <div className="text">
          <h2>Welcome to <span className="accent">ParkSphere!</span></h2>
          <p>
            Park Sphere helps drivers find free parking spots in real time by connecting those who are about to leave with those looking to park.
            Simply open the app to view nearby spots that will soon become available, reserve one with a small tip, and head to the location
            while the other driver waits. Whether you're leaving or arriving, Park Sphere makes city parking faster, easier, and stress-free.
          </p>

          <h2>How ParkSphere works</h2>
          <ul>
            <li>Step 1: Find nearby parking spots that will soon be free — updated in real time on the map.</li>
            <li>Step 2: Request the spot by sending a small tip to reserve it.</li>
            <li>Step 3: Get confirmation from the current driver and temporarily block the amount.</li>
            <li>Step 4: Arrive and confirm the handoff — the spot is yours to park!</li>
          </ul>
        </div>
      </main>

      <footer>
        <p>Konstantinos Dimou © 2025</p>
      </footer>
    </div>
  );
};

export default SplashScreen;