import React from 'react';
import './LeavingFab.css';

const presets = [0, 2, 5, 10]; // minutes, 0 = now

// Accept new props: userLocation, currentUserCarType, currentUserId
const LeavingFab = ({ userLocation, currentUserCarType, currentUserId, addNotification, setPinDropMode, setShowLeavingOverlay, showLeavingOverlay, setPinnedLocation, pinnedLocation }) => {

  const handlePresetClick = async (minutes) => {
    setShowLeavingOverlay(false); // Close overlay immediately

    if (!pinnedLocation) {
      addNotification("Cannot declare spot: Please pin a location on the map first.", 'default');
      return;
    }

    if (!currentUserCarType) {
      addNotification("Cannot declare spot: User car type not available. Please log in again.", 'default');
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to declare a spot.", 'default');
      return;
    }

    const timeToLeave = minutes;
    const price = 0; // Assuming free spots have 0 price
    const comments = ""; // No comments for now

    try {
      const response = await fetch('/api/declare-spot', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          latitude: pinnedLocation[0],
          longitude: pinnedLocation[1],
          timeToLeave,
          costType: 'free', // Changed from isFree
          price,
          declaredCarType: currentUserCarType,
          comments,
        }),
      });

      if (response.ok) {
        const responseData = await response.json(); // Parse JSON response
        addNotification(`Parking spot ${responseData.spotId} declared successfully! You are leaving in ${minutes === 0 ? 'Now' : `${minutes} minutes`}.`, 'default');
        setPinnedLocation(null); // Clear the pin from the map
        // The socket.io 'newParkingSpot' event on the server will handle map updates
      } else if (response.status === 409) { // Handle 409 Conflict specifically
        const errorData = await response.json();
        alert(errorData.message); // Show as pop-up
        addNotification(errorData.message, 'default'); // Also add to log
      } else {
        const errorData = await response.json();
        addNotification(`Failed to declare spot: ${errorData.message}`, 'default');
      }
    } catch (error) {
      console.error('Error declaring spot:', error);
      addNotification('An error occurred while declaring the spot.', 'default');
    }
  };

  return (
    <>
      <button className="leaving-fab" onClick={() => setPinDropMode(true)}>
        I'm leaving
      </button>

      {showLeavingOverlay && (
        <div className="leaving-overlay-backdrop">
          <div className="leaving-overlay-content">
            <h2>Leaving in…</h2>
            <div className="chips-container">
              {presets.map((m) => (
                <button key={m} className="chip" onClick={() => handlePresetClick(m)}>
                  {m === 0 ? 'Now' : `${m}m`}
                </button>
              ))}
            </div>
            <button className="close-overlay-button" onClick={() => { setShowLeavingOverlay(false); setPinnedLocation(null); }}>
              X
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default LeavingFab;
