process.env.EXPO_OS = 'ios';
global.__DEV__ = true;

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: 'mock://',
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(true),
}));

jest.mock('react-native-motion-activity-tracker', () => ({
  startTracking: jest.fn(),
  stopTracking: jest.fn(),
  addMotionStateChangeListener: jest.fn(),
  getPermissionStatusAsync: jest.fn().mockResolvedValue('granted'),
}));
