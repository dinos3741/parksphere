import AsyncStorage from '@react-native-async-storage/async-storage';

const MOCK_DATA = {
  user: {
    id: -1,
    username: 'demo user',
    credits: 100,
    car_type: 'sedan',
    car_color: 'black',
    plate_number: 'ABC-1234',
    avatar_url: 'https://i.pravatar.cc/150?u=demouser',
    auto_detect: true,
    created_at: '2020-01-01T00:00:00.000Z',
    // Mock mode is only reachable via an admin's own toggle now (the old public Demo Login button
    // is gone) — every debug-tool gate (HMMOverlay, DebugSimulator, StreamMonitor, the notification
    // log, and this Mock Mode switch itself) checks specifically for role === 'admin', so a 'demo'
    // role here made them all disappear the moment mock mode activated, including the switch needed
    // to turn it back off. No server-side authorization depends on this value (checked: only these
    // client-side UI gates do), so 'admin' here is safe.
    role: 'admin'
  },
  spots: [
    {
      id: 101,
      user_id: -1,
      latitude: 37.78825,
      longitude: -122.4324,
      time_to_leave: 30,
      declared_at: new Date().toISOString(),
      car_type: 'sedan',
      ownerId: -1,
      status: 'active'
    }
  ],
  nextSpotId: 102,
  carTypes: ['sedan', 'suv', 'truck', 'van', 'electric'],
  conversations: [],
  messages: []
};

export const apiRequest = async (endpoint, options = {}) => {
  const mockMode = await AsyncStorage.getItem('mockModeEnabled');
  const isMockMode = mockMode === 'true';

  if (isMockMode) {
    console.log(`[MOCK] Request to ${endpoint}`, options);
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 300));

    if (endpoint.includes('/api/login')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({
          token: 'mock-jwt-token-demo',
          userId: -1,
          username: 'demo user',
          carType: 'sedan'
        })
      };
    }

    if (endpoint.includes('/api/car-types')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve(MOCK_DATA.carTypes)
      };
    }

    if (endpoint.includes('/api/declare-spot')) {
      // Used to just return a fake success without touching MOCK_DATA.spots, so the spot you just
      // placed never showed up on the map — the follow-up /api/parkingspots fetch (below) just
      // replayed the original static seed spot. Build a real record from the request body and add
      // it, mirroring the real server's shape (server/index.js's GET /api/parkingspots SELECT) so
      // the map/SpotDetails render it the same way a real spot would.
      const body = options.body ? JSON.parse(options.body) : {};
      const newSpot = {
        id: MOCK_DATA.nextSpotId++,
        user_id: MOCK_DATA.user.id,
        username: MOCK_DATA.user.username,
        car_type: MOCK_DATA.user.car_type,
        plate_number: MOCK_DATA.user.plate_number,
        car_color: MOCK_DATA.user.car_color,
        share_plate_number: true,
        latitude: body.latitude,
        longitude: body.longitude,
        fuzzed_latitude: body.latitude,
        fuzzed_longitude: body.longitude,
        time_to_leave: body.timeToLeave,
        cost_type: body.costType || 'free',
        price: body.price || 0,
        declared_at: new Date().toISOString(),
        declared_car_type: body.declaredCarType || MOCK_DATA.user.car_type,
        comments: body.comments || '',
        status: 'free',
        is_auto_detected: false,
      };
      // Real server rejects a second declare while one is already active (409) — mirror that by
      // replacing rather than accumulating, so mock mode can't end up with two "own" spots either.
      MOCK_DATA.spots = MOCK_DATA.spots.filter((s) => s.user_id !== MOCK_DATA.user.id);
      MOCK_DATA.spots.push(newSpot);
      return {
        ok: true,
        status: 201,
        json: () => Promise.resolve({ spotId: newSpot.id, message: 'Spot created (Mock)' })
      };
    }

    if (endpoint.includes('/api/request-spot')) {
      return {
        ok: true,
        status: 200,
        json: () => Promise.resolve({ message: 'Request sent (Mock)' })
      };
    }

    if (endpoint.includes('/api/users/')) {
        return {
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_DATA.user)
        }
    }

    if (endpoint.includes('/api/parkingspots')) {
        const method = options.method || 'GET';
        // Used to ignore method entirely and always just echo the current list back — DELETE/PUT to
        // /api/parkingspots/:id got an ok:true response, which made SpotContext.js's optimistic local
        // state update (setParkingSpots filter/map) look like it worked, but MOCK_DATA.spots itself
        // was never touched. The change looked fine until the next fetchParkingSpots() (foreground,
        // pull-to-refresh) silently brought the "deleted"/unedited spot back.
        if (method === 'DELETE') {
          const spotId = parseInt(endpoint.split('/').pop(), 10);
          MOCK_DATA.spots = MOCK_DATA.spots.filter((s) => s.id !== spotId);
          return { ok: true, status: 200, json: () => Promise.resolve({ message: 'Spot deleted (Mock)' }) };
        }
        if (method === 'PUT') {
          const spotId = parseInt(endpoint.split('/').pop(), 10);
          const body = options.body ? JSON.parse(options.body) : {};
          MOCK_DATA.spots = MOCK_DATA.spots.map((s) => (s.id === spotId ? { ...s, ...body } : s));
          return { ok: true, status: 200, json: () => Promise.resolve({ message: 'Spot updated (Mock)' }) };
        }
        return {
            ok: true,
            status: 200,
            json: () => Promise.resolve(MOCK_DATA.spots)
        }
    }

    if (endpoint.includes('/api/messages')) {
      return {
          ok: true,
          status: 200,
          json: () => Promise.resolve([])
      }
    }
    
    // Default fallback
    return { 
      ok: true, 
      status: 200, 
      json: () => Promise.resolve({}),
      text: () => Promise.resolve('Mock response')
    };
  }

  // Real fetch implementation
  const token = await AsyncStorage.getItem('userToken');
  const headers = {
    'Content-Type': 'application/json',
    ...(token && { 'Authorization': `Bearer ${token}` }),
    ...options.headers
  };

  return fetch(endpoint, { ...options, headers });
};
