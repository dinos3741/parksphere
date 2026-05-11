import AsyncStorage from '@react-native-async-storage/async-storage';

const MOCK_DATA = {
  user: {
    id: 766,
    username: 'dinos',
    credits: 100,
    car_type: 'sedan',
    avatar_url: 'https://i.pravatar.cc/150?u=dinos',
    auto_detect: true
  },
  spots: [
    {
      id: 101,
      user_id: 1,
      latitude: 37.78825,
      longitude: -122.4324,
      time_to_leave: 30,
      declared_at: new Date().toISOString(),
      car_type: 'sedan',
      ownerId: 1
    }
  ]
};

export const apiRequest = async (endpoint, options = {}) => {
  const mockMode = await AsyncStorage.getItem('mockModeEnabled');
  const isMockMode = mockMode === 'true';

  if (isMockMode) {
    console.log(`[MOCK] Request to ${endpoint}`, options);
    
    // Simulate delay
    await new Promise(resolve => setTimeout(resolve, 500));

    if (endpoint.includes('/api/login')) {
      return {
        ok: true,
        json: () => Promise.resolve({
          token: 'mock-jwt-token-dinos',
          userId: 766,
          username: 'dinos',
          carType: 'sedan'
        })
      };
    }

    if (endpoint.includes('/api/users/')) {
        return {
            ok: true,
            json: () => Promise.resolve(MOCK_DATA.user)
        }
    }

    if (endpoint.includes('/api/parkingspots')) {
        return {
            ok: true,
            json: () => Promise.resolve(MOCK_DATA.spots)
        }
    }
    
    // Default fallback
    return { ok: true, json: () => Promise.resolve({}) };
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
