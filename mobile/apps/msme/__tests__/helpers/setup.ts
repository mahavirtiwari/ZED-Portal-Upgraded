jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { fetch: jest.fn(async () => ({ isConnected: true })), addEventListener: jest.fn(() => () => undefined) },
}));
jest.mock('@op-engineering/op-sqlite', () => ({ open: jest.fn() }));
jest.mock('react-native-svg', () => {
  const React = require('react');
  const C = (name: string) => (props: Record<string, unknown>) => React.createElement(name, props, props.children);
  return { __esModule: true, default: C('Svg'), Svg: C('Svg'), Path: C('Path'), G: C('G'), Defs: C('Defs'), ClipPath: C('ClipPath'), LinearGradient: C('LinearGradient'), Stop: C('Stop'), Rect: C('Rect') };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaProvider: ({ children }: { children: unknown }) => children,
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
// The app runs on React Native's FormData ({uri, name, type} file parts); Jest would use Node's.
// eslint-disable-next-line @typescript-eslint/no-var-requires
(global as unknown as { FormData: unknown }).FormData = require('react-native/Libraries/Network/FormData').default;
