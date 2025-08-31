import React from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './Map.css'; // Import the new CSS file
import L from 'leaflet';
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

const Map = ({ parkingSpots, userLocation, currentUserId, acceptedSpot, requesterEta, requesterArrived, onAcknowledgeArrival, onSpotDeleted, onEditSpot, addNotification }) => { // NEW PROP
  const mapRef = React.useRef(null);

  const [currentTime, setCurrentTime] = React.useState(Date.now());
  const [eta, setEta] = React.useState(null);
  const [isConfirming, setIsConfirming] = React.useState(false);

  React.useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 5000); // Update every 5 seconds

    return () => clearInterval(interval);
  }, []);

  const getDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371; // Radius of the Earth in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const distance = R * c; // Distance in km
    return distance;
  }

  const handleConfirmArrival = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to confirm arrival.");
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
        addNotification("Arrival confirmed! The spot owner has been notified.");
      } else {
        const errorData = await response.json();
        addNotification(`Failed to confirm arrival: ${errorData.message}`);
      }
    } catch (error) {
      console.error('Error confirming arrival:', error);
      addNotification('An error occurred while confirming arrival.');
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  React.useEffect(() => {
    if (acceptedSpot && !isConfirming) {
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { latitude, longitude } = position.coords;
          const distance = getDistance(latitude, longitude, acceptedSpot.latitude, acceptedSpot.longitude);

          if (distance < 0.02) { // 20 meters
            setIsConfirming(true);
            if (window.confirm("It looks like you've arrived. Confirm your arrival?")) {
              handleConfirmArrival(acceptedSpot.id);
              navigator.geolocation.clearWatch(watchId);
            } else {
              setIsConfirming(false); // Allow the dialog to reappear if the user cancels
            }
          }

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
  }, [acceptedSpot, isConfirming, eta]);

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

  const handleDelete = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to delete a spot.");
      return;
    }

    if (window.confirm("Are you sure you want to delete this parking spot?")) {
      try {
        const response = await fetch(`/api/parkingspots/${spotId}`, {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        });

        if (response.ok) {
          addNotification("Parking spot deleted successfully!");
        } else if (response.status === 401 || response.status === 403) {
          addNotification("Authentication failed or not authorized to delete this spot.");
        } else {
          const errorData = await response.json();
          addNotification(`Failed to delete spot: ${errorData.message}`);
        }
      } catch (error) {
        console.error('Error deleting spot:', error);
        addNotification('An error occurred while deleting the spot.');
      }
    }
  };

  const handleNewButtonClick = (spotId) => {
    console.log(`Edit button clicked for spot ID: ${spotId}`);
    // Find the full spot object from parkingSpots to pass to the modal
    const spot = parkingSpots.find(s => s.id === spotId);
    if (spot && onEditSpot) {
      onEditSpot(spot); // Call the callback from App.js
      if (mapRef.current) {
        mapRef.current.closePopup(); // Close the map popup
      }
    }
  };

  const handleRequest = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to request a spot.");
      return;
    }

    console.log(`Attempting to send request for spot ID: ${spotId}`);

    try {
      const response = await fetch('/api/request-spot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({ spotId }),
      });

      console.log('Response from /api/request-spot:', response);

      if (response.ok) {
        addNotification("Request sent successfully.");
        if (mapRef.current) {
          mapRef.current.closePopup();
        }
      } else {
        const errorData = await response.json();
        addNotification(`Failed to send request: ${errorData.message}`);
      }
    } catch (error) {
      console.error('Error requesting spot:', error);
      addNotification('An error occurred while sending the request.');
    }
  };

  return (
    <MapContainer ref={mapRef} center={userLocation} zoom={13} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
      />
      <Marker position={userLocation} icon={userIcon}>
        <Popup>
          Your current location.
        </Popup>
      </Marker>

      {parkingSpots.map(spot => {
        const lat = spot.lat;
        const lng = spot.lng;

        if (isNaN(lat) || isNaN(lng)) {
          console.warn(`Skipping invalid parking spot coordinates for ID: ${spot.id}. Lat: ${lat}, Lng: ${lng}`);
          return null;
        }

        const isOwner = spot.user_id === currentUserId;
        const isExactLocation = spot.isExactLocation; // Use the flag from the backend

        if (acceptedSpot) {
          console.log(`Map.js - Comparing spot ${spot.id} with accepted spot ${acceptedSpot.id}. Match: ${acceptedSpot.id === spot.id}`);
        }

        return (
          <React.Fragment key={spot.id}>
            {isExactLocation ? (
              <Marker position={[lat, lng]} icon={parkingSpotIcon}>
                <Popup>
                  <div>
                    Parking Spot ID: {spot.id} <br />
                    Declared by: {spot.username} <br />
                    Cost Type: {spot.cost_type} <br /> {/* Changed from Status: is_free */}
                    Price: €{ (spot.price ?? 0).toFixed(2) } <br />
                    Time until expiration: {formatRemainingTime(spot.declared_at, spot.time_to_leave)} <br />
                    Comments: {spot.comments}
                    {requesterEta && requesterEta.spotId === spot.id && <div>Requester ETA: {requesterEta.eta} minutes</div>}
                    {isOwner ? (
                      <div className="owner-actions-container">
                        {/* New button, identical to delete button */}
                        <button onClick={() => handleNewButtonClick(spot.id)} className="delete-spot-button edit-button-color">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(spot.id)} className="delete-spot-button">
                          Delete
                        </button>
                      </div>
                    ) : (
                      // This is a revealed spot, but not owned by current user
                      // Hide the request button if this spot is the accepted one
                      acceptedSpot && acceptedSpot.id === spot.id ? null : (
                        <div className="request-button-container">
                          <hr />
                          <button onClick={() => handleRequest(spot.id)} className="request-spot-button delete-spot-button">
                            Request
                          </button>
                        </div>
                      )
                    )}
                  </div>
                </Popup>
              </Marker>
            ) : (
              <Circle center={[lat, lng]} radius={200} pathOptions={{ color: getCircleColor(spot.declared_at, spot.time_to_leave), fillColor: getCircleColor(spot.declared_at, spot.time_to_leave), fillOpacity: 0.2 }} className={shouldAnimate(spot.declared_at, spot.time_to_leave) ? "pulse-opacity" : ""}>
                <Popup>
                  <div>
                    Parking Spot ID: {spot.id} <br />
                    Declared by: {spot.username} <br />
                    Cost Type: {spot.cost_type} <br /> {/* Changed from Status: is_free */}
                    Price: €{ (spot.price ?? 0).toFixed(2) } <br />
                    Time until expiration: {formatRemainingTime(spot.declared_at, spot.time_to_leave)} <br />
                    Comments: {spot.comments}
                    <div className="request-button-container">
                      <hr />
                      <button onClick={() => handleRequest(spot.id)} className="request-spot-button delete-spot-button">
                        Request
                      </button>
                    </div>
                  </div>
                </Popup>
              </Circle>
            )}
          </React.Fragment>
        );
      })}
    </MapContainer>
  );
};

export default Map;
