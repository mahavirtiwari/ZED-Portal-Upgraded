import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  BackBar,
  colors,
  dimens,
  errorOf,
  formatDate,
  isNetworkAvailable,
  isSuccess,
  OutlinedButton,
  parseLegacyDate,
  ScreenFrame,
  shapes,
  useFocusEffect,
  useNavigation,
  useUi,
  ZedDialog,
} from '@zed/shared';
import type { CertificationStatusResponse } from '../api';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { CertificationCard, certificationCardState } from '../components/CertificationCard';
import { certificationStatus, CertificationStatusDialog, type CertificationStatus } from '../components/CertificationStatusDialog';
import { openDocument } from '../components/documents';
import { SyncAllButton } from '../components/SyncAllButton';
import { certificationDetailsOf, type CertificationType, type MsmeStatus } from '../models';
import { DarkHeading } from '../ui/legacy';
import { refreshStatus, useCertificationClick } from './DashboardScreen';

/** showCertificationInfo: the level's two lines (donottranslate.xml bronze_info_one ... gold_info_two). */
const LEVEL_INFO: Record<CertificationType, { title: string; lines: [string, string] }> = {
  Bronze: {
    title: 'Bronze Certification',
    lines: [
      'This level has 5 parameters, which need to be conformed to, for achieving a Certification.',
      'The certification cost is Rs. 10,000/- inclusive of taxes, subsidy, as applicable.',
    ],
  },
  Silver: {
    title: 'Silver Certification',
    lines: [
      'This level has 14 parameters, which need to be conformed to, for achieving a Certification.',
      'The certification cost is Rs. 40,000/- inclusive of taxes; subsidy, as applicable.',
    ],
  },
  Gold: {
    title: 'Gold Certification',
    lines: [
      'This level has 20 parameters, which need to be conformed to, for achieving a Certification.',
      'The certification cost is Rs. 90,000/- inclusive of taxes; subsidy, as applicable.',
    ],
  },
};

const LEVELS: { type: CertificationType; title: string; color: string; image: number }[] = [
  { type: 'Bronze', title: 'BRONZE CERTIFICATION', color: colors.bronze, image: images.bronze },
  { type: 'Silver', title: 'SILVER CERTIFICATION', color: colors.silver, image: images.silver },
  { type: 'Gold', title: 'GOLD CERTIFICATION', color: colors.gold, image: images.gold },
];

/** MyCertificationsFragment ("ZED Certifications"): Bronze, Silver and Gold, then the ZED Pledge Certificate. */
export function MyCertificationsScreen() {
  const app = useMsme();
  const ui = useUi();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('dashboard');
  const onCertificationClick = useCertificationClick();
  const status = app.user?.MsmeDetails?.msmeStatus ?? null;
  // MsmeDetails.getFormattedPledgeDate: "MMM dd, yyyy"; nothing when the date cannot be read.
  const pledgeDate = formatPledgeDate(app.user?.MsmeDetails?.DateOfPledge);
  const [info, setInfo] = useState<CertificationType | null>(null);
  const [statusOf, setStatusOf] = useState<{ level: CertificationType; status: CertificationStatus } | null>(null);

  const openStatus = async (level: CertificationType) => {
    if (!(await isNetworkAvailable())) return ui.toast('Network Unavailable', { long: true });
    ui.showLoading();
    let r: CertificationStatusResponse;
    try {
      r = await app.api.getCertificationStatus(level);
    } catch (e) {
      r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r) && r.steps) setStatusOf({ level, status: certificationStatus(level, r.steps) });
    else ui.toast(errorOf(r), { long: true });
  };
  useFocusEffect(useCallback(() => void refreshStatus(app).catch(() => undefined), [app]));

  return (
    <ScreenFrame title="ZED Certifications" onMenu={openDrawer} headerRight={<SyncAllButton />}>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          {LEVELS.map(level => {
            const details = certificationDetailsOf(status, level.type);
            const action = certificationAction(status, level.type);
            // setCertificationStatus is only called when the details exist; otherwise the card keeps its defaults.
            const state = certificationCardState(details, level.type === 'Bronze', details != null && action === 'none');
            return (
              <CertificationCard
                key={level.type}
                title={level.title}
                titleColor={level.color}
                image={level.image}
                action={action}
                state={state}
                onApply={() => nav.push('Payment', { certificationType: level.type })}
                onOpen={() => onCertificationClick(level.type)}
                onInfo={() => setInfo(level.type)}
                // VIEW DETAILS: once the level has started (the card past Get Started).
                onDetails={details != null && action !== 'apply' && state.statusText !== 'Get Started' ? () => openStatus(level.type) : null}
                testID={`${level.type.toLowerCase()}-card`}
              />
            );
          })}
          <View style={{ marginHorizontal: dimens.padding2 }}>
            <DarkHeading title="ZED Pledge Certificate" />
          </View>
          <View style={styles.pledgeBox}>
            {pledgeDate ? <Text style={styles.pledgeDate}>Pledge taken on {pledgeDate}</Text> : null}
            <OutlinedButton title="Download" color={colors.darkGrey} onPress={() => openDocument(app, ui, 'pledge', 'Pledge Certificate')} testID="pledge-download" />
          </View>
        </ScrollView>
      </View>
      {info ? <CertificationInfoDialog type={info} onClose={() => setInfo(null)} /> : null}
      {statusOf ? <CertificationStatusDialog level={statusOf.level} status={statusOf.status} onClose={() => setStatusOf(null)} /> : null}
    </ScreenFrame>
  );
}

/** dialog_certification_info: the level's title and its two bullet lines. */
function CertificationInfoDialog({ type, onClose }: { type: CertificationType; onClose: () => void }) {
  const { title, lines } = LEVEL_INFO[type];
  return (
    <ZedDialog visible title={title} onClose={onClose} testID="certification-info">
      {lines.map(line => (
        <View key={line} style={styles.infoLine}>
          <Text style={styles.infoText}>{'•'}</Text>
          <Text style={[styles.infoText, { flex: 1, paddingHorizontal: dimens.padding2 }]}>{line}</Text>
        </View>
      ))}
    </ZedDialog>
  );
}

/** DateOfPledge ("MM/dd/yyyy hh:mm:ss a") as "MMM dd, yyyy"; '' when it cannot be read. */
export function formatPledgeDate(value: string | null | undefined): string {
  const d = parseLegacyDate(value);
  return d ? formatDate(d, 'MMM dd, yyyy') : '';
}

/**
 * handleCertificationAction: APPLY when the level has no details or all three are inactive; the arrow for status 1-4;
 * for status 0, Silver and Gold may be applied for when the levels below allow it; otherwise nothing.
 */
export function certificationAction(status: MsmeStatus | null, type: CertificationType): 'apply' | 'arrow' | 'none' {
  const details = certificationDetailsOf(status, type);
  const of = (t: CertificationType) => certificationDetailsOf(status, t)?.status;
  const allInactive = status != null && of('Bronze') === 0 && of('Silver') === 0 && of('Gold') === 0;
  if (details == null || allInactive) return 'apply';
  if (details.status >= 1 && details.status <= 4) return 'arrow';
  if (details.status === 0) {
    const bronze = of('Bronze');
    if (type === 'Silver' && (bronze === 3 || bronze === 0) && of('Gold') === 0) return 'apply';
    if (type === 'Gold' && (bronze === 0 || bronze === 3) && (of('Silver') === 0 || of('Silver') === 4)) return 'apply';
  }
  return 'none';
}

const styles = StyleSheet.create({
  infoLine: { flexDirection: 'row', padding: dimens.padding1 },
  infoText: { color: colors.black, fontSize: dimens.textSize, lineHeight: 23 },
  pledgeBox: { ...shapes.greyRectangle, margin: dimens.padding2, padding: dimens.padding2 },
  pledgeDate: { color: colors.black, fontSize: dimens.textSize, marginBottom: dimens.padding1 },
});
