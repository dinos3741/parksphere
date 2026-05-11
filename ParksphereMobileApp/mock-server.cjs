const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

const PORT = 3001;

// In-memory data
let parkingSpots = [
  {
    id: 1,
    user_id: 766,
    latitude: 37.78825,
    longitude: -122.4324,
    time_to_leave: 30,
    declared_at: new Date().toISOString(),
    car_type: 'sedan',
    ownerId: 766
  }
  ];

  const mockUser = {
  id: 766,
  username: 'dinos',
  credits: 100,
  car_type: 'sedan',
  avatar_url: 'https://i.pravatar.cc/150?u=dinos',
  auto_detect: true
  };

  // API Endpoints
  app.get('/api/car-types', (req, res) => {
  res.json(['sedan', 'suv', 'truck', 'van']);
  });

  app.post('/api/login', (req, res) => {
  const { username } = req.body;
  if (username === 'dinos') {
    res.json({
      token: 'mock-jwt-token-dinos',
      userId: 766,
      username: 'dinos',
      carType: 'sedan'
    });
  } else {
    res.status(401).json({ message: 'Only "dinos" is supported in mock mode.' });
  }
  });

app.get('/api/users/:id', (req, res) => {
  res.json(mockUser);
});

app.get('/api/parkingspots', (req, res) => {
  res.json(parkingSpots);
});

app.post('/api/declare-spot', (req, res) => {
  const newSpot = {
    ...req.body,
    id: Date.now(),
    declared_at: new Date().toISOString(),
    ownerId: req.body.userId
  };
  parkingSpots.push(newSpot);
  io.emit('newParkingSpot', newSpot);
  res.status(201).json({ message: 'Spot declared', spotId: newSpot.id });
});

app.delete('/api/parkingspots/:id', (req, res) => {
  const id = parseInt(req.params.id);
  parkingSpots = parkingSpots.filter(s => s.id !== id);
  io.emit('spotDeleted', { spotId: id });
  res.json({ message: 'Spot deleted' });
});

// Socket logic
io.on('connection', (socket) => {
  console.log('Mobile app connected:', socket.id);

  socket.on('register', (data) => {
    console.log('User registered:', data);
  });

  socket.on('disconnect', () => {
    console.log('Mobile app disconnected');
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Mock Server running on http://0.0.0.0:${PORT}`);
  console.log('Ready to support HMM testing!');
});
