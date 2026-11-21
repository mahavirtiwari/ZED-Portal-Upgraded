import React, { useState } from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { resetSpeechAvailabilityForTesting, setZedDeviceForTesting, UiHost } from '@zed/shared';
import { Field } from '../src/ui/zed';

/** 2026-11-21: voice typing in the comment boxes (the shared mic in the app's Field). */
describe('voice typing in the assessor app', () => {
  afterEach(() => {
    setZedDeviceForTesting(null);
    resetSpeechAvailabilityForTesting();
  });

  function mount(node: React.ReactElement) {
    let r!: ReactTestRenderer.ReactTestRenderer;
    act(() => {
      r = ReactTestRenderer.create(
        <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
          <UiHost>{node}</UiHost>
        </SafeAreaProvider>,
      );
    });
    return r;
  }

  it('a box that saves when left (scheme visit remarks) saves the words heard, with the new text', async () => {
    resetSpeechAvailabilityForTesting();
    setZedDeviceForTesting({ isSpeechAvailable: () => true, recognizeSpeech: async () => 'documents verified on site' } as never);
    const saved: string[] = [];
    function Remarks() {
      const [v, setV] = useState('Visit done.');
      return <Field value={v} onChangeText={setV} onBlur={() => saved.push(v)} multiline maxLength={1000} testID="scheme-remarks" />;
    }
    const r = mount(<Remarks />);
    const mic = r.root.findAll(n => n.props.testID === 'scheme-remarks-voice' && typeof n.props.onPress === 'function');
    expect(mic).toHaveLength(1);
    await act(async () => mic[0]!.props.onPress());
    expect(saved).toEqual(['Visit done. Documents verified on site']);
  });

  it('single-line and read-only boxes have no mic', () => {
    resetSpeechAvailabilityForTesting();
    setZedDeviceForTesting({ isSpeechAvailable: () => true, recognizeSpeech: async () => null } as never);
    const r = mount(
      <>
        <Field value="" onChangeText={() => undefined} testID="name" />
        <Field value="" onChangeText={() => undefined} multiline editable={false} testID="locked" />
      </>,
    );
    expect(r.root.findAll(n => typeof n.props.testID === 'string' && n.props.testID.endsWith('-voice'))).toHaveLength(0);
  });
});
