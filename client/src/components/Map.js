import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css'; // Import the new CSS file
import L from 'leaflet';
import markerGreen from './icons/marker-icon-green.png';
import markerGreen2x from './icons/marker-icon-green-2x.png';
import markerRed from './icons/marker-icon-red.png';
import markerRed2x from './icons/marker-icon-red-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';
import { getDistance } from '../utils/geoUtils';

import RequesterSpotPopup from './RequesterSpotPopup';
import { emitter } from '../emitter';
import { socket } from '../socket';
import SideDrawer from './SideDrawer';
import RequesterSideDrawer from './RequesterSideDrawer';
import DeleteConfirmationModal from './DeleteConfirmationModal'; // Import the new modal


// Fix for default marker icon not showing
delete L.Icon.Default.prototype._getIconUrl;

// Custom icon for user's current location
const userIcon = new L.Icon({
  iconUrl: markerGreen,
  iconRetinaUrl: markerGreen2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

// Custom icon for parking spots
const parkingSpotIcon = new L.Icon({
  iconUrl: markerRed,
  iconRetinaUrl: markerRed2x,
  shadowUrl: markerShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41]
});

const invisibleIcon = new L.Icon({
    iconUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
    iconSize: [1, 1],
    iconAnchor: [0, 0],
    popupAnchor: [0, 0],
    shadowUrl: null,
    shadowSize: null,
    shadowAnchor: null
});

const Map = ({ parkingSpots, userLocation, currentUserId, acceptedSpot, requesterEta, requesterArrived, onAcknowledgeArrival, onSpotDeleted, onEditSpot, addNotification, onRequestStatusChange, currentUsername, pendingRequests }) => {
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  const [isConfirming, setIsConfirming] = useState(false);
  const [eta, setEta] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [popup, setPopup] = useState(null);
  const [drawerSpot, setDrawerSpot] = useState(null);
  const [requesterDrawerSpot, setRequesterDrawerSpot] = useState(null);
  const [userAddress, setUserAddress] = useState(null);
  const [currentUserCarType, setCurrentUserCarType] = useState(null);
  const [spotRequests, setSpotRequests] = useState([]);
  const [showDeleteConfirmationModal, setShowDeleteConfirmationModal] = useState(false); // New state for delete modal
  const [spotToDeleteId, setSpotToDeleteId] = useState(null); // New state to store spot ID to delete

  const handleNewButtonClick = (spot) => {
    console.log(`Edit button clicked for spot ID: ${spot.id}`);
    if (spot && onEditSpot) {
      onEditSpot(spot); // Call the callback from App.js
      setDrawerSpot(null); // Close the drawer
    }
  };

  const handleDelete = useCallback((spotId) => {
    setSpotToDeleteId(spotId);
    setShowDeleteConfirmationModal(true);
  }, []);

  const confirmDeleteSpot = () => {
    onSpotDeleted(spotToDeleteId);
    setShowDeleteConfirmationModal(false);
    setSpotToDeleteId(null);
  };

  useEffect(() => {
    if (popup && popupRef.current) {
      popupRef.current.openPopup();
    }
  }, [popup]);

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000); // Update every second
    return () => clearInterval(timer);
  }, []);


  const handleLocateMe = () => {
    if (mapRef.current && userLocation) {
      mapRef.current.flyTo(userLocation, 15); // Adjust zoom level as needed
    }
  };

  const fetchUserAddress = async (lat, lng) => {
    try {
      const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
      const data = await response.json();
      return data.display_name;
    } catch (error) {
      console.error('Error fetching address:', error);
      return 'Could not fetch address.';
    }
  };

  const fetchUserCarType = async (userId) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`/api/users/${userId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        return data.car_type;
      } else {
        console.error('Error fetching user car type:', response.statusText);
        return null;
      }
    } catch (error) {
      console.error('Error fetching user car type:', error);
      return null;
    }
  };

  const handleUserMarkerClick = async () => {
    setDrawerSpot(null);
    const address = await fetchUserAddress(userLocation[0], userLocation[1]);
    setUserAddress(address);
    if (currentUserId) {
      const carType = await fetchUserCarType(currentUserId);
      setCurrentUserCarType(carType);
    }
  };


  useEffect(() => {
    const handleConfirmArrival = async (spotId) => {
      const token = localStorage.getItem('token');
      if (!token) {
        addNotification("You must be logged in to confirm arrival.", 'default');
        return;
      }

      try {
        const response = await fetch('/api/confirm-arrival', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`,
          },
          body: JSON.stringify({ spotId }),
        });

        if (response.ok) {
          addNotification("Arrival confirmed! The spot owner has been notified.", 'default');
        } else {
          const errorData = await response.json();
          addNotification(`Failed to confirm arrival: ${errorData.message}`, 'default');
        }
      } catch (error) {
        console.error('Error confirming arrival:', error);
        addNotification('An error occurred while confirming arrival.', 'default');
      }
    };

    if (acceptedSpot && !isConfirming) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const distance = getDistance(latitude, longitude, acceptedSpot.latitude, acceptedSpot.longitude);

          // if (distance < 0.05) { // 50 meters
          //   setIsConfirming(true);
          //   if (window.confirm("It looks like you've arrived. Confirm your arrival?")) {
          //     handleConfirmArrival(acceptedSpot.id);
          //     navigator.geolocation.clearWatch(watchId);
          //   } else {
          //     setIsConfirming(false); // Allow the dialog to reappear if the user cancels
          //   }
          // }

          // Fetch ETA every 10 seconds
          const now = Date.now();
          if (!eta || (now - eta.lastUpdated) > 10000) {
            const fetchEta = async () => {
              const token = localStorage.getItem('token');
              const response = await fetch('/api/eta', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${token}`,
                },
                body: JSON.stringify({ requesterLat: latitude, requesterLon: longitude, spotId: acceptedSpot.id }),
              });
              const data = await response.json();
              setEta({ value: data.eta, lastUpdated: Date.now() });
            };
            fetchEta();
          }
        },
        (error) => {
          console.error("Error watching position:", error);
        },
        { enableHighAccuracy: true }
      );

      return () => {
        navigator.geolocation.clearWatch(watchId);
      };
    }
  }, [acceptedSpot, isConfirming, eta, addNotification]);

  if (!userLocation || isNaN(userLocation[0]) || isNaN(userLocation[1])) {
    return <div>Loading map or getting your location...</div>;
  }

  // Helper function to determine circle color based on remaining time
  const getCircleColor = (declaredAt, timeToLeave) => {
    const declaredTime = new Date(declaredAt).getTime(); // Convert declared_at to milliseconds
    const expirationTime = declaredTime + (timeToLeave * 60 * 1000); // Add timeToLeave minutes in milliseconds
    const remainingMinutes = (expirationTime - currentTime) / (60 * 1000); // Remaining time in minutes

    if (remainingMinutes > 15) {
      return '#0000FF'; // Blue for > 15 min
    } else if (remainingMinutes > 10 && remainingMinutes <= 15) {
      return '#008000'; // Green
    } else if (remainingMinutes > 5 && remainingMinutes <= 10) {
      return '#800080'; // Purple
    } else if (remainingMinutes > 2 && remainingMinutes <= 5) {
      return '#FFA500'; // Orange
    } else if (remainingMinutes >= 0 && remainingMinutes <= 2) {
      return '#FF0000'; // Red
    } else { // This case should ideally not be reached if all positive ranges are covered
      return '#808080'; // Grey for expired spots (should be removed by server)
    }
  };

  // Helper function to format remaining time for display
  const formatRemainingTime = (declaredAt, timeToLeave) => {
    const declaredTime = new Date(declaredAt).getTime();
    const expirationTime = declaredTime + (timeToLeave * 60 * 1000);
    const remainingMinutes = (expirationTime - currentTime) / (60 * 1000);

    if (remainingMinutes <= 0) {
      return 'Expired';
    } else if (remainingMinutes < 1) {
      return '< 1 minute';
    } else {
      return `${Math.floor(remainingMinutes)} minutes`;
    }
  };

  // Helper function to determine if a circle should animate
  const shouldAnimate = (declaredAt, timeToLeave) => {
    const declaredTime = new Date(declaredAt).getTime();
    const expirationTime = declaredTime + (timeToLeave * 60 * 1000);
    const remainingMinutes = (expirationTime - currentTime) / (60 * 1000);

    // Animate if red (<= 2 minutes) AND less than 1 minute remaining
    return (remainingMinutes >= 0 && remainingMinutes <= 2) && (remainingMinutes < 1);
  };

  const handleRequest = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to request a spot.", 'default');
      return;
    }

    const requesterLat = userLocation[0];
    const requesterLon = userLocation[1];

    console.log(`Attempting to send request for spot ID: ${spotId}`);

    try {
      const response = await fetch('/api/request-spot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ spotId, requesterLat, requesterLon }), // Add requesterLat and requesterLon
      });

      console.log('Response from /api/request-spot:', response);

      if (response.ok) {
        addNotification(`Request for spot #${spotId} sent successfully.`, 'green');
        onRequestStatusChange(spotId, 'requested'); // Notify App.js to update pending requests
        if (mapRef.current) {
          mapRef.current.closePopup();
        }
      } else {
        const errorData = await response.json();
        addNotification(`Failed to send request: ${errorData.message}`, 'default');
      }
    } catch (error) {
      console.error('Error requesting spot:', error);
      addNotification('An error occurred while sending the request.', 'default');
    }
  };

  const handleCancelRequest = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to cancel a request.", 'default');
      return;
    }

    console.log(`Attempting to send cancel request for spot ID: ${spotId}`);

    try {
      const response = await fetch('/api/cancel-request', { // This endpoint needs to be created
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ spotId }),
      });

      console.log('Response from /api/cancel-request:', response);

      if (response.ok) {
        addNotification(`Request for spot #${spotId} cancelled successfully.`, 'default');
        await onRequestStatusChange(spotId, 'cancelled'); // Notify App.js to update pending requests
        emitter.emit('spot-request-updated', spotId);
        if (mapRef.current) {
          mapRef.current.closePopup();
        }
      } else {
        const errorData = await response.json();
        addNotification(`Failed to cancel request: ${errorData.message}`, 'default');
      }
    } catch (error) {
      console.error('Error cancelling request:', error);
      addNotification('An error occurred while cancelling the request.', 'default');
    }
  };

  const handleArrived = (spotId) => {
    socket.emit('requester-arrived', { spotId });
    addNotification(`You have arrived at spot ${spotId}. The owner has been notified.`, 'default');
    if (mapRef.current) {
      mapRef.current.closePopup();
    }
  };

  const handleOwnerSpotClick = async (spot) => {
    setUserAddress(null);
    setDrawerSpot(spot);
    const token = localStorage.getItem('token');
    try {
      const response = await fetch(`/api/spots/${spot.id}/requests-details`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      if (response.ok) {
        const data = await response.json();
        const formattedData = data.map(req => ({...req, distance: parseFloat(req.distance)}));
        setSpotRequests(formattedData);
      } else {
        console.error('Error fetching spot requests:', response.statusText);
      }
    } catch (error) {
      console.error('Error fetching spot requests:', error);
    }
  };

  

  const isSpotExpired = (spot) => {
    const declaredTime = new Date(spot.declared_at).getTime();
    const expirationTime = declaredTime + (spot.time_to_leave * 60 * 1000);
    return currentTime >= expirationTime;
  };

  return (
    <>
      <MapContainer ref={mapRef} center={userLocation} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <button className="locate-me-button" onClick={handleLocateMe}>
          <span className="crosshair-icon"></span>
        </button>
        <Marker 
          position={userLocation} 
          icon={userIcon}
          eventHandlers={{
            click: () => {
              handleUserMarkerClick();
            },
          }}
        />

        {parkingSpots.filter(spot => !isSpotExpired(spot)).map(spot => {
          const lat = spot.lat;
          const lng = spot.lng;

          if (isNaN(lat) || isNaN(lng)) {
            console.warn(`Skipping invalid parking spot coordinates for ID: ${spot.id}. Lat: ${lat}, Lng: ${lng}`);
            return null;
          }

          const isOwner = spot.user_id === currentUserId;
          const isExactLocation = spot.isExactLocation; // Use the flag from the backend
          
          

          if (acceptedSpot) {
          }

          return (
            <React.Fragment key={spot.id}>
              {isExactLocation ? (
                <Marker
                  position={[lat, lng]}
                  icon={parkingSpotIcon}
                  eventHandlers={{
                    click: () => {
                      if (isOwner) {
                        handleOwnerSpotClick(spot);
                      }
                    },
                  }}
                >
                  {!isOwner && (
                    <Popup>
                      <div>
                        {(acceptedSpot && acceptedSpot.id === spot.id) ? (
                          <RequesterSpotPopup
                            spot={spot}
                            onClose={() => mapRef.current.closePopup()}
                            onArrived={handleArrived}
                          />
                        ) : (
                          // This is a revealed spot, but not owned by current user
                          // Hide the request button if this spot is the accepted one
                          <div className="request-button-container">
                            <hr />
                            <button
                              onClick={() => handleRequest(spot.id)}
                              className={`request-spot-button delete-spot-button`}
                            >
                              {'Request'}
                            </button>
                          </div>
                        )}
                      </div>
                    </Popup>
                  )}
                </Marker>
              ) : (
                <Circle
                  center={[lat, lng]}
                  radius={200}
                  pathOptions={{ color: getCircleColor(spot.declared_at, spot.time_to_leave), fillColor: getCircleColor(spot.declared_at, spot.time_to_leave), fillOpacity: 0.2 }}
                  className={shouldAnimate(spot.declared_at, spot.time_to_leave) ? "pulse-opacity" : ""}
                  eventHandlers={{
                    click: () => {
                      if (isOwner) {
                        handleOwnerSpotClick(spot);
                      } else {
                        setRequesterDrawerSpot(spot);
                        setPopup(null); // Close any existing popup
                      }
                    }
                  }}
                />
              )}
            </React.Fragment>
          );
        })}
      </MapContainer>

      <SideDrawer 
        spot={drawerSpot} 
        userAddress={userAddress}
        currentUserCarType={currentUserCarType}
        onClose={() => {
          setDrawerSpot(null);
          setUserAddress(null);
          setCurrentUserCarType(null);
        }}
        onEdit={handleNewButtonClick}
        onDelete={handleDelete}
        formatRemainingTime={formatRemainingTime}
        spotRequests={spotRequests}
        currentUserId={currentUserId}
        addNotification={addNotification}
        currentUsername={currentUsername}
      />
      <RequesterSideDrawer
        spot={requesterDrawerSpot}
        formatRemainingTime={formatRemainingTime}
        onRequest={handleRequest}
        onCancelRequest={handleCancelRequest}
        hasPendingRequest={requesterDrawerSpot && pendingRequests.includes(requesterDrawerSpot.id)}
        onClose={() => setRequesterDrawerSpot(null)}
        onRejected={(spotId) => onRequestStatusChange(spotId, 'cancelled')}
      />

      {showDeleteConfirmationModal && (
        <DeleteConfirmationModal
          isOpen={showDeleteConfirmationModal}
          onClose={() => setShowDeleteConfirmationModal(false)}
          onConfirm={confirmDeleteSpot}
          message={`Are you sure you want to delete parking spot #${spotToDeleteId}? This action cannot be undone.`}
        />
      )}
    </>
  );
};

export default Map;
