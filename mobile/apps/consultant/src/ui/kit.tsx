import React from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StatusBar, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Icon } from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';

/** res/values/colors.xml of the legacy app. */
export const sa = {
  primary: '#45A5AD',
  darkGrey: '#232527',
  teal: '#59A021',
  squash: '#F6A623',
  coolGrey: '#949597',
  paleGrey: '#F7F8F9',
  silver: '#F3F3F3',
  labelColor: '#595959',
  defaultValue: '#484848',
  white: '#FFFFFF',
  black: '#000000',
  red: '#FF0000',
  divider: '#DFDFDF',
  bodyTextGrey: '#8E8A8B',
  lightGrey: '#F0F0F0',
  paleBlue: '#EBF0F9',
  blue: '#3366C1',
  subheading: '#1D1618',
  greyStroke: '#DFE1E4',
  reviewStroke: '#D2D0D1',
};

/** strings.xml mandatory_label / optional_label */
export const MANDATORY_LABEL = ' (Mandatory)';
export const OPTIONAL_LABEL = ' (Optional)';

/**
 * default_toolbar: bar in `primary` with the title on the left (white, bold, 18sp; "ZED Consultancy" unless the screen
 * sets one) and the launcher icon on the right; status bar in `primary` with light icons.
 */
export function SaFrame({
  title = 'ZED Consultancy',
  showToolbar = true,
  children,
  scroll = false,
  contentStyle,
  testID,
}: {
  title?: string;
  showToolbar?: boolean;
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
      <StatusBar barStyle="light-content" />
      <View style={{ height: insets.top, backgroundColor: sa.primary }} />
      {showToolbar ? (
        <View style={styles.toolbar}>
          <Text style={styles.title} numberOfLines={1} testID="toolbar-title">
            {title}
          </Text>
          <Image source={images.ic_launcher} style={styles.launcher} />
        </View>
      ) : null}
      {body}
    </View>
  );
}

/**
 * @style/BaseButton (MaterialComponents button: text in capitals, 14sp, white on `primary`, silver when disabled).
 * `large`: BaseButton.Large (full width).
 */
export function SaButton({
  title,
  onPress,
  large,
  disabled,
  style,
  textStyle,
  left,
  testID,
}: {
  title: string;
  onPress: () => void;
  large?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  textStyle?: StyleProp<TextStyle>;
  left?: React.ReactNode;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      testID={testID}
      accessibilityState={{ disabled: !!disabled }}
      style={({ pressed }) => [styles.button, large && styles.large, disabled && styles.buttonDisabled, pressed && !disabled && { opacity: 0.85 }, style]}>
      {left}
      <Text style={[styles.buttonText, disabled && { color: 'rgba(0,0,0,0.38)' }, textStyle]}>{title.toUpperCase()}</Text>
    </Pressable>
  );
}

/** @style/BaseButtonInverse: white button with the text in `primary`. */
export function SaInverseButton({ title, onPress, style, testID }: { title: string; onPress: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.inverse, pressed && { backgroundColor: '#E8F4F5' }, style]}>
      <Text style={styles.inverseText}>{title.toUpperCase()}</Text>
    </Pressable>
  );
}

/** @style/BaseOutlinedButton */
export function SaOutlinedButton({ title, onPress, style, testID }: { title: string; onPress: () => void; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.outlined, pressed && { backgroundColor: '#E8F4F5' }, style]}>
      <Text style={styles.outlinedText}>{title.toUpperCase()}</Text>
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

/** A label ending with " (Mandatory)" shows that part in red at 75 % (prepareMandatoryLabel). */
export function MandatoryText({ label, style }: { label: string; style?: StyleProp<TextStyle> }) {
  if (!label.endsWith(MANDATORY_LABEL)) return <Text style={style} numberOfLines={2}>{label}</Text>;
  const base = StyleSheet.flatten(style) ?? {};
  return (
    <Text style={style} numberOfLines={2}>
      {label.substring(0, label.length - MANDATORY_LABEL.length)}
      <Text style={{ color: sa.red, fontSize: (base.fontSize ?? 16) * 0.75 }}>{MANDATORY_LABEL}</Text>
    </Text>
  );
}

/**
 * layout_home_menu / layout_clickable_option: white rounded card, a coloured bar on the left, the label (16sp, two
 * lines at most) above the status (14sp), and the forward arrow on the right.
 */
export function MenuRow({
  label,
  status,
  statusColor,
  statusBold,
  leading = images.ic_menu_leading,
  onPress,
  bordered,
  testID,
}: {
  label: string;
  status?: string | null;
  statusColor?: string;
  statusBold?: boolean;
  leading?: number;
  onPress: () => void;
  /** bordered_background (the parameter lists) instead of the dashboard card. */
  bordered?: boolean;
  testID?: string;
}) {
  return (
    <Pressable onPress={onPress} testID={testID} style={({ pressed }) => [styles.menuRow, bordered && styles.menuRowBordered, pressed && { backgroundColor: '#F2F2F2' }]}>
      <Image source={leading} style={styles.menuLeading} resizeMode="stretch" />
      <View style={styles.menuTexts}>
        <MandatoryText label={label} style={styles.menuLabel} />
        {status != null ? (
          <Text style={[styles.menuStatus, statusColor ? { color: statusColor } : null, statusBold && { fontWeight: 'bold' }]} testID={testID ? `${testID}-status` : undefined}>
            {status}
          </Text>
        ) : null}
      </View>
      <Icon icon={icons.ic_forward_arrow} size={30} />
    </Pressable>
  );
}

/** navigation_footer: light grey bar with BACK (text button with the back arrow) on the left and PROCEED on the right. */
export function NavigationFooter({
  onBack,
  onProceed,
  proceedTitle = 'Proceed',
  proceedDisabled,
  middle,
  testID = 'footer',
}: {
  onBack: () => void;
  onProceed?: () => void;
  proceedTitle?: string;
  proceedDisabled?: boolean;
  middle?: React.ReactNode;
  testID?: string;
}) {
  return (
    <View style={styles.footer} testID={testID}>
      <Pressable onPress={onBack} style={styles.backButton} testID={`${testID}-back`}>
        <Icon icon={icons.ic_back_arrow} size={16} />
        <Text style={styles.backText}>BACK</Text>
      </Pressable>
      {middle}
      {onProceed ? <SaButton title={proceedTitle} onPress={onProceed} disabled={proceedDisabled} style={styles.footerButton} testID={`${testID}-proceed`} /> : <View />}
    </View>
  );
}

/** @style/PageTitle: 18sp bold black. */
export function PageTitle({ children, style }: { children: React.ReactNode; style?: StyleProp<TextStyle> }) {
  return <Text style={[styles.pageTitle, style]}>{children}</Text>;
}

/** layout_static_label: a bold heading in `primary` (StaticLabelHelper). */
export function StaticLabel({ label }: { label: string }) {
  return (
    <View style={{ padding: 5 }}>
      <Text style={styles.staticLabel}>{label}</Text>
    </View>
  );
}

/** list_textview: a bullet and the text (16sp black); `indent` for a sub-option. */
export function BulletText({ text, indent, right }: { text: string; indent?: boolean; right?: React.ReactNode }) {
  return (
    <View style={[styles.bulletRow, indent && { paddingLeft: 12, paddingVertical: 5, paddingRight: 5 }]}>
      <Text style={styles.bullet}>•</Text>
      <Text style={styles.bulletText}>{text}</Text>
      {right}
    </View>
  );
}

/**
 * layout_review_item: the document or section image on the left, three lines of text, VIEW (outlined) and, for
 * technology upgradation, VALIDATE.
 */
export function ReviewItem({
  label,
  image,
  imageNode,
  onView,
  validateTitle,
  validateEnabled,
  onValidate,
  testID,
}: {
  label: string;
  image?: number | { uri: string };
  imageNode?: React.ReactNode;
  onView: () => void;
  validateTitle?: string;
  validateEnabled?: boolean;
  onValidate?: () => void;
  testID?: string;
}) {
  return (
    <View style={styles.review} testID={testID}>
      {imageNode ?? <Image source={image ?? images.placeholder_img} style={styles.reviewImage} resizeMode="contain" />}
      <Text style={styles.reviewLabel} numberOfLines={3}>
        {label}
      </Text>
      <View>
        <SaOutlinedButton title="View" onPress={onView} testID={testID ? `${testID}-view` : undefined} />
        {validateTitle ? (
          <SaButton title={validateTitle} onPress={() => onValidate?.()} disabled={!validateEnabled} style={{ margin: 4 }} testID={testID ? `${testID}-validate` : undefined} />
        ) : null}
      </View>
    </View>
  );
}

/** fragment_comment_input: dialog body with the bold title, the close icon and the views. */
export function DialogFrame({ title, onClose, children }: { title?: string | null; onClose: () => void; children: React.ReactNode }) {
  return (
    <View style={styles.dialog}>
      <View style={styles.dialogHeader}>
        <Text style={styles.dialogTitle}>{title ?? ''}</Text>
        <Pressable onPress={onClose} testID="dialog-close" hitSlop={8}>
          <Image source={images.ic_close_dialog} style={{ width: 24, height: 24 }} />
        </Pressable>
      </View>
      <ScrollView keyboardShouldPersistTaps="handled">{children}</ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: sa.white },
  toolbar: { minHeight: 58, backgroundColor: sa.primary, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 5, elevation: 4 },
  title: { flex: 1, color: sa.white, fontWeight: 'bold', fontSize: 18, padding: 8 },
  launcher: { width: 37, height: 37, marginLeft: 5, marginRight: 6 },
  button: {
    backgroundColor: sa.primary,
    borderRadius: 5,
    margin: 8,
    minHeight: 40,
    paddingHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
  },
  buttonDisabled: { backgroundColor: sa.silver, borderColor: sa.paleGrey, borderWidth: 1 },
  large: { alignSelf: 'stretch', marginTop: 10, marginBottom: 10, marginLeft: 25, marginRight: 25 },
  buttonText: { color: sa.white, fontSize: 14, fontWeight: '500', letterSpacing: 0.8 },
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
  outlined: { borderColor: '#BDBDBD', borderWidth: 1, borderRadius: 4, margin: 4, minHeight: 36, paddingHorizontal: 10, alignItems: 'center', justifyContent: 'center' },
  outlinedText: { color: sa.primary, fontSize: 14, fontWeight: '500', letterSpacing: 0.8 },
  tileWrap: { marginVertical: 5 },
  tileTitle: { color: sa.darkGrey, fontSize: 16, fontWeight: 'bold', marginBottom: 5 },
  tile: {
    height: 128,
    backgroundColor: sa.paleGrey,
    borderColor: sa.greyStroke,
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
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: sa.white,
    borderRadius: 8,
    margin: 8,
    padding: 8,
    minHeight: 48,
    elevation: 2,
    alignSelf: 'stretch',
  },
  menuRowBordered: { elevation: 0, borderColor: sa.reviewStroke, borderWidth: 1, margin: 5 },
  menuLeading: { width: 8, alignSelf: 'stretch', marginHorizontal: 8 },
  menuTexts: { flex: 1, paddingVertical: 5 },
  menuLabel: { color: sa.black, fontSize: 16, marginHorizontal: 8 },
  menuStatus: { color: sa.bodyTextGrey, fontSize: 14, marginHorizontal: 8 },
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: sa.lightGrey, padding: 8 },
  backButton: { flexDirection: 'row', alignItems: 'center', padding: 8 },
  backText: { color: sa.black, fontSize: 13, fontWeight: '500', marginLeft: 8, letterSpacing: 0.8 },
  footerButton: { margin: 0 },
  pageTitle: { fontSize: 18, fontWeight: 'bold', color: sa.black, marginBottom: 8, marginTop: 5, padding: 5 },
  staticLabel: { color: sa.primary, fontWeight: 'bold', fontSize: 16 },
  bulletRow: { flexDirection: 'row', padding: 5, alignItems: 'flex-start' },
  bullet: { fontSize: 18, color: sa.black },
  bulletText: { fontSize: 16, color: sa.black, paddingHorizontal: 8, flex: 1 },
  review: {
    flexDirection: 'row',
    alignItems: 'center',
    borderColor: sa.reviewStroke,
    borderWidth: 1,
    borderRadius: 8,
    padding: 5,
    marginVertical: 5,
  },
  reviewImage: { width: 64, height: 64 },
  reviewLabel: { flex: 1, padding: 5, color: sa.black, fontSize: 14 },
  dialog: { backgroundColor: sa.white, borderRadius: 4, padding: 8, maxHeight: '90%' },
  dialogHeader: { flexDirection: 'row', alignItems: 'center', paddingBottom: 12 },
  dialogTitle: { flex: 1, fontSize: 18, fontWeight: 'bold', color: sa.black, paddingVertical: 5 },
});
