import React, { useCallback, useEffect, useRef } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  GradientFill,
  HtmlText,
  htmlToPlain,
  Icon,
  isNetworkAvailable,
  isSuccess,
  ScreenFrame,
  shapes,
  textStyles,
  useAppText,
  useBackHandler,
  useFocusEffect,
  useNavigation,
  useRoute,
  useUi,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { SyncAllButton } from '../components/SyncAllButton';
import { certificationDetailsOf, normalizeElements, plantAddress, updateCertificationDetails, type CertificationType, type MsmeDetails } from '../models';

/** DashboardActivity */
export function DashboardScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const route = useRoute<{ fromLogin?: boolean }>();
  const openDrawer = useOpenDrawer('dashboard');
  const started = useRef(false);
  const details = app.user?.MsmeDetails;
  const steps = useAppText('app.msme.dashboard.certificationSteps');
  const certificationsInfo = useAppText('app.msme.dashboard.info.myCertifications');
  const incentivesInfo = useAppText('app.msme.dashboard.info.myIncentives');
  const stepItems = steps ? parseSteps(steps.html) : [];

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // prepareViews: after login the Enterprise Profile opens on top (with Proceed).
    if (route.params?.fromLogin) nav.push('MyAccount', { showProceed: true, hideHeaderMenu: true });
  }, [nav, route.params?.fromLogin]);

  // New (the code base's refresh was switched off): the statuses are asked again whenever the dashboard shows, so that
  // a submission, a payment or the office's decision shows without signing in again.
  useFocusEffect(
    useCallback(() => {
      refreshStatus(app).catch(() => undefined);
    }, [app]),
  );

  // onBackPressed with no fragment: "Are you sure you want to exit?"
  useBackHandler(() => {
    ui.alert(null, 'Are you sure you want to exit?', [{ text: 'No' }, { text: 'Yes', onPress: () => BackHandler.exitApp() }]);
    return true;
  });

  // configureRefreshOption: the refresh icon on the header asks for the statuses again (startRefresh).
  const refresh = async () => {
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    ui.showLoading();
    try {
      await refreshStatus(app);
    } catch (e) {
      ui.snackbar(errorOf({ status: '0', errorMessage: e instanceof Error ? e.message : null }));
    } finally {
      ui.hideLoading();
    }
  };

  const headerRight = (
    <View style={styles.headerRight}>
      <SyncAllButton />
      <Pressable onPress={refresh} hitSlop={8} style={styles.refresh} testID="dashboard-refresh" accessibilityLabel="Refresh">
        <Icon icon={icons.ic_baseline_refresh_24} size={36} />
      </Pressable>
    </View>
  );

  return (
    <ScreenFrame title="Dashboard" onMenu={openDrawer} headerRight={headerRight} testID="dashboard">
      <ScrollView>
        <View style={styles.container}>
          <Text style={[textStyles.subheading, { marginTop: 0, color: colors.appColor }]}>Welcome</Text>
          {details ? <EnterpriseCard details={details} /> : null}
          <OptionCard
            title="My Certifications"
            text="Apply for Bronze, Silver or Gold Certifications"
            from="#8DE09D"
            to="#60C473"
            onPress={() => nav.push('MyCertifications')}
            onInfo={() => ui.alert('My Certifications', certificationsInfo ? htmlToPlain(certificationsInfo.html) : '', [{ text: 'OK' }])}
            testID="dashboard-certifications"
          />
          <OptionCard
            title="My Incentives"
            text="Apply to avail incentives"
            from="#6DC5C5"
            to="#4C9A9B"
            onPress={() => nav.push('Incentives')}
            onInfo={() => ui.alert('My Incentives', incentivesInfo ? htmlToPlain(incentivesInfo.html) : '', [{ text: 'OK' }])}
            testID="dashboard-incentives"
          />
          <ZedGearDivider />
          {steps ? (
            <View style={styles.steps} testID="certification-steps">
              <Text style={styles.stepsTitle}>ZED CERTIFICATION STEPS</Text>
              {stepItems.length > 0 ? (
                stepItems.map((step, i) => (
                  <View key={i} style={styles.step} testID={`certification-step-${i + 1}`}>
                    <Icon icon={STEP_ICONS[Math.min(i, STEP_ICONS.length - 1)] ?? icons.ic_step_5} width={40} height={46} />
                    <View style={styles.stepTexts}>
                      {step.label ? <Text style={styles.stepLabel}>{step.label}</Text> : null}
                      {step.value ? <Text style={styles.stepValue}>{step.value}</Text> : null}
                    </View>
                  </View>
                ))
              ) : (
                <HtmlText html={steps.html} style={styles.value} />
              )}
            </View>
          ) : null}
        </View>
      </ScrollView>
    </ScreenFrame>
  );
}

/**
 * my_certifications_background / my_incentives_background: the info icon at the top left, the arrow box at the top
 * right, the title and the line under it at the bottom.
 */
function OptionCard({
  title,
  text,
  from,
  to,
  onPress,
  onInfo,
  testID,
}: {
  title: string;
  text: string;
  from: string;
  to: string;
  onPress: () => void;
  onInfo: () => void;
  testID: string;
}) {
  return (
    <Pressable style={styles.optionCard} onPress={onPress} testID={testID}>
      <GradientFill from={from} to={to} angle="diagonal" radius={8} />
      <View style={styles.optionTop}>
        <Pressable onPress={onInfo} hitSlop={12} testID={`${testID}-info`}>
          <Icon icon={icons.ic_info} size={20} />
        </Pressable>
        <Icon icon={icons.ic_dashboard_arrow} />
      </View>
      <Text style={[textStyles.subheading, styles.optionTitle]}>{title}</Text>
      <Text style={styles.optionText}>{text}</Text>
    </Pressable>
  );
}

const STEP_ICONS = [icons.ic_step_1, icons.ic_step_2, icons.ic_step_3, icons.ic_step_4, icons.ic_step_5];

/**
 * prepareCertificationSteps: the Admin's list (<li><b>label</b><br>value</li>) as label and value per step, each with
 * its numbered circle (layout_certification_step). Text without a list keeps showing as it is.
 */
export function parseSteps(html: string): { label: string; value: string }[] {
  const items = [...html.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)].map(m => m[1] ?? '');
  return items
    .map(item => {
      const bold = item.match(/<(b|strong)[^>]*>([\s\S]*?)<\/\1>/i);
      const label = bold ? htmlToPlain(bold[2] ?? '').trim() : '';
      const rest = bold ? item.replace(bold[0], '') : item;
      const value = htmlToPlain(rest.replace(/^\s*(<br\s*\/?>\s*)+/i, '')).trim();
      return { label, value };
    })
    .filter(step => step.label !== '' || step.value !== '');
}

function enterpriseTypeImage(type: string | null | undefined) {
  if (type === 'Micro') return images.ic_micro;
  if (type === 'Small') return images.ic_small;
  if (type === 'Medium') return images.ic_medium;
  return null;
}

/** layout_enterprise_details_dashboard via ComplianceFragment.prepareRows. */
export function EnterpriseCard({ details }: { details: MsmeDetails }) {
  const typeImage = enterpriseTypeImage(details.BasicDetails?.EnterpriseTypee);
  return (
    <View style={styles.enterprise} testID="enterprise-card">
      {typeImage ? <Image source={typeImage} style={{ margin: dimens.padding1 }} /> : null}
      <Text style={styles.enterpriseName}>{details.PlantDetails?.UnitName ?? ''}</Text>
      {details.PlantDetails ? (
        <View style={{ paddingVertical: dimens.padding1 }}>
          <Text style={styles.label}>Unit Address</Text>
          <Text style={styles.value}>{plantAddress(details.PlantDetails)}</Text>
        </View>
      ) : null}
    </View>
  );
}

/** layout_divider_zed_gear */
export function ZedGearDivider() {
  return (
    <View style={styles.gear}>
      <View style={styles.gearLine} />
      <Image source={images.ic_zed_gear_grey} style={styles.gearImage} resizeMode="contain" />
    </View>
  );
}

/** DashboardActivity.startRefresh: GetMsmeStatus, taken into the stored data (updateCertificationDetails). */
export async function refreshStatus(app: ReturnType<typeof useMsme>) {
  if (!app.loginId || !(await isNetworkAvailable())) return;
  const server = await app.api.getMsmeStatus(app.loginId);
  const local = app.user?.MsmeDetails?.msmeStatus;
  if (!isSuccess(server) || !local) return;
  updateCertificationDetails(local, server);
  await app.persist();
}

/**
 * DashboardActivity.onCertificationClick: the parameters are fetched once (GetParametersByType) and kept,
 * then the certification's options open.
 */
export function useCertificationClick() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  return async (type: CertificationType) => {
    const details = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type);
    if (details?.parameters && details.parameters.length > 0) {
      nav.push('CertificationOptions', { certificationType: type });
      return;
    }
    if (!app.loginId) return;
    ui.showLoading();
    let response;
    try {
      response = await app.api.getParametersByType(app.loginId, type);
    } catch (e) {
      response = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(response) && response.parameters && response.parameters.length > 0) {
      const target = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type);
      if (target) target.parameters = normalizeElements(response.parameters);
      await app.persist();
      if (target) nav.push('CertificationOptions', { certificationType: type });
    } else {
      ui.toast(errorOf(response), { long: true });
    }
  };
}

const styles = StyleSheet.create({
  container: { margin: dimens.padding1, padding: dimens.padding2 },
  enterprise: { ...shapes.greyRectangle, margin: dimens.padding1, padding: dimens.padding2 },
  enterpriseName: { margin: dimens.padding1, fontSize: 20, fontWeight: 'bold', color: colors.black },
  label: { padding: 3, color: colors.labelColor, fontSize: dimens.textSize },
  value: { padding: 3, color: colors.textColor, fontSize: dimens.textSize },
  headerRight: { flexDirection: 'row', alignItems: 'center' },
  refresh: { marginLeft: dimens.padding1, padding: 2 },
  optionCard: { margin: dimens.padding2, padding: dimens.padding3, borderRadius: 8, overflow: 'hidden', minHeight: 140 },
  optionTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: dimens.padding4 },
  optionTitle: { color: colors.white, marginBottom: dimens.padding1, marginTop: 'auto' },
  optionText: { color: colors.white, fontSize: dimens.textSize },
  steps: { ...shapes.lightGreyOutlineFilled, margin: dimens.padding2, padding: dimens.padding3 },
  stepsTitle: { color: colors.labelColor, fontWeight: 'bold', marginBottom: dimens.padding2, fontSize: dimens.textSize },
  step: { flexDirection: 'row', alignItems: 'center', paddingVertical: dimens.padding2 },
  stepTexts: { flex: 1, paddingStart: dimens.padding2 },
  stepLabel: { fontWeight: 'bold', color: colors.black, fontSize: dimens.textSize },
  stepValue: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  gear: { padding: dimens.padding1, alignItems: 'center', justifyContent: 'center' },
  gearLine: { position: 'absolute', left: dimens.padding1, right: dimens.padding1, height: 1, backgroundColor: colors.labelColor },
  gearImage: { height: 36, width: 46, backgroundColor: colors.white, padding: dimens.padding1 },
});
