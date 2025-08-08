
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); // Import cors
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Server from socket.io
const { pool, createUsersTable, createParkingSpotsTable, createAcceptedRequestsTable } = require('./db');
const { getRandomPointInCircle } = require('./utils/geoutils'); // Import geoutils
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
    const { requesterId, spotId, ownerUsername, ownerId } = data;
    const requesterSocketId = userSockets[requesterId]?.socketId;

    try {
      // Record the accepted request in the database
      await pool.query(
        'INSERT INTO accepted_requests (spot_id, requester_id, owner_id) VALUES ($1, $2, $3) ON CONFLICT (spot_id, requester_id) DO NOTHING',
        [spotId, requesterId, ownerId]
      );
      console.log(`Accepted request for spot ${spotId} by requester ${requesterId}. Record added to DB.`);

      const spotResult = await pool.query('SELECT * FROM parking_spots WHERE id = $1', [spotId]);
      const spot = spotResult.rows[0];

      if (requesterSocketId) {
        io.to(requesterSocketId).emit('requestResponse', {
          message: `Your request for spot ${spotId} was ACCEPTED by ${ownerUsername}!`,
          spot: spot // Include the full spot object
        });
      }
    } catch (error) {
      console.error('Error accepting request and recording to DB:', error);
      // Optionally, send an error message back to the owner or requester
    }
  });

  socket.on('declineRequest', (data) => {
    const { requesterId, spotId, ownerUsername } = data;
    const requesterSocket = userSockets[requesterId]?.socketId;
    if (requesterSocket) {
      io.to(requesterSocket).emit('requestResponse', {
        message: `Your request for spot ${spotId} was DECLINED by ${ownerUsername}.`
      });
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
createAcceptedRequestsTable(); // Ensure accepted_requests table exists

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
        'SELECT spot_id FROM accepted_requests WHERE requester_id = $1',
        [currentUserId]
      );
      acceptedRequests = acceptedResult.rows.reduce((acc, row) => {
        acc[row.spot_id] = true;
        return acc;
      }, {});
    }

    const spotsToSend = result.rows.map(spot => {
      if (spot.user_id === currentUserId || acceptedRequests[spot.id]) {
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
      'INSERT INTO parking_spots (user_id, latitude, longitude, time_to_leave, is_free, price, declared_car_type, comments) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id, user_id, latitude, longitude, time_to_leave, is_free, price, declared_car_type, comments',
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

    // Get the requester's username
    const requesterResult = await pool.query('SELECT username FROM users WHERE id = $1', [requesterId]);
    if (requesterResult.rows.length === 0) {
      console.log(`Requester with ID ${requesterId} not found.`);
      return res.status(404).send('Requester not found.');
    }
    const requesterUsername = requesterResult.rows[0].username;
    console.log(`Requester username: ${requesterUsername}`);

    // Find the owner's socket ID
    const ownerSocketInfo = userSockets[ownerId];
    console.log(`Owner socket info for ID ${ownerId}:`, ownerSocketInfo);

    if (ownerSocketInfo && ownerSocketInfo.socketId) {
      console.log(`Attempting to emit spotRequest to socket ${ownerSocketInfo.socketId}`);
      // Send a notification to the spot owner
      io.to(ownerSocketInfo.socketId).emit('spotRequest', {
        spotId,
        requesterId,
        requesterUsername,
        message: `User ${requesterUsername} has requested your parking spot!`
      });
      res.status(200).send('Request sent successfully.');
    } else {
      console.log(`Spot owner ${ownerId} is not currently connected or socketId is missing.`);
      res.status(404).send('Spot owner is not currently connected.');
    }
  } catch (error) {
    console.error('Error requesting spot:', error);
    res.status(500).send('Server error requesting spot.');
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
      "SELECT id FROM parking_spots WHERE declared_at + (time_to_leave * INTERVAL '1 minute') < NOW()"
    );

    for (const spot of expiredSpots.rows) {
      await pool.query('DELETE FROM parking_spots WHERE id = $1', [spot.id]);
      io.emit('spotDeleted', spot.id); // Emit event for real-time update
      console.log(`Expired spot ${spot.id} removed.`);
    }
  } catch (error) {
    console.error('Error checking and removing expired spots:', error);
  }
}

// Schedule the function to run every minute (60000 milliseconds)
setInterval(checkAndRemoveExpiredSpots, 60000);


server.listen(port, () => {
  console.log(`Server listening at http://localhost:${port}`);
});
