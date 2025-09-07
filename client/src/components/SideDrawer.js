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
      </div>
      {userAddress ? (
        <div className="side-drawer-content">
          <p style={{ paddingBottom: '20px' }}><span style={{ display: 'flex', alignItems: 'flex-start' }}><img src={locationIcon} alt="Location" style={{ width: '28px', height: '28px', marginRight: '10px' }} /> {userAddress}</span></p>
          {currentUserCarType && <p><span style={{ color: '#333', display: 'flex', alignItems: 'center', paddingLeft: '5px' }}><img src={carIcon} alt="Car" style={{ width: '24px', height: '24px', marginRight: '8px' }} /> {currentUserCarType.charAt(0).toUpperCase() + currentUserCarType.slice(1)}</span></p>}
        </div>
      ) : spot && (
        <> 
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="side-drawer-content spot-details-grid">
              <div><img src={spotIcon} alt="Spot" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Spot ID: </strong> {spot.id}</div>
              <div><img src={timeIcon} alt="Time" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Time to Expire: </strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</div>
              <div><img src={costIcon} alt="Cost" style={{ width: '28.8px', height: '28.8px' }} /></div><div className="spot-detail-text"><strong>Cost Type: </strong> {spot.cost_type}</div>
              <div><img src={priceIcon} alt="Price" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Price: </strong> €{(spot.price ?? 0).toFixed(2)}</div>
              <div><img src={commentsIcon} alt="Comments" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Comments:</strong> {spot.comments ? spot.comments : 'None'}</div>
              <hr style={{ gridColumn: '1 / -1', margin: '10px 0 0 0', borderColor: '#eee' }} />
            </div>
            <div className="requests-section">
              <h3>Requests</h3>
              {/* Requests will be rendered here */}
            </div>
            <p style={{ color: '#333', display: 'flex', alignItems: 'center', paddingLeft: '1rem', marginTop: '0px' }}> {spot.car_type && spot.car_type.charAt(0).toUpperCase() + spot.car_type.slice(1)}</p>
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
