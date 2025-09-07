import locationIcon from '../assets/images/location.png';
import carIcon from '../assets/images/car.png';
import spotIcon from '../assets/images/spot.png';
import timeIcon from '../assets/images/time.png';
import costIcon from '../assets/images/cost.png';
import priceIcon from '../assets/images/price.png';
import commentsIcon from '../assets/images/comments.png';
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
          <p style={{ paddingBottom: '20px' }}><span style={{ display: 'flex', alignItems: 'flex-start' }}><img src={locationIcon} alt="Location" style={{ width: '28px', height: '28px', marginRight: '10px' }} /> {userAddress}</span></p>
          {currentUserCarType && <p><span style={{ color: '#333', display: 'flex', alignItems: 'center', paddingLeft: '5px' }}><img src={carIcon} alt="Car" style={{ width: '24px', height: '24px', marginRight: '8px' }} /> {currentUserCarType.charAt(0).toUpperCase() + currentUserCarType.slice(1)}</span></p>}
        </div>
      ) : spot && (
        <>
          <div className="side-drawer-content">
            <p><span style={{ display: 'flex', alignItems: 'center' }}><img src={spotIcon} alt="Spot" style={{ width: '24px', height: '24px', marginRight: '8px' }} /><strong>Spot ID: &nbsp;</strong> {spot.id}</span></p>
            <p><span style={{ display: 'flex', alignItems: 'center' }}><img src={timeIcon} alt="Time" style={{ width: '24px', height: '24px', marginRight: '8px' }} /><strong>Time to Expire: &nbsp;</strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</span></p>
            <p><span style={{ display: 'flex', alignItems: 'center' }}><img src={costIcon} alt="Cost" style={{ width: '28.8px', height: '28.8px', marginRight: '8px' }} /><strong>Cost Type: &nbsp;</strong> {spot.cost_type}</span></p>
            <p><span style={{ display: 'flex', alignItems: 'center' }}><img src={priceIcon} alt="Price" style={{ width: '24px', height: '24px', marginRight: '8px' }} /><strong>Price: &nbsp;</strong> €{(spot.price ?? 0).toFixed(2)}</span></p>
            <p><span style={{ display: 'flex', alignItems: 'center' }}><img src={commentsIcon} alt="Comments" style={{ width: '24px', height: '24px', marginRight: '8px' }} /><strong>Comments:</strong> {spot.comments}</span></p>
            <p><span style={{ color: '#333', display: 'flex', alignItems: 'center', paddingLeft: '5px' }}> {spot.car_type && spot.car_type.charAt(0).toUpperCase() + spot.car_type.slice(1)}</span></p>
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
