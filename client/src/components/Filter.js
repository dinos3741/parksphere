import React from 'react';
import messageIcon from '../assets/images/envelope.png';
import './Filter.css';

const Filter = ({ selectedFilter, onFilterChange, currentUsername, onLogout, currentUserAvatarUrl, onAvatarClick, showSearchUserModal, setShowSearchUserModal }) => {
  return (
    <div className="filter-container">
      <i className={`fas fa-search search-icon ${showSearchUserModal ? 'highlighted' : ''}`} onClick={() => setShowSearchUserModal(true)}></i>
      <img src={messageIcon} alt="Messages" className="message-icon" />
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
