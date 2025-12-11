import React, { useRef, useEffect, useState } from 'react';
import './RequesterSideDrawer.css';
import './RequestRejectedModal.css';
import spotIcon from '../assets/images/spot.png';
import timeIcon from '../assets/images/time.png';
import costIcon from '../assets/images/cost.png';
import priceIcon from '../assets/images/price.png';
import commentsIcon from '../assets/images/comments.png';
import carIcon from '../assets/images/car.png';
import plateIcon from '../assets/images/plate.png';
import emitter from '../utils/emitter';
import OwnerDetailsModal from './OwnerDetailsModal';
import ArrivalConfirmationModal from './ArrivalConfirmationModal';
import DistanceWarningModal from './DistanceWarningModal';
import { getDistance } from '../utils/geoUtils';

const RequesterSideDrawer = ({ spot, formatRemainingTime, onRequest, onCancelRequest, hasPendingRequest, isAcceptedSpot, onArrived, ownerCarDetails, onClose, onRejected, onOpenChat, unreadMessages, userLocation, addNotification }) => {
  const drawerRef = useRef(null);
  const [showRejectedModal, setShowRejectedModal] = useState(false);
  const [rejectedSpot, setRejectedSpot] = useState(null);
  const [ownerUsername, setOwnerUsername] = useState('');
  const [showOwnerModal, setShowOwnerModal] = useState(false);
  const [ownerDetails, setOwnerDetails] = useState(null);
  const [arrivedClicked, setArrivedClicked] = useState(false);
  const [showArrivalConfirmation, setShowArrivalConfirmation] = useState(false);
  const [showDistanceWarningModal, setShowDistanceWarningModal] = useState(false);
  const [distanceWarningMessage, setDistanceWarningMessage] = useState('');

  const handleOwnerClick = async () => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3001/api/users/username/${spot.username}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setOwnerDetails(data);
        setShowOwnerModal(true);
      } else {
        console.error('Failed to fetch owner details');
      }
    } catch (error) {
      console.error('Error fetching owner details:', error);
    }
  };

  useEffect(() => {
    setArrivedClicked(false);
  }, [spot]);

  useEffect(() => {
    const handleRequestRejected = (data) => {
      if (spot && spot.id === data.spotId) {
        setRejectedSpot(spot);
        setOwnerUsername(data.ownerUsername);
        setShowRejectedModal(true);
      }
    };

    emitter.on('request-rejected', handleRequestRejected);

    return () => {
      emitter.off('request-rejected', handleRequestRejected);
    };
  }, [spot]);

  const handleCloseRejectedModal = () => {
    setShowRejectedModal(false);
    if (rejectedSpot) {
      onRejected(rejectedSpot.id);
    }
  };

  useEffect(() => {
    if (spot) {
      const interval = setInterval(() => {
        const remainingTime = formatRemainingTime(spot.declared_at, spot.time_to_leave);
        if (remainingTime === 'Expired') {
          onClose();
        }
      }, 1000);

      return () => clearInterval(interval);
    }
  }, [spot, formatRemainingTime, onClose]);

  const handleArrivedClick = () => {
    if (!userLocation || !spot) {
      addNotification('Error: Your location or spot data is not available.', 'red');
      return;
    }

    const distance = getDistance(
      userLocation[0],
      userLocation[1],
      spot.lat,
      spot.lng
    );

    const distanceThreshold = 0.1; // 100 meters in kilometers

    if (distance > distanceThreshold) {
      setDistanceWarningMessage("You are too far from the spot to confirm arrival. Please get closer (within 100 meters).");
      setShowDistanceWarningModal(true);
    } else {
      setShowArrivalConfirmation(true);
    }
  };

  return (
    <>
      <div ref={drawerRef} className={`requester-side-drawer ${spot ? 'open' : ''}`}>
        <div className="requester-side-drawer-header">
          <h3>Spot Details</h3>
          <button className="close-button" onClick={onClose}>X</button>
        </div>
        {spot && (
          <>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <div className="requester-side-drawer-content">
                <div className="spot-details-grid">
                  <div><img src={spotIcon} alt="Spot" style={{ width: '24px', height: '24px' }} /></div>
                  <div className="spot-detail-text">
                    <strong>Declared by: </strong>
                    <button onClick={handleOwnerClick} style={{ background: 'none', border: 'none', padding: 0, color: '#3454bd', cursor: 'pointer', font: 'inherit' }}>
                      {spot.username}
                    </button>
                  </div>
                  <div><img src={timeIcon} alt="Time" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Time to Expire: </strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</div>
                  <div><img src={costIcon} alt="Cost" style={{ width: '28.8px', height: '28.8px' }} /></div><div className="spot-detail-text"><strong>Cost Type: </strong> {spot.cost_type}</div>
                  <div><img src={priceIcon} alt="Price" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Price: </strong> {(spot.price ?? 0)} credits</div>
                  {isAcceptedSpot && ownerCarDetails && (
                    <>
                      <div><img src={carIcon} alt="Car" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Car Color: </strong> {ownerCarDetails.car_color}</div>
                      <div><img src={plateIcon} alt="Plate" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Plate Number: </strong> {ownerCarDetails.plate_number}</div>
                    </>
                  )}
                  <div><img src={commentsIcon} alt="Comments" style={{ width: '24px', height: '24px' }} /></div><div className="spot-detail-text"><strong>Comments:</strong> {spot.comments ? spot.comments : 'None'}</div>
                </div>
                <hr style={{ margin: '20px 0', borderColor: '#eee' }} />
                <div className="requests-section" style={{ padding: '0', marginTop: '-10px' }}>
                  <h3>Approvals</h3>
                  {isAcceptedSpot ? (
                    <div className="request-item accepted">
                      <div className="requester-avatar accepted">
                        <i className="fas fa-user-check"></i>
                      </div>
                      <div className="request-details">
                        <div className="requester-username accepted" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
                          <span>Accepted by {spot.username}</span>
                          <div style={{ position: 'relative' }}>
                            <span className="chat-symbol" onClick={() => onOpenChat({ id: spot.user_id, username: spot.username })}>💬</span>
                            {unreadMessages && unreadMessages[spot.user_id] && <span className="unread-indicator"></span>}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <p className="no-approvals-text">No approvals yet.</p>
                  )}
                </div>
              </div>
              <p style={{ color: '#333', display: 'flex', alignItems: 'center', paddingLeft: '1rem', marginTop: 'auto' }}> {spot.car_type && spot.car_type.charAt(0).toUpperCase() + spot.car_type.slice(1)}</p>
            </div>
            <div className="requester-side-drawer-footer">
              {isAcceptedSpot && !arrivedClicked ? (
                <button onClick={handleArrivedClick} className="arrived-button">Arrived</button>
              ) : !isAcceptedSpot && hasPendingRequest ? (
                <button onClick={() => onCancelRequest(spot.id)} className="cancel-request-button">Cancel Request</button>
              ) : !isAcceptedSpot ? (
                <button onClick={() => onRequest(spot.id)} className="request-button">Request</button>
              ) : null}
            </div>
          </>
        )}
      </div>
      {showRejectedModal && (
        <div className="request-rejected-modal-overlay">
          <div className="request-rejected-modal-content">
            <h2>Request Rejected</h2>
            <p>{`User ${ownerUsername} has unfortunately rejected your parking request`}</p>
            <button onClick={handleCloseRejectedModal}>Close</button>
          </div>
        </div>
      )}
      {showOwnerModal && <OwnerDetailsModal owner={ownerDetails} onClose={() => setShowOwnerModal(false)} />}
      <ArrivalConfirmationModal
        isOpen={showArrivalConfirmation}
        onClose={() => setShowArrivalConfirmation(false)}
        onConfirm={() => {
          onArrived(spot.id);
          setArrivedClicked(true);
          setShowArrivalConfirmation(false);
          onClose();
        }}
        isOwner={false}
      />
      <DistanceWarningModal
        isOpen={showDistanceWarningModal}
        onClose={() => setShowDistanceWarningModal(false)}
        message={distanceWarningMessage}
      />
    </>
  );
};

export default RequesterSideDrawer;