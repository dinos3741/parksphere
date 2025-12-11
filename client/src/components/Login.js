import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import './Login.css';

const Login = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const navigate = useNavigate();

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
          <h2>Login</h2>
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
