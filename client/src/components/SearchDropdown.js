import React, { useState, useEffect, useRef } from 'react';
import './SearchDropdown.css';

const SearchDropdown = ({ isOpen, onClose, pendingRequests }) => {
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

  if (!isOpen) return null;

  const handleSearch = () => {
    console.log('Searching for user:', username);
    // TODO: Implement actual search logic
    // onClose(); // Keep open after search for now, user can close manually
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
      <p className="requests-text">Requests</p>
      <div className="requests-list">
        {lastThreeRequests.length > 0 ? (
          lastThreeRequests.map((requestId) => (
            <div key={requestId} className="request-item">
              Request ID: {requestId}
            </div>
          ))
        ) : (
          <p className="no-requests">No recent requests.</p>
        )}
      </div>
    </div>
  );
};

export default SearchDropdown;
