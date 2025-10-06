import React, { useState } from 'react';
import './SearchUserModal.css';

const SearchUserModal = ({ isOpen, onClose }) => {
  const [username, setUsername] = useState('');

  if (!isOpen) return null;

  const handleSearch = () => {
    console.log('Searching for user:', username);
    // TODO: Implement actual search logic
    onClose(); // Close modal after search for now
  };

  return (
    <div className="search-user-modal-overlay">
      <div className="search-user-modal-content">
        <button className="search-user-modal-close-button" onClick={onClose}>&times;</button>
        <h2>Search User</h2>
        <div className="search-bar-container">
          <input
            type="text"
            placeholder="Enter username..."
            value={username}
            onChange={(e) => setUsername(e.target.value)}
          />
          <button onClick={handleSearch}>Search</button>
        </div>
      </div>
    </div>
  );
};

export default SearchUserModal;
