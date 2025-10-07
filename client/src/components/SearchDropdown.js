import React, { useState, useEffect, useRef } from 'react';
import './SearchDropdown.css';
import { findUserByUsername, getInteractions } from '../utils/api';

const SearchDropdown = ({ isOpen, onClose, onUserSelect }) => {
  const [username, setUsername] = useState('');
  const [recentSearches, setRecentSearches] = useState([]);
  const [interactions, setInteractions] = useState([]);
  const [errorMessage, setErrorMessage] = useState('');
  const dropdownRef = useRef(null);

  useEffect(() => {
    const storedSearches = JSON.parse(localStorage.getItem('recentSearches')) || [];
    setRecentSearches(storedSearches);

    const fetchInteractions = async () => {
      try {
        const interactionData = await getInteractions();
        setInteractions(interactionData);
      } catch (error) {
        console.error('Error fetching interactions:', error);
      }
    };

    if (isOpen) {
      fetchInteractions();
    }

    const handleClickOutside = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        onClose();
        setErrorMessage('');
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      setErrorMessage('');
    } 

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose]);

  const handleSearch = async () => {
    if (!username.trim()) {
      setErrorMessage('Please enter a username.');
      return;
    }

    try {
      const userData = await findUserByUsername(username);
      setRecentSearches(prevSearches => {
        const newSearchItem = { username: userData.username, avatar_url: userData.avatar_url };
        const filteredSearches = prevSearches.filter(search => search.username !== newSearchItem.username);
        const newSearches = [newSearchItem, ...filteredSearches].slice(0, 5);
        localStorage.setItem('recentSearches', JSON.stringify(newSearches));
        return newSearches;
      });
      onUserSelect(userData);
      onClose();
    } catch (error) {
      if (error.status === 404) {
        setErrorMessage('Username not found.');
      } else {
        setErrorMessage('An error occurred while searching.');
      }
      console.error('Error searching for user:', error);
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
      {errorMessage && <p className="error-message">{errorMessage}</p>}
      <hr className="search-separator" />
      <p className="section-title">Recent Searches</p>
      <div className="recent-searches-list">
        {recentSearches.length > 0 ? (
          recentSearches.map((search, index) => (
            <div key={index} className="recent-search-item" onClick={() => {
              onUserSelect(search);
              onClose();
            }}>
              {search.username}
            </div>
          ))
        ) : (
          <p className="no-recent-searches">No recent searches.</p>
        )}
      </div>
      <hr className="search-separator" />
      <p className="section-title">Interactions</p>
      <div className="interactions-list">
        {interactions.length > 0 ? (
          interactions.map((interaction, index) => (
            <div key={index} className="interaction-item" onClick={() => {
              onUserSelect(interaction);
              onClose();
            }}>
              {interaction.username}
            </div>
          ))
        ) : (
          <p className="no-interactions">No recent interactions.</p>
        )}
      </div>
    </div>
  );
};

export default SearchDropdown;
