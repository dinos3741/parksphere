import React, { useState, useEffect, useCallback } from 'react';
import './OwnerSpotPopup.css';
import { getToken } from '../utils/auth';
import { emitter } from '../emitter';
import RequestDetailsModal from './RequestDetailsModal';

  const OwnerSpotPopup = ({ spot, onEdit, onDelete, formatRemainingTime, onClose }) => {
  const [activeTab, setActiveTab] = useState('details');
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState(null);
  const [showRequestDetailsModal, setShowRequestDetailsModal] = useState(false);
  const [selectedRequest, setSelectedRequest] = useState(null);

  const fetchRequests = useCallback(async () => {
    if (spot && spot.id) {
      setLoadingRequests(true);
      setRequestsError(null);
      try {
        const token = getToken();
        if (!token) {
          setRequestsError('Authentication required to view requests.');
          setLoadingRequests(false);
          return;
        }

        const response = await fetch(`/api/spots/${spot.id}/requests-details`, {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (!response.ok) {
          const errorText = await response.text();
          throw new Error(`HTTP error! status: ${response.status}, message: ${errorText}`);
        }

        const data = await response.json();
        setRequests(data);
      } catch (error) {
        console.error('Error fetching requests:', error);
        setRequestsError(`Failed to load requests: ${error.message}`);
      } finally {
        setLoadingRequests(false);
      }
    }
  }, [spot]);

  const handleRowClick = (request) => {
    setSelectedRequest(request);
    setShowRequestDetailsModal(true);
  };

  const handleCloseRequestDetailsModal = () => {
    setShowRequestDetailsModal(false);
    setSelectedRequest(null);
  };

  const handleAcceptRequest = useCallback(async (requestId) => {
    try {
      const token = getToken();
      if (!token) {
        // Handle not authenticated
        return;
      }
      const response = await fetch('/api/accept-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, spotId: spot.id }),
      });
      if (response.ok) {
        // Handle success (e.g., close modal, refresh requests)
        handleCloseRequestDetailsModal();
        fetchRequests();
      } else {
        // Handle error
      }
    } catch (error) {
      // Handle network error
    }
  }, [spot, fetchRequests, handleCloseRequestDetailsModal]);

  const handleDeclineRequest = useCallback(async (requestId) => {
    try {
      const token = getToken();
      if (!token) {
        // Handle not authenticated
        return;
      }
      const response = await fetch('/api/decline-request', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ requestId, spotId: spot.id }),
      });
      if (response.ok) {
        // Handle success (e.g., close modal, refresh requests)
        handleCloseRequestDetailsModal();
        fetchRequests();
      } else {
        // Handle error
      }
    } catch (error) {
      // Handle network error
    }
  }, [spot, fetchRequests, handleCloseRequestDetailsModal]);

  useEffect(() => {
    if (activeTab === 'requests') {
      fetchRequests();
    }
  }, [activeTab, fetchRequests]);

  useEffect(() => {
    const handleNewRequest = () => {
      if (activeTab === 'requests') {
        fetchRequests();
      }
    };

    emitter.on('new-request', handleNewRequest);

    return () => {
      emitter.off('new-request', handleNewRequest);
    };
  }, [activeTab, fetchRequests]);

  useEffect(() => {
    const handleSpotRequestUpdated = async (updatedSpotId) => {
      if (spot && spot.id === updatedSpotId) {
        await fetchRequests();
      }
    };

    emitter.on('spot-request-updated', handleSpotRequestUpdated);

    return () => {
      emitter.off('spot-request-updated', handleSpotRequestUpdated);
    };
  }, [spot, fetchRequests]);

  return (
    <React.Fragment>
      <div className="popup-content-container">
      <div className="tab-buttons">
        <button
          className={activeTab === 'details' ? 'active' : ''}
          onClick={() => setActiveTab('details')}
        >
          Details
        </button>
        <button
          className={activeTab === 'requests' ? 'active' : ''}
          onClick={() => setActiveTab('requests')}
        >
          Requests
        </button>
      </div>
      <div className="tab-content">
        {activeTab === 'details' && (
          <div>
            Parking Spot ID: {spot.id} <br />
            Declared by: {spot.username} <br />
            Cost Type: {spot.cost_type} <br />
            Price: €{ (spot.price ?? 0).toFixed(2) } <br />
            Time until expiration: {formatRemainingTime(spot.declared_at, spot.time_to_leave)} <br />
            Comments: {spot.comments}
            <hr />
            <div className="owner-actions-container">
              <button onClick={() => onEdit(spot.id)} className="delete-spot-button edit-button-color">
                Edit
              </button>
              <button onClick={() => onDelete(spot.id)} className="delete-spot-button">
                Delete
              </button>
            </div>
          </div>
        )}
        {activeTab === 'requests' && (
          <div>
            <h3>Requests for this Spot:</h3>
            {loadingRequests && <p>Loading requests...</p>}
            {requestsError && <p className="error-message">{requestsError}</p>}
            {!loadingRequests && !requestsError && requests.length === 0 && <p>No requests yet.</p>}
            {!loadingRequests && !requestsError && requests.length > 0 && (
              <div className="requests-table-container">
                <table>
                  <thead>
                    <tr>
                      <th>Requester</th>
                      <th>Car Type</th>
                      <th>Time</th>
                      <th>Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(request => (
                      <tr key={request.id} onClick={() => handleRowClick(request)}>
                        <td>{request.requester_username}</td>
                        <td>{request.requester_car_type}</td>
                        <td>{new Date(request.requested_at).toLocaleTimeString()}</td>
                        <td>{typeof request.distance === 'number' && !isNaN(request.distance) ? `${request.distance.toFixed(2)} km` : 'N/A'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
    {showRequestDetailsModal && selectedRequest && (
      <RequestDetailsModal
          request={selectedRequest}
          onClose={handleCloseRequestDetailsModal}
          onAccept={handleAcceptRequest}
          onDecline={handleDeclineRequest}
        />
    )}
    </React.Fragment>
  );
};

export default OwnerSpotPopup;
