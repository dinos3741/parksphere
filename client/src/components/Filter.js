import React from 'react';
import './Filter.css';

const Filter = ({ selectedFilter, onFilterChange, currentUsername, onLogout, currentUserAvatarUrl }) => {
  return (
    <div className="filter-container">
      <div className="user-info">
        <img src={currentUserAvatarUrl || "https://i.pravatar.cc/80"} alt="User Avatar" className="user-avatar" />
        <div className="welcome-text-container">
          Welcome {currentUsername}!
        </div>
      </div>
    </div>
  );
};

export default Filter;
