import React, { useState } from 'react';
import './LeavingFab.css';

const presets = [2, 5, 10, 0]; // minutes, 0 = now

// Accept new props: userLocation, currentUserCarType, currentUserId, onCustomDeclare
const LeavingFab = ({ userLocation, currentUserCarType, currentUserId, onCustomDeclare }) => {
  const [showOverlay, setShowOverlay] = useState(false);

  const handlePresetClick = async (minutes) => {
    setShowOverlay(false); // Close overlay immediately

    if (!userLocation) {
      alert("Cannot declare spot: User location not available.");
      return;
    }

    if (!currentUserCarType) {
      alert("Cannot declare spot: User car type not available. Please log in again.");
      return;
    }

    const token = localStorage.getItem('token');
    if (!token) {
      alert("You must be logged in to declare a spot.");
      return;
    }

    const timeToLeave = minutes;
    const isFree = true; // Assuming these are free spots for now
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
          isFree,
          price,
          declaredCarType: currentUserCarType,
          comments,
        }),
      });

      if (response.ok) {
        console.log(`Parking spot declared successfully for ${minutes === 0 ? 'Now' : `${minutes} minutes`}!`);
        // The socket.io 'newParkingSpot' event on the server will handle map updates
      } else {
        const errorText = await response.text();
        alert(`Failed to declare spot: ${errorText}`);
      }
    } catch (error) {
      console.error('Error declaring spot:', error);
      alert('An error occurred while declaring the spot.');
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
