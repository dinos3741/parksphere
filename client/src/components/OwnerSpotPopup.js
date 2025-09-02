import React, { useState, useEffect } from 'react';
import './OwnerSpotPopup.css';
import { getToken } from '../utils/auth';

const OwnerSpotPopup = ({ spot, onEdit, onDelete, formatRemainingTime }) => {
  const [activeTab, setActiveTab] = useState('details');
  const [requests, setRequests] = useState([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [requestsError, setRequestsError] = useState(null);

  useEffect(() => {
    if (activeTab === 'requests' && spot && spot.id) {
      const fetchRequests = async () => {
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
      };

      fetchRequests();
    }
  }, [activeTab, spot]);

  return (
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
                    </tr>
                  </thead>
                  <tbody>
                    {requests.map(request => (
                      <tr key={request.id}>
                        <td>{request.requester_username}</td>
                        <td>{request.requester_car_type}</td>
                        <td>{new Date(request.requested_at).toLocaleString()}</td>
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
  );
};

export default OwnerSpotPopup;
