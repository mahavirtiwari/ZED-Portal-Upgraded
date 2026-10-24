import React, { useEffect, useRef } from 'react';
import { BackHandler, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  GradientFill,
  Icon,
  isSuccess,
  ScreenFrame,
  shapes,
  textStyles,
  useBackHandler,
  useNavigation,
  useRoute,
  useUi,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { SyncAllButton } from '../components/SyncAllButton';
import { certificationDetailsOf, normalizeElements, plantAddress, type CertificationType, type MsmeDetails } from '../models';

/** DashboardActivity */
export function DashboardScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const route = useRoute<{ fromLogin?: boolean }>();
  const openDrawer = useOpenDrawer('dashboard');
  const started = useRef(false);
  const details = app.user?.MsmeDetails;

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    // prepareViews: MyCertificationsFragment is added at once; after login the Enterprise Profile opens on top.
    nav.push('MyCertifications');
    if (route.params?.fromLogin) nav.push('MyAccount', { showProceed: true, hideHeaderMenu: true });
  }, [nav, route.params?.fromLogin]);

  // onBackPressed with no fragment: "Are you sure you want to exit?"
  useBackHandler(() => {
    ui.alert(null, 'Are you sure you want to exit?', [{ text: 'No' }, { text: 'Yes', onPress: () => BackHandler.exitApp() }]);
    return true;
  });

  return (
    <ScreenFrame title="Dashboard" onMenu={openDrawer} headerRight={<SyncAllButton />} testID="dashboard">
      <ScrollView>
        <View style={styles.container}>
          <Text style={[textStyles.subheading, { marginTop: 0, color: colors.appColor }]}>Welcome</Text>
          {details ? <EnterpriseCard details={details} /> : null}
          <Pressable style={styles.certCard} onPress={() => nav.push('MyCertifications')} testID="dashboard-certifications">
            <GradientFill from="#8DE09D" to="#60C473" angle="diagonal" radius={8} />
            <View style={styles.certRow}>
              <Text style={[textStyles.subheading, styles.certTitle]}>Bronze Surveillance</Text>
              <Icon icon={icons.ic_dashboard_arrow} />
            </View>
          </Pressable>
          <ZedGearDivider />
        </View>
      </ScrollView>
    </ScreenFrame>
  );
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
  certCard: { margin: dimens.padding2, padding: dimens.padding3, borderRadius: 8, overflow: 'hidden' },
  certRow: { flexDirection: 'row', alignItems: 'flex-start' },
  certTitle: { color: colors.white, flex: 1 },
  gear: { padding: dimens.padding1, alignItems: 'center', justifyContent: 'center' },
  gearLine: { position: 'absolute', left: dimens.padding1, right: dimens.padding1, height: 1, backgroundColor: colors.labelColor },
  gearImage: { height: 36, width: 46, backgroundColor: colors.white, padding: dimens.padding1 },
});
