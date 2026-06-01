module.exports = {
  transform: {
    '^.+\\.(js|jsx|ts|tsx)$': 'babel-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(jest-)?react-native|@react-native|expo|@expo|react-navigation|@react-navigation|@unimodules|unimodules|sentry-expo|native-base|react-native-svg|react-native-motion-activity-tracker|@tensorflow/tfjs-react-native|@tensorflow/tfjs)',
  ],
  moduleNameMapper: {
    '\\.bin$': '<rootDir>/tests/binaryMock.js'
  },
  setupFiles: ['./tests/setup.js'],
};
