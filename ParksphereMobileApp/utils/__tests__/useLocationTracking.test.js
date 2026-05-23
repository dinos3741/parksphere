import { renderHook } from '@testing-library/react-native';
import { useLocationTracking } from '../useLocationTracking';
import * as Location from 'expo-location';

jest.mock('expo-location', () => ({
  requestForegroundPermissionsAsync: jest.fn(),
  startLocationUpdatesAsync: jest.fn(),
  hasStartedLocationUpdatesAsync: jest.fn(),
  stopLocationUpdatesAsync: jest.fn(),
  Accuracy: { Balanced: 'Balanced' }
}));

describe('useLocationTracking Background Task', () => {
  it('should call startLocationUpdatesAsync when permission is granted and a spot is accepted', async () => {
    Location.requestForegroundPermissionsAsync.mockResolvedValue({ status: 'granted' });
    Location.hasStartedLocationUpdatesAsync.mockResolvedValue(false);

    const acceptedSpot = { id: '1', latitude: '37.7749', longitude: '-122.4194' };
    
    renderHook(() => useLocationTracking(acceptedSpot, false, jest.fn()));

    // Wait for the effect to run
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(Location.startLocationUpdatesAsync).toHaveBeenCalledWith(
      'background-location-task',
      expect.objectContaining({
        accuracy: 'Balanced',
        distanceInterval: 50,
      })
    );
  });
});
