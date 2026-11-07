import React from 'react';
import { Text } from 'react-native';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { UiHost, useUi, type Ui } from '../src/ui/UiHost';

const texts = (r: ReactTestRenderer.ReactTestRenderer) =>
  r.root.findAll(n => n.type === Text).map(n => [n.props.children].flat().join(''));
const press = (r: ReactTestRenderer.ReactTestRenderer, id: string) =>
  r.root.findAll(n => n.props.testID === id && typeof n.props.onPress === 'function')[0]!.props.onPress();
const pressText = (r: ReactTestRenderer.ReactTestRenderer, label: string) =>
  r.root
    .findAll(n => typeof n.props.onPress === 'function' && n.findAll(c => c.type === Text && [c.props.children].flat().join('') === label).length > 0)
    .at(-1)!
    .props.onPress();

function mount(): { r: ReactTestRenderer.ReactTestRenderer; ui: () => Ui } {
  let ui!: Ui;
  function Grab() {
    ui = useUi();
    return null;
  }
  let r!: ReactTestRenderer.ReactTestRenderer;
  act(() => {
    r = ReactTestRenderer.create(
      <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 760 }, insets: { top: 0, left: 0, right: 0, bottom: 0 } }}>
        <UiHost>
          <Grab />
        </UiHost>
      </SafeAreaProvider>,
    );
  });
  return { r, ui: () => ui };
}

describe('pop-ups (2026-11-07 design)', () => {
  it('the photo source is a bottom sheet: title, line, hints, and Cancel as a button that resolves its index', async () => {
    const { r, ui } = mount();
    let picked: Promise<number | null>;
    act(() => {
      picked = ui().pickItem('Add document', ['Take Photo', 'Pick Photo from Gallery', 'Pick PDF from Gallery', 'Cancel'], {
        subtitle: 'Choose how to add this evidence',
        icons: ['camera', 'gallery', 'pdf', null],
        hints: ['Use the camera now', 'JPG or PNG', 'One PDF file', null],
        cancelIndex: 3,
      });
    });
    expect(r.root.findAll(n => n.props.testID === 'pick-sheet').length).toBeGreaterThan(0);
    expect(texts(r)).toEqual(expect.arrayContaining(['Add document', 'Choose how to add this evidence', 'Use the camera now', 'One PDF file', 'Cancel']));
    act(() => press(r, 'pick-item-2'));
    await expect(picked!).resolves.toBe(2);

    act(() => {
      picked = ui().pickItem('Add document', ['Take Photo', 'Cancel'], { cancelIndex: 1 });
    });
    act(() => press(r, 'pick-item-1'));
    await expect(picked!).resolves.toBe(1);
  });

  it('the "Pick" list shows the field, starts on the current value, marks a tap and returns it on OK', async () => {
    const { r, ui } = mount();
    let picked: Promise<number | null>;
    act(() => {
      picked = ui().pickOne('Select one', ['Kilogram', 'Litre', 'Meter'], { subtitle: 'Monthly manufacturing capacity', selected: 1 });
    });
    expect(texts(r)).toEqual(expect.arrayContaining(['Select one', 'Monthly manufacturing capacity']));
    const selected = () => r.root.findAll(n => typeof n.props.testID === 'string' && n.props.testID.startsWith('pick-item-') && n.props.accessibilityState?.selected === true && typeof n.props.onPress === 'function').map(n => n.props.testID);
    expect(selected()).toEqual(['pick-item-1']);
    act(() => press(r, 'pick-item-2'));
    expect(selected()).toEqual(['pick-item-2']);
    act(() => pressText(r, 'OK'));
    await expect(picked!).resolves.toBe(2);

    // Without a current value, OK alone still answers -1 (the field keeps its value).
    act(() => {
      picked = ui().pickOne('Select one', ['Kilogram', 'Litre']);
    });
    act(() => pressText(r, 'OK'));
    await expect(picked!).resolves.toBe(-1);
  });
});
