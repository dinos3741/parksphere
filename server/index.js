
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); // Import cors
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Server from socket.io
const { pool, createUsersTable, createParkingSpotsTable, createRequestsTable } = require('./db');
const { getRandomPointInCircle, getDistance } = require('./utils/geoutils'); // Import geoutils
const app = express();

const server = http.createServer(app); // Create http server
const io = new Server(server, { // Initialize Socket.IO
  cors: {
    origin: ["http://localhost:3000", "http://localhost:3002"], // Allow multiple origins
    methods: ["GET", "POST"]
  }
});

const userSockets = {}; // Map userId to socketId

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  socket.on('register', (payload) => {
    const { userId, username } = payload;
    if (!userId) return;

    // Remove any existing registration for this socket to prevent duplicates
    for (const id in userSockets) {
      if (userSockets[id].socketId === socket.id && id !== userId) {
        console.log(`Socket ${socket.id} was previously registered to user ${userSockets[id].username}. Unregistering old user.`);
        delete userSockets[id];
      }
    }

    // Register the new user
    console.log(`Registering user ${username} (ID: ${userId}) with socket ${socket.id}`);
    userSockets[userId] = { socketId: socket.id, username };
    console.log('Current user sockets:', userSockets);
  });

  socket.on('unregister', (userId) => {
    if (userId && userSockets[userId]) {
      console.log(`Unregistering user ${userSockets[userId].username} (ID: ${userId})`);
      delete userSockets[userId];
      console.log('Current user sockets:', userSockets);
    }
  });

  socket.on('acceptRequest', async (data) => {
    const { requestId, requesterId, spotId, ownerUsername, ownerId } = data;
    const requesterSocketId = userSockets[requesterId]?.socketId;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // Get the spot price
      const spotResult = await client.query('SELECT price FROM parking_spots WHERE id = $1', [spotId]);
      if (spotResult.rows.length === 0) {
        await client.query('ROLLBACK');
        // maybe emit an error to the owner
        return;
      }
      const { price } = spotResult.rows[0];

      // Update the request status in the database
      await client.query(
        `UPDATE requests SET status = 'accepted', responded_at = NOW(), accepted_at = NOW() WHERE id = $1 AND spot_id = $2 AND owner_id = $3`,
        [requestId, spotId, ownerId]
      );

      // Reserve the funds in the requester's account
      await client.query('UPDATE users SET reserved_amount = $1 WHERE id = $2', [price, requesterId]);

      await client.query('COMMIT');

      const fullSpotResult = await pool.query('SELECT * FROM parking_spots WHERE id = $1', [spotId]);
      const spot = fullSpotResult.rows[0];

      if (requesterSocketId) {
        io.to(requesterSocketId).emit('requestResponse', {
          message: `Your request for spot ${spotId} was ACCEPTED by ${ownerUsername}! Please get to the spot before the expiration time.`,
          spot: spot, // Include the full spot object
          ownerUsername: ownerUsername
        });
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error accepting request and updating DB:', error);
      // Optionally, send an error message back to the owner or requester
    } finally {
      client.release();
    }
  });

  socket.on('declineRequest', async (data) => {
    const { requestId, requesterId, spotId, ownerUsername } = data;
    const requesterSocket = userSockets[requesterId]?.socketId;

    try {
      // Update the request status in the database
      await pool.query(
        `UPDATE requests SET status = 'rejected', responded_at = NOW() WHERE id = $1 AND spot_id = $2`,
        [requestId, spotId]
      );
      console.log(`Request ${requestId} for spot ${spotId} was REJECTED.`);
      console.log(`Request ${requestId} for spot ${spotId} was REJECTED.`);

      if (requesterSocket) {
        io.to(requesterSocket).emit('requestResponse', {
          message: `Your request for spot ${spotId} was DECLINED by ${ownerUsername}.`
        });
      }
    } catch (error) {
      console.error('Error declining request and updating DB:', error);
    }
  });

  socket.on('requester-arrived', async (data) => {
    const { spotId } = data;
    const requesterId = Object.keys(userSockets).find(key => userSockets[key].socketId === socket.id);
    if (!requesterId) return;

    try {
      const spotResult = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
      if (spotResult.rows.length === 0) {
        return; // Spot not found
      }
      const ownerId = spotResult.rows[0].user_id;

      const requesterResult = await pool.query('SELECT username FROM users WHERE id = $1', [requesterId]);
      if (requesterResult.rows.length === 0) {
        return; // Requester not found
      }
      const requesterUsername = requesterResult.rows[0].username;

      const ownerSocketInfo = userSockets[ownerId];
      if (ownerSocketInfo && ownerSocketInfo.socketId) {
        io.to(ownerSocketInfo.socketId).emit('requesterArrived', { 
          spotId, 
          requesterId, 
          requesterUsername 
        });
      }
    } catch (error) {
      console.error('Error handling requester arrival:', error);
    }
  });

  socket.on('confirm-transaction', async (data) => {
    const { spotId, requesterId } = data;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const spotResult = await client.query('SELECT user_id, price FROM parking_spots WHERE id = $1', [spotId]);
      if (spotResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }
      const { user_id: ownerId, price } = spotResult.rows[0];

      const requesterResult = await client.query('SELECT credits, reserved_amount FROM users WHERE id = $1', [requesterId]);
      if (requesterResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }
      const { credits: requesterCredits, reserved_amount: requesterReservedAmount } = requesterResult.rows[0];

      if (requesterReservedAmount < price) {
        // Not enough reserved, something is wrong
        await client.query('ROLLBACK');
        // maybe emit an error
        return;
      }

      // Transfer credits
      await client.query('UPDATE users SET credits = credits - $1, reserved_amount = 0 WHERE id = $2', [price, requesterId]);
      await client.query('UPDATE users SET credits = credits + $1 WHERE id = $2', [price, ownerId]);

      // Increment spots_taken for the requester
      await client.query('UPDATE users SET spots_taken = spots_taken + 1 WHERE id = $1', [requesterId]);

      // Record arrived_at and calculate individual arrival time
      const requestUpdateResult = await client.query(
        `UPDATE requests SET status = 'fulfilled', arrived_at = NOW() WHERE requester_id = $1 AND spot_id = $2 RETURNING accepted_at, arrived_at`,
        [requesterId, spotId]
      );

      if (requestUpdateResult.rows.length > 0) {
        const { accepted_at, arrived_at } = requestUpdateResult.rows[0];
        const individualArrivalTimeMs = arrived_at.getTime() - accepted_at.getTime(); // in milliseconds
        const individualArrivalTimeMinutes = individualArrivalTimeMs / (1000 * 60); // in minutes

        // Update total_arrival_time and completed_transactions_count for the requester
        await client.query(
          `UPDATE users SET total_arrival_time = total_arrival_time + $1, completed_transactions_count = completed_transactions_count + 1 WHERE id = $2`,
          [individualArrivalTimeMinutes, requesterId]
        );
      }

      // Delete the spot
      await client.query('DELETE FROM parking_spots WHERE id = $1', [spotId]);
      io.emit('spotDeleted', spotId);

      await client.query('COMMIT');

      const requesterSocketId = userSockets[requesterId]?.socketId;
      if (requesterSocketId) {
        io.to(requesterSocketId).emit('transactionComplete', { message: `Transaction for spot ${spotId} complete. ${price} credits have been transferred.` });
      }

      const ownerSocketId = userSockets[ownerId]?.socketId;
      if (ownerSocketId) {
        io.to(ownerSocketId).emit('transactionComplete', { message: `Transaction for spot ${spotId} complete. You have received ${price} credits.` });
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error acknowledging arrival:', error);
    } finally {
      client.release();
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    // Find which user was connected on this socket and remove them
    for (const userId in userSockets) {
      if (userSockets[userId].socketId === socket.id) {
        console.log(`User ${userSockets[userId].username} (ID: ${userId}) disconnected.`);
        delete userSockets[userId];
        break; // Assuming one user per socket, we can stop
      }
    }
    console.log('Current user sockets:', userSockets);
  });
});
const port = 3001;

const JWT_SECRET = 'supersecretjwtkey';

const CAR_SIZE_HIERARCHY = {
  'motorcycle': 0,
  'city car': 1,
  'hatchback': 2,
  'sedan': 3,
  'family car': 4,
  'SUV': 5,
  'van': 6,
  'truck': 7,
};

app.use(bodyParser.json());
app.use(cors()); // Enable CORS for all routes

// Ensure tables exist on server start
createUsersTable();
createParkingSpotsTable();
createRequestsTable(); // Ensure requests table exists

// Middleware to authenticate JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.status(401).json({ message: 'Unauthorized: No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Forbidden: Invalid token.' });
    req.user = user;
    next();
  });
}

app.get('/api', (req, res) => {
  res.json({ message: 'Hello from the server!' });
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      'SELECT id, username, plate_number, car_color, car_type, created_at, credits, spots_declared, spots_taken, total_arrival_time, completed_transactions_count FROM users WHERE id = $1',
      [userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).send('User not found.');
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send('Server error fetching user data.');
  }
});

app.get('/api/user/spots-count', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query('SELECT spots_declared FROM users WHERE id = $1', [userId]);
    const count = parseInt(result.rows[0].spots_declared, 10);
    res.status(200).json({ count });
  } catch (error) {
    console.error('Error fetching spots count:', error);
    res.status(500).send('Server error fetching spots count.');
  }
});

app.get('/api/user/pending-requests', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT spot_id FROM requests WHERE requester_id = $1 AND status = 'pending'`,
      [userId]
    );
    const pendingSpotIds = result.rows.map(row => row.spot_id);
    res.status(200).json(pendingSpotIds);
  } catch (error) {
    console.error('Error fetching pending requests:', error);
    res.status(500).send('Server error fetching pending requests.');
  }
});



app.get('/api/parkingspots', authenticateToken, async (req, res) => {
  const filter = req.query.filter;
  const userCarType = req.query.userCarType; // Get user's car type from query
  let query = 'SELECT ps.id, ps.user_id, u.username, ps.latitude, ps.longitude, ps.time_to_leave, ps.cost_type, ps.price, ps.declared_at, ps.declared_car_type, ps.comments, ps.fuzzed_latitude, ps.fuzzed_longitude FROM parking_spots ps JOIN users u ON ps.user_id = u.id'; // Changed is_free to cost_type
  const queryParams = [];
  const conditions = [];

  try {
    if (filter) {
      if (filter === 'available') { // This filter now refers to spots that are not occupied by anyone
        // We don't have an 'is_occupied' column anymore.
        // If 'available' means not currently taken, we need a different way to determine this.
        // For now, I'll remove this condition as it's based on the old 'is_free' meaning.
        // conditions.push('ps.is_free = TRUE');
      } else if (filter === 'occupied') { // This filter now refers to spots that are currently taken by someone
        // conditions.push('ps.is_free = FALSE');
      } else if (!isNaN(parseInt(filter))) { // Check if filter is a number
        const minutes = parseInt(filter);
        // Spots that will be empty within 'minutes' from now
                conditions.push(`ps.declared_at + (ps.time_to_leave * INTERVAL '1 minute') <= NOW() + (INTERVAL '1 minute' * $1::integer) AND ps.declared_at + (ps.time_to_leave * INTERVAL '1 minute') > NOW()`);
        queryParams.push(minutes);
      }
    }

    // Add car type filtering
    if (userCarType && CAR_SIZE_HIERARCHY[userCarType] !== undefined) {
      const userCarSize = CAR_SIZE_HIERARCHY[userCarType];
      const suitableCarTypes = Object.keys(CAR_SIZE_HIERARCHY).filter(type => CAR_SIZE_HIERARCHY[type] >= userCarSize);
      if (suitableCarTypes.length > 0) {
        //const placeholders = suitableCarTypes.map((_, i) => `${queryParams.length + 1 + i}`).join(',');
        const placeholders = suitableCarTypes.map((_, i) => `$${queryParams.length + 1 + i}`).join(',');

        conditions.push(`ps.declared_car_type IN (${placeholders})`);
        queryParams.push(...suitableCarTypes);
      }
    }

    if (conditions.length > 0) {
      query += ' WHERE ' + conditions.join(' AND ');
    }

    const result = await pool.query(query, queryParams);
    const currentUserId = req.user ? req.user.userId : null; // Get current user ID from authenticated token

    // Fetch accepted requests for the current user
    let acceptedRequests = {};
    if (currentUserId) {
      const acceptedResult = await pool.query(
        `SELECT spot_id FROM requests WHERE requester_id = $1 AND status = 'accepted'`,
        [currentUserId]
      );
      acceptedRequests = acceptedResult.rows.reduce((acc, row) => {
        acc[row.spot_id] = true;
        return acc;
      }, {});
    }

    const spotsToSend = result.rows.map(spot => {
      const shouldBeExactLocation = Boolean(spot.user_id === currentUserId || acceptedRequests[spot.id]);

      if (shouldBeExactLocation) {
        return { ...spot, isExactLocation: true };
      } else {
        if (spot.fuzzed_latitude && spot.fuzzed_longitude) {
          return { ...spot, latitude: spot.fuzzed_latitude, longitude: spot.fuzzed_longitude, isExactLocation: false };
        } else {
          const [fuzzedLat, fuzzedLon] = getRandomPointInCircle(parseFloat(spot.latitude), parseFloat(spot.longitude), 130);
          return { ...spot, latitude: fuzzedLat, longitude: fuzzedLon, isExactLocation: false };
        }
      }
    });

    res.status(200).json(spotsToSend);
  } catch (error) {
    console.error('Error fetching parking spots:', error);
    res.status(500).send('Server error fetching parking spots.');
  }
});

// Protect this route with authentication middleware
app.post('/api/declare-spot', authenticateToken, async (req, res) => {
  const { latitude, longitude, timeToLeave, costType, price, declaredCarType, comments } = req.body; // Changed isFree to costType
  const userId = req.user.userId;

  
  

  try {
    const existingSpot = await pool.query('SELECT id FROM parking_spots WHERE user_id = $1', [userId]);
    if (existingSpot.rows.length > 0) {
      return res.status(409).json({ message: 'You have already declared a parking spot. Please delete your existing spot first.' });
    }

    const [fuzzedLat, fuzzedLon] = getRandomPointInCircle(latitude, longitude, 130);

    const result = await pool.query(
      'INSERT INTO parking_spots (user_id, latitude, longitude, time_to_leave, cost_type, price, declared_car_type, comments, fuzzed_latitude, fuzzed_longitude) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, user_id, latitude, longitude, time_to_leave, cost_type, price, declared_car_type, comments, declared_at', // Changed is_free to cost_type
      [userId, latitude, longitude, timeToLeave, costType, price, declaredCarType, comments, fuzzedLat, fuzzedLon] // Changed isFree to costType
    );
    const newSpot = result.rows[0];
    await pool.query('UPDATE users SET spots_declared = spots_declared + 1 WHERE id = $1', [userId]);
    io.emit('newParkingSpot', newSpot); // Emit new spot event
    res.status(201).json({ message: 'Spot declared successfully!', spotId: newSpot.id });
  } catch (error) {
    console.error('Error declaring spot:', error);
    res.status(500).json({ message: 'Server error declaring spot.' });
  }
});

app.post('/api/seed-spot-notification', async (req, res) => {
  const { spot } = req.body;
  if (spot) {
    io.emit('newParkingSpot', spot);
    res.status(200).json({ message: 'Spot notification emitted.' });
  } else {
    res.status(400).json({ message: 'No spot data provided.' });
  }
});

// Protect this route with authentication middleware
app.put('/api/parkingspots/:id', authenticateToken, async (req, res) => {
  const spotId = req.params.id;
  const userId = req.user.userId;
  const { timeToLeave, costType, price, declaredCarType, comments } = req.body; // Changed isFree to costType

  try {
    const spot = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
    if (spot.rows.length === 0) {
      return res.status(404).send('Parking spot not found.');
    }
    if (spot.rows[0].user_id !== userId) {
      return res.status(403).send('You are not authorized to update this parking spot.');
    }

    await pool.query(
      'UPDATE parking_spots SET time_to_leave = $1, cost_type = $2, price = $3, comments = $4 WHERE id = $5', // Changed is_free to cost_type
      [timeToLeave, costType, price, comments, spotId] // Changed isFree to costType
    );

    // Fetch the updated spot to emit it
    const updatedSpotResult = await pool.query('SELECT * FROM parking_spots WHERE id = $1', [spotId]);
    const updatedSpot = updatedSpotResult.rows[0];

    io.emit('spotUpdated', updatedSpot); // Emit spot updated event
    res.status(200).json({ message: 'Parking spot updated successfully!', spot: updatedSpot });
  } catch (error) {
    console.error('Error updating parking spot:', error);
    res.status(500).send('Server error updating parking spot.');
  }
});

app.delete('/api/parkingspots/:id', authenticateToken, async (req, res) => {
  const spotId = req.params.id;
  const userId = req.user.userId;

  try {
    const spot = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
    if (spot.rows.length === 0) {
      return res.status(404).send('Parking spot not found.');
    }
    if (spot.rows[0].user_id !== userId) {
      return res.status(403).send('You are not authorized to delete this parking spot.');
    }

    await pool.query('DELETE FROM parking_spots WHERE id = $1', [spotId]);
    io.emit('spotDeleted', spotId); // Emit spot deleted event
    res.status(200).send('Parking spot deleted successfully!');
  } catch (error) {
    console.error('Error deleting parking spot:', error);
    res.status(500).send('Server error deleting parking spot.');
  }
});

app.get('/api/spots/:spotId/requests-details', authenticateToken, async (req, res) => {
  const { spotId } = req.params;
  const ownerId = req.user.userId; // The authenticated user should be the owner

  try {
    // Verify that the authenticated user is indeed the owner of the spot
    const spotCheck = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
    if (spotCheck.rows.length === 0 || spotCheck.rows[0].user_id !== ownerId) {
      return res.status(403).json({ message: 'Forbidden: You do not own this spot or it does not exist.' });
    }

    const result = await pool.query(
      `SELECT
          r.id,
          r.requester_id,
          r.requested_at,
          u.username AS requester_username,
          u.car_type AS requester_car_type,
          r.distance::NUMERIC AS distance
       FROM
          requests r
       JOIN
          users u ON r.requester_id = u.id
       WHERE
          r.spot_id = $1 AND (r.status = 'pending' OR r.status = 'accepted')
       ORDER BY
          r.requested_at DESC`,
      [spotId]
    );
    const formattedRows = result.rows.map(row => ({
      ...row,
      distance: parseFloat(row.distance) // Convert to number
    }));
    res.status(200).json(formattedRows);
  } catch (error) {
    console.error('Error fetching requests details:', error);
    res.status(500).send('Server error fetching requests details.');
  }
});

app.post('/api/request-spot', authenticateToken, async (req, res) => {
  const { spotId, requesterLat, requesterLon } = req.body;
  const requesterId = req.user.userId;

  try {
    // Get the user ID of the spot owner and spot's coordinates
    const spotResult = await pool.query('SELECT user_id, latitude, longitude FROM parking_spots WHERE id = $1', [spotId]);
    if (spotResult.rows.length === 0) {
      return res.status(404).send('Parking spot not found.');
    }
    const { user_id: ownerId, latitude: spotLat, longitude: spotLon } = spotResult.rows[0];

    // Calculate distance
    const distance = getDistance(requesterLat, requesterLon, parseFloat(spotLat), parseFloat(spotLon));
    

    // Check if a request already exists for this spot by this requester (any status)
    const existingRequest = await pool.query(
      `SELECT id, status FROM requests WHERE spot_id = $1 AND requester_id = $2`,
      [spotId, requesterId]
    );

    if (existingRequest.rows.length > 0) {
      const currentRequest = existingRequest.rows[0];
      if (currentRequest.status === 'cancelled' || currentRequest.status === 'rejected') {
        // Reactivate the request
        await pool.query(
          `UPDATE requests SET status = 'pending', responded_at = NULL, accepted_at = NULL, distance = $4 WHERE id = $1 RETURNING id`,
          [currentRequest.id, spotId, requesterId, distance]
        );
        const requestId = currentRequest.id; // Use the existing request ID
        // Re-send notification to owner if they are connected
        const ownerSocketInfo = userSockets[ownerId];
        const ownerUsername = ownerSocketInfo ? ownerSocketInfo.username : 'Unknown Owner';
        if (ownerSocketInfo && ownerSocketInfo.socketId) {
          io.to(ownerSocketInfo.socketId).emit('spotRequest', {
            spotId,
            requesterId,
            requesterUsername,
            ownerUsername,
            requestId,
            message: `User ${requesterUsername} has re-requested your parking spot!`
          });
        }
        return res.status(200).json({ message: 'Your request has been reactivated!', requestId });
      } else if (currentRequest.status === 'pending' || currentRequest.status === 'accepted') {
        return res.status(409).json({ message: 'You already have an active request for this spot.' });
      }
    }

    // If no existing request or if it was not active, create a new one (original logic)
    const requestResult = await pool.query(
      `INSERT INTO requests (spot_id, requester_id, owner_id, status, distance) VALUES ($1, $2, $3, 'pending', $4) RETURNING id`,
      [spotId, requesterId, ownerId, distance]
    );
    const requestId = requestResult.rows[0].id;

    // Get the requester's username
    const requesterResult = await pool.query('SELECT username FROM users WHERE id = $1', [requesterId]);
    if (requesterResult.rows.length === 0) {
      console.log(`Requester with ID ${requesterId} not found.`);
      return res.status(404).send('Requester not found.');
    }
    const requesterUsername = requesterResult.rows[0].username;
    
    

    // Find the owner's socket ID and username
    const ownerSocketInfo = userSockets[ownerId];
    const ownerUsername = ownerSocketInfo ? ownerSocketInfo.username : 'Unknown Owner'; // Get owner's username

    if (ownerSocketInfo && ownerSocketInfo.socketId) {
      // Send a notification to the spot owner
      io.to(ownerSocketInfo.socketId).emit('spotRequest', {
        spotId,
        requesterId,
        requesterUsername,
        ownerUsername, // Include ownerUsername here
        requestId, // Pass the new requestId
        message: `User ${requesterUsername} has requested your parking spot!`
      });
      res.status(200).json({ message: 'Request sent successfully.', requestId });
    } else {
      console.log(`Spot owner ${ownerId} is not currently connected or socketId is missing.`);
      // If owner is not connected, still create the request in DB, but inform requester
      res.status(200).json({ message: 'Request sent. Owner is currently offline, they will be notified when they connect.', requestId });
    }
  } catch (error) {
    console.error('Error requesting spot:', error);
    res.status(500).send('Server error requesting spot.');
  }
});

app.post('/api/cancel-request', authenticateToken, async (req, res) => {
  const { spotId } = req.body;
  const requesterId = req.user.userId;

  try {
    // Find the pending request
    const requestResult = await pool.query(
      `SELECT id, owner_id FROM requests WHERE spot_id = $1 AND requester_id = $2 AND status = 'pending'`,
      [spotId, requesterId]
    );

    if (requestResult.rows.length === 0) {
      return res.status(404).json({ message: 'No pending request found for this spot and user.' });
    }

    const { id: requestId, owner_id: ownerId } = requestResult.rows[0];

    // Delete the request
    await pool.query(
      `DELETE FROM requests WHERE id = $1`,
      [requestId]
    );

    // Get requester's username for notification
    const requesterResult = await pool.query('SELECT username FROM users WHERE id = $1', [requesterId]);
    const requesterUsername = requesterResult.rows[0].username;

    // Notify the spot owner
    const ownerSocketInfo = userSockets[ownerId];
    if (ownerSocketInfo && ownerSocketInfo.socketId) {
      io.to(ownerSocketInfo.socketId).emit('requestCancelled', {
        spotId,
        requesterId,
        requesterUsername,
        message: `User ${requesterUsername} has cancelled their request for your spot ${spotId}.`
      });
    }

    res.status(200).json({ message: 'Request cancelled successfully.' });
  } catch (error) {
    console.error('Error cancelling request:', error);
    res.status(500).json({ message: 'Server error cancelling request.' });
  }
});

app.post('/api/eta', authenticateToken, async (req, res) => {
  const { requesterLat, requesterLon, spotId } = req.body;
  const requesterId = req.user.userId;

  try {
    const spotResult = await pool.query('SELECT user_id, latitude, longitude FROM parking_spots WHERE id = $1', [spotId]);
    if (spotResult.rows.length === 0) {
      return res.status(404).send('Parking spot not found.');
    }
    const { user_id: ownerId, latitude: spotLat, longitude: spotLon } = spotResult.rows[0];

    const distance = getDistance(requesterLat, requesterLon, parseFloat(spotLat), parseFloat(spotLon));
    const eta = (distance / 20) * 60; // ETA in minutes, assuming 20 km/h average speed

    const ownerSocketInfo = userSockets[ownerId];
    if (ownerSocketInfo && ownerSocketInfo.socketId) {
      io.to(ownerSocketInfo.socketId).emit('etaUpdate', { spotId, requesterId, eta: Math.round(eta) });
    }

    res.status(200).json({ eta: Math.round(eta) });
  } catch (error) {
    console.error('Error calculating ETA:', error);
    res.status(500).send('Server error calculating ETA.');
  }
});

app.post('/api/confirm-arrival', authenticateToken, async (req, res) => {
  const { spotId } = req.body;
  const requesterId = req.user.userId;

  try {
    const spotResult = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
    if (spotResult.rows.length === 0) {
      return res.status(404).send('Parking spot not found.');
    }
    const ownerId = spotResult.rows[0].user_id;

    const ownerSocketInfo = userSockets[ownerId];
    if (ownerSocketInfo && ownerSocketInfo.socketId) {
      io.to(ownerSocketInfo.socketId).emit('requesterArrived', { spotId, requesterId });
      res.status(200).json({ message: 'Arrival confirmed and owner notified.' });
    } else {
      res.status(200).json({ message: 'Arrival confirmed. Owner is currently offline.' });
    }
  } catch (error) {
    console.error('Error confirming arrival:', error);
    res.status(500).send('Server error confirming arrival.');
  }
});

app.post('/api/register', async (req, res) => {
  const { username, password, plateNumber, carColor, carType } = req.body;

  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      'INSERT INTO users (username, password, plate_number, car_color, car_type) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [username, hashedPassword, plateNumber, carColor, carType]
    );
    res.status(201).json({ message: 'User registered successfully!', userId: result.rows[0].id });
  } catch (error) {
    console.error('Error during registration:', error);
    if (error.code === '23505') {
      res.status(409).send('Username already exists.');
    } else {
      res.status(500).send('Server error during registration.');
    }
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    const user = result.rows[0];

    if (!user) {
      return res.status(400).send('Invalid username or password.');
    }

    const isMatch = await bcrypt.compare(password, user.password);

    if (!isMatch) {
      return res.status(400).send('Invalid username or password.');
    }

    const accessToken = jwt.sign({ userId: user.id, username: user.username, carType: user.car_type }, JWT_SECRET, { expiresIn: '1d' });

    res.status(200).json({ message: 'Login successful!', token: accessToken, userId: user.id, username: user.username });
  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).send('Server error during login.');
  }
});

// Function to check and remove expired parking spots
async function checkAndRemoveExpiredSpots() {
  try {
    const expiredSpots = await pool.query(
      "SELECT id, declared_at, time_to_leave FROM parking_spots WHERE declared_at + (time_to_leave * INTERVAL '1 minute') < NOW()"
    );

    if (expiredSpots.rows.length > 0) {
      // console.log("Server: Expired spots found:", expiredSpots.rows);
    }

    for (const spot of expiredSpots.rows) {
      await pool.query('DELETE FROM parking_spots WHERE id = $1', [spot.id]);
      io.emit('spotDeleted', spot.id); // Emit event for real-time update
    }
  } catch (error) {
    console.error('Error checking and removing expired spots:', error);
  }
}

// Schedule the function to run every 15 seconds (15000 milliseconds)
setInterval(checkAndRemoveExpiredSpots, 15000);


server.listen(port, () => {
  console.log(`Server listening at http://0.0.0.0:${port}`);
});
