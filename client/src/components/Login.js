import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { GoogleLogin } from '@react-oauth/google';
import './Login.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [plateNumber, setPlateNumber] = useState('');
  const [carColor, setCarColor] = useState('');
  const [carType, setCarType] = useState('');
  const [carTypes, setCarTypes] = useState([]);
  const [showCarDetailsFields, setShowCarDetailsFields] = useState(false);
  const [tempIdToken, setTempIdToken] = useState(null);
  const navigate = useNavigate();

  useEffect(() => {
    const fetchCarTypes = async () => {
      try {
        const response = await fetch('/api/car-types');
        if (response.ok) {
          const data = await response.json();
          setCarTypes(data);
          if (data.length > 0) setCarType(data[0]);
        }
      } catch (error) {
        console.error('Error fetching car types:', error);
      }
    };
    fetchCarTypes();
  }, []);

  const handleGoogleSuccess = async (credentialResponse) => {
    const idToken = credentialResponse.credential;
    try {
      const response = await fetch('/api/auth/google', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          idToken,
          plateNumber: plateNumber || null,
          carColor: carColor || null,
          carType: carType || null
        }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('token', data.token);
        sessionStorage.setItem('welcomeMessage', `Welcome, ${data.username}!`);
        navigate('/dashboard');
      } else if (response.status === 428) { // Precondition Required - missing car details
        setTempIdToken(idToken);
        setShowCarDetailsFields(true);
        alert('Please provide your car details to complete Google login.');
      } else {
        const errorData = await response.text();
        alert(`Google login failed: ${errorData}`);
      }
    } catch (error) {
      console.error('Error during Google login:', error);
      alert('An error occurred during Google login.');
    }
  };

  const handleCarDetailsSubmit = (e) => {
    e.preventDefault();
    if (tempIdToken) {
      handleGoogleSuccess({ credential: tempIdToken });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch('/api/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ username, password }),
      });

      if (response.ok) {
        const data = await response.json();
        localStorage.setItem('token', data.token);
        sessionStorage.setItem('welcomeMessage', `Welcome, ${username}!`);
        navigate('/dashboard'); // Redirect to dashboard on successful login
      } else {
        const errorData = await response.text();
        alert(`Login failed: ${errorData}`);
      }
    } catch (error) {
      console.error('Error during login:', error);
      alert('An error occurred while declaring the spot.');
    }
  };

  return (
    <>
      <div className="auth-page-wrapper">
        <div className="logo-container">
          <div className="logo-and-title">
            <h1 className="logo">PARKSPHERE</h1>
          </div>
          <h2 className="tagline-login">the app you need to <span className="highlight">park in the city!</span></h2>
        </div>
        
        <div className="auth-top-background"></div>
        <div className="auth-container">
          <h2>{showCarDetailsFields ? 'Enter Car Details' : 'Login'}</h2>
        {showCarDetailsFields ? (
          <form onSubmit={handleCarDetailsSubmit}>
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
            <button type="submit">Complete Google Login</button>
            <button type="button" className="cancel-button" onClick={() => setShowCarDetailsFields(false)} style={{ backgroundColor: '#6c757d', marginTop: '10px' }}>Cancel</button>
          </form>
        ) : (
          <>
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
              <button type="submit">Login</button>
            </form>
            <div className="social-login-separator">
              <span>OR</span>
            </div>
            <div className="google-login-container">
              <GoogleLogin
                onSuccess={handleGoogleSuccess}
                onError={() => {
                  console.log('Login Failed');
                  alert('Google Login Failed');
                }}
                useOneTap
              />
            </div>
          </>
        )}
        <p>
          Don't have an account? <Link to="/register">Register here</Link>
        </p>
      </div>
    <footer className="App-footer">
        <p>Konstantinos Dimou &copy; 2025</p>
      </footer>
    </div>
    </>
  );
};

export default Login;
