import React, { useState, useEffect, useRef } from 'react';
import './SearchDropdown.css';

const SearchDropdown = ({ isOpen, onClose, pendingRequests, onUserSelect }) => {
  const [username, setUsername] = useState('');
  const [recentSearches, setRecentSearches] = useState([]);
  const dropdownRef = useRef(null);

  const lastThreeRequests = pendingRequests ? pendingRequests.slice(-3) : [];

  useEffect(() => {
    // Load recent searches from localStorage on component mount
    const storedSearches = JSON.parse(localStorage.getItem('recentSearches')) || [];
    setRecentSearches(storedSearches);

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

    // Add current search to recent searches
    setRecentSearches(prevSearches => {
      const newSearches = [username, ...prevSearches.filter(search => search !== username)].slice(0, 5);
      localStorage.setItem('recentSearches', JSON.stringify(newSearches));
      return newSearches;
    });

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
          onKeyPress={(e) => {
            if (e.key === 'Enter') {
              handleSearch();
            }
          }}
        />
        <button onClick={handleSearch}>Search</button>
      </div>
      <hr className="search-separator" />
      <p className="section-title">Recent Searches</p>
      <div className="recent-searches-list">
        {recentSearches.length > 0 ? (
          recentSearches.map((search, index) => (
            <div key={index} className="recent-search-item" onClick={() => {
              setUsername(search);
              handleSearch();
            }}>
              {search}
            </div>
          ))
        ) : (
          <p className="no-recent-searches">No recent searches.</p>
        )}
      </div>

      <hr className="search-separator" />
      <p className="section-title">Recent Interactions</p>
      <div className="requests-list">
        {lastThreeRequests.length > 0 ? (
          lastThreeRequests.map((requestId) => (
            <div key={requestId} className="request-item">
              Request ID: {requestId}
            </div>
          ))
        ) : (
          <p className="no-requests">No recent interactions.</p>
        )}
      </div>
    </div>
  );
};

export default SearchDropdown;
