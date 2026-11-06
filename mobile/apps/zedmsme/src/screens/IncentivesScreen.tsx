import React from 'react';
import { Image, Linking, Pressable, ScrollView, StyleSheet, Text, View, type ImageSourcePropType } from 'react-native';
import {
  BackBar,
  colors,
  dimens,
  htmlToPlain,
  Icon,
  lineHeight,
  ScreenFrame,
  textStyles,
  useAppText,
  useNavigation,
  useUi,
  type IconDefinition,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { isAnyCertificationCompleted } from '../models';

/**
 * The incentives that open the incentives page once a level is certified (GradedIncentivesActivity for all of them):
 * title, description, the legacy logo and how many leading characters of the description are in the coupon blue.
 */
const GRADED: [string, string, ImageSourcePropType, number][] = [
  ['Handholding Support', 'Cost: Rs. 2,00,000/- (Subsidy as per MSME size) for improving systems and processes', images.handholding_logo, 47],
  ['Technology Upgradation', 'Support of up to Rs. 3,00,000/- for moving towards Zero Effect Solutions', images.technology_logo, 31],
  ['Ministry of MSME', 'Incentives by MoMSME through its schemes, for ZED Certified MSMEs', images.msme_logo, 0],
  ['States/UTs', 'Incentives by States/UTs for ZED Certified MSMEs', images.state_uts_logo, 0],
  ['Financial Institutions', 'Incentives by Financial Institutions for ZED Certified MSMEs', images.financial_institution_logo, 0],
  ['Other Incentives', 'Incentives by Central Ministries/Other Organizations for ZED Certified MSMEs', images.graded_incentives_logo, 0],
];

/** getForegroundColorSpan: the first `n` characters in the coupon blue. */
const highlighted = (text: string, n: number) =>
  n > 0 ? (
    <>
      <Text style={{ color: colors.couponBorder }}>{text.slice(0, n)}</Text>
      {text.slice(n)}
    </>
  ) : (
    text
  );

const rupees = (value: string | null | undefined) => {
  const n = Number(value ?? '');
  return Number.isFinite(n) ? '₹ ' + n.toLocaleString('en-IN') : value ?? '';
};

/** MyIncentivesFragment ("My Incentives"). */
export function IncentivesScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('incentives');
  const status = app.user?.MsmeDetails?.msmeStatus ?? null;
  const certified = status ? isAnyCertificationCompleted(status) : false;
  const availInfo = useAppText('app.msme.incentives.joiningReward.availInfo');
  const open = (url: string, fallback?: string) =>
    Linking.openURL(url).catch(() => (fallback ? Linking.openURL(fallback) : Promise.reject()).catch(() => ui.toast('No suitable application found to perform this action')));

  const joiningReward = () => {
    const message = status?.isCouponUsed
      ? `Date of avail: ${status.dateOfAvail ?? ''}\nAmount: ${rupees(status.joiningRewardAmount)}\nCertification level: ${status.latestCertification ?? ''}`
      : availInfo
        ? htmlToPlain(availInfo.html)
        : '';
    ui.alert('Joining Reward', message, [{ text: 'OK' }]);
  };

  return (
    <ScreenFrame title="My Incentives" onMenu={openDrawer} testID="incentives">
      <View style={{ flex: 1, backgroundColor: colors.lightGrey2 }}>
        {/* fragment_my_incentives: BACK only, no ZED ID. */}
        <BackBar onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          {/* MSME KAWACH was removed (2026-11-06). */}
          <Incentive
            title="Joining Reward"
            logo={images.reward}
            detail={highlighted('Rs. 10,000/- Limited purpose reward, linked with ZED Certification Levels', 12)}
            right={status?.isCouponUsed ? icons.ic_baseline_view_48 : icons.ic_incentive_arrow_enabled}
            onPress={joiningReward}
            testID="incentive-joining-reward"
          />
          <Incentive
            title="Financial Assistance"
            logo={images.financial_assistance_logo}
            detail={highlighted('75% of Subsidy (Max. Rs. 50,000/-) For System Certification or Product Certification of Product Testing', 34)}
            enabled={status?.financialAssistanceStatus === 1}
            right={icons.ic_incentive_arrow_enabled}
            onPress={() => nav.push('FinancialAssistance')}
            testID="incentive-financial-assistance"
          />
          {GRADED.map(([title, detail, logo, blue], i) => (
            <Incentive
              key={title}
              title={title}
              logo={logo}
              detail={highlighted(detail, blue)}
              enabled={certified}
              right={icons.ic_incentive_arrow_enabled}
              onPress={() => open(app.api.incentivesUrl)}
              testID={`incentive-graded-${i}`}
            />
          ))}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}

/**
 * layout_incentives_option: the logo with the arrow (in its grey square) on the right, the title (TextSubheading) and
 * the description under it, on a white card with the green outline. A disabled option shows the disabled arrow and does
 * nothing.
 */
function Incentive({
  title,
  logo,
  detail,
  right,
  enabled = true,
  onPress,
  testID,
}: {
  title: string;
  logo: ImageSourcePropType;
  detail: React.ReactNode;
  right: IconDefinition;
  enabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable style={styles.card} onPress={enabled ? onPress : undefined} disabled={!enabled} testID={testID}>
      <View style={styles.top}>
        <Image source={logo} style={styles.logo} resizeMode="contain" />
        {enabled && right === icons.ic_baseline_view_48 ? (
          <View style={styles.viewBox}>
            <Icon icon={right} />
          </View>
        ) : (
          <Icon icon={enabled ? right : icons.ic_incentive_arrow_disabled} />
        )}
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.detail} numberOfLines={4}>
        {detail}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    margin: dimens.padding2,
    padding: dimens.padding4,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: dimens.padding2,
    backgroundColor: colors.white,
  },
  viewBox: { padding: dimens.padding2, borderRadius: 8, backgroundColor: colors.lightGrey },
  top: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  logo: { width: dimens.incentiveLogoSize, height: dimens.incentiveLogoSize, borderRadius: 12 },
  title: { ...textStyles.subheading, marginTop: dimens.padding2 },
  detail: { color: colors.black, fontSize: dimens.textSize, lineHeight: lineHeight(dimens.textSize) },
});
