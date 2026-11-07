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
  tint,
  description,
}: {
  /** New (2026-11-07): the level's colour: a tinted card with the icon in a coloured circle. */
  tint?: string;
  /** New (2026-11-07): one line under the label. */
  description?: string;
  label: string;
  left?: IconDefinition | ImageSourcePropType | null;
  right?: IconDefinition | null;
  onPress?: () => void;
  overlay?: boolean;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  if (tint)
    return (
      <Pressable
        onPress={overlay ? undefined : onPress}
        style={({ pressed }) => [styles.box, styles.tinted, { backgroundColor: tint + '14', borderColor: tint, borderLeftColor: tint }, style, pressed && onPress && !overlay && { opacity: 0.8 }]}
        testID={testID}>
        <View style={styles.row}>
          {left ? (
            <View style={[styles.circle, { backgroundColor: tint }]}>
              {isIcon(left) ? <Icon icon={left} size={22} tint={colors.white} /> : <Image source={left} style={styles.circleImage} />}
            </View>
          ) : null}
          <View style={styles.texts}>
            <Text style={[styles.label, styles.labelTinted]}>{label}</Text>
            {description ? <Text style={styles.description}>{description}</Text> : null}
          </View>
          {right ? <Icon icon={right} tint={tint} /> : null}
        </View>
        {overlay ? <View style={styles.overlay} /> : null}
      </Pressable>
    );
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
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: '#FFFFFFAA', borderRadius: 5 },
  tinted: { borderWidth: 1, borderLeftWidth: 5, borderRadius: 10 },
  circle: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  circleImage: { width: 24, height: 24, tintColor: colors.white },
  texts: { flex: 1, marginHorizontal: dimens.padding2 },
  labelTinted: { flex: 0, marginHorizontal: 0, fontWeight: 'bold' },
  description: { color: colors.darkGrey2, fontSize: 13, marginTop: 2 },
});
