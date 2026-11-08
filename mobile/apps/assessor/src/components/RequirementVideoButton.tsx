import React from 'react';
import { Linking, Pressable, StyleSheet, Text, type StyleProp, type ViewStyle } from 'react-native';
import { useUi } from '@zed/shared';
import { C } from '../ui/zed';

/** The Admin's requirement video, when set and a web address (http/https); else null (no button). */
export function requirementVideoUrl(url: string | null | undefined): string | null {
  const u = (url ?? '').trim();
  return /^https?:\/\/\S+$/i.test(u) ? u : null;
}

/** The orange of the redesign's text on white: the app colour (#FFB243) is too light for a small glyph. */
const ACCENT = C.primaryText;

/**
 * 2026-11-08: the small play button next to a requirement's title when the Admin set a video for it (`videoUrl`);
 * tapping opens the video in the phone's browser / video app. Nothing is shown without a (web) video address.
 */
export function RequirementVideoButton({ url, code, style }: { url?: string | null; code?: string | null; style?: StyleProp<ViewStyle> }) {
  const ui = useUi();
  const video = requirementVideoUrl(url);
  if (!video) return null;
  const open = async () => {
    try {
      await Linking.openURL(video);
    } catch {
      ui.toast('The video could not be opened.');
    }
  };
  return (
    <Pressable
      onPress={open}
      accessibilityRole="button"
      accessibilityLabel="Watch video"
      hitSlop={8}
      style={({ pressed }) => [styles.button, pressed && styles.pressed, style]}
      testID={`req-video-${code ?? ''}`}
    >
      <Text style={styles.glyph}>▶</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    flexShrink: 0,
  },
  pressed: { opacity: 0.6 },
  glyph: { color: ACCENT, fontSize: 13, marginLeft: 2 },
});
