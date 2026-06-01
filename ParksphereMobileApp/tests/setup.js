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

jest.mock('@tensorflow/tfjs', () => ({
  loadLayersModel: jest.fn().mockResolvedValue({
    predict: jest.fn().mockReturnValue({
      dataSync: jest.fn().mockReturnValue([0.1, 0.9]), // Mock returning state
      dispose: jest.fn()
    })
  }),
  tensor2d: jest.fn().mockReturnValue({
    dispose: jest.fn()
  }),
  setBackend: jest.fn().mockResolvedValue(true),
  ready: jest.fn().mockResolvedValue(true),
}));

jest.mock('@tensorflow/tfjs-react-native', () => ({
  bundleResourceIO: jest.fn()
}));
