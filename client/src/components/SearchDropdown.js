import React, { useState, useEffect, useRef } from 'react';
import './SearchDropdown.css';

const SearchDropdown = ({ isOpen, onClose, pendingRequests, onUserSelect }) => {
  const [username, setUsername] = useState('');
  const dropdownRef = useRef(null);

  const lastThreeRequests = pendingRequests ? pendingRequests.slice(-3) : [];

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleSearch = async () => {
    if (!username.trim()) return;

    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3001/api/users/username/${username}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (!response.ok) {
        throw new Error('User not found');
      }
      const userData = await response.json();
      onUserSelect(userData);
      onClose(); // Close dropdown after showing user details
    } catch (error) {
      console.error('Error searching for user:', error);
      // TODO: Display an error message to the user
    }
  };

  return (
    <div className="search-dropdown" ref={dropdownRef}>
      <div className="search-bar-container">
        <input
          type="text"
          placeholder="Enter username..."
          value={username}
          onChange={(e) => setUsername(e.target.value)}
        />
        <button onClick={handleSearch}>Search</button>
      </div>
      <hr className="search-separator" />
      <p className="requests-text">Recent Searches</p>
      <div className="requests-list">
        {lastThreeRequests.length > 0 ? (
          lastThreeRequests.map((requestId) => (
            <div key={requestId} className="request-item">
              Request ID: {requestId}
            </div>
          ))
        ) : (
          <p className="no-requests">No recent searches.</p>
        )}
      </div>
    </div>
  );
};

export default SearchDropdown;
