require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors'); // Import cors
const { auth } = require('express-oauth2-jwt-bearer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const http = require('http'); // Import http module
const { Server } = require('socket.io'); // Import Server from socket.io
const { OAuth2Client } = require('google-auth-library');
const { pool, createUsersTable, createParkingSpotsTable, createRequestsTable, createUserRatingsTable, createMessagesTable } = require('./db');
const { getRandomPointInCircle, getDistance } = require('./utils/geoutils'); // Import geoutils
const path = require('path');
const fs = require('fs');
const multer = require('multer');

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const app = express();

// Ensure uploads directory exists
const uploadDir = path.join(__dirname, 'uploads', 'avatars');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

// Multer configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, 'avatar-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({ storage: storage });

const allowedOrigins = [
  "http://localhost:3000",
  "http://localhost:3002",
  "http://localhost:8081",
  "http://192.168.1.70:3000",
  "http://192.168.1.70:8081",
  "http://192.168.1.22:3000",
  "http://192.168.1.22:8081",
  "http://192.168.1.22:19000",
  "http://192.168.1.22:19006"
];

const server = http.createServer(app); // Create http server
const io = new Server(server, { // Initialize Socket.IO
  cors: {
    origin: allowedOrigins,
    methods: ["GET", "POST"]
  }
});

const userSockets = {}; // Map userId to socketId

io.on('connection', (socket) => {
  console.log('Server: A user connected:', socket.id);
  console.log('Server: userSockets on connection:', userSockets);

  socket.on('register', (payload) => {
    const { userId, username } = payload;
    if (!userId) return;

    if (!userSockets[userId]) {
      userSockets[userId] = [];
    }

    // Avoid adding the same socket id multiple times
    if (!userSockets[userId].find(s => s.socketId === socket.id)) {
      userSockets[userId].push({ socketId: socket.id, username });
      console.log(`Server: Registering user ${username} (ID: ${userId}) with socket ${socket.id}. Current userSockets:`, userSockets);
      console.log('Server: userSockets after register:', userSockets);
    }
  });

  socket.on('unregister', (userId) => {
    if (userId && userSockets[userId]) {
      const sockets = userSockets[userId];
      const index = sockets.findIndex(s => s.socketId === socket.id); // Find the specific socket
      if (index !== -1) {
        console.log(`Server: Unregistering socket ${socket.id} for user (ID: ${userId})`);
        sockets.splice(index, 1); // Remove only that socket
        if (sockets.length === 0) { // If no more sockets for this user, remove the user entry
          delete userSockets[userId];
          console.log(`Server: User ${userId} has no more active sockets. Removed from userSockets.`);
        }
        console.log('Server: Current userSockets after unregister:', userSockets);
        console.log('Server: userSockets after unregister:', userSockets);
      }
    }
  });

  socket.on('acceptRequest', async (data) => {
    console.log('Server: acceptRequest event received with data:', data);
    const { requestId, requesterId, spotId, ownerUsername, ownerId } = data;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Check if the spot still exists and get its price
      const spotResult = await client.query('SELECT price FROM parking_spots WHERE id = $1 FOR UPDATE', [spotId]);
      if (spotResult.rows.length === 0) {
        await client.query('ROLLBACK');
        return;
      }
      const { price } = spotResult.rows[0];

      // 2. Check if the request is still pending
      const requestCheck = await client.query('SELECT status FROM requests WHERE id = $1 FOR UPDATE', [requestId]);
      if (requestCheck.rows.length === 0 || requestCheck.rows[0].status !== 'pending') {
        await client.query('ROLLBACK');
        return;
      }

      // 3. Update the accepted request
      await client.query(
        `UPDATE requests SET status = 'accepted', responded_at = NOW(), accepted_at = NOW() WHERE id = $1 AND spot_id = $2 AND owner_id = $3`,
        [requestId, spotId, ownerId]
      );

      // 4. Reject all other pending requests for this spot
      const otherRequestsResult = await client.query(
        `UPDATE requests SET status = 'rejected', responded_at = NOW() 
         WHERE spot_id = $1 AND id != $2 AND status = 'pending' 
         RETURNING requester_id`,
        [spotId, requestId]
      );
      const rejectedRequesterIds = otherRequestsResult.rows.map(r => r.requester_id);

      // 5. Reserve the funds in the requester's account
      await client.query('UPDATE users SET reserved_amount = $1 WHERE id = $2', [price, requesterId]);

      await client.query('COMMIT');

      // --- Notifications ---

      // Notify the accepted requester
      const requesterSockets = userSockets[requesterId];
      const fullSpotResult = await pool.query(
        `SELECT ps.*, u.username, u.plate_number, u.car_color 
         FROM parking_spots ps 
         JOIN users u ON ps.user_id = u.id 
         WHERE ps.id = $1`, 
        [spotId]
      );
      const spot = fullSpotResult.rows[0];

      if (requesterSockets) {
        requesterSockets.forEach(s => {
          io.to(s.socketId).emit('requestResponse', {
            message: `Your request for spot ${spotId} was ACCEPTED by ${ownerUsername}! Please get to the spot before the expiration time.`,
            spot: spot,
            ownerUsername: ownerUsername,
            requestId: requestId
          });
        });
      }

      // Notify all rejected requesters
      rejectedRequesterIds.forEach(rejectedId => {
        const rejectedSockets = userSockets[rejectedId];
        if (rejectedSockets) {
          rejectedSockets.forEach(s => {
            io.to(s.socketId).emit('requestResponse', {
              message: `Your request for spot ${spotId} was DECLINED by ${ownerUsername}.`,
              spotId: spotId,
              status: 'rejected'
            });
          });
        }
      });

      // Notify owner to update their UI
      const ownerSocketInfo = userSockets[ownerId];
      if (ownerSocketInfo) {
        ownerSocketInfo.forEach(s => {
          io.to(s.socketId).emit('requestAcceptedOrDeclined', { spotId, requestId });
        });
      }
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error accepting request:', error);
    } finally {
      client.release();
    }
  });

  socket.on('declineRequest', async (data) => {
    const { requestId, requesterId, spotId, ownerUsername, ownerId } = data;
    const requesterSockets = userSockets[requesterId];

    try {
      // Update the request status in the database
      await pool.query(
        `UPDATE requests SET status = 'rejected', responded_at = NOW() WHERE id = $1 AND spot_id = $2`,
        [requestId, spotId]
      );
      
      if (requesterSockets) {
        requesterSockets.forEach(s => {
          io.to(s.socketId).emit('requestResponse', {
            message: `Your request for spot ${spotId} was DECLINED by ${ownerUsername}.`,
            spotId: spotId,
            ownerUsername: ownerUsername
          });
          io.to(s.socketId).emit('requestAcceptedOrDeclined', { spotId, requestId });
        });
      }
      // Emit to owner to update their requests list
      const ownerSocketInfo = userSockets[ownerId];
      if (ownerSocketInfo) {
        ownerSocketInfo.forEach(s => {
          io.to(s.socketId).emit('requestAcceptedOrDeclined', { spotId, requestId });
        });
      }
    } catch (error) {
      console.error('Error declining request and updating DB:', error);
    }
  });

  socket.on('requester-arrived', async (data) => {
    console.log('Server: Received requester-arrived event with data:', data);
    console.log('Server: Incoming socket.id for requester-arrived:', socket.id);
    const { spotId } = data;
    let requesterId = null;
    for (const userIdKey in userSockets) {
      if (userSockets[userIdKey].some(s => s.socketId === socket.id)) {
        requesterId = userIdKey;
        break;
      }
    }
    console.log('Server: Identified requesterId:', requesterId);
    if (!requesterId) return;

    try {
      const spotResult = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
      if (spotResult.rows.length === 0) {
        console.log('Server: Spot not found for spotId:', spotId);
        return; // Spot not found
      }
      const ownerId = spotResult.rows[0].user_id;
      console.log('Server: Identified ownerId:', ownerId);

      const requesterResult = await pool.query('SELECT username FROM users WHERE id = $1', [requesterId]);
      if (requesterResult.rows.length === 0) {
        console.log('Server: Requester not found for requesterId:', requesterId);
        return; // Requester not found
      }
      const requesterUsername = requesterResult.rows[0].username;

      const ownerSockets = userSockets[ownerId];
      if (ownerSockets) {
        const payload = { 
          spotId, 
          requesterId, 
          requesterUsername 
        };
        console.log(`Server: Emitting requesterArrived to owner ${ownerId} on sockets:`, ownerSockets, 'with payload:', payload);
        ownerSockets.forEach(s => {
          io.to(s.socketId).emit('requesterArrived', payload);
        });
      } else {
        console.log(`Server: Owner ${ownerId} has no active sockets to emit requesterArrived.`);
      }
    } catch (error) {
      console.error('Error handling requester arrival:', error);
    }
  });

  socket.on('reject-arrival', (data) => {
    const { spotId, requesterId } = data;
    const requesterSockets = userSockets[requesterId];
    if (requesterSockets) {
      requesterSockets.forEach(s => {
        io.to(s.socketId).emit('arrivalRejected', { spotId });
      });
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

      const requestsResult = await client.query('SELECT requester_id FROM requests WHERE spot_id = $1', [spotId]);
      const requesterIds = requestsResult.rows.map(r => r.requester_id);

      // Delete the spot
      await client.query('DELETE FROM parking_spots WHERE id = $1', [spotId]);
      io.emit('spotDeleted', { spotId, ownerId, requesterIds });

      await client.query('COMMIT');

      const ownerResult = await client.query('SELECT username FROM users WHERE id = $1', [ownerId]);
      const ownerUsername = ownerResult.rows[0].username;

      const requesterSockets = userSockets[requesterId];
      if (requesterSockets) {
        requesterSockets.forEach(s => {
          io.to(s.socketId).emit('transactionComplete', { 
            message: `Transaction for spot ${spotId} complete. ${price} credits have been transferred.`,
            ownerId: ownerId,
            ownerUsername: ownerUsername
          });
        });
      }

      const ownerSockets = userSockets[ownerId];
      if (ownerSockets) {
        const requesterResult = await client.query('SELECT username FROM users WHERE id = $1', [requesterId]);
        const requesterUsername = requesterResult.rows[0].username;
        ownerSockets.forEach(s => {
          io.to(s.socketId).emit('transactionComplete', { 
            message: `Transaction for spot ${spotId} complete. You have received ${price} credits.`,
            requesterId: requesterId,
            requesterUsername: requesterUsername
          });
        });
      }

    } catch (error) {
      await client.query('ROLLBACK');
      console.error('Error acknowledging arrival:', error);
    } finally {
      client.release();
    }
  });

  socket.on('privateMessage', async (data) => {
    const { from, to, message } = data;
    const recipientSockets = userSockets[to];

    try {
      const result = await pool.query(
        'INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3) RETURNING created_at',
        [from, to, message]
      );
      const created_at = result.rows[0].created_at;

      const senderResult = await pool.query('SELECT username, avatar_url FROM users WHERE id = $1', [from]);
      const sender = senderResult.rows[0];

      if (recipientSockets) {
        recipientSockets.forEach(s => {
          io.to(s.socketId).emit('privateMessage', { 
            from, 
            to, 
            message, 
            created_at,
            sender_username: sender ? sender.username : 'Unknown User',
            sender_avatar_url: sender ? sender.avatar_url : null
          });
        });
      }
    } catch (error) {
      console.error('Error saving private message:', error);
    }
  });

  socket.on('disconnect', () => {
    console.log('A user disconnected:', socket.id);
    // Find which user was connected on this socket and remove them
    for (const userId in userSockets) {
      const sockets = userSockets[userId];
      const index = sockets.findIndex(s => s.socketId === socket.id);
      if (index !== -1) {
        console.log(`User ${sockets[index].username} (ID: ${userId}) disconnected.`);
        sockets.splice(index, 1);
        if (sockets.length === 0) {
          delete userSockets[userId];
        }
        break;
      }
    }
    console.log('Server: userSockets on disconnect:', userSockets);
  });
});
const PORT = process.env.PORT || 3001;

const JWT_SECRET = process.env.JWT_SECRET || 'supersecretjwtkey';

const { CAR_SIZE_HIERARCHY } = require('./utils/carTypes');

app.use(bodyParser.json());
app.use(cors({ origin: allowedOrigins })); // Enable CORS for all routes
app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); // Serve uploads statically

// Endpoint for avatar upload
app.post('/api/users/avatar', authenticateToken, upload.single('avatar'), async (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  const userId = req.user.userId;
  // Store only the relative path in the database.
  // The client will prepend the server's base URL.
  const avatarUrl = `/uploads/avatars/${req.file.filename}`;

  try {
    await pool.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, userId]);
    res.status(200).json({ avatar_url: avatarUrl });
  } catch (error) {
    console.error('Error updating user avatar:', error);
    res.status(500).send('Server error updating avatar.');
  }
});

// Ensure tables exist on server start
createUsersTable();
createParkingSpotsTable();
createRequestsTable(); // Ensure requests table exists
createUserRatingsTable();
createMessagesTable();

const jwtCheck = auth({
  audience: ['parksphere-client', 'account'],
  issuerBaseURL: 'http://localhost:8080/realms/Parksphere',
  tokenSigningAlg: 'RS256'
});

// Middleware to authenticate both Local JWT (HS256) and Keycloak JWT (RS256)
async function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Unauthorized: No token provided.' });
  }

  // 1. Try to verify as a Local JWT (HS256) first
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // If successful, it's a local token issued by our server (e.g., Google login)
    req.user = decoded; // { userId, username, carType }
    return next();
  } catch (err) {
    // If HS256 verification fails, proceed to try Keycloak (RS256)
    // Only continue if it's an algorithm mismatch or invalid signature, 
    // not if the token is completely malformed or expired (though jwtCheck will handle those too)
  }

  // 2. Fallback: Try to verify as a Keycloak JWT (RS256)
  jwtCheck(req, res, async (err) => {
    if (err) {
      console.error('JWT Validation Error (Keycloak):', err);
      return res.status(401).json({ message: 'Unauthorized: Invalid token.' });
    }

    // Keycloak 'sub' is the unique user ID, 'preferred_username' is the username
    const keycloakId = req.auth.payload.sub;
    const username = req.auth.payload.preferred_username;
    const email = req.auth.payload.email;

    try {
      // 1. First, check if a user already exists with this Keycloak ID
      let result = await pool.query('SELECT id, username, car_type, credits FROM users WHERE keycloak_id = $1', [keycloakId]);
      let user = result.rows[0];

      if (!user) {
        // 2. If not, check if a user with the SAME USERNAME exists from the old database
        result = await pool.query('SELECT id, keycloak_id FROM users WHERE username = $1', [username]);
        user = result.rows[0];

        if (user && !user.keycloak_id) {
          // 3. Link this existing user to the new Keycloak ID
          console.log(`Server: Linking existing user ${username} (ID: ${user.id}) to Keycloak ID: ${keycloakId}`);
          await pool.query('UPDATE users SET keycloak_id = $1 WHERE id = $2', [keycloakId, user.id]);
        } else if (!user) {
          // 4. Create new user from Keycloak data
          console.log(`Server: Creating new user for Keycloak user: ${username}`);
          const newUserResult = await pool.query(
            'INSERT INTO users (username, email, keycloak_id, avatar_url) VALUES ($1, $2, $3, $4) RETURNING id',
            [username, email, keycloakId, `https://i.pravatar.cc/80?u=${username}`]
          );
          user = newUserResult.rows[0];
        }
      }

      // Attach our internal database ID to the request
      req.user = { userId: user.id, username: username, keycloakId: keycloakId };
      next();
    } catch (dbError) {
      console.error('Database Sync Error:', dbError);
      res.status(500).send('Server error during user sync.');
    }
  });
}

app.get('/api/me', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        u.id, 
        u.username, 
        u.plate_number, 
        u.car_color, 
        u.car_type, 
        u.credits, 
        u.spots_declared, 
        u.spots_taken, 
        u.avatar_url,
        (SELECT AVG(rating) FROM user_ratings WHERE rated_user_id = u.id) as average_rating
      FROM users u 
      WHERE u.id = $1`,
      [req.user.userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).send('User not found.');
    }

    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching me profile:', error);
    res.status(500).send('Server error fetching profile.');
  }
});

app.get('/api', (req, res) => {
  res.json({ message: 'Hello from the server!' });
});

app.get('/api/car-types', (req, res) => {
  const carTypes = Object.keys(CAR_SIZE_HIERARCHY);
  res.status(200).json(carTypes);
});

app.get('/api/users/interactions', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT DISTINCT owner_id, requester_id, responded_at
       FROM requests
       WHERE (owner_id = $1 OR requester_id = $1) AND (status = 'fulfilled' OR status = 'accepted')
       ORDER BY responded_at DESC
       LIMIT 20`,
      [userId]
    );

    const interactionUserIds = result.rows.map(row => row.owner_id === userId ? row.requester_id : row.owner_id);
    const uniqueUserIds = [...new Set(interactionUserIds)];

    if (uniqueUserIds.length === 0) {
      return res.status(200).json([]);
    }

    const usersResult = await pool.query(
      `SELECT id, username, avatar_url FROM users WHERE id = ANY($1::int[])`,
      [uniqueUserIds]
    );

    res.status(200).json(usersResult.rows);
  } catch (error) {
    console.error('Error fetching user interactions:', error);
    res.status(500).send('Server error fetching user interactions.');
  }
});

app.get('/api/users/:id', authenticateToken, async (req, res) => {
  const userId = req.params.id;

  try {
    const result = await pool.query(
      `SELECT 
        u.id, 
        u.username, 
        u.plate_number, 
        u.car_color, 
        u.car_type, 
        u.created_at, 
        u.credits, 
        u.spots_declared, 
        u.spots_taken, 
        u.total_arrival_time, 
        u.completed_transactions_count,
        u.avatar_url,
        u.auto_detect,
        (SELECT AVG(rating) FROM user_ratings WHERE rated_user_id = u.id) as rating,

        (SELECT COUNT(rating) FROM user_ratings WHERE rated_user_id = u.id) as rating_count
      FROM users u 
      WHERE u.id = $1`,
      [userId]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).send('User not found.');
    }

    const scores = await calculateAllUserScores();
    const sortedScores = scores.sort((a, b) => b.score - a.score);
    const userIndex = sortedScores.findIndex(s => s.userId === parseInt(userId));
    const percentile = (userIndex / sortedScores.length) * 100;

    user.rank = Math.ceil(percentile);


    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user data:', error);
    res.status(500).send('Server error fetching user data.');
  }
});

async function calculateAllUserScores() {
  const client = await pool.connect();
  try {
      const usersResult = await client.query(
        `SELECT id, spots_declared, spots_taken, average_rating, total_arrival_time, completed_transactions_count
         FROM users`
      );
      const users = usersResult.rows;

      const maxValuesResult = await client.query(
        `SELECT MAX(spots_declared) as max_spots_declared,
                MAX(spots_taken) as max_spots_taken,
                MAX(total_arrival_time) as max_total_arrival_time,
                MAX(completed_transactions_count) as max_completed_transactions_count
         FROM users`
      );
      const maxValues = maxValuesResult.rows[0];

      const scores = users.map(user => {
        const normalized_spots_declared = maxValues.max_spots_declared > 0 ? user.spots_declared / maxValues.max_spots_declared : 0;
        const normalized_spots_taken = maxValues.max_spots_taken > 0 ? user.spots_taken / maxValues.max_spots_taken : 0;
        const normalized_rating = user.average_rating ? user.average_rating / 5.0 : 0; // Use stored average_rating
        // For total_arrival_time, lower is better, so we invert the score
        const normalized_arrival_time = maxValues.max_total_arrival_time > 0 ? (1 - (user.total_arrival_time / maxValues.max_total_arrival_time)) : 0;
        const normalized_completed_transactions = maxValues.max_completed_transactions_count > 0 ? user.completed_transactions_count / maxValues.max_completed_transactions_count : 0;

        // Define weights for each factor (adjust as needed)
        const weight_rating = 0.4;
        const weight_spots_declared = 0.15;
        const weight_spots_taken = 0.15;
        const weight_arrival_time = 0.15;
        const weight_completed_transactions = 0.15;

        const rank_score = (
          (weight_rating * normalized_rating) +
          (weight_spots_declared * normalized_spots_declared) +
          (weight_spots_taken * normalized_spots_taken) +
          (weight_arrival_time * normalized_arrival_time) +
          (weight_completed_transactions * normalized_completed_transactions)
        );
        return { userId: user.id, score: rank_score };
      });

    return scores;
  } finally {
    client.release();
  }
}


app.get('/api/users/username/:username', authenticateToken, async (req, res) => {
  const username = req.params.username;

  try {
    const result = await pool.query(
      `SELECT 
        u.id, 
        u.username, 
        u.created_at, 
        u.credits, 
        u.car_type, 
        u.spots_declared, 
        u.spots_taken, 
        u.avatar_url,
        (SELECT AVG(rating) FROM user_ratings WHERE rated_user_id = u.id) as average_rating
      FROM users u 
      WHERE u.username = $1`,
      [username]
    );
    const user = result.rows[0];

    if (!user) {
      return res.status(404).send('User not found.');
    }

    const scores = await calculateAllUserScores();
    const sortedScores = scores.sort((a, b) => b.score - a.score);
    const userIndex = sortedScores.findIndex(s => s.userId === user.id);
    const percentile = (userIndex / sortedScores.length) * 100;

    user.rank = Math.ceil(percentile);

    res.status(200).json(user);
  } catch (error) {
    console.error('Error fetching user data by username:', error);
    res.status(500).send('Server error fetching user data by username.');
  }
});

app.post('/api/users/populate-avatars', authenticateToken, async (req, res) => {
  try {
    const client = await pool.connect();
    const usersToUpdate = await client.query('SELECT id, username FROM users WHERE avatar_url IS NULL');

    for (const user of usersToUpdate.rows) {
      const avatarUrl = `https://i.pravatar.cc/80?u=${user.username}`;
      await client.query('UPDATE users SET avatar_url = $1 WHERE id = $2', [avatarUrl, user.id]);
    }
    client.release();
    res.status(200).json({ message: `Populated avatar_url for ${usersToUpdate.rows.length} users.` });
  } catch (error) {
    console.error('Error populating avatar URLs:', error);
    res.status(500).send('Server error populating avatar URLs.');
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

app.get('/api/user/spot-requests', authenticateToken, async (req, res) => {
  const ownerId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT
          r.id,
          r.spot_id AS "spotId",
          r.requester_id,
          r.requested_at,
          u.username AS requester_username,
          u.car_type AS requester_car_type,
          u.avatar_url AS requester_avatar_url,
          r.distance::NUMERIC AS distance,
          r.status
       FROM
          requests r
       JOIN
          parking_spots ps ON r.spot_id = ps.id
       JOIN
          users u ON r.requester_id = u.id
       WHERE
          ps.user_id = $1 AND (r.status = 'pending' OR r.status = 'accepted')
       ORDER BY
          r.requested_at DESC`,
      [ownerId]
    );
    const formattedRows = result.rows.map(row => ({
      ...row,
      distance: parseFloat(row.distance) // Convert to number
    }));
    res.status(200).json(formattedRows);
  } catch (error) {
    console.error('Error fetching owner spot requests:', error);
    res.status(500).send('Server error fetching owner spot requests.');
  }
});



app.get('/api/parkingspots', authenticateToken, async (req, res) => {
  const filter = req.query.filter;
  const userCarType = req.query.userCarType; // Get user's car type from query
  let query = 'SELECT ps.id, ps.user_id, u.username, u.car_type, u.plate_number, u.car_color, ps.latitude, ps.longitude, ps.time_to_leave, ps.cost_type, ps.price, ps.declared_at, ps.declared_car_type, ps.comments, ps.fuzzed_latitude, ps.fuzzed_longitude, ps.status FROM parking_spots ps JOIN users u ON ps.user_id = u.id'; // Changed is_free to cost_type
  const queryParams = [];
  const conditions = [];

  try {
    if (filter) {
      if (filter === 'available') { 
        conditions.push("ps.status IN ('free', 'soon_free')");
      } else if (filter === 'occupied') { 
        conditions.push("ps.status = 'occupied'");
      } else if (!isNaN(parseInt(filter))) { 
        const minutes = parseInt(filter);
        // Spots that will be empty within 'minutes' from now
                conditions.push(`ps.declared_at + (ps.time_to_leave * INTERVAL '1 minute') <= NOW() + (INTERVAL '1 minute' * $1::integer) AND ps.declared_at + (ps.time_to_leave * INTERVAL '1 minute') > NOW()`);
        queryParams.push(minutes);
      }
    }

    // Add car type filtering
    if (userCarType && CAR_SIZE_HIERARCHY[userCarType.toLowerCase()] !== undefined) {
      const userCarSize = CAR_SIZE_HIERARCHY[userCarType.toLowerCase()];
      const suitableCarTypes = Object.keys(CAR_SIZE_HIERARCHY).filter(type => CAR_SIZE_HIERARCHY[type] >= userCarSize);
      if (suitableCarTypes.length > 0) {
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

    // --- PROXIMITY CHECK: CONSUME EXISTING FREE/SOON_FREE SPOTS ---
    try {
      const PROXIMITY_THRESHOLD_METERS = 5;
      const candidates = await pool.query(
        "SELECT id, user_id, latitude, longitude FROM parking_spots WHERE status IN ('free', 'soon_free')"
      );

      for (const cand of candidates.rows) {
        const distKm = getDistance(latitude, longitude, parseFloat(cand.latitude), parseFloat(cand.longitude));
        const distM = distKm * 1000;

        if (distM < PROXIMITY_THRESHOLD_METERS) {
          console.log(`[Lifecycle] Consuming nearby spot ${cand.id} (Distance: ${distM.toFixed(2)}m)`);
          
          // Emit deletion before actual DB delete to maintain consistency with logic elsewhere
          const requestsResult = await pool.query('SELECT requester_id FROM requests WHERE spot_id = $1', [cand.id]);
          const requesterIds = requestsResult.rows.map(r => r.requester_id);
          const ownerId = cand.user_id;

          await pool.query('DELETE FROM requests WHERE spot_id = $1', [cand.id]);
          await pool.query('DELETE FROM parking_spots WHERE id = $1', [cand.id]);
          
          io.emit('spotDeleted', { spotId: cand.id, ownerId, requesterIds });
        }
      }
    } catch (proxError) {
      console.error('Error during proximity cleanup:', proxError);
      // We continue even if cleanup fails
    }

    const result = await pool.query(
      'INSERT INTO parking_spots (user_id, latitude, longitude, time_to_leave, cost_type, price, declared_car_type, comments, fuzzed_latitude, fuzzed_longitude, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id, user_id, latitude, longitude, time_to_leave, cost_type, price, declared_car_type, comments, declared_at, status', // Changed is_free to cost_type
      [userId, latitude, longitude, timeToLeave, costType, price, declaredCarType, comments, fuzzedLat, fuzzedLon, 'occupied'] // Changed isFree to costType
    );
    const newSpot = result.rows[0];
    await pool.query('UPDATE users SET spots_declared = spots_declared + 1 WHERE id = $1', [userId]);

    const userResult = await pool.query('SELECT username FROM users WHERE id = $1', [userId]);
    const username = userResult.rows[0].username;
    const spotToEmit = { ...newSpot, username };

    io.emit('newParkingSpot', spotToEmit); // Emit new spot event with username
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

app.put('/api/parkingspots/:id/status', authenticateToken, async (req, res) => {
  const spotId = req.params.id;
  const { status } = req.body;
  const userId = req.user.userId;

  if (!['occupied', 'soon_free', 'free'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status.' });
  }

  try {
    const spotResult = await pool.query('SELECT user_id FROM parking_spots WHERE id = $1', [spotId]);
    if (spotResult.rows.length === 0) {
      return res.status(404).json({ message: 'Spot not found.' });
    }
    if (spotResult.rows[0].user_id !== userId) {
      return res.status(403).json({ message: 'Unauthorized.' });
    }

    const result = await pool.query(
      'UPDATE parking_spots SET status = $1 WHERE id = $2 RETURNING *',
      [status, spotId]
    );

    const updatedSpot = result.rows[0];
    io.emit('spotStatusUpdated', updatedSpot);
    res.status(200).json({ message: 'Status updated successfully.', spot: updatedSpot });
  } catch (error) {
    console.error('Error updating spot status:', error);
    res.status(500).json({ message: 'Server error updating status.' });
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
      'UPDATE parking_spots SET time_to_leave = $1, cost_type = $2, price = $3, comments = $4, declared_car_type = $5 WHERE id = $6',
      [timeToLeave, costType, price, comments, declaredCarType, spotId]
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

    const requestsResult = await pool.query('SELECT requester_id FROM requests WHERE spot_id = $1', [spotId]);
    const requesterIds = requestsResult.rows.map(r => r.requester_id);
    const ownerId = userId;

    await pool.query('DELETE FROM requests WHERE spot_id = $1', [spotId]);
    await pool.query('DELETE FROM parking_spots WHERE id = $1', [spotId]);
    io.emit('spotDeleted', { spotId, ownerId, requesterIds }); // Emit spot deleted event
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
          u.avatar_url AS requester_avatar_url,
          r.distance::NUMERIC AS distance,
          r.status
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
      `SELECT id, status FROM requests WHERE spot_id = $1 AND requester_id = $2 AND (status = 'pending' OR status = 'accepted')`,
      [spotId, requesterId]
    );

    if (existingRequest.rows.length > 0) {
      return res.status(409).json({ message: 'You already have an active request for this spot.' });
    }

    // Always create a new request if no active (pending/accepted) request exists
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
    
    // Log distance after parseFloat and before emission
    const distanceToSend = parseFloat(distance);

    // Find the owner's socket ID and username
    const ownerSockets = userSockets[ownerId];
    const ownerUsername = ownerSockets ? ownerSockets[0].username : 'Unknown Owner'; // Get owner's username
    
    console.log(`[request-spot] Attempting to notify owner. Owner ID: ${ownerId}`, { ownerSockets });

    if (ownerSockets) {
      const payload = {
        spotId,
        requesterId,
        requesterUsername,
        ownerUsername, // Include ownerUsername here
        requestId, // Pass the new requestId
        distance: distanceToSend,
        message: `User ${requesterUsername} has requested your parking spot!`
      };
      
      console.log('[request-spot] Emitting spotRequest with payload:', payload);
      // Send a notification to the spot owner
      ownerSockets.forEach(s => {
        io.to(s.socketId).emit('spotRequest', payload);
      });
      res.status(200).json({ message: 'Request sent successfully.', requestId });
    } else {
      console.log(`[request-spot] Spot owner ${ownerId} is not currently connected or socketId is missing.`);
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
    if (requesterResult.rows.length === 0) {
      console.log(`Requester with ID ${requesterId} not found.`);
      return res.status(404).send('Requester not found.');
    }
    const requesterUsername = requesterResult.rows[0].username;

    // Notify the spot owner
    const ownerSockets = userSockets[ownerId];
    if (ownerSockets) {
      ownerSockets.forEach(s => {
        io.to(s.socketId).emit('requestCancelled', {
          spotId,
          requesterId,
          requesterUsername,
          requestId,
          message: `User ${requesterUsername} has cancelled their request for your spot ${spotId}.`
        });
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

    const ownerSockets = userSockets[ownerId];
    if (ownerSockets) {
      ownerSockets.forEach(s => {
        io.to(s.socketId).emit('etaUpdate', { spotId, requesterId, eta: Math.round(eta) });
      });
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

    const ownerSockets = userSockets[ownerId];
    if (ownerSockets) {
      ownerSockets.forEach(s => {
        io.to(s.socketId).emit('requesterArrived', { spotId, requesterId });
      });
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
  const { username, email, password, plateNumber, carColor, carType } = req.body;
  const avatarUrl = `https://i.pravatar.cc/80?u=${username}`;

  try {
    // 1. Get an Admin Token from Keycloak
    const tokenResponse = await fetch('http://localhost:8080/realms/master/protocol/openid-connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id: 'admin-cli',
        username: 'admin',
        password: 'admin'
      })
    });

    if (!tokenResponse.ok) {
      throw new Error('Failed to get Keycloak admin token');
    }
    const tokenData = await tokenResponse.json();
    const adminToken = tokenData.access_token;

    // 2. Create the User in Keycloak (Base Info)
    const createUserResponse = await fetch('http://localhost:8080/admin/realms/Parksphere/users', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        username,
        email,
        firstName: username, // Providing names to satisfy 'Update Profile' requirement
        lastName: 'User',
        enabled: true,
        emailVerified: true,
        requiredActions: []
      })
    });

    if (!createUserResponse.ok) {
      const errorText = await createUserResponse.text();
      if (createUserResponse.status === 409) {
        return res.status(409).send('Username or Email already exists.');
      }
      throw new Error(`Failed to create user in Keycloak: ${errorText}`);
    }

    // 3. Get the Keycloak ID (UUID) from the Location header
    const locationHeader = createUserResponse.headers.get('Location');
    const keycloakId = locationHeader.split('/').pop();

    // 4. Set the Password explicitly
    const setPasswordResponse = await fetch(`http://localhost:8080/admin/realms/Parksphere/users/${keycloakId}/reset-password`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        type: 'password',
        value: password,
        temporary: false
      })
    });

    if (!setPasswordResponse.ok) {
      throw new Error('Failed to set user password in Keycloak.');
    }

    // 5. FINAL AGGRESSIVE SYNC: Force-clear everything again
    await fetch(`http://localhost:8080/admin/realms/Parksphere/users/${keycloakId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        emailVerified: true,
        firstName: username,
        lastName: 'User',
        requiredActions: [] // This is the crucial line
      })
    });

    // 6. Save to Local Database
    const result = await pool.query(
      'INSERT INTO users (username, email, keycloak_id, plate_number, car_color, car_type, avatar_url) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [username, email, keycloakId, plateNumber, carColor, carType, avatarUrl]
    );

    console.log(`Server: Successfully registered user ${username} with Keycloak ID ${keycloakId}`);
    res.status(201).json({ message: 'User registered successfully!', userId: result.rows[0].id });

  } catch (error) {
    console.error('Error during registration:', error);
    res.status(500).send(`Server error during registration: ${error.message}`);
  }
});

app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    // 1. Authenticate with Keycloak using Resource Owner Password Credentials Grant
    const details = {
      'client_id': 'parksphere-client',
      'username': username,
      'password': password,
      'grant_type': 'password',
      'scope': 'openid profile email'
    };

    const formBody = Object.keys(details).map(key => encodeURIComponent(key) + '=' + encodeURIComponent(details[key])).join('&');

    const kcResponse = await fetch('http://localhost:8080/realms/Parksphere/protocol/openid-connect/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8'
      },
      body: formBody
    });

    if (!kcResponse.ok) {
      const errorData = await kcResponse.json();
      console.error('Keycloak Login Error:', errorData);
      return res.status(401).json({ message: 'Invalid username or password.' });
    }

    const kcData = await kcResponse.json();
    // Keycloak token successfully obtained!

    // 2. Get user info from local database (or sync from Keycloak if it's the first time)
    let result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
    let user = result.rows[0];

    if (!user) {
      // If user exists in Keycloak but not locally (e.g. manual Keycloak entry), create local record
      // We can decode the ID token to get email and keycloak_id (sub)
      const decodedIdToken = jwt.decode(kcData.id_token);
      const email = decodedIdToken.email;
      const keycloakId = decodedIdToken.sub;
      
      console.log(`Server: Creating local record for Keycloak user ${username}`);
      const newUserResult = await pool.query(
        'INSERT INTO users (username, email, keycloak_id, avatar_url) VALUES ($1, $2, $3, $4) RETURNING id, username, car_type',
        [username, email, keycloakId, `https://i.pravatar.cc/80?u=${username}`]
      );
      user = newUserResult.rows[0];
    }

    // 3. Issue our Local JWT (HS256) for the app to use
    const accessToken = jwt.sign(
      { userId: user.id, username: user.username, carType: user.car_type },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      message: 'Login successful!',
      token: accessToken,
      userId: user.id,
      username: user.username,
      carType: user.car_type
    });

  } catch (error) {
    console.error('Error during login:', error);
    res.status(500).json({ message: 'Server error during login.' });
  }
});

app.post('/api/auth/google', async (req, res) => {
  const { idToken, plateNumber, carColor, carType } = req.body;

  try {
    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: [process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_MOBILE_CLIENT_ID],
    });
    const payload = ticket.getPayload();
    const { sub: googleId, email, name, picture, given_name } = payload;

    // Check if user exists with this google_id
    let result = await pool.query('SELECT * FROM users WHERE google_id = $1', [googleId]);
    let user = result.rows[0];

    if (!user) {
      // Check if user exists with this email (link accounts)
      result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
      user = result.rows[0];
    }

    let isNewUser = false;
    // If user exists, check if they have car details
    if (user) {
      // If car details are missing and not provided in request, ask for them
      if ((!user.plate_number || !user.car_color || !user.car_type) && (!plateNumber || !carColor || !carType)) {
        return res.status(428).send('Car details required');
      }

      // Update user only with missing details to avoid overwriting existing ones
      await pool.query(
        'UPDATE users SET google_id = $1, avatar_url = COALESCE(avatar_url, $2), plate_number = COALESCE(plate_number, $3), car_color = COALESCE(car_color, $4), car_type = COALESCE(car_type, $5) WHERE id = $6',
        [googleId, picture, plateNumber, carColor, carType, user.id]
      );
      
      const refreshResult = await pool.query('SELECT * FROM users WHERE id = $1', [user.id]);
      user = refreshResult.rows[0];
    } else {
      // New user - MUST have car details
      if (!plateNumber || !carColor || !carType) {
        return res.status(428).send('Car details required');
      }
      isNewUser = true;

      let usernameBase = given_name || name.split(' ')[0];
      let username = usernameBase.toLowerCase();
      
      const checkUser = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
      if (checkUser.rows.length > 0) {
        username = `${username}_${Date.now()}`;
      }

      const newUserResult = await pool.query(
        'INSERT INTO users (username, email, google_id, avatar_url, plate_number, car_color, car_type) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, username, car_type, avatar_url',
        [username, email, googleId, picture, plateNumber, carColor, carType]
      );
      user = newUserResult.rows[0];
    }

    const accessToken = jwt.sign(
      { userId: user.id, username: user.username, carType: user.car_type },
      JWT_SECRET,
      { expiresIn: '30d' }
    );

    res.status(200).json({
      message: isNewUser ? 'Google registration successful!' : 'Google login successful!',
      token: accessToken,
      userId: user.id,
      username: user.username,
      avatar_url: user.avatar_url,
      isNewUser
    });
  } catch (error) {
    console.error('Error during Google auth:', error);
    res.status(401).send('Invalid Google token.');
  }
});

app.put('/api/users/:id/car-details', authenticateToken, async (req, res) => {
  const userId = req.params.id;
  const { car_type, car_color, plate_number, auto_detect } = req.body;

  // Ensure the authenticated user is updating their own details
  if (req.user.userId !== parseInt(userId)) {
    return res.status(403).json({ message: 'Forbidden: You can only update your own car details.' });
  }

  try {
    // Update car_type, car_color, plate_number, and auto_detect in the database
    // We use COALESCE to keep existing values if some are not provided
    await pool.query(
      'UPDATE users SET car_type = COALESCE($1, car_type), car_color = COALESCE($2, car_color), plate_number = COALESCE($3, plate_number), auto_detect = COALESCE($4, auto_detect) WHERE id = $5',
      [car_type, car_color, plate_number, auto_detect, userId]
    );

    // Fetch the updated user data to create a new JWT
    const updatedUserResult = await pool.query('SELECT id, username, car_type FROM users WHERE id = $1', [userId]);
    const updatedUser = updatedUserResult.rows[0];

    // Re-issue JWT with updated carType
    const newAccessToken = jwt.sign({ userId: updatedUser.id, username: updatedUser.username, carType: updatedUser.car_type }, JWT_SECRET, { expiresIn: '30d' });

    res.status(200).json({ message: 'Car details updated successfully!', token: newAccessToken });
  } catch (error) {
    console.error('Error updating car details:', error);
    res.status(500).json({ message: 'Server error updating car details.' });
  }
});

app.put('/api/users/:id/auto-detection', authenticateToken, async (req, res) => {
  const userId = req.params.id;
  const { enabled } = req.body;

  if (req.user.userId !== parseInt(userId)) {
    return res.status(403).json({ message: 'Forbidden.' });
  }

  try {
    await pool.query('UPDATE users SET auto_detect = $1 WHERE id = $2', [enabled, userId]);
    res.status(200).json({ message: 'Auto detection setting updated.' });
  } catch (error) {
    console.error('Error updating auto detection:', error);
    res.status(500).json({ message: 'Failed to update auto detection.' });
  }
});

app.post('/api/users/rate', authenticateToken, async (req, res) => {
  const { rated_user_id, rating } = req.body;
  const rater_id = req.user.userId;

  try {
      await pool.query('INSERT INTO user_ratings (rater_id, rated_user_id, rating) VALUES ($1, $2, $3)', [rater_id, rated_user_id, rating]);

      // Recalculate average rating for the rated user and update the users table
      const avgRatingResult = await pool.query(
        'SELECT AVG(rating) FROM user_ratings WHERE rated_user_id = $1',
        [rated_user_id]
      );
      const newAverageRating = avgRatingResult.rows[0].avg;

      await pool.query(
        'UPDATE users SET average_rating = $1 WHERE id = $2',
        [newAverageRating, rated_user_id]
      );

      res.status(201).json({ message: 'Rating submitted successfully!' });
  } catch (error) {
    console.error('Error submitting rating:', error);
    res.status(500).json({ message: 'Server error submitting rating.' });
  }
});

app.post('/api/messages', authenticateToken, async (req, res) => {
  const { to, message } = req.body;
  const from = req.user.userId;

  try {
    await pool.query(
      'INSERT INTO messages (sender_id, receiver_id, message) VALUES ($1, $2, $3)',
      [from, to, message]
    );

    const recipientSocketId = userSockets[to]?.socketId;
    if (recipientSocketId) {
      io.to(recipientSocketId).emit('privateMessage', { from, to, message });
    }

    res.status(201).json({ message: 'Message sent successfully!' });
  } catch (error) {
    console.error('Error sending message:', error);
    res.status(500).json({ message: 'Server error sending message.' });
  }
});

app.get('/api/messages/conversations', authenticateToken, async (req, res) => {
  const userId = req.user.userId;

  try {
    const result = await pool.query(
      `SELECT DISTINCT ON (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id))
         CASE
           WHEN sender_id = $1 THEN receiver_id
           ELSE sender_id
         END AS other_user_id,
         message,
         created_at
       FROM messages
       WHERE sender_id = $1 OR receiver_id = $1
       ORDER BY LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id), created_at DESC`,
      [userId]
    );

    const conversations = await Promise.all(result.rows.map(async (row) => {
      const otherUserResult = await pool.query('SELECT username, avatar_url FROM users WHERE id = $1', [row.other_user_id]);
      const otherUser = otherUserResult.rows[0];
      return {
        ...row,
        other_username: otherUser ? otherUser.username : 'Unknown User',
        other_avatar_url: otherUser ? otherUser.avatar_url : 'https://i.pravatar.cc/80?u=unknown', // Provide a default avatar
      };
    }));

    res.status(200).json(conversations);
  } catch (error) {
    console.error('Error fetching conversations:', error);
    res.status(500).send('Server error fetching conversations.');
  }
});

app.get('/api/messages/conversations/:otherUserId', authenticateToken, async (req, res) => {
  const userId = req.user.userId;
  const otherUserId = req.params.otherUserId;

  try {
    const result = await pool.query(
      `SELECT m.sender_id, m.receiver_id, m.message, m.created_at, u.avatar_url AS sender_avatar_url, u.username AS sender_username
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE (m.sender_id = $1 AND m.receiver_id = $2) OR (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at ASC`,
      [userId, otherUserId]
    );

    res.status(200).json(result.rows);
  } catch (error) {
    console.error('Error fetching messages:', error);
    res.status(500).send('Server error fetching messages.');
  }
});

// Function to check and remove expired parking spots
async function checkAndRemoveExpiredSpots() {
  try {
    const expiredSpots = await pool.query(
      "SELECT id, user_id, declared_at, time_to_leave FROM parking_spots WHERE declared_at + (time_to_leave * INTERVAL '1 minute') < NOW()"
    );

    for (const spot of expiredSpots.rows) {
      const requestsResult = await pool.query('SELECT requester_id FROM requests WHERE spot_id = $1', [spot.id]);
      const requesterIds = requestsResult.rows.map(r => r.requester_id);
      const ownerId = spot.user_id;

      await pool.query('DELETE FROM requests WHERE spot_id = $1', [spot.id]);
      await pool.query('DELETE FROM parking_spots WHERE id = $1', [spot.id]);
      io.emit('spotDeleted', { spotId: spot.id, ownerId, requesterIds }); // Emit event for real-time update
    }
  } catch (error) {
    console.error('Error checking and removing expired spots:', error);
  }
}

// Schedule the function to run every 15 seconds (15000 milliseconds)
setInterval(checkAndRemoveExpiredSpots, 15000);


server.listen(PORT, () => {
  console.log(`Server listening at http://0.0.0.0:${PORT}`);
});