module.exports = {
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: ['node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-svg|react-native-safe-area-context|@op-engineering)/)'],
  setupFiles: ['<rootDir>/__tests__/helpers/setup.ts'],
};
