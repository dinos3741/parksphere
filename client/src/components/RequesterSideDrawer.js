import React, { useRef, useEffect } from 'react';
import './RequesterSideDrawer.css';
import spotIcon from '../assets/images/spot.png';
import timeIcon from '../assets/images/time.png';
import costIcon from '../assets/images/cost.png';
import priceIcon from '../assets/images/price.png';
import commentsIcon from '../assets/images/comments.png';

const RequesterSideDrawer = ({ spot, formatRemainingTime, onRequest, onClose }) => {
  const drawerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (drawerRef.current && !drawerRef.current.contains(event.target)) {
        onClose();
      }
    };

    if (spot) {
      document.addEventListener('mousedown', handleClickOutside);
    } else {
      document.removeEventListener('mousedown', handleClickOutside);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [spot, onClose]);

  return (
    <div ref={drawerRef} className={`requester-side-drawer ${spot ? 'open' : ''}`}>
      <div className="requester-side-drawer-header">
        <h3>Spot Details</h3>
      </div>
      {spot && (
        <>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
            <div className="requester-side-drawer-content spot-details-grid">
              <div><img src={spotIcon} alt="Spot" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Declared by: </strong> {spot.username}</div>
              <div><img src={timeIcon} alt="Time" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Time to Expire: </strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</div>
              <div><img src={costIcon} alt="Cost" style={{ width: '28.8px', height: '28.8px' }} /></div><div className="spot-detail-text"><strong>Cost Type: </strong> {spot.cost_type}</div>
              <div><img src={priceIcon} alt="Price" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Price: </strong> €{(spot.price ?? 0).toFixed(2)}</div>
              <div><img src={commentsIcon} alt="Comments" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Comments:</strong> {spot.comments ? spot.comments : 'None'}</div>
            </div>
            <p style={{ color: '#333', display: 'flex', alignItems: 'center', paddingLeft: '1rem', marginTop: '0px' }}> {spot.car_type && spot.car_type.charAt(0).toUpperCase() + spot.car_type.slice(1)}</p>
          </div>
          <div className="requester-side-drawer-footer">
            <button onClick={() => onRequest(spot.id)} className="request-button">Request</button>
          </div>
        </>
      )}
    </div>
  );
};

export default RequesterSideDrawer;
