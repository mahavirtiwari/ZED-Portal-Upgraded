import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { useBrandTheme } from '../../branding/AppBrandingContext';
import { useSharedAppText } from '../../content/AppTextsContext';
import { appendDictation, dictate, DICTATION_ENGLISH, DICTATION_HINDI, speechAvailable } from '../../speech/dictation';
import { colors } from '../theme';
import { useUi } from '../UiHost';
import { htmlToPlain } from './HtmlText';
import { Icon, type IconDefinition } from './Icon';

/** Material "mic" (baseline_mic_24). */
export const MIC_ICON: IconDefinition = {
  width: 24,
  height: 24,
  viewBox: [0, 0, 24, 24],
  paths: [
    {
      d: 'M12,14c1.66,0 2.99,-1.34 2.99,-3L15,5c0,-1.66 -1.34,-3 -3,-3S9,3.34 9,5v6c0,1.66 1.34,3 3,3zM17.3,11c0,3 -2.54,5.1 -5.3,5.1S6.7,14 6.7,11L5,11c0,3.41 2.72,6.23 6,6.72L11,21h2v-3.28c3.28,-0.48 6,-3.3 6,-6.72h-1.7z',
      fill: '#000000',
    },
  ],
};

/** The texts of voice typing (Admin → Texts, `<app>.voice.*`), with the standard wording. */
export const VOICE_TEXTS = {
  button: 'Speak to type (hold for Hindi)',
  prompt: 'Speak now',
  unavailable: 'Voice typing is not available on this phone. Please turn on the Google voice typing service and try again.',
  failed: 'Voice typing could not start, please try again.',
  cut: 'Only part of what you said was added: this box takes up to {{Max}} characters.',
} as const;

function plain(t: { html: string } | null): string {
  return t ? htmlToPlain(t.html).trim() : '';
}

type Props = {
  value: string;
  onChangeText: (text: string) => void;
  /** The box's character limit: the words heard are cut to it. */
  maxLength?: number | null;
  disabled?: boolean;
  /** The icon colour; defaults to the dark app colour (the Admin's when set). */
  color?: string;
  size?: number;
  style?: StyleProp<ViewStyle>;
  /** `<testID>-voice` */
  testID?: string;
};

/**
 * The mic button of a comment box: a tap listens in English (India), a long press in Hindi; the words heard are added
 * to the box (see appendDictation). Not shown on phones without a speech service, or while the box is read-only.
 */
export function VoiceInputButton({ value, onChangeText, maxLength, disabled, color, size = 22, style, testID }: Props) {
  const ui = useUi();
  const theme = useBrandTheme();
  const [busy, setBusy] = useState(false);
  // The box may change while the dialog is open (it does not, but the latest value is what the words are added to).
  const latest = useRef(value);
  latest.current = value;
  const label = plain(useSharedAppText('voice.button', VOICE_TEXTS.button)) || VOICE_TEXTS.button;
  const prompt = plain(useSharedAppText('voice.prompt', VOICE_TEXTS.prompt));
  const unavailable = plain(useSharedAppText('voice.unavailable', VOICE_TEXTS.unavailable)) || VOICE_TEXTS.unavailable;
  const failed = plain(useSharedAppText('voice.failed', VOICE_TEXTS.failed)) || VOICE_TEXTS.failed;
  const cut = plain(useSharedAppText('voice.cut', VOICE_TEXTS.cut, { Max: maxLength ?? '' })) || VOICE_TEXTS.cut.replace('{{Max}}', String(maxLength ?? ''));

  if (disabled || !speechAvailable()) return null;

  const listen = async (language: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const heard = await dictate(language, prompt || null);
      if (heard) {
        const r = appendDictation(latest.current, heard, maxLength);
        if (r.text !== latest.current) onChangeText(r.text);
        if (r.cut) ui.toast(cut, { long: true });
      }
    } catch (e) {
      const code = (e as { code?: string } | null)?.code;
      if (code !== 'BUSY') ui.toast(code === 'SPEECH_UNAVAILABLE' ? unavailable : failed, { long: true });
    } finally {
      setBusy(false);
    }
  };

  const tint = color ?? theme?.dark ?? colors.appColorDark;
  return (
    <Pressable
      onPress={() => void listen(DICTATION_ENGLISH)}
      onLongPress={() => void listen(DICTATION_HINDI)}
      disabled={busy}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}
      testID={testID ? `${testID}-voice` : 'voice-input'}>
      <View style={[styles.circle, { borderColor: tint }]}>
        {busy ? <ActivityIndicator size="small" color={tint} /> : <Icon icon={MIC_ICON} size={size} tint={tint} />}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: { alignSelf: 'flex-start', padding: 6 },
  pressed: { opacity: 0.6 },
  circle: { width: 36, height: 36, borderRadius: 18, borderWidth: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
});
