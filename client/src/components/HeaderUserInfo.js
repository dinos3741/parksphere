import React from 'react';

export default function HeaderUserInfo({
  avatarUrl,
  username,
  onAvatarClick,
  onSearchClick,
  onMessagesClick,
  unreadCount,
  isSearchHighlighted,
}) {
  return (
    <div className="header-user-info">
      <div className="header-actions">
        <button
          type="button"
          className={`header-action-btn ${isSearchHighlighted ? 'is-active' : ''}`}
          onClick={onSearchClick}
          aria-label="Search users"
        >
          <i className="fas fa-search" />
        </button>
        <button
          type="button"
          className="header-action-btn header-action-btn--messages"
          onClick={onMessagesClick}
          aria-label="Open messages"
        >
          <i className="fas fa-envelope" />
          {unreadCount > 0 && <span className="header-action-badge" />}
        </button>
      </div>
      <img
        src={avatarUrl}
        alt="User Avatar"
        className="header-user-avatar"
        onClick={onAvatarClick}
      />
      <div className="header-welcome-text">Welcome {username}!</div>
    </div>
  );
}
