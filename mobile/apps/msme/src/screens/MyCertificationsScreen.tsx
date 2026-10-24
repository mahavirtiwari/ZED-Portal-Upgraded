import React from 'react';
import { ScrollView, View } from 'react-native';
import { BackBar, colors, dimens, ScreenFrame, useNavigation } from '@zed/shared';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { CertificationCard, certificationCardState } from '../components/CertificationCard';
import { SyncAllButton } from '../components/SyncAllButton';
import { certificationDetailsOf, type MsmeStatus } from '../models';
import { useCertificationClick } from './DashboardScreen';

/** MyCertificationsFragment: only the Bronze card in this build (Silver, Gold and the pledge box are gone). */
export function MyCertificationsScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const openDrawer = useOpenDrawer('dashboard');
  const onCertificationClick = useCertificationClick();
  const status = app.user?.MsmeDetails?.msmeStatus ?? null;
  const details = certificationDetailsOf(status, 'Bronze');
  const action = bronzeAction(status);

  return (
    <ScreenFrame title="Bronze Surveillance" onMenu={openDrawer} headerRight={<SyncAllButton />}>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          <CertificationCard
            title="Bronze Surveillance"
            titleColor={colors.bronze}
            image={images.bronze}
            action={action}
            // setCertificationStatus is only called when the details exist; otherwise the card keeps its defaults.
            state={certificationCardState(details, true, details != null && action === 'none')}
            onApply={() => nav.push('Payment', { certificationType: 'Bronze' })}
            onOpen={() => onCertificationClick('Bronze')}
            testID="bronze-card"
          />
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}

/** handleCertificationAction for Bronze. */
export function bronzeAction(status: MsmeStatus | null): 'apply' | 'arrow' | 'none' {
  const bronze = certificationDetailsOf(status, 'Bronze');
  const allInactive =
    status != null && status.bronze?.status === 0 && status.silver?.status === 0 && status.gold?.status === 0;
  if (bronze == null || allInactive) return 'apply';
  if (bronze.status >= 1 && bronze.status <= 4) return 'arrow';
  return 'none';
}
