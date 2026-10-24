import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { images } from '../assets/images';

/** res/values/colors.xml of the legacy app. */
export const sa = {
  primary: '#FFB243',
  darkGrey: '#232527',
  teal: '#53A92C',
  squash: '#F6A623',
  coolGrey: '#949597',
  paleGrey: '#F7F8F9',
  silver: '#DEE1E4',
  labelColor: '#595959',
  defaultValue: '#484848',
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  divider: '#DFDFDF',
};

/**
 * default_toolbar: 48dp bar in `primary` with the launcher icon on the left, the title in the middle (white, bold,
 * 18sp; "ZED Assessment" unless the screen sets one) and an optional home icon on the right; status bar in `primary`.
 */
export function SaFrame({
  title = 'ZED Assessment',
  showToolbar = true,
  onHome,
  children,
  scroll = false,
  contentStyle,
  testID,
}: {
  title?: string;
  showToolbar?: boolean;
  onHome?: () => void;
  children: React.ReactNode;
  scroll?: boolean;
  contentStyle?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  const insets = useSafeAreaInsets();
  const body = scroll ? (
    <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={contentStyle}>
      {children}
    </ScrollView>
  ) : (
    <View style={[{ flex: 1 }, contentStyle]}>{children}</View>
  );
  return (
    <View style={[styles.root, { paddingBottom: insets.bottom }]} testID={testID}>
      <StatusBar barStyle="dark-content" />
      <View style={{ height: insets.top, backgroundColor: sa.primary }} />
      {showToolbar ? (
        <View style={styles.toolbar}>
          <Image source={images.ic_launcher} style={styles.launcher} />
          <Text style={styles.title} numberOfLines={1} testID="toolbar-title">
            {title}
          </Text>
          {onHome ? (
            <Pressable onPress={onHome} style={styles.homeTouch} testID="home-icon">
              <Image source={images.ic_home_white_36dp} style={styles.home} />
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {body}
    </View>
  );
}

/** @style/BaseButton: primary rounded rectangle, white 15sp text, 12dp margin. `large`: BaseButton.Large (full width). */
export function SaButton({
  title,
  onPress,
  large,
  disabled,
  style,
  textStyle,
  testID,
}: {
  title: string;
  onPress: () => void;
  large?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      style={({ pressed }) => [styles.button, large && styles.large, (disabled || pressed) && { opacity: disabled ? 0.5 : 0.85 }, style]}>
      <Text style={[styles.buttonText, textStyle]}>{title}</Text>
    </Pressable>
  );
}

/** @style/BaseButtonInverse: white button with the text in `primary`. */
export function SaInverseButton({ title, onPress, style, testID }: { title: string; onPress: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.inverse, pressed && { backgroundColor: '#FFF3E0' }, style]}>
      <Text style={styles.inverseText}>{title.toUpperCase()}</Text>
    </Pressable>
  );
}

/** image_container: the title above a 128dp pale grey box that shows "Tap Here" or the photo. */
export function PhotoTile({
  title,
  base64,
  onPress,
  testID,
}: {
  title?: string | null;
  base64?: string | null;
  onPress?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.tileWrap}>
      {title ? <Text style={styles.tileTitle}>{title}</Text> : null}
      <Pressable onPress={onPress} style={styles.tile} testID={testID}>
        {base64 ? (
          <Image source={{ uri: `data:image/jpeg;base64,${base64.replace(/\s/g, '')}` }} style={StyleSheet.absoluteFill} resizeMode="stretch" testID={testID ? `${testID}-image` : undefined} />
        ) : (
          <Text style={styles.tapHere}>Tap Here</Text>
        )}
      </Pressable>
    </View>
  );
}

/** company_details_row / label_value_row: label in cool grey, value in dark grey, 15sp. */
export function LabelValue({ label, value, onPressValue, right, testID }: { label: string; value: string; onPressValue?: () => void; right?: React.ReactNode; testID?: string }) {
  return (
    <View style={styles.lvRow} testID={testID}>
      <Text style={styles.lvLabel}>{label}</Text>
      <Pressable onPress={onPressValue} disabled={!onPressValue} style={styles.lvValueRow}>
        <Text style={styles.lvValue}>{value}</Text>
        {right}
      </Pressable>
    </View>
  );
}

export function Divider({ style }: { style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.divider, style]} />;
}

/** A centred spinner for a screen still reading its data. */
export function Loading() {
  return (
    <View style={styles.loading}>
      <ActivityIndicator color={sa.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: sa.white },
  toolbar: { height: 48, backgroundColor: sa.primary, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', elevation: 4 },
  launcher: { position: 'absolute', left: 10, width: 29, height: 29 },
  title: { color: sa.white, fontWeight: 'bold', fontSize: 18, maxWidth: '70%' },
  homeTouch: { position: 'absolute', right: 10, padding: 4 },
  home: { width: 30, height: 30 },
  button: {
    backgroundColor: sa.primary,
    borderRadius: 5,
    margin: 12,
    minHeight: 48,
    paddingHorizontal: 10,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  large: { alignSelf: 'stretch', marginTop: 10, marginBottom: 10, marginLeft: 25, marginRight: 25 },
  buttonText: { color: sa.white, fontSize: 15, textShadowColor: '#329378', textShadowOffset: { width: 1, height: 1 }, textShadowRadius: 1 },
  inverse: {
    backgroundColor: sa.white,
    borderRadius: 4,
    margin: 8,
    minHeight: 48,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'stretch',
    elevation: 2,
  },
  inverseText: { color: sa.primary, fontSize: 14, fontWeight: '500', letterSpacing: 0.5 },
  tileWrap: { marginVertical: 5 },
  tileTitle: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  tile: {
    height: 128,
    backgroundColor: sa.paleGrey,
    borderColor: sa.silver,
    borderWidth: 0.5,
    borderRadius: 3,
    padding: 5,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  tapHere: { color: sa.darkGrey, fontSize: 15 },
  lvRow: { paddingHorizontal: 16, paddingVertical: 6 },
  lvLabel: { color: sa.coolGrey, fontSize: 15 },
  lvValueRow: { flexDirection: 'row', alignItems: 'center' },
  lvValue: { color: sa.darkGrey, fontSize: 15, flexShrink: 1 },
  divider: { height: 1, backgroundColor: sa.divider, marginVertical: 8 },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },
});
