import React from 'react';
import './Filter.css';

const Filter = ({ selectedFilter, onFilterChange, currentUsername, onLogout, currentUserAvatarUrl, onAvatarClick }) => {
  return (
    <div className="filter-container">
      <div className="user-info">
        <img src={currentUserAvatarUrl} alt="User Avatar" className="user-avatar" onClick={onAvatarClick} />
        <div className="welcome-text-container">
          Welcome {currentUsername}!
        </div>
      </div>
    </div>
  );
};

export default Filter;
