import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Dimensions,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  ToastAndroid,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, dimens } from './theme';
import { Icon, type IconDefinition } from './components/Icon';
import { sharedIcons } from './sharedIcons';

export type SheetIcon = 'camera' | 'gallery' | 'pdf';

/** Icons of the bottom sheet's options (2026-11-07). Material Design paths. */
const SHEET_ICONS: Record<SheetIcon, IconDefinition> = {
  camera: {
    viewBox: [0, 0, 24, 24],
    paths: [
      { d: 'M12,15.2A3.2,3.2 0,1 1,12 8.8a3.2,3.2 0,0 1,0 6.4z', fill: '#000000' },
      {
        d: 'M9,2L7.17,4H4c-1.1,0 -2,0.9 -2,2v12c0,1.1 0.9,2 2,2h16c1.1,0 2,-0.9 2,-2V6c0,-1.1 -0.9,-2 -2,-2h-3.17L15,2H9zM12,17c-2.76,0 -5,-2.24 -5,-5s2.24,-5 5,-5 5,2.24 5,5 -2.24,5 -5,5z',
        fill: '#000000',
      },
    ],
  },
  gallery: {
    viewBox: [0, 0, 24, 24],
    paths: [{ d: 'M21,19V5c0,-1.1 -0.9,-2 -2,-2H5c-1.1,0 -2,0.9 -2,2v14c0,1.1 0.9,2 2,2h14c1.1,0 2,-0.9 2,-2zM8.5,13.5l2.5,3.01L14.5,12l4.5,6H5l3.5,-4.5z', fill: '#000000' }],
  },
  pdf: sharedIcons.ic_baseline_picture_as_pdf_18,
};

/** pickItem as a bottom sheet (2026-11-07): a line under the title, and per option an icon and a hint; the cancel option is a button. */
export type SheetOptions = {
  subtitle?: string;
  icons?: Array<SheetIcon | null>;
  hints?: Array<string | null>;
  /** The option drawn as the Cancel button at the bottom (it resolves its index, as before). */
  cancelIndex?: number;
};

/**
 * The legacy BaseActivity/BaseFragment helpers as one provider: the "Please Wait" loading overlay (touches blocked),
 * Toast, Snackbar, AlertDialog (native, via Alert) and the item / multi-choice AlertDialogs (setItems,
 * setMultiChoiceItems) that Alert cannot show.
 */
export const PLEASE_WAIT = 'Please Wait';

export type AlertButton = { text: string; onPress?: () => void; style?: 'default' | 'cancel' | 'destructive' };

export type Ui = {
  showLoading(text?: string): void;
  updateLoadingText(text: string): void;
  hideLoading(): void;
  readonly isLoading: boolean;
  /** Toast.LENGTH_LONG (activities) or LENGTH_SHORT centred (fragments' showToast). */
  toast(message: string, options?: { long?: boolean; center?: boolean }): void;
  snackbar(message: string, options?: { long?: boolean }): void;
  /**
   * AlertDialog. Buttons as Android shows them: [neutral?, negative?, positive] in Alert order
   * (Alert.alert puts the last button on the right, i.e. positive).
   */
  alert(title: string | null, message: string | null, buttons?: AlertButton[], cancelable?: boolean, onDismiss?: () => void): void;
  /** BaseActivity.showAlert(title?, message, onOk): OK button, not cancelable. */
  showAlert(message: string | null, title?: string | null, onOk?: () => void): void;
  /** AlertDialog.setItems: resolves the chosen index, or null when dismissed. */
  pickItem(title: string | null, items: string[], sheet?: SheetOptions): Promise<number | null>;
  /**
   * SelectionPickerInputHelper dialog: items + OK/Cancel; resolves the item index, -1 for OK without choice, null for cancel.
   * 2026-11-07: a line under the title (the field) and the current choice shown selected.
   */
  pickOne(title: string, items: string[], options?: { subtitle?: string | null; selected?: number }): Promise<number | null>;
  /** MultiSelectionInputHelper dialog: resolves the checked indexes in click order, or null for Cancel. */
  pickMany(title: string, items: string[], checked: number[]): Promise<number[] | null>;
  /**
   * An AlertDialog with its own view (setView): `render` gets `close`; the back button closes it too and calls
   * `onBack` (the dialog's negative button, usually).
   */
  custom(render: (close: () => void) => React.ReactNode, onBack?: () => void): void;
};

const UiContext = createContext<Ui | null>(null);

export function useUi(): Ui {
  const ui = useContext(UiContext);
  if (!ui) throw new Error('useUi must be used inside <UiHost>');
  return ui;
}

type ItemsDialog =
  | { kind: 'items'; title: string | null; items: string[]; sheet?: SheetOptions; resolve: (i: number | null) => void }
  | { kind: 'one'; title: string; items: string[]; subtitle?: string | null; selected?: number; resolve: (i: number | null) => void }
  | { kind: 'many'; title: string; items: string[]; checked: number[]; resolve: (i: number[] | null) => void };

export function UiHost({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState<string | null>(null);
  const [snack, setSnack] = useState<string | null>(null);
  const [dialog, setDialog] = useState<ItemsDialog | null>(null);
  const [customDialog, setCustomDialog] = useState<{ render: (close: () => void) => React.ReactNode; onBack?: () => void } | null>(null);
  const snackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const insets = useSafeAreaInsets();
  const loadingRef = useRef(false);

  const ui = useMemo<Ui>(
    () => ({
      showLoading(text) {
        Keyboard.dismiss();
        loadingRef.current = true;
        setLoading(text ?? PLEASE_WAIT);
      },
      updateLoadingText(text) {
        setLoading(l => (l == null ? l : text));
      },
      hideLoading() {
        loadingRef.current = false;
        setLoading(null);
      },
      get isLoading() {
        return loadingRef.current;
      },
      toast(message, options) {
        const duration = options?.long ? ToastAndroid.LONG : ToastAndroid.SHORT;
        if (options?.center) ToastAndroid.showWithGravity(message, duration, ToastAndroid.CENTER);
        else ToastAndroid.show(message, duration);
      },
      snackbar(message, options) {
        if (snackTimer.current) clearTimeout(snackTimer.current);
        setSnack(message);
        snackTimer.current = setTimeout(() => setSnack(null), options?.long ? 2750 : 1500);
      },
      alert(title, message, buttons, cancelable = true, onDismiss) {
        Alert.alert(title ?? '', message ?? '', buttons, { cancelable, onDismiss });
      },
      showAlert(message, title, onOk) {
        Alert.alert(title ?? '', message ?? '', [{ text: 'OK', onPress: onOk }], { cancelable: false });
      },
      pickItem(title, items, sheet) {
        return new Promise(resolve => setDialog({ kind: 'items', title, items, sheet, resolve }));
      },
      pickOne(title, items, options) {
        return new Promise(resolve => setDialog({ kind: 'one', title, items, subtitle: options?.subtitle, selected: options?.selected, resolve }));
      },
      pickMany(title, items, checked) {
        return new Promise(resolve => setDialog({ kind: 'many', title, items, checked: [...checked], resolve }));
      },
      custom(render, onBack) {
        setCustomDialog({ render, onBack });
      },
    }),
    [],
  );

  // While loading, the hardware back button does nothing (BaseActivity.canGoBack).
  React.useEffect(() => {
    if (loading == null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => true);
    return () => sub.remove();
  }, [loading]);

  return (
    <UiContext.Provider value={ui}>
      <View style={styles.fill}>
        {children}
        {snack != null && (
          <View style={[styles.snackbar, { bottom: 8 + insets.bottom }]} pointerEvents="none" testID="snackbar">
            <Text style={styles.snackbarText}>{snack}</Text>
          </View>
        )}
        {loading != null && (
          <View style={styles.loading} testID="loading-indicator">
            <ActivityIndicator size="large" color={colors.white} style={{ padding: dimens.padding2 }} />
            <Text style={styles.loadingText}>{loading}</Text>
          </View>
        )}
      </View>
      {dialog && <ItemsDialogView dialog={dialog} close={() => setDialog(null)} />}
      {customDialog && (
        <Modal
          transparent
          animationType="fade"
          visible
          onRequestClose={() => {
            setCustomDialog(null);
            customDialog.onBack?.();
          }}>
          <KeyboardRoom>{customDialog.render(() => setCustomDialog(null))}</KeyboardRoom>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

function ItemsDialogView({ dialog, close }: { dialog: ItemsDialog; close: () => void }) {
  const [checked, setChecked] = useState<number[]>(dialog.kind === 'many' ? dialog.checked : []);
  const initial = dialog.kind === 'one' && dialog.selected != null && dialog.selected >= 0 ? dialog.selected : -1;
  const [chosen, setChosen] = useState<number>(initial);
  const chosenRef = useRef(initial);
  const insets = useSafeAreaInsets();

  const dismiss = useCallback(() => {
    close();
    if (dialog.kind === 'many') dialog.resolve(null);
    else dialog.resolve(null);
  }, [close, dialog]);

  if (dialog.kind === 'items' && dialog.sheet) {
    const { sheet } = dialog;
    const choose = (i: number) => {
      close();
      dialog.resolve(i);
    };
    return (
      <Modal transparent animationType="slide" visible onRequestClose={dismiss}>
        <Pressable style={styles.sheetScrim} onPress={dismiss}>
          <Pressable style={[styles.sheet, { paddingBottom: 16 + insets.bottom }]} onPress={() => undefined} testID="pick-sheet">
            <View style={styles.grab} />
            {dialog.title ? <Text style={styles.sheetTitle}>{dialog.title}</Text> : null}
            {sheet.subtitle ? <Text style={styles.sheetSubtitle}>{sheet.subtitle}</Text> : null}
            {dialog.items.map((item, i) => {
              if (i === sheet.cancelIndex) return null;
              const icon = sheet.icons?.[i];
              const hint = sheet.hints?.[i];
              return (
                <Pressable key={i} style={styles.sheetRow} onPress={() => choose(i)} testID={`pick-item-${i}`} android_ripple={{ color: '#E3F3F4' }}>
                  {icon ? (
                    <View style={[styles.sheetIcon, icon === 'pdf' && styles.sheetIconPdf]}>
                      <Icon icon={SHEET_ICONS[icon]} size={22} tint={icon === 'pdf' ? '#A32D2D' : colors.appColorDark} />
                    </View>
                  ) : null}
                  <View style={styles.fill}>
                    <Text style={styles.sheetLabel}>{item}</Text>
                    {hint ? <Text style={styles.sheetHint}>{hint}</Text> : null}
                  </View>
                </Pressable>
              );
            })}
            {sheet.cancelIndex != null && dialog.items[sheet.cancelIndex] != null ? (
              <Pressable style={styles.sheetCancel} onPress={() => choose(sheet.cancelIndex!)} testID={`pick-item-${sheet.cancelIndex}`}>
                <Text style={styles.sheetCancelText}>{dialog.items[sheet.cancelIndex]}</Text>
              </Pressable>
            ) : null}
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  const one = dialog.kind === 'one';
  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <Pressable style={styles.scrim} onPress={dismiss}>
        <Pressable style={[styles.dialog, one && styles.dialogRound]} onPress={() => undefined}>
          {dialog.title ? <Text style={[styles.dialogTitle, one && styles.dialogTitleOne]}>{dialog.title}</Text> : null}
          {dialog.kind === 'one' && dialog.subtitle ? <Text style={styles.dialogSubtitle}>{dialog.subtitle}</Text> : null}
          <ScrollView style={{ maxHeight: 420 }}>
            {dialog.items.map((item, i) => {
              if (dialog.kind === 'many') {
                const on = checked.includes(i);
                return (
                  <Pressable
                    key={i}
                    style={styles.itemRow}
                    onPress={() => setChecked(c => (on ? c.filter(x => x !== i) : [...c, i]))}
                    testID={`pick-item-${i}`}>
                    <View style={[styles.checkbox, on && styles.checkboxOn]}>{on ? <Text style={styles.tick}>✓</Text> : null}</View>
                    <Text style={styles.itemText}>{item}</Text>
                  </Pressable>
                );
              }
              if (one) {
                // A tap marks the choice and OK confirms it (as before); now a radio row, tinted when chosen.
                const on = chosen === i;
                return (
                  <Pressable
                    key={i}
                    style={[styles.itemRow, styles.oneRow, on && styles.oneRowOn]}
                    testID={`pick-item-${i}`}
                    accessibilityState={{ selected: on }}
                    onPress={() => {
                      chosenRef.current = i;
                      setChosen(i);
                    }}>
                    <View style={[styles.radio, on && styles.radioOn]}>{on ? <View style={styles.radioDot} /> : null}</View>
                    <Text style={[styles.itemText, on && styles.oneTextOn]}>{item}</Text>
                  </Pressable>
                );
              }
              return (
                <Pressable
                  key={i}
                  style={styles.itemRow}
                  testID={`pick-item-${i}`}
                  onPress={() => {
                    // setItems: a tap chooses and closes the dialog.
                    chosenRef.current = i;
                    setChosen(i);
                    close();
                    dialog.resolve(i);
                  }}>
                  <Text style={styles.itemText}>{item}</Text>
                </Pressable>
              );
            })}
          </ScrollView>
          {dialog.kind !== 'items' && (
            <View style={styles.buttons}>
              <Pressable onPress={dismiss} style={styles.button}>
                <Text style={styles.buttonText}>CANCEL</Text>
              </Pressable>
              <Pressable
                style={[styles.button, one && styles.buttonFilled]}
                onPress={() => {
                  close();
                  if (dialog.kind === 'many') dialog.resolve(checked);
                  else dialog.resolve(chosenRef.current);
                }}>
                <Text style={[styles.buttonText, one && styles.buttonFilledText]}>OK</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * The custom dialog's scrim, kept above the on-screen keyboard: apps that draw edge to edge (Android 15 and later) are no
 * longer resized for it (adjustResize), so a dialog's field and buttons would sit under the keyboard.
 */
/** How much of the screen the open keyboard covers (0 when closed); with edge to edge, nothing resizes for it. */
export function useKeyboardInset(): number {
  const [keyboard, setKeyboard] = useState(0);
  useEffect(() => {
    // From the keyboard's top edge to the bottom of the screen: the reported height leaves out the navigation bar.
    const show = Keyboard.addListener('keyboardDidShow', e =>
      setKeyboard(Math.max(e.endCoordinates.height, Dimensions.get('screen').height - e.endCoordinates.screenY)),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboard(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return keyboard;
}

function KeyboardRoom({ children }: { children: React.ReactNode }) {
  const keyboard = useKeyboardInset();
  return <View style={[styles.customScrim, keyboard ? { paddingBottom: keyboard } : null]}>{children}</View>;
}

const styles = StyleSheet.create({
  customScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center' },
  fill: { flex: 1 },
  loading: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.appColor90,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  loadingText: { color: colors.white, fontSize: dimens.textSize2, fontWeight: 'bold', padding: dimens.padding1 },
  snackbar: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    backgroundColor: '#323232',
    borderRadius: 4,
    paddingHorizontal: 16,
    paddingVertical: 14,
    elevation: 6,
  },
  snackbarText: { color: colors.white, fontSize: 14 },
  scrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.32)', justifyContent: 'center', padding: 24 },
  dialog: { backgroundColor: colors.white, borderRadius: 4, paddingVertical: 12, elevation: 24 },
  dialogTitle: { fontSize: 20, fontWeight: '500', color: colors.black, paddingHorizontal: 24, paddingVertical: 12 },
  itemRow: { flexDirection: 'row', alignItems: 'center', minHeight: 48, paddingHorizontal: 24 },
  itemText: { fontSize: 16, color: colors.black, flexShrink: 1 },
  checkbox: {
    width: 20,
    height: 20,
    borderWidth: 2,
    borderColor: '#757575',
    borderRadius: 2,
    marginRight: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.appColorSecondary, borderColor: colors.appColorSecondary },
  tick: { color: colors.black, fontSize: 14, lineHeight: 16 },
  buttons: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 8, paddingTop: 8 },
  button: { paddingHorizontal: 12, paddingVertical: 10, marginLeft: 8 },
  buttonText: { color: colors.appColor, fontWeight: '500', fontSize: 14 },
  // The single-choice "Pick" dialog (2026-11-07).
  dialogRound: { borderRadius: 16 },
  dialogTitleOne: { fontSize: 18, paddingHorizontal: 20, paddingBottom: 2 },
  dialogSubtitle: { fontSize: 13, color: '#5F5E5A', paddingHorizontal: 20, paddingBottom: 8 },
  oneRow: { paddingHorizontal: 20 },
  oneRowOn: { backgroundColor: '#E3F3F4' },
  oneTextOn: { color: '#1F5C61', fontWeight: '600' },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: '#888780', marginRight: 14, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.appColor },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.appColor },
  buttonFilled: { backgroundColor: colors.appColor, borderRadius: 18, paddingHorizontal: 22 },
  buttonFilledText: { color: colors.white },
  // The bottom sheet (pickItem with sheet options).
  sheetScrim: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.white, borderTopLeftRadius: 18, borderTopRightRadius: 18, paddingHorizontal: 16, paddingTop: 10, elevation: 24 },
  grab: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#D3D1C7', alignSelf: 'center', marginBottom: 12 },
  sheetTitle: { fontSize: 17, fontWeight: '600', color: '#2C2C2A' },
  sheetSubtitle: { fontSize: 13, color: '#5F5E5A', marginTop: 2, marginBottom: 6 },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E5E0',
  },
  sheetIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#E3F3F4', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  sheetIconPdf: { backgroundColor: '#FCEBEB' },
  sheetLabel: { fontSize: 15, fontWeight: '500', color: '#2C2C2A' },
  sheetHint: { fontSize: 12, color: '#5F5E5A', marginTop: 1 },
  sheetCancel: { marginTop: 14, borderWidth: 1, borderColor: colors.appColor, borderRadius: 22, paddingVertical: 11, alignItems: 'center' },
  sheetCancelText: { color: colors.appColorDark, fontSize: 15, fontWeight: '600' },
});
