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
  const getAvatarUri = () => {
    if (!avatarUrl) {
      return `https://i.pravatar.cc/150?u=${username}`;
    }
    if (avatarUrl.startsWith('http')) {
      return avatarUrl;
    }
    return avatarUrl; // Let the proxy handle it or it's a relative path from the same host
  };

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
        src={getAvatarUri()}
        alt="User Avatar"
        className="header-user-avatar"
        onClick={onAvatarClick}
        referrerPolicy="no-referrer"
      />
      <div className="header-welcome-text">Welcome {username}!</div>
    </div>
  );
}
