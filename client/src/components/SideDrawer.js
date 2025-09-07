import locationIcon from '../assets/images/location.png';
import React, { useEffect, useRef } from 'react';
import './SideDrawer.css';

const SideDrawer = ({ spot, userAddress, currentUserCarType, onClose, onEdit, onDelete, formatRemainingTime }) => {
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
        <h3>{userAddress ? 'User Details' : 'Spot Details'}</h3>
        <button onClick={onClose} className="close-button">&times;</button>
      </div>
      {userAddress ? (
        <div className="side-drawer-content">
          <p><span style={{ display: 'flex', alignItems: 'flex-start' }}><img src={locationIcon} alt="Location" style={{ width: '28px', height: '28px', marginRight: '10px' }} /> {userAddress}</span></p>
          {currentUserCarType && <p><span style={{ color: '#333', display: 'flex', alignItems: 'center' }}><strong>🚗</strong> {currentUserCarType.charAt(0).toUpperCase() + currentUserCarType.slice(1)}</span></p>}
        </div>
      ) : spot && (
        <>
          <div className="side-drawer-content">
            <p><strong>Spot ID:</strong> {spot.id}</p>
            <p><strong>Time until expiration:</strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</p>
            <p><strong>Cost Type:</strong> {spot.cost_type}</p>
            <p><strong>Price:</strong> €{(spot.price ?? 0).toFixed(2)}</p>
            <p><strong>Comments:</strong> {spot.comments}</p>
            <p><span style={{ color: '#333', display: 'flex', alignItems: 'center' }}><strong>🚗</strong> {spot.car_type && spot.car_type.charAt(0).toUpperCase() + spot.car_type.slice(1)}</span></p>
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
