import React, { useState } from 'react';
import './LeavingFab.css';

const presets = [2, 5, 10, 0]; // minutes, 0 = now

// Accept new props: userLocation, currentUserCarType, currentUserId, onCustomDeclare
const LeavingFab = ({ userLocation, currentUserCarType, currentUserId, onCustomDeclare, addNotification }) => {
  const [showOverlay, setShowOverlay] = useState(false);

  const handlePresetClick = async (minutes) => {
    setShowOverlay(false); // Close overlay immediately

    if (!userLocation) {
      addNotification("Cannot declare spot: User location not available.");
      return;
    }

    if (!currentUserCarType) {
      addNotification("Cannot declare spot: User car type not available. Please log in again.");
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      addNotification("You must be logged in to declare a spot.");
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
          latitude: userLocation[0],
          longitude: userLocation[1],
          timeToLeave,
          costType: 'free', // Changed from isFree
          price,
          declaredCarType: currentUserCarType,
          comments,
        }),
      });

      if (response.ok) {
        const responseData = await response.json(); // Parse JSON response
        addNotification(`Parking spot ${responseData.spotId} declared successfully! You are leaving in ${minutes === 0 ? 'Now' : `${minutes} minutes`}.`);
        // The socket.io 'newParkingSpot' event on the server will handle map updates
      } else if (response.status === 409) { // Handle 409 Conflict specifically
        const errorData = await response.json();
        alert(errorData.message); // Show as pop-up
        addNotification(errorData.message); // Also add to log
      } else {
        const errorData = await response.json();
        addNotification(`Failed to declare spot: ${errorData.message}`);
      }
    } catch (error) {
      console.error('Error declaring spot:', error);
      addNotification('An error occurred while declaring the spot.');
    }
  };

  return (
    <>
      <button className="leaving-fab" onClick={() => setShowOverlay(true)}>
        I'm leaving
      </button>

      {showOverlay && (
        <div className="leaving-overlay-backdrop">
          <div className="leaving-overlay-content">
            <h2>Leaving in…</h2>
            <div className="chips-container">
              {presets.map((m) => (
                <button key={m} className="chip" onClick={() => handlePresetClick(m)}>
                  {m === 0 ? 'Now' : `${m}m`}
                </button>
              ))}
              <button className="chip" onClick={() => { setShowOverlay(false); onCustomDeclare(); }}>
                Custom…
              </button>
            </div>
            <button className="close-overlay-button" onClick={() => setShowOverlay(false)}>
              X
            </button>
          </div>
        </div>
      )}
    </>
  );
};

export default LeavingFab;
