import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { AppErrorBoundary, AppStartError } from '../src/ui/components/AppStart';

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => n.type === Text).map(n => [n.props.children].flat().join(''));
const retry = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress();

describe('app start errors (new in V4)', () => {
  it('AppStartError says the app could not start and RETRY calls back', () => {
    const onRetry = jest.fn();
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(<AppStartError onRetry={onRetry} />);
    });
    expect(texts(r)).toContain('The app could not start');
    act(() => retry(r, 'app-start-error-retry'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('AppErrorBoundary shows the error page when a screen fails and draws the app again on RETRY', () => {
    let fail = true;
    function Screen() {
      if (fail) throw new Error('boom');
      return <Text>screen</Text>;
    }
    const onError = jest.fn();
    const spy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <AppErrorBoundary onError={onError}>
          <Screen />
        </AppErrorBoundary>,
      );
    });
    expect(r.root.findAll(n => n.props.testID === 'app-error').length).toBeGreaterThan(0);
    expect(onError).toHaveBeenCalled();

    fail = false;
    act(() => retry(r, 'app-error-retry'));
    expect(texts(r)).toContain('screen');
    spy.mockRestore();
  });
});
