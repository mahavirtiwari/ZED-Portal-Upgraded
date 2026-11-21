import React, { useState } from 'react';
import { ToastAndroid } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppTexts } from '../src/content/appTexts';
import { AppTextsProvider } from '../src/content/AppTextsContext';
import { setZedDeviceForTesting } from '../src/native';
import { appendDictation, resetSpeechAvailabilityForTesting } from '../src/speech/dictation';
import { TextField } from '../src/ui/components/Form';
import { UiHost } from '../src/ui/UiHost';

type Fake = { available: boolean; heard: Array<string | null | Error>; calls: Array<[string, string | null]> };

function installDevice(fake: Fake) {
  resetSpeechAvailabilityForTesting();
  setZedDeviceForTesting({
    isSpeechAvailable: () => fake.available,
    recognizeSpeech: async (language: string, prompt: string | null) => {
      fake.calls.push([language, prompt]);
      const next = fake.heard.shift() ?? null;
      if (next instanceof Error) throw next;
      return next;
    },
  } as never);
}

function Box({ initial = '', max, disabled }: { initial?: string; max?: number; disabled?: boolean }) {
  const [v, setV] = useState(initial);
  return <TextField label="Remarks" value={v} onChange={setV} multiline maxLength={max} disabled={disabled} testID="remarks" />;
}

function mount(node: React.ReactElement, texts?: AppTexts) {
  let r!: ReactTestRenderer.ReactTestRenderer;
  const inner = texts ? (
    <AppTextsProvider texts={texts} app="app.msme">
      {node}
    </AppTextsProvider>
  ) : (
    node
  );
  act(() => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <UiHost>{inner}</UiHost>
      </SafeAreaProvider>,
    );
  });
  return r;
}

const mic = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll(n => n.props.testID === 'remarks-voice' && typeof n.props.onPress === 'function');
const boxValue = (r: ReactTestRenderer.ReactTestRenderer) => r.root.findAll(n => n.props.testID === 'remarks' && n.props.value !== undefined)[0]!.props.value;

afterEach(() => {
  setZedDeviceForTesting(null);
  resetSpeechAvailabilityForTesting();
  jest.restoreAllMocks();
});

describe('voice typing: adding the words heard', () => {
  it('starts the box with a capital, adds after a space, and a new sentence with a capital', () => {
    expect(appendDictation('', 'machine is calibrated')).toEqual({ text: 'Machine is calibrated', cut: false });
    expect(appendDictation('Machine', 'is calibrated')).toEqual({ text: 'Machine is calibrated', cut: false });
    expect(appendDictation('Checked. ', 'all good')).toEqual({ text: 'Checked. All good', cut: false });
    expect(appendDictation('Checked.', 'all good')).toEqual({ text: 'Checked. All good', cut: false });
    expect(appendDictation('Line one\n', 'next')).toEqual({ text: 'Line one\nnext', cut: false });
    expect(appendDictation('Keep', '   ')).toEqual({ text: 'Keep', cut: false });
  });

  it('cuts to the box limit and says so', () => {
    expect(appendDictation('abc', 'defgh', 7)).toEqual({ text: 'abc def', cut: true });
    expect(appendDictation('abcdefg', 'more', 7)).toEqual({ text: 'abcdefg', cut: true });
    expect(appendDictation('abc', 'de', 6)).toEqual({ text: 'abc de', cut: false });
  });
});

describe('voice typing: the mic of a comment box', () => {
  it('is hidden without a speech service, without the native part, and on a read-only box', () => {
    installDevice({ available: false, heard: [], calls: [] });
    expect(mic(mount(<Box />))).toHaveLength(0);
    setZedDeviceForTesting({} as never);
    resetSpeechAvailabilityForTesting();
    expect(mic(mount(<Box />))).toHaveLength(0);
    installDevice({ available: true, heard: [], calls: [] });
    expect(mic(mount(<Box disabled />))).toHaveLength(0);
  });

  it('a tap listens in English (India), a long press in Hindi; the words are added to the box', async () => {
    const fake: Fake = { available: true, heard: ['all machines calibrated', 'सब ठीक है'], calls: [] };
    installDevice(fake);
    const r = mount(<Box initial="Checked." />);
    expect(mic(r)).toHaveLength(1);
    await act(async () => mic(r)[0]!.props.onPress());
    expect(boxValue(r)).toBe('Checked. All machines calibrated');
    await act(async () => mic(r)[0]!.props.onLongPress());
    expect(boxValue(r)).toBe('Checked. All machines calibrated सब ठीक है');
    expect(fake.calls).toEqual([
      ['en-IN', 'Speak now'],
      ['hi-IN', 'Speak now'],
    ]);
  });

  it("uses the Admin's texts of the app, tells when the words were cut, and when the phone cannot listen", async () => {
    const toast = jest.spyOn(ToastAndroid, 'show').mockImplementation(() => undefined);
    const fake: Fake = { available: true, heard: ['one two three', Object.assign(new Error('x'), { code: 'SPEECH_UNAVAILABLE' }), null], calls: [] };
    installDevice(fake);
    const texts = new AppTexts(null, {});
    await texts.refresh(async () => ({ status: '1', texts: [{ key: 'app.msme.voice.prompt', enabled: true, html: 'Boliye' }] }));
    const r = mount(<Box initial="abc" max={8} />, texts);
    await act(async () => mic(r)[0]!.props.onPress());
    expect(boxValue(r)).toBe('abc one');
    expect(toast).toHaveBeenLastCalledWith('Only part of what you said was added: this box takes up to 8 characters.', ToastAndroid.LONG);
    await act(async () => mic(r)[0]!.props.onPress());
    expect(toast).toHaveBeenLastCalledWith(expect.stringContaining('Voice typing is not available on this phone'), ToastAndroid.LONG);
    await act(async () => mic(r)[0]!.props.onPress());
    expect(boxValue(r)).toBe('abc one');
    expect(fake.calls[0]).toEqual(['en-IN', 'Boliye']);
  });
});
