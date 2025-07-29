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

const Map = ({ parkingSpots, userLocation, currentUserId, onSpotDeleted, onEditSpot }) => { // NEW PROP
  const mapRef = React.useRef(null);
  console.log("Map.js - Received userLocation:", userLocation);
  console.log("Map.js - Received parkingSpots:", parkingSpots);
  if (!userLocation || isNaN(userLocation[0]) || isNaN(userLocation[1])) {
    return <div>Loading map or getting your location...</div>;
  }

  const handleDelete = async (spotId) => {
    const token = localStorage.getItem('token');
    if (!token) {
      alert("You must be logged in to delete a spot.");
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
          // alert("Parking spot deleted successfully!"); // Removed alert
        } else if (response.status === 401 || response.status === 403) {
          alert("Authentication failed or not authorized to delete this spot.");
        } else {
          const errorText = await response.text();
          alert(`Failed to delete spot: ${errorText}`);
        }
      } catch (error) {
        console.error('Error deleting spot:', error);
        alert('An error occurred while deleting the spot.');
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
      alert("You must be logged in to request a spot.");
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
        if (mapRef.current) {
          mapRef.current.closePopup();
        }
      } else {
        const errorText = await response.text();
        alert(`Failed to send request: ${errorText}`);
      }
    } catch (error) {
      console.error('Error requesting spot:', error);
      alert('An error occurred while sending the request.');
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
        console.log(`Map.js - Spot ID: ${spot.id}, Lat: ${lat}, Lng: ${lng}`);
        console.log(`Map.js - Typeof Lat: ${typeof lat}, Typeof Lng: ${typeof lng}`);

        if (isNaN(lat) || isNaN(lng)) {
          console.warn(`Skipping invalid parking spot coordinates for ID: ${spot.id}. Lat: ${lat}, Lng: ${lng}`);
          return null;
        }

        const isOwner = spot.user_id === currentUserId;
        const isExactLocation = spot.isExactLocation; // Use the flag from the backend
        const circleColor = '#FF0000'; // Red color for the circle
        const circleFillColor = '#FF0000';

        return (
          <React.Fragment key={spot.id}>
            {isExactLocation ? (
              <Marker position={[lat, lng]} icon={parkingSpotIcon}>
                <Popup>
                  <div>
                    Parking Spot ID: {spot.id} <br />
                    Declared by: {spot.username} <br />
                    Status: {spot.is_free ? 'Free' : 'Charged'} <br />
                    Price: €{ (spot.price ?? 0).toFixed(2) } <br />
                    Time to leave: {spot.time_to_leave} minutes <br />
                    Comments: {spot.comments}
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
                      <div className="request-button-container">
                        <hr />
                        <button onClick={() => handleRequest(spot.id)} className="request-spot-button delete-spot-button">
                          Request
                        </button>
                      </div>
                    )}
                  </div>
                </Popup>
              </Marker>
            ) : (
              <Circle center={[lat, lng]} radius={130} pathOptions={{ color: circleColor, fillColor: circleFillColor, fillOpacity: 0.2 }}>
                <Popup>
                  <div>
                    Parking Spot ID: {spot.id} <br />
                    Declared by: {spot.username} <br />
                    Status: {spot.is_free ? 'Free' : 'Charged'} <br />
                    Price: €{ (spot.price ?? 0).toFixed(2) } <br />
                    Time to leave: {spot.time_to_leave} minutes <br />
                    Comments: {spot.comments}
                    <div className="request-button-container">
                      <hr />
                      <button onClick={() => handleRequest(spot.id)} className="request-spot-button spot-action-button">
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
