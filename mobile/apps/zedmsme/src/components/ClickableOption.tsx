import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType, type StyleProp, type ViewStyle } from 'react-native';
import { colors, dimens, Icon, type IconDefinition } from '@zed/shared';

/** layout_clickable_option: grey_2 box with a label between a left and a right drawable, and an optional overlay. */
export function ClickableOption({
  label,
  left,
  right,
  onPress,
  overlay = false,
  style,
  testID,
}: {
  label: string;
  left?: IconDefinition | ImageSourcePropType | null;
  right?: IconDefinition | null;
  onPress?: () => void;
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <Pressable onPress={overlay ? undefined : onPress} style={({ pressed }) => [styles.box, style, pressed && onPress && !overlay && { opacity: 0.8 }]} testID={testID}>
      <View style={styles.row}>
        {left ? isIcon(left) ? <Icon icon={left} /> : <Image source={left} /> : null}
        <Text style={styles.label}>{label}</Text>
        {right ? <Icon icon={right} /> : null}
      </View>
      {overlay ? <View style={styles.overlay} /> : null}
    </Pressable>
  );
}

function isIcon(x: unknown): x is IconDefinition {
  return typeof x === 'object' && x != null && 'paths' in x;
}

const styles = StyleSheet.create({
  box: { margin: dimens.padding2, backgroundColor: colors.lightGrey2, borderRadius: 5 },
  row: { flexDirection: 'row', alignItems: 'center', margin: dimens.padding2 },
  label: { flex: 1, marginHorizontal: dimens.padding2, fontSize: dimens.textSize, color: colors.black },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: '#AAFFFFFF', borderRadius: 5 },
});
