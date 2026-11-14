import React from 'react';
import { Linking, ScrollView, View } from 'react-native';
import {
  BackBar,
  colors,
  dimens,
  htmlToPlain,
  isToday,
  ScreenFrame,
  sharedIcons,
  shapes,
  useAppText,
  useNavigation,
  useRoute,
  useUi,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { CertificationCard, certificationCardState } from '../components/CertificationCard';
import { ClickableOption } from '../components/ClickableOption';
import { openDocument } from '../components/documents';
import { SyncAllButton } from '../components/SyncAllButton';
import {
  anyActiveNc,
  certificationDetailsOf,
  isAnyCertificationCompleted,
  isSurveillanceNcActive,
  parsedSurveillanceDate,
  certificationLabel,
  isDesktopLevel,
  isLegacyLevel,
  Status,
  type CertificationType,
} from '../models';
import { levelDisplayName, publicLevel, v4LevelImage } from '../levels';

/** CertificationOptionsFragment */
export function CertificationOptionsScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const openDrawer = useOpenDrawer('dashboard');
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const status = app.user?.MsmeDetails?.msmeStatus ?? null;
  const details = certificationDetailsOf(status, type);
  const alert = (message: string) => ui.alert('Alert', message, [{ text: 'OK' }], false);
  // Admin text app.msme.certification.readOnly (the legacy wording until the server's arrives).
  const readOnlyText = useAppText('app.msme.certification.readOnly');
  const READ_ONLY_MESSAGE = readOnlyText ? htmlToPlain(readOnlyText.html) : '';
  const open = (url: string) => Linking.openURL(url).catch(() => ui.toast('No suitable application found to perform this action'));

  const onBasicInfo = () => {
    if (details?.status != null && details.status >= 2) {
      alert(READ_ONLY_MESSAGE);
    } else if (details?.basicInformation?.status === Status.SUBMITTED) {
      if (details.finalSubmitDone) alert(READ_ONLY_MESSAGE);
      else nav.push('Evidences', { certificationType: type });
    } else {
      // 2026-11-08: first the undertaking of compliances and the certification requirements, as in the old app.
      nav.push('Compliance', { certificationType: type });
    }
  };

  const ncActive = details ? anyActiveNc(details) : null;
  const showCertificate = !!details?.certificate?.trim();
  const showReport = !!details?.report?.trim();
  const showIncentives = (status ? isAnyCertificationCompleted(status) : false) && !!details?.incentives?.trim();
  const showRemote = details?.remoteStatus === '1';
  // Only the surveillance round's NC replies (status "3"): status "1", the surveillance itself, is the desktop
  // assessor's data entry in the ZED Surveillance app.
  const showSurveillanceNc = details ? isSurveillanceNcActive(details) : false;
  // ZED-X and (2026-11-08) the levels the Admin added: the Admin's logo and name.
  const image =
    type === 'Bronze'
      ? images.bronze
      : type === 'Silver'
        ? images.silver
        : type === 'Gold'
          ? images.gold
          : v4LevelImage(type, app.levels, url => app.api.levelLogoUrl(url));
  const name = levelDisplayName(type, app.levels, status);
  // Redesigned 2026-11-07: the steps in the level's colour.
  const tint = type === 'Bronze' ? colors.bronze : type === 'Silver' ? '#8E9499' : type === 'Gold' ? '#B89A3E' : colors.appColorDark;

  return (
    <ScreenFrame title={!isLegacyLevel(type) ? `${name} Certification` : certificationLabel(type)} onMenu={openDrawer} headerRight={<SyncAllButton />}>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ margin: dimens.padding1 }}>
          <CertificationCard
            title=""
            titleColor={colors.bronze}
            showTitle={false}
            image={image}
            action="gone"
            state={{ ...certificationCardState(details, isDesktopLevel(type, status), false, publicLevel(app.levels, type)?.assessmentFlow), overlay: false }}
            testID="options-card"
          />
          <ClickableOption
            label="Basic Information & Document Upload"
            description="Fill in your unit's details and upload the documents."
            tint={tint}
            left={icons.ic_basic_info_doc_upload}
            right={icons.ic_forward_arrow}
            onPress={onBasicInfo}
            testID="option-basic-info"
          />
          {ncActive !== false ? (
            <ClickableOption
              label="Non-conformances"
              left={images.ic_non_conformance}
              right={icons.ic_forward_arrow}
              style={shapes.ncRectangle}
              overlay={ncActive !== true}
              onPress={() => nav.push('NonConformances', { certificationType: type })}
              testID="option-nc"
            />
          ) : null}
          {showCertificate ? (
            <ClickableOption
              label="Certificate Download"
              description={`Your ${name} certificate.`}
              tint={tint}
              left={icons.ic_basic_info_doc_upload}
              right={icons.ic_download}
              // The certificate's address is no public file in V4: downloaded with the sign-in token (Msme/AppDocument).
              onPress={() => openDocument(app, ui, details!.certificate!.trim(), `${name} Certificate`)}
              testID="option-certificate"
            />
          ) : null}
          {showReport ? (
            // The legacy option has no click listener.
            <ClickableOption label="Download Report" description="Your assessment report." tint={tint} left={icons.ic_basic_info_doc_upload} right={icons.ic_download} testID="option-report" />
          ) : null}
          {showIncentives ? (
            <ClickableOption
              label="Incentives"
              description="Incentives you can apply for."
              tint={tint}
              left={icons.ic_incentives}
              right={icons.ic_external_link}
              onPress={() => open(details!.incentives!)}
              testID="option-incentives"
            />
          ) : null}
          {showRemote ? (
            <ClickableOption
              label="Remote Assessment"
              description="Join your remote assessment."
              tint={tint}
              right={sharedIcons.ic_forward_arrow}
              onPress={() => nav.push('RemoteAssessmentInitial', { certificationType: type })}
              testID="option-remote"
            />
          ) : null}
          {showSurveillanceNc ? (
            <ClickableOption
              label="Surveillance Assessment"
              right={icons.ic_forward_arrow}
              style={shapes.ncRectangle}
              onPress={() => {
                if (isToday(parsedSurveillanceDate(details!))) nav.push('NonConformances', { certificationType: type, isSurveillance: true });
                else alert('This module will be activated on the scheduled assessment date only');
              }}
              testID="option-surveillance"
            />
          ) : null}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}
