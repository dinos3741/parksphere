import React, { useEffect, useRef } from 'react';
import './SideDrawer.css';

const SideDrawer = ({ spot, userAddress, onClose, onEdit, onDelete, formatRemainingTime }) => {
  const drawerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (spot || userAddress) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [spot, userAddress, onClose]);

  return (
    <div ref={drawerRef} className={`side-drawer ${spot || userAddress ? 'open' : ''}`}>
      <div className="side-drawer-header">
        <h3>{userAddress ? 'User Location' : 'Spot Details'}</h3>
        <button onClick={onClose} className="close-button">&times;</button>
      </div>
      {userAddress ? (
        <div className="side-drawer-content">
          <p><strong>Current Address:</strong></p>
          <p>{userAddress}</p>
        </div>
      ) : spot && (
        <>
          <div className="side-drawer-content">
            <p><strong>Spot ID:</strong> {spot.id}</p>
            <p><strong>Time until expiration:</strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</p>
            <p><strong>Cost Type:</strong> {spot.cost_type}</p>
            <p><strong>Price:</strong> €{(spot.price ?? 0).toFixed(2)}</p>
            <p><strong>Comments:</strong> {spot.comments}</p>
          </div>
          <div className="side-drawer-footer">
            <button onClick={() => onEdit(spot)} className="edit-button">Edit</button>
            <button onClick={() => onDelete(spot.id)} className="delete-button">Delete</button>
          </div>
        </>
      )}
    </div>
  );
};

export default SideDrawer;
