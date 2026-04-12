import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import keycloak from '../utils/keycloak';
import './Register.css';

const Register = () => {
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carColor, setCarColor] = useState('');
  const [carType, setCarType] = useState('');
  const [carTypes, setCarTypes] = useState([]);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCarTypes = async () => {
      try {
        const response = await fetch('/api/car-types');
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        setCarTypes(data);
        if (data.length > 0) {
          setCarType(data[0]);
        }
      } catch (error) {
        console.error('Error fetching car types:', error);
        setCarTypes(['city car', 'hatchback', 'sedan', 'SUV', 'family car', 'van', 'truck', 'motorcycle']);
        setCarType('city car');
      }
    };

    fetchCarTypes();
  }, []);

  const handleGoogleLogin = () => {
    if (!plateNumber || !carColor || !carType) {
      alert('Please fill in your plate number, car color, and car type before registering with Google.');
      return;
    }
    keycloak.login({ idpHint: 'google' });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!username || !password || !email) {
      alert('Username, email and password are required for registration.');
      return;
    }
    try {
      const response = await fetch('/api/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, email, password, plateNumber, carColor, carType }),
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
              <label htmlFor="email">Email:</label>
              <input
                type="email"
                id="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
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
                {carTypes.map((type) => (
                  <option key={type} value={type}>
                    {type.charAt(0).toUpperCase() + type.slice(1)}
                  </option>
                ))}
              </select>
            </div>
            <button type="submit">Register</button>
            <div className="social-login-separator">
              <span>OR</span>
            </div>
            <div className="google-login-container">
              <button type="button" className="google-button" onClick={handleGoogleLogin}>
                <img src="https://developers.google.com/identity/images/g-logo.png" alt="Google logo" />
                Sign up with Google
              </button>
            </div>
          </form>
          <p>
            Already have an account? <Link to="/login">Login here</Link>
          </p>
        </div>
        <footer className="App-footer">
          <p>Konstantinos Dimou &copy; 2025</p>
        </footer>
      </div>
    </>
  );
};

export default Register;
