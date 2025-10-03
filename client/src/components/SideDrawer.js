import locationIcon from '../assets/images/location.png';
import carIcon from '../assets/images/car.png';
import spotIcon from '../assets/images/spot.png';
import timeIcon from '../assets/images/time.png';
import costIcon from '../assets/images/cost.png';
import priceIcon from '../assets/images/price.png';
import commentsIcon from '../assets/images/comments.png';
import React, { useEffect, useRef, useState } from 'react';
import './SideDrawer.css';
import RequestActionModal from './RequestActionModal';
import { socket } from '../socket';
import { emitter } from '../emitter';

const SideDrawer = ({ spot, userAddress, currentUserCarType, onClose, onEdit, onDelete, formatRemainingTime, spotRequests, currentUserId, addNotification, currentUsername, onOpenChat, unreadMessages, onOpenRequesterDetails }) => {
  const drawerRef = useRef(null);

  const handleConfirmRequest = (request) => {
    socket.emit('acceptRequest', {
      requestId: request.id,
      requesterId: request.requester_id,
      spotId: spot.id,
      ownerUsername: currentUsername, // Pass owner's username
      ownerId: currentUserId, // Pass owner's ID
    });
    addNotification(`Request from ${request.requester_username} confirmed!`, 'green');
    emitter.emit('new-request');
    // Remove the accepted request from the list
    // This will be handled by a socket event from the backend, which will trigger a re-fetch of spot requests in App.js
  };

  const handleRejectRequest = (request) => {
    socket.emit('declineRequest', {
      requestId: request.id,
      requesterId: request.requester_id,
      spotId: spot.id,
      ownerUsername: currentUsername, // Pass owner's username
    });
    addNotification(`Request from ${request.requester_username} rejected!`, 'red');
    emitter.emit('request-rejected-by-owner', request.id);
  };



  return (
    <div ref={drawerRef} className={`side-drawer ${spot || userAddress ? 'open' : ''}`}>
      <div className="side-drawer-header">
        <h3>{userAddress ? 'User Details' : 'Spot Details'}</h3>
        <button className="close-button" onClick={onClose}>X</button>
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
              <div><img src={spotIcon} alt="Spot" style={{ width: '20px', height: '20px' }} /></div><div className="spot-detail-text"><strong>Spot ID: </strong> {spot.id}</div>
              <div><img src={timeIcon} alt="Time" style={{ width: '20px', height: '20px' }} /></div><div className="spot-detail-text"><strong>Time to Expire: </strong> {formatRemainingTime(spot.declared_at, spot.time_to_leave)}</div>
              <div><img src={costIcon} alt="Cost" style={{ width: '20px', height: '20px' }} /></div><div className="spot-detail-text"><strong>Cost Type: </strong> {spot.cost_type}</div>
              <div><img src={priceIcon} alt="Price" style={{ width: '20px', height: '20px' }} /></div><div className="spot-detail-text"><strong>Price: </strong> {(spot.price ?? 0)} credits</div>
              <div><img src={commentsIcon} alt="Comments" style={{ width: '20px', height: '20px' }} /></div><div className="spot-detail-text"><strong>Comments:</strong> {spot.comments ? spot.comments : 'None'}</div>
              <hr style={{ gridColumn: '1 / -1', margin: '10px 0 0 0', borderColor: '#eee' }} />
            </div>
            <div className="requests-section">
              <h3>Requests</h3>
              {spotRequests && spotRequests.length > 0 ? (
                <div className="requests-list">
                  {spotRequests.map((request, index) => {
                    const hasUnread = unreadMessages && unreadMessages[request.requester_id];
                    return (
                      <div key={index} className={`request-item ${request.status === 'accepted' ? 'accepted' : ''}`}>
                        <div className={`requester-avatar ${request.status === 'accepted' ? 'accepted' : ''}`}>
                          <img src={request.requester_avatar_url || `https://i.pravatar.cc/80?u=${request.requester_username}`} alt={request.requester_username} style={{width: '100%', height: '100%', borderRadius: '50%', objectFit: 'cover'}} />
                        </div>
                        <div className="request-details">
                          <div className={`requester-username ${request.status === 'accepted' ? 'accepted' : ''}`} onClick={(e) => { e.stopPropagation(); onOpenRequesterDetails(request); }} style={{cursor: 'pointer', color: '#007bff'}}>{request.requester_username}</div>
                        </div>
                        <div className={`request-distance ${request.status === 'accepted' ? 'accepted' : ''}`}>
                          {typeof request.distance === 'number' && !isNaN(request.distance) ? `${request.distance.toFixed(2)} km` : 'N/A'}
                        </div>
                        {request.status === 'pending' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleConfirmRequest(request); }}
                            style={{
                              marginLeft: '10px',
                              backgroundColor: 'transparent',
                              color: '#218838',
                              border: '1px solid #218838',
                              borderRadius: '5px',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1rem',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            }}
                          >
                            <i className="fas fa-check-circle"></i>
                          </button>
                        )}
                        {request.status === 'pending' && (
                          <button 
                            onClick={(e) => { e.stopPropagation(); handleRejectRequest(request); }}
                            style={{
                              marginLeft: '5px',
                              backgroundColor: 'transparent',
                              color: '#a5387b',
                              border: '1px solid #a5387b',
                              borderRadius: '5px',
                              padding: '3px 6px',
                              cursor: 'pointer',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              fontSize: '1rem',
                              boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                            }}
                          >
                            <i className="fas fa-times-circle"></i>
                          </button>
                        )}
                        {request.status === 'accepted' && (
                          <div style={{ position: 'relative' }}>
                            <div className="chat-symbol" onClick={() => onOpenChat({ id: request.requester_id, username: request.requester_username })}>💬</div>
                            {hasUnread && <span className="unread-indicator"></span>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p style={{ color: '#7A1BE0', textAlign: 'left' }}>No requests until now</p>
              )}
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