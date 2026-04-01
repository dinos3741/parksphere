import React, { useState, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';

import HeaderUserInfo from './HeaderUserInfo';
import './Filter.css';

const Filter = ({
  currentUsername,
  currentUserAvatarUrl,
  onAvatarClick,
  showSearchUserModal,
  setShowSearchUserModal,
  setIsMessagesDrawerOpen,
  unreadMessages,
}) => {
  const unreadCount = Object.values(unreadMessages).reduce((acc, count) => acc + count, 0);
  const [headerUserMount, setHeaderUserMount] = useState(null);

  useLayoutEffect(() => {
    const header = document.querySelector('.App-header');
    if (!header) return undefined;
    const el = document.createElement('div');
    el.className = 'header-user-info-portal-root';
    header.appendChild(el);
    setHeaderUserMount(el);
    return () => {
      el.remove();
      setHeaderUserMount(null);
    };
  }, []);

  return (
    <>
      {headerUserMount &&
        createPortal(
          <HeaderUserInfo
            avatarUrl={currentUserAvatarUrl}
            username={currentUsername}
            onAvatarClick={onAvatarClick}
            onSearchClick={() => setShowSearchUserModal(true)}
            onMessagesClick={() => setIsMessagesDrawerOpen(true)}
            unreadCount={unreadCount}
            isSearchHighlighted={showSearchUserModal}
          />,
          headerUserMount
        )}
    </>
  );
};

export default Filter;
