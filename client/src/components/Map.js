import React, { useState, useEffect, useRef, useCallback } from 'react';
import { MapContainer, TileLayer, Marker, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css'; // Import the new CSS file
import L from 'leaflet';
import { emitter } from '../emitter';
import { socket } from '../socket';
import SideDrawer from './SideDrawer';
import RequesterSideDrawer from './RequesterSideDrawer';
import DeleteConfirmationModal from './DeleteConfirmationModal'; // Import the new modal
import RequesterDetailsModal from './RequesterDetailsModal';
import markerGreen from './icons/marker-icon-green.png';
import markerGreen2x from './icons/marker-icon-green-2x.png';
import markerRed from './icons/marker-icon-red.png';
import markerRed2x from './icons/marker-icon-red-2x.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

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

// Function to create a custom DivIcon with a red dot
const createCustomIcon = (iconUrl, iconRetinaUrl, hasNewRequest) => {
  const iconHtml = `
    <div style="position: relative; width: 25px; height: 41px;">
      <img src="${iconUrl}" srcset="${iconRetinaUrl} 2x" alt="Marker" style="width: 100%; height: 100%;"/>
      ${hasNewRequest ? '<div class="new-request-dot"></div>' : ''}
    </div>
  `;
  return L.divIcon({
    className: 'custom-div-icon',
    html: iconHtml,
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34]
  });
};

const PinDropInstructions = L.Control.extend({
  onAdd: function(map) {
    const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control leaflet-control-custom');
    container.innerHTML = "Click anywhere on the map to indicate spot location";
    return container;
  },

  onRemove: function(map) {
    // Nothing to do here
  }
});

L.control.pinDropInstructions = function(opts) {
  return new PinDropInstructions(opts);
}




const Map = ({ parkingSpots, userLocation: appUserLocation, currentUserId, acceptedSpot, requesterEta, requesterArrived, onAcknowledgeArrival, onSpotDeleted, onEditSpot, addNotification: appAddNotification, onRequestStatusChange, currentUsername, pendingRequests, onOpenChat, unreadMessages, isPinDropMode, setPinDropMode, pinnedLocation, setPinnedLocation, setShowLeavingOverlay, onRateRequester }) => {
  const mapRef = useRef(null);
  const popupRef = useRef(null);
  
  const [eta, setEta] = useState(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [popup, setPopup] = useState(null);
  const [drawerSpot, setDrawerSpot] = useState(null);
  const [requesterDrawerSpot, setRequesterDrawerSpot] = useState(null);
  const [ownerCarDetails, setOwnerCarDetails] = useState(null);
  const [userAddress, setUserAddress] = useState(null);
  const [currentUserCarType, setCurrentUserCarType] = useState(null);
  const [spotRequests, setSpotRequests] = useState([]);
  const [showDeleteConfirmationModal, setShowDeleteConfirmationModal] = useState(false); // New state for delete modal
  const [spotToDeleteId, setSpotToDeleteId] = useState(null); // New state to store spot ID to delete
  const [newRequestSpotIds, setNewRequestSpotIds] = useState([]); // New state for spots with new requests
  const [showRequesterDetailsModal, setShowRequesterDetailsModal] = useState(false);
  const [selectedRequester, setSelectedRequester] = useState(null);

  useEffect(() => {
    if (acceptedSpot) {
      setRequesterDrawerSpot(acceptedSpot);
    }
  }, [acceptedSpot]);

  useEffect(() => {
    const handleNewRequest = (data) => {
      setNewRequestSpotIds(prev => [...prev, data.spotId]);
      if (drawerSpot && drawerSpot.id === data.spotId) {
        // If the drawer is open for this spot, refresh its requests
        handleOwnerSpotClick(drawerSpot);
      }
    };

    emitter.on('spotRequest', handleNewRequest);

    return () => {
      emitter.off('spotRequest', handleNewRequest);
    };
  }, [drawerSpot]);

  useEffect(() => {
    const handleNewRequest = () => {
      if (drawerSpot) {
        handleOwnerSpotClick(drawerSpot);
      }
    };

    emitter.on('new-request', handleNewRequest);

    return () => {
      emitter.off('new-request', handleNewRequest);
    };
  }, [drawerSpot]);

  useEffect(() => {
    const handleSpotDeletedEvent = (data) => {
      console.log("spotDeleted event received:", data);
      setRequesterDrawerSpot(prevSpot => {
        if (prevSpot && prevSpot.id === parseInt(data.spotId, 10)) {
          return null;
        }
        return prevSpot;
      });
    };

    emitter.on('spotDeleted', handleSpotDeletedEvent);

    return () => {
      emitter.off('spotDeleted', handleSpotDeletedEvent);
    };
  }, []); // Empty dependency array to ensure listener is set up once

  useEffect(() => {
    const handleRequestRejected = (requestId) => {
      setSpotRequests(prevRequests => prevRequests.filter(req => req.id !== requestId));
    };

    emitter.on('request-rejected-by-owner', handleRequestRejected);

    return () => {
      emitter.off('request-rejected-by-owner', handleRequestRejected);
    };
  }, []);

  useEffect(() => {
    const handleRequestCancelled = (requestId) => {
      setSpotRequests(prevRequests => prevRequests.filter(req => req.id !== requestId));
    };

    emitter.on('request-cancelled-for-owner', handleRequestCancelled);

    return () => {
      emitter.off('request-cancelled-for-owner', handleRequestCancelled);
    };
  }, []);

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
    setDrawerSpot(null); // Close the SideDrawer after deletion
  };

  const handleOpenRequesterDetails = async (requester) => {
    try {
      const token = localStorage.getItem('token');
      const response = await fetch(`http://localhost:3001/api/users/username/${requester.requester_username}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });
      if (response.ok) {
        const data = await response.json();
        setSelectedRequester(data);
        setShowRequesterDetailsModal(true);
      } else {
        console.error('Failed to fetch requester details');
      }
    } catch (error) {
      console.error('Error fetching requester details:', error);
    }
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
    if (mapRef.current && appUserLocation) {
      mapRef.current.flyTo(appUserLocation, 15); // Adjust zoom level as needed
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
    const address = await fetchUserAddress(appUserLocation[0], appUserLocation[1]);
    setUserAddress(address);
    if (currentUserId) {
      const carType = await fetchUserCarType(currentUserId);
      setCurrentUserCarType(carType);
    }
  };


  useEffect(() => {
    if (acceptedSpot) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;

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
  }, [acceptedSpot, eta, appAddNotification]);

  useEffect(() => {
    const map = mapRef.current;
    if (map) {
      if (isPinDropMode) {
        map.getContainer().classList.add('pin-drop-mode');
        const instructions = L.control.pinDropInstructions({ position: 'topright' });
        instructions.addTo(map);

        const handleMapClick = (e) => {
          setPinnedLocation([e.latlng.lat, e.latlng.lng]);
          setPinDropMode(false);
          setShowLeavingOverlay(true);
          map.off('click', handleMapClick); // Remove listener after use
        };
        map.on('click', handleMapClick);

        const handleKeyDown = (e) => {
          if (e.key === 'Escape') {
            setPinDropMode(false);
          }
        };
        document.addEventListener('keydown', handleKeyDown);

        return () => {
          map.off('click', handleMapClick);
          document.removeEventListener('keydown', handleKeyDown);
          map.getContainer().classList.remove('pin-drop-mode');
          instructions.remove();
        };
      } else {
        map.getContainer().classList.remove('pin-drop-mode');
      }
    }
  }, [isPinDropMode, mapRef, setPinnedLocation, setPinDropMode, setShowLeavingOverlay]);

  if (!appUserLocation || isNaN(appUserLocation[0]) || isNaN(appUserLocation[1])) {
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
      appAddNotification("You must be logged in to request a spot.", 'default');
      return;
    }

    const requesterLat = appUserLocation[0];
    const requesterLon = appUserLocation[1];

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
        appAddNotification(`Request for spot #${spotId} sent successfully.`, 'green');
        onRequestStatusChange(spotId, 'requested'); // Notify App.js to update pending requests
        if (mapRef.current) {
          mapRef.current.closePopup();
        }
      } else {
        const errorData = await response.json();
        appAddNotification(`Failed to send request: ${errorData.message}`, 'default');
      }
    } catch (error) {
      console.error('Error requesting spot:', error);
      appAddNotification('An error occurred while sending the request.', 'default');
    }
  };

  const handleCancelRequest = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      appAddNotification("You must be logged in to cancel a request.", 'default');
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
        appAddNotification(`Request for spot #${spotId} cancelled successfully.`, 'default');
        await onRequestStatusChange(spotId, 'cancelled'); // Notify App.js to update pending requests
        emitter.emit('spot-request-updated', spotId);
        if (mapRef.current) {
          mapRef.current.closePopup();
        }
      } else {
        const errorData = await response.json();
        appAddNotification(`Failed to cancel request: ${errorData.message}`, 'default');
      }
    } catch (error) {
      console.error('Error cancelling request:', error);
      appAddNotification('An error occurred while cancelling the request.', 'default');
    }
  };

  const handleArrived = (spotId) => {
    socket.emit('requester-arrived', { spotId });
    appAddNotification(`You have arrived at spot ${spotId}. The owner has been notified.`, 'default');
    if (mapRef.current) {
      mapRef.current.closePopup();
    }
  };

  const handleOwnerSpotClick = async (spot) => {
    setUserAddress(null);
    setDrawerSpot(spot);
    setNewRequestSpotIds(prev => prev.filter(id => id !== spot.id)); // Clear red dot
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
      <MapContainer ref={mapRef} center={appUserLocation} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        <button className="locate-me-button" onClick={handleLocateMe}>
          <span className="crosshair-icon"></span>
        </button>
        <Marker 
          position={appUserLocation} 
          icon={userIcon}
          eventHandlers={{
            click: () => {
              handleUserMarkerClick();
            },
          }}
        />

        {pinnedLocation && (
          <Marker
            position={pinnedLocation}
            icon={userIcon} // Or a different icon for the pin
          />
        )}

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
                  icon={createCustomIcon(markerRed, markerRed2x, isOwner && newRequestSpotIds.includes(spot.id))}
                  eventHandlers={{
                    click: async () => {
                      if (isOwner) {
                        handleOwnerSpotClick(spot);
                      } else if (acceptedSpot && acceptedSpot.id === spot.id) {
                        setRequesterDrawerSpot(spot);
                        const token = localStorage.getItem('token');
                        try {
                          const response = await fetch(`/api/users/${spot.user_id}`, {
                            headers: {
                              'Authorization': `Bearer ${token}`,
                            },
                          });
                          if (response.ok) {
                            const data = await response.json();
                            setOwnerCarDetails(data);
                          } else {
                            console.error('Error fetching owner car details:', response.statusText);
                          }
                        } catch (error) {
                          console.error('Error fetching owner car details:', error);
                        }
                      } else {
                        console.log("Setting requesterDrawerSpot from Marker click:", spot);
                        setRequesterDrawerSpot(spot);
                        setPopup(null); // Close any existing popup
                      }
                    },
                  }}
                >
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
                        console.log("Setting requesterDrawerSpot from Circle click:", spot);
                        setRequesterDrawerSpot(spot);
                        setPopup(null); // Close any existing popup
                      }
                    }
                  }}
                >
                </Circle>
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
        addNotification={appAddNotification}
        currentUsername={currentUsername}
        onOpenChat={onOpenChat}
        unreadMessages={unreadMessages}
        onOpenRequesterDetails={handleOpenRequesterDetails}
        onRateRequester={onRateRequester}
      />
      <RequesterSideDrawer
        spot={requesterDrawerSpot}
        formatRemainingTime={formatRemainingTime}
        onRequest={handleRequest}
        onCancelRequest={handleCancelRequest}
        hasPendingRequest={requesterDrawerSpot && pendingRequests.includes(requesterDrawerSpot.id)}
        isAcceptedSpot={acceptedSpot && requesterDrawerSpot && acceptedSpot.id === requesterDrawerSpot.id}
        onArrived={handleArrived}
        ownerCarDetails={ownerCarDetails}
        onClose={() => {
          setRequesterDrawerSpot(null);
          setOwnerCarDetails(null);
        }}
        onRejected={(spotId) => onRequestStatusChange(spotId, 'cancelled')}
        onOpenChat={onOpenChat}
        unreadMessages={unreadMessages}
        userLocation={appUserLocation}
        addNotification={appAddNotification}
      />

      {showDeleteConfirmationModal && (
        <DeleteConfirmationModal
          isOpen={showDeleteConfirmationModal}
          onClose={() => setShowDeleteConfirmationModal(false)}
          onConfirm={confirmDeleteSpot}
          message={`Are you sure you want to delete parking spot #${spotToDeleteId}? This action cannot be undone.`}
        />
      )}

      {showRequesterDetailsModal && (
        <RequesterDetailsModal
          isOpen={showRequesterDetailsModal}
          onClose={() => setShowRequesterDetailsModal(false)}
          requester={selectedRequester}
        />
      )}
    </>
  );
};

export default Map;
