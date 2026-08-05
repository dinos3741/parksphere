import React, { useCallback, useEffect, useState } from 'react';
import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import socket from '../../utils/socket';
import { sendAuthenticatedRequest } from '../../utils/api';
import './OpsMap.css';

// Matches the status set used across the app (server/index.js's /api/parkingspots/:id/status
// CHECK, ParksphereMobileApp/components/Map.js's getStatusHex) — amber while soon-free, green once
// actually free/committed, red while occupied/vacating.
const STATUS_COLORS = {
  soon_free: '#FB8C00',
  free: '#2E7D32',
  committed: '#2E7D32',
  occupied: '#E53935',
  vacating: '#E53935',
};

const DEFAULT_CENTER = [40.6401, 22.9444]; // Thessaloniki — matches Map.js's own fallback center

function ageMinutes(declaredAt) {
  return Math.max(0, Math.round((Date.now() - new Date(declaredAt).getTime()) / 60000));
}

// Admin-only live map (see AdminRoute.js) — every spot regardless of privacy status, via
// GET /api/admin/parkingspots (server/index.js), unlike the regular map's GET /api/parkingspots
// which hides other users' 'occupied' spots and fuzzes non-owned locations.
//
// Declaring a spot always starts it 'occupied' and PRIVATE — the server only emits its
// 'newParkingSpot' socket event to the owner's own socket in that case (server/index.js:1102-1109),
// not a global broadcast, so an admin listening for that event globally would miss it. Rather than
// try to reconstruct correct state from those privacy-filtered/partial event payloads, the four
// lifecycle events below are used purely as "something changed, refetch the authoritative admin
// view" triggers — always correct, and no new server-side broadcast plumbing needed.
const OpsMap = () => {
  const [spots, setSpots] = useState([]);
  const [error, setError] = useState(null);

  const refetch = useCallback(async () => {
    try {
      const data = await sendAuthenticatedRequest('/admin/parkingspots');
      setSpots(data);
      setError(null);
    } catch (err) {
      setError(err.status === 403 ? 'Admin access required.' : 'Failed to load parking spots.');
    }
  }, []);

  useEffect(() => {
    refetch();
    socket.on('newParkingSpot', refetch);
    socket.on('spotUpdated', refetch);
    socket.on('spotStatusUpdated', refetch);
    socket.on('spotDeleted', refetch);
    return () => {
      socket.off('newParkingSpot', refetch);
      socket.off('spotUpdated', refetch);
      socket.off('spotStatusUpdated', refetch);
      socket.off('spotDeleted', refetch);
    };
  }, [refetch]);

  return (
    <div className="ops-map-screen">
      <div className="ops-map-header">
        <h1>Ops Center — Live Map</h1>
        <span className="ops-map-count">{spots.length} active spot{spots.length === 1 ? '' : 's'}</span>
      </div>
      {error && <div className="ops-map-error">{error}</div>}
      <MapContainer center={DEFAULT_CENTER} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        />
        {spots.map((spot) => (
          <CircleMarker
            key={spot.id}
            center={[parseFloat(spot.latitude), parseFloat(spot.longitude)]}
            radius={9}
            pathOptions={{
              color: STATUS_COLORS[spot.status] || '#616161',
              fillColor: STATUS_COLORS[spot.status] || '#616161',
              fillOpacity: 0.85,
              weight: 2,
            }}
          >
            <Popup>
              <div className="ops-map-popup">
                <strong>Spot #{spot.id}</strong> — {spot.status}
                <br />
                Owner: {spot.username} ({spot.declared_car_type || spot.car_type})
                <br />
                {spot.is_auto_detected ? 'Auto-detected' : 'Manual'} · declared {ageMinutes(spot.declared_at)}m ago
                <br />
                Expires in {spot.time_to_leave}m · {spot.cost_type}{spot.cost_type !== 'free' ? ` (${spot.price} credits)` : ''}
                {spot.comments && (
                  <>
                    <br />
                    "{spot.comments}"
                  </>
                )}
              </div>
            </Popup>
          </CircleMarker>
        ))}
      </MapContainer>
    </div>
  );
};

export default OpsMap;
