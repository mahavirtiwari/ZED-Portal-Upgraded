import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
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
  pickItem(title: string | null, items: string[]): Promise<number | null>;
  /** SelectionPickerInputHelper dialog: items + OK/Cancel; resolves the item index, -1 for OK without choice, null for cancel. */
  pickOne(title: string, items: string[]): Promise<number | null>;
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
  | { kind: 'items'; title: string | null; items: string[]; resolve: (i: number | null) => void }
  | { kind: 'one'; title: string; items: string[]; resolve: (i: number | null) => void }
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
      pickItem(title, items) {
        return new Promise(resolve => setDialog({ kind: 'items', title, items, resolve }));
      },
      pickOne(title, items) {
        return new Promise(resolve => setDialog({ kind: 'one', title, items, resolve }));
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
          <View style={styles.customScrim}>{customDialog.render(() => setCustomDialog(null))}</View>
        </Modal>
      )}
    </UiContext.Provider>
  );
}

function ItemsDialogView({ dialog, close }: { dialog: ItemsDialog; close: () => void }) {
  const [checked, setChecked] = useState<number[]>(dialog.kind === 'many' ? dialog.checked : []);
  const [, setChosen] = useState<number>(-1);
  const chosenRef = useRef(-1);

  const dismiss = useCallback(() => {
    close();
    if (dialog.kind === 'many') dialog.resolve(null);
    else dialog.resolve(null);
  }, [close, dialog]);

  return (
    <Modal transparent animationType="fade" visible onRequestClose={dismiss}>
      <Pressable style={styles.scrim} onPress={dismiss}>
        <Pressable style={styles.dialog} onPress={() => undefined}>
          {dialog.title ? <Text style={styles.dialogTitle}>{dialog.title}</Text> : null}
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
                style={styles.button}
                onPress={() => {
                  close();
                  if (dialog.kind === 'many') dialog.resolve(checked);
                  else dialog.resolve(chosenRef.current);
                }}>
                <Text style={styles.buttonText}>OK</Text>
              </Pressable>
            </View>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
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
});
