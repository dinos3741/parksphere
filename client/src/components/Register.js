import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Register.css';

const Register = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carColor, setCarColor] = useState('');
  const [carType, setCarType] = useState('city car'); // New state for car type
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password, plateNumber, carColor, carType }),
      });

      if (response.ok) {
        alert('Registration successful! Please log in.');
        navigate('/login');
      } else {
        const errorData = await response.text();
        alert(`Registration failed: ${errorData}`);
      }
    } catch (error) {
      console.error('Error during registration:', error);
      alert('An error occurred during registration.');
    }
  };

  return (
    <>
      <div className="auth-page-wrapper">
        <div className="logo-container">
          <h1 className="logo">PARKSPHERE</h1>
          <h2 className="tagline">the app you need to <span className="highlight">park in the city!</span></h2>
        </div>
        <div className="auth-top-background"></div>
        <div className="spacer"></div>
        <div className="auth-container">
          <h2>Register</h2>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="username">Username:</label>
            <input
              type="text"
              id="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="password">Password:</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="plateNumber">Plate Number:</label>
            <input
              type="text"
              id="plateNumber"
              value={plateNumber}
              onChange={(e) => setPlateNumber(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="carColor">Car Color:</label>
            <input
              type="text"
              id="carColor"
              value={carColor}
              onChange={(e) => setCarColor(e.target.value)}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="carType">Car Type:</label>
            <select id="carType" value={carType} onChange={(e) => setCarType(e.target.value)}>
              <option value="city car">City Car (Mini/Compact)</option>
              <option value="hatchback">Hatchback</option>
              <option value="sedan">Sedan</option>
              <option value="SUV">SUV</option>
              <option value="family car">Family Car</option>
              <option value="van">Van</option>
              <option value="truck">Truck</option>
              <option value="motorcycle">Motorcycle</option>
            </select>
          </div>
          <button type="submit">Register</button>
        </form>
        <p>
          Already have an account? <Link to="/login">Login here</Link>
        </p>
      </div>
    </div>
    </>
  );
};

export default Register;