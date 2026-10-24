module.exports = {
  // Off C: (disk rule): the cache lives in mobile/.jest-cache, ignored by Git.
  cacheDirectory: '<rootDir>/../../.jest-cache',
  preset: '@react-native/jest-preset',
  testMatch: ['<rootDir>/__tests__/**/*.test.ts?(x)'],
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|react-native-svg|react-native-safe-area-context|@op-engineering|@zed)/)',
  ],
  setupFiles: ['<rootDir>/__tests__/helpers/setup.ts'],
};
