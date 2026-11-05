import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, dimens, Icon, sharedIcons, ZedButton } from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';

/**
 * Pieces of the legacy layouts that several ZED MSME screens share (res/layout of ZED_MSME_Bronze), as the current
 * Play Store app shows them.
 */

export type StepStatus = 'completed' | 'current' | 'default' | 'nc';

export const statusIcon = (s: StepStatus) =>
  s === 'completed' ? icons.ic_status_completed : s === 'current' ? icons.ic_status_current : s === 'nc' ? icons.ic_status_nc : icons.ic_status_default;

/** layout_page_status: the steps on a 2 dp track. */
export function PageStatus({ steps, style }: { steps: StepStatus[]; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.pageStatus, style]} testID="page-status">
      <View style={styles.track} />
      <View style={styles.statusIcons}>
        {steps.map((s, i) => (
          <Icon key={i} icon={statusIcon(s)} />
        ))}
      </View>
    </View>
  );
}

/** The four registration steps with `current` (0 to 3) as the current one; -1 before the first. */
export function registrationSteps(current: number): StepStatus[] {
  return [0, 1, 2, 3].map(i => (i < current ? 'completed' : i === current ? 'current' : 'default'));
}

/** layout_registration_common: the page status, then the ZED banner (zed_logo, hidden on the pledge). */
export function RegistrationCommon({ current, banner = true }: { current: number; banner?: boolean }) {
  return (
    <View>
      <PageStatus steps={registrationSteps(current)} style={styles.registrationStatus} />
      {banner ? <Image source={images.zed_banner} style={styles.banner} resizeMode="contain" /> : null}
    </View>
  );
}

/** registration_footer: BACK (text button) on the light grey bar, the small Proceed button on the right. */
export function Footer({
  onBack,
  onProceed,
  proceedEnabled = true,
  backTitle = 'BACK',
  proceedTitle = 'Proceed',
  backTestID = 'footer-back',
  proceedTestID = 'footer-proceed',
}: {
  onBack: () => void;
  onProceed: () => void;
  proceedEnabled?: boolean;
  backTitle?: string;
  proceedTitle?: string;
  backTestID?: string;
  proceedTestID?: string;
}) {
  return (
    <View style={styles.footer}>
      <Pressable style={({ pressed }) => [styles.footerBack, pressed && { backgroundColor: colors.appColor3 }]} onPress={onBack} testID={backTestID}>
        <Icon icon={sharedIcons.ic_back_arrow} />
        <Text style={styles.footerBackText}>{backTitle.toUpperCase()}</Text>
      </Pressable>
      <ZedButton title={proceedTitle} onPress={onProceed} disabled={!proceedEnabled} small style={styles.footerProceed} testID={proceedTestID} />
    </View>
  );
}

type NoteTone = 'green' | 'yellow' | 'blue' | 'grey';
const NOTE_BACKGROUND: Record<NoteTone, string> = {
  green: '#EFF8E4', // secondary_3 (#33B3E079) on white
  yellow: colors.yellow,
  blue: '#DCEBEF',
  grey: colors.lightGrey,
};

/** secondary_color_trans_rectangle and its kin: a rounded tinted box for notes. */
export function Note({
  tone = 'green',
  center = false,
  children,
  style,
  testID,
}: {
  tone?: NoteTone;
  center?: boolean;
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  testID?: string;
}) {
  return (
    <View style={[styles.note, { backgroundColor: NOTE_BACKGROUND[tone] }, tone === 'blue' && styles.noteBlue, style]} testID={testID}>
      {typeof children === 'string' ? <Text style={[styles.noteText, center && { textAlign: 'center' }]}>{children}</Text> : children}
    </View>
  );
}

/** @style/TextSubheadingDarkBackground as a bar, with the white edit pencil when the section can be changed. */
export function DarkHeading({ title, onEdit, testID }: { title: string; onEdit?: () => void; testID?: string }) {
  return (
    <View style={styles.darkHeading} testID={testID}>
      <Text style={styles.darkHeadingText}>{title}</Text>
      {onEdit ? (
        <Pressable onPress={onEdit} hitSlop={12} testID={testID ? `${testID}-edit` : undefined}>
          <Icon icon={icons.ic_edit} size={14} />
        </Pressable>
      ) : null}
    </View>
  );
}

/** layout_divider_zed_gear: a line, the grey gear, a line. */
export function GearDivider({ style }: { style?: StyleProp<ViewStyle> }) {
  return (
    <View style={[styles.gearDivider, style]}>
      <View style={styles.gearLine} />
      <Image source={images.ic_zed_gear_grey} style={styles.gear} />
      <View style={styles.gearLine} />
    </View>
  );
}

/** A grey row with a teal icon (layout_plant_selection / layout_activity_selection rows). */
export function IconRow({ icon, text, bold = false }: { icon: (typeof icons)[keyof typeof icons]; text: string; bold?: boolean }) {
  return (
    <View style={styles.iconRow}>
      <Icon icon={icon} size={20} />
      <Text style={[styles.iconRowText, bold && { fontWeight: 'bold' }]}>{text}</Text>
    </View>
  );
}

/** The radio row on top of a selectable card ("Select this Unit" / "Selected"). */
export function RadioRow({ selected, label, selectedLabel = 'Selected' }: { selected: boolean; label: string; selectedLabel?: string }) {
  return (
    <View style={styles.radioRow}>
      <View style={[styles.radio, selected && styles.radioOn]}>{selected ? <View style={styles.radioDot} /> : null}</View>
      <Text style={styles.radioText}>{selected ? selectedLabel : label}</Text>
    </View>
  );
}

/** A selectable card (grey outline; light grey when chosen). */
export function OptionCard({
  selected,
  onPress,
  children,
  testID,
}: {
  selected: boolean;
  onPress: () => void;
  children: React.ReactNode;
  testID?: string;
}) {
  return (
    <Pressable onPress={onPress} style={[styles.optionCard, selected && styles.optionCardSelected]} testID={testID} accessibilityState={{ selected }}>
      {children}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pageStatus: { margin: dimens.padding1, padding: dimens.padding1, justifyContent: 'center' },
  registrationStatus: { marginHorizontal: 48, marginVertical: dimens.padding4 },
  track: { position: 'absolute', left: 16, right: 16, height: 2, backgroundColor: colors.progressBarColor },
  statusIcons: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  banner: { width: '100%', height: 72, marginBottom: dimens.padding2 },
  footer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.lightGrey,
    padding: dimens.padding2,
  },
  footerBack: { flexDirection: 'row', alignItems: 'center', paddingVertical: dimens.padding3, paddingHorizontal: dimens.padding2, borderRadius: 4 },
  footerBackText: { fontSize: 13, color: colors.black, fontWeight: 'bold', marginLeft: dimens.padding2, letterSpacing: 1.2 },
  footerProceed: { alignSelf: 'auto' },
  note: { borderRadius: 5, padding: dimens.padding3, marginVertical: dimens.padding2 },
  noteBlue: { borderWidth: 2, borderColor: colors.progressBarColor },
  noteText: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  darkHeading: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.darkGrey,
    borderRadius: dimens.padding1,
    padding: dimens.padding2,
    paddingHorizontal: dimens.padding3,
    marginTop: dimens.padding2,
    marginBottom: dimens.padding1,
  },
  darkHeadingText: { flex: 1, color: colors.white, fontWeight: 'bold', fontSize: dimens.textSize },
  gearDivider: { flexDirection: 'row', alignItems: 'center', marginVertical: dimens.padding2 },
  gearLine: { flex: 1, height: 1, backgroundColor: colors.labelColor },
  gear: { width: 24, height: 24, marginHorizontal: dimens.padding1 },
  iconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.lightGrey2,
    borderRadius: 5,
    padding: dimens.padding3,
    marginTop: dimens.padding2,
  },
  iconRowText: { flex: 1, marginLeft: dimens.padding3, color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  radioRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: dimens.padding1, paddingHorizontal: dimens.padding2 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 2, borderColor: colors.labelColor, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: colors.appColorDark },
  radioDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: colors.appColorDark },
  radioText: { marginLeft: dimens.padding3, fontSize: dimens.textSize, color: colors.black },
  optionCard: {
    borderWidth: 2,
    borderColor: colors.progressBarColor,
    borderRadius: 5,
    backgroundColor: colors.white,
    padding: dimens.padding2,
    marginVertical: dimens.padding2,
  },
  optionCardSelected: { backgroundColor: colors.lightGrey },
});
