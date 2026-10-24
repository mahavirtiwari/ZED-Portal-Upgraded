jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true })), addEventListener: jest.fn(() => () => undefined) },
}));
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
