import React from 'react';
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackBar, colors, dimens, htmlToPlain, Icon, ScreenFrame, useAppText, useNavigation, useUi, type IconDefinition } from '@zed/shared';
import { icons } from '../assets/icons';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { isAnyCertificationCompleted } from '../models';

const KAWACH_MARKET = 'market://details?id=com.qci.msme.kawach';
const KAWACH_WEB = 'https://play.google.com/store/apps/details?id=com.qci.msme.kawach';

/** The incentives that open the incentives page once a level is certified (GradedIncentivesActivity for all of them). */
const GRADED: [string, string][] = [
  ['Handholding Support', 'Cost: Rs. 2,00,000/- (Subsidy as per MSME size) for improving systems and processes'],
  ['Technology Upgradation', 'Support of up to Rs. 3,00,000/- for moving towards Zero Effect Solutions'],
  ['Ministry of MSME', 'Incentives by MoMSME through its schemes, for ZED Certified MSMEs'],
  ['States/UTs', 'Incentives by States/UTs for ZED Certified MSMEs'],
  ['Financial Institutions', 'Incentives by Financial Institutions for ZED Certified MSMEs'],
  ['Other Incentives', 'Incentives by Central Ministries/Other Organizations for ZED Certified MSMEs'],
];

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
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          <Incentive
            title="MSME KAWACH"
            detail="WASH Certification on Safety & Hygiene · Free (₹ 5,750 + Taxes, 100% Subsidized)"
            right={icons.ic_external_link}
            onPress={() => open(KAWACH_MARKET, KAWACH_WEB)}
            testID="incentive-kawach"
          />
          <Incentive
            title="Joining Reward"
            detail="Rs. 10,000/- Limited purpose reward, linked with ZED Certification Levels"
            right={status?.isCouponUsed ? icons.ic_baseline_view_48 : icons.ic_incentive_arrow_enabled}
            onPress={joiningReward}
            testID="incentive-joining-reward"
          />
          <Incentive
            title="Financial Assistance"
            detail="75% of Subsidy (Max. Rs. 50,000/-) For System Certification or Product Certification of Product Testing"
            enabled={status?.financialAssistanceStatus === 1}
            right={icons.ic_incentive_arrow_enabled}
            onPress={() => nav.push('FinancialAssistance')}
            testID="incentive-financial-assistance"
          />
          {GRADED.map(([title, detail], i) => (
            <Incentive
              key={title}
              title={title}
              detail={detail}
              enabled={certified}
              right={icons.ic_external_link}
              onPress={() => open(app.api.incentivesUrl)}
              testID={`incentive-graded-${i}`}
            />
          ))}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}

/** layout_incentives_option: title, description and the arrow; a disabled option is greyed and does nothing. */
function Incentive({
  title,
  detail,
  right,
  enabled = true,
  onPress,
  testID,
}: {
  title: string;
  detail: string;
  right: IconDefinition;
  enabled?: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable style={[styles.card, !enabled && styles.disabled]} onPress={enabled ? onPress : undefined} disabled={!enabled} testID={testID}>
      <Icon icon={icons.ic_incentives} />
      <View style={{ flex: 1, marginHorizontal: dimens.padding2 }}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.detail}>{detail}</Text>
      </View>
      <Icon icon={enabled ? right : icons.ic_incentive_arrow_disabled} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: dimens.padding2,
    marginVertical: dimens.padding1,
    borderWidth: 1,
    borderColor: colors.lightGrey,
    borderRadius: 8,
    backgroundColor: colors.white,
  },
  disabled: { opacity: 0.45 },
  title: { color: colors.black, fontWeight: 'bold', fontSize: dimens.textSize },
  detail: { color: colors.labelColor, fontSize: dimens.textSize14, marginTop: 2 },
});
