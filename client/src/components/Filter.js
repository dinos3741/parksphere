import React from 'react';
import './Filter.css';

const Filter = ({ selectedFilter, onFilterChange, currentUsername, onLogout }) => {
  return (
    <div className="filter-container">
      <label htmlFor="filter">Show spots free in:</label>
      <select id="filter" className="filter-dropdown" value={selectedFilter} onChange={(e) => onFilterChange(e.target.value)}>
        <option value="all">All</option>
        <option value="5">5 minutes</option>
        <option value="10">10 minutes</option>
        <option value="15">15 minutes</option>
        <option value="30">30 minutes</option>
      </select>
      <div className="user-info">
        <span>Welcome {currentUsername}!</span>
        <button onClick={onLogout}>Logout</button>
      </div>
    </div>
  );
};

export default Filter;
