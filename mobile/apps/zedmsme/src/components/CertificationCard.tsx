import React from 'react';
import { Image, Pressable, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import { colors, dimens, Icon, sharedIcons, TextButton } from '@zed/shared';
import { icons } from '../assets/icons';
import { anyActiveNc, isCompletedAndDisabled, type CertificationDetails } from '../models';

type StatusIcon = 'default' | 'current' | 'completed' | 'nc';

const statusIcon = (s: StatusIcon) =>
  s === 'completed' ? icons.ic_status_completed : s === 'current' ? icons.ic_status_current : s === 'nc' ? icons.ic_status_nc : icons.ic_status_default;

export type CardState = {
  statusText: string;
  one: StatusIcon;
  two: StatusIcon | null;
  three: StatusIcon | null;
  four: StatusIcon;
  five: StatusIcon | null;
  overlay: boolean;
};

/**
 * CertificationStatusHandler.setCertificationStatus (MyCertificationsFragment.kt). `actionsHidden` is true when both
 * the apply button and the arrow are INVISIBLE, which shows the overlay first.
 */
export function certificationCardState(details: CertificationDetails | null, isBronze: boolean, actionsHidden: boolean): CardState {
  const s: CardState = {
    statusText: 'Get Started',
    one: 'default',
    two: 'default',
    three: 'default',
    four: 'default',
    five: null,
    overlay: actionsHidden,
  };
  if (!details) return s;
  if (isBronze) {
    s.two = null;
    s.three = null;
    s.five = 'default';
    if (details.status === 3 || isCompletedAndDisabled(details)) {
      s.statusText = 'Completed';
      s.one = 'completed';
      s.five = 'completed';
      s.four = 'completed';
      s.overlay = isCompletedAndDisabled(details);
    } else if (details.status === 2) {
      s.statusText = 'Desktop Verification';
      s.one = 'completed';
      s.five = anyActiveNc(details) ? 'nc' : 'current';
    } else if (details.status === 1) {
      s.statusText = 'Basic Information & Document Upload';
      if (details.basicInformation != null && !details.finalSubmitDone) s.one = 'current';
      else if (details.finalSubmitDone) s.one = 'completed';
    }
    return s;
  }
  if (details.status === 4 || isCompletedAndDisabled(details)) {
    s.one = s.two = s.three = s.four = 'completed';
    s.statusText = 'Completed';
    s.overlay = isCompletedAndDisabled(details);
  } else if (details.status === 3) {
    s.one = 'completed';
    s.two = 'completed';
    s.statusText = details.remoteStatus === '1' || details.remoteStatus === '2' ? 'Remote Assessment' : 'Onsite Assessment';
    s.three = anyActiveNc(details) ? 'nc' : 'current';
  } else if (details.status === 2) {
    s.one = 'completed';
    s.statusText = 'Desktop Verification';
  } else if (details.status === 1) {
    s.statusText = 'Basic Information & Document Upload';
    if (details.basicInformation != null && !details.finalSubmitDone) s.one = 'current';
    else if (details.finalSubmitDone) s.one = 'completed';
  }
  return s;
}

/** layout_certification_overview */
export function CertificationCard({
  title,
  titleColor,
  image,
  state,
  action,
  onApply,
  onOpen,
  showTitle = true,
  testID,
}: {
  title: string;
  titleColor: string;
  image: ImageSourcePropType;
  state: CardState;
  /** Which of the apply button / right arrow is visible ('none' = both invisible, 'gone' = both gone). */
  action: 'apply' | 'arrow' | 'none' | 'gone';
  onApply?: () => void;
  onOpen?: () => void;
  showTitle?: boolean;
  testID?: string;
}) {
  return (
    <View style={styles.wrapper} testID={testID}>
      {showTitle ? <Text style={[styles.title, { backgroundColor: titleColor }]}>{title}</Text> : null}
      <View style={styles.card}>
        <View style={styles.cardBody}>
          <View style={styles.left}>
            <View style={styles.statusRow}>
              <Icon icon={icons.ic_arrow_orange} />
              <Text style={styles.statusText} numberOfLines={2} testID={testID ? `${testID}-status` : undefined}>
                {state.statusText}
              </Text>
            </View>
            <PageStatus state={state} />
          </View>
          <Image source={image} style={styles.optionIcon} resizeMode="contain" />
          <View style={styles.divider} />
          <View style={styles.actionBox}>
            {action === 'apply' ? <TextButton title="APPLY" onPress={() => onApply?.()} testID={testID ? `${testID}-apply` : undefined} /> : null}
            {action === 'arrow' ? (
              <Pressable onPress={onOpen} style={{ padding: dimens.padding2 }} testID={testID ? `${testID}-open` : undefined}>
                <Icon icon={sharedIcons.ic_forward_arrow} />
              </Pressable>
            ) : null}
            {action === 'none' ? <View style={{ minWidth: 72 }} /> : null}
          </View>
        </View>
        {state.overlay ? <View style={styles.overlay} /> : null}
      </View>
    </View>
  );
}

/** layout_page_status: the four steps (or Bronze's three) on a 2 dp track. */
function PageStatus({ state }: { state: CardState }) {
  return (
    <View style={styles.pageStatus}>
      <View style={styles.track} />
      <View style={styles.statusIcons}>
        <Icon icon={statusIcon(state.one)} />
        {state.two ? <Icon icon={statusIcon(state.two)} /> : null}
        {state.five ? <Icon icon={statusIcon(state.five)} /> : null}
        {state.three ? <Icon icon={statusIcon(state.three)} /> : null}
        <Icon icon={statusIcon(state.four)} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: { paddingVertical: dimens.padding2 },
  title: {
    marginHorizontal: dimens.padding2,
    padding: dimens.padding3,
    color: colors.white,
    fontSize: 14,
    fontWeight: 'bold',
    borderTopLeftRadius: dimens.padding1,
    borderTopRightRadius: dimens.padding1,
    overflow: 'hidden',
  },
  card: {
    height: 110,
    marginHorizontal: dimens.padding2,
    marginBottom: dimens.padding2,
    backgroundColor: colors.white,
    borderRadius: 4,
    elevation: 2,
  },
  cardBody: { flex: 1, flexDirection: 'row', paddingVertical: dimens.padding1 },
  left: { flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding2 },
  statusText: { color: colors.orange, fontWeight: 'bold', marginLeft: dimens.padding1, flex: 1, fontSize: dimens.textSize },
  pageStatus: { margin: dimens.padding1, padding: dimens.padding1, justifyContent: 'center' },
  track: { position: 'absolute', left: 16, right: 16, height: 2, backgroundColor: colors.progressBarColor },
  statusIcons: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  optionIcon: { width: 64, height: 90, margin: dimens.padding1 },
  divider: { width: 1, backgroundColor: colors.lightGrey },
  actionBox: { justifyContent: 'center', alignItems: 'center' },
  overlay: { ...StyleSheet.absoluteFill, backgroundColor: '#AAFFFFFF', borderRadius: 4 },
});
