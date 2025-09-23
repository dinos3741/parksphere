import React from 'react';
import './Filter.css';

const Filter = ({ selectedFilter, onFilterChange, currentUsername, onLogout }) => {
  return (
    <div className="filter-container">
      <div className="user-info">
        <span>Welcome {currentUsername}!</span>
        
      </div>
    </div>
  );
};

export default Filter;
