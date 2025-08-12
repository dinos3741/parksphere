
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
        `UPDATE requests SET status = 'accepted', responded_at = NOW() WHERE id = $1 AND spot_id = $2 AND owner_id = $3`,
        [requestId, spotId, ownerId]
      );

      // Reserve the funds in the requester's account
      await client.query('UPDATE users SET reserved_amount = $1 WHERE id = $2', [price, requesterId]);

      await client.query('COMMIT');
      console.log(`Request ${requestId} for spot ${spotId} was ACCEPTED by owner ${ownerId}.`);

      const fullSpotResult = await pool.query('SELECT * FROM parking_spots WHERE id = $1', [spotId]);
      const spot = fullSpotResult.rows[0];

      if (requesterSocketId) {
        io.to(requesterSocketId).emit('requestResponse', {
          message: `Your request for spot ${spotId} was ACCEPTED by ${ownerUsername}!`,
          spot: spot // Include the full spot object
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

      if (requesterSocket) {
        io.to(requesterSocket).emit('requestResponse', {
          message: `Your request for spot ${spotId} was DECLINED by ${ownerUsername}.`
        });
      }
    } catch (error) {
      console.error('Error declining request and updating DB:', error);
    }
  });

  socket.on('acknowledgeArrival', async (data) => {
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

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

app.get('/api', (req, res) => {
  res.send('Hello from the server!');
});

app.get('/api/parkingspots', authenticateToken, async (req, res) => {
  const filter = req.query.filter;
  const userCarType = req.query.userCarType; // Get user's car type from query
  let query = 'SELECT ps.id, ps.user_id, u.username, ps.latitude, ps.longitude, ps.time_to_leave, ps.is_free, ps.price, ps.declared_at, ps.declared_car_type, ps.comments FROM parking_spots ps JOIN users u ON ps.user_id = u.id'; // Add ps.comments
  const queryParams = [];
  const conditions = [];

  try {
    if (filter) {
      if (filter === 'available') {
        conditions.push('ps.is_free = TRUE');
      } else if (filter === 'occupied') {
        conditions.push('ps.is_free = FALSE');
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
        // If the spot belongs to the current user OR the current user has an accepted request for it, send exact coordinates
        return { ...spot, isExactLocation: true };
      } else {
        // If the spot does not belong to the current user, fuzz the coordinates
        const [fuzzedLat, fuzzedLon] = getRandomPointInCircle(parseFloat(spot.latitude), parseFloat(spot.longitude), 130); // 130 meters radius
        return { ...spot, latitude: fuzzedLat, longitude: fuzzedLon, isExactLocation: false };
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
  const { latitude, longitude, timeToLeave, isFree, price, declaredCarType, comments } = req.body; // Add comments
  const userId = req.user.userId;

  try {
    const existingSpot = await pool.query('SELECT id FROM parking_spots WHERE user_id = $1', [userId]);
    if (existingSpot.rows.length > 0) {
      return res.status(409).send('You have already declared a parking spot. Please delete your existing spot first.');
    }

    const result = await pool.query(
      'INSERT INTO parking_spots (user_id, latitude, longitude, time_to_leave, is_free, price, declared_car_type, comments) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, user_id, latitude, longitude, time_to_leave, is_free, price, declared_car_type, comments, declared_at',
      [userId, latitude, longitude, timeToLeave, isFree, price, declaredCarType, comments] // Add comments
    );
    const newSpot = result.rows[0];
    io.emit('newParkingSpot', newSpot); // Emit new spot event
    res.status(201).json({ message: 'Spot declared successfully!', spotId: newSpot.id });
  } catch (error) {
    console.error('Error declaring spot:', error);
    res.status(500).send('Server error declaring spot.');
  }
});

// Protect this route with authentication middleware
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





app.post('/api/request-spot', authenticateToken, async (req, res) => {
  const { spotId } = req.body;
  const requesterId = req.user.userId;

  try {
    // Get the user ID of the spot owner
    const spotResult = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
    if (spotResult.rows.length === 0) {
      return res.status(404).send('Parking spot not found.');
    }
    const ownerId = spotResult.rows[0].user_id;
    console.log(`Request for spot ${spotId}: Owner ID is ${ownerId}`);

    // Check if a pending request already exists for this spot by this requester
    const existingRequest = await pool.query(
      `SELECT id FROM requests WHERE spot_id = $1 AND requester_id = $2 AND status = 'pending'`,
      [spotId, requesterId]
    );
    if (existingRequest.rows.length > 0) {
      return res.status(409).send('You already have a pending request for this spot.');
    }

    // Insert the new request into the requests table with 'pending' status
    const requestResult = await pool.query(
      `INSERT INTO requests (spot_id, requester_id, owner_id, status) VALUES ($1, $2, $3, 'pending') RETURNING id`,
      [spotId, requesterId, ownerId]
    );
    const requestId = requestResult.rows[0].id;

    // Get the requester's username
    const requesterResult = await pool.query('SELECT username FROM users WHERE id = $1', [requesterId]);
    if (requesterResult.rows.length === 0) {
      console.log(`Requester with ID ${requesterId} not found.`);
      return res.status(404).send('Requester not found.');
    }
    const requesterUsername = requesterResult.rows[0].username;
    console.log(`Requester username from DB: ${requesterUsername}`);
    console.log(`Requester username: ${requesterUsername}`);

    // Find the owner's socket ID
    const ownerSocketInfo = userSockets[ownerId];

    if (ownerSocketInfo && ownerSocketInfo.socketId) {
      // Send a notification to the spot owner
      io.to(ownerSocketInfo.socketId).emit('spotRequest', {
        spotId,
        requesterId,
        requesterUsername,
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

    const accessToken = jwt.sign({ userId: user.id, username: user.username, carType: user.car_type }, JWT_SECRET, { expiresIn: '1h' });

    res.status(200).json({ message: 'Login successful!', token: accessToken, userId: user.id });
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
      console.log(`Expired spot ${spot.id} removed.`);
    }
  } catch (error) {
    console.error('Error checking and removing expired spots:', error);
  }
}

// Schedule the function to run every 15 seconds (15000 milliseconds)
setInterval(checkAndRemoveExpiredSpots, 15000);


server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
