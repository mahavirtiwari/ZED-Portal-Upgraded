import React from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { BackBar, colors, dimens, OutlinedButton, ScreenFrame, shapes, textStyles, useNavigation, useUi } from '@zed/shared';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { CertificationCard, certificationCardState } from '../components/CertificationCard';
import { openDocument } from '../components/documents';
import { SyncAllButton } from '../components/SyncAllButton';
import { certificationDetailsOf, type CertificationType, type MsmeStatus } from '../models';
import { useCertificationClick } from './DashboardScreen';

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
  const pledgeDate = app.user?.MsmeDetails?.DateOfPledge;

  return (
    <ScreenFrame title="ZED Certifications" onMenu={openDrawer} headerRight={<SyncAllButton />}>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          {LEVELS.map(level => {
            const details = certificationDetailsOf(status, level.type);
            const action = certificationAction(status, level.type);
            return (
              <CertificationCard
                key={level.type}
                title={level.title}
                titleColor={level.color}
                image={level.image}
                action={action}
                // setCertificationStatus is only called when the details exist; otherwise the card keeps its defaults.
                state={certificationCardState(details, level.type === 'Bronze', details != null && action === 'none')}
                onApply={() => nav.push('Payment', { certificationType: level.type })}
                onOpen={() => onCertificationClick(level.type)}
                testID={`${level.type.toLowerCase()}-card`}
              />
            );
          })}
          <Text style={styles.pledgeHeading}>ZED Pledge Certificate</Text>
          <View style={styles.pledgeBox}>
            {pledgeDate ? <Text style={styles.pledgeDate}>Pledge taken on {pledgeDate}</Text> : null}
            <OutlinedButton title="Download" color={colors.darkGrey} onPress={() => openDocument(app, ui, 'pledge', 'Pledge Certificate')} testID="pledge-download" />
          </View>
        </ScrollView>
      </View>
    </ScreenFrame>
  );
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
  pledgeHeading: { ...textStyles.subheading, backgroundColor: colors.appColorDark, color: colors.white, padding: dimens.padding2, marginTop: dimens.padding2 },
  pledgeBox: { ...shapes.greyRectangle, margin: dimens.padding2, padding: dimens.padding2 },
  pledgeDate: { color: colors.black, fontSize: dimens.textSize, marginBottom: dimens.padding1 },
});
