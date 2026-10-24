import React from 'react';
import { Linking, ScrollView, View } from 'react-native';
import { BackBar, colors, dimens, htmlToPlain, isToday, ScreenFrame, sharedIcons, shapes, useAppText, useNavigation, useRoute, useUi } from '@zed/shared';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useOpenDrawer } from '../app/AppDrawer';
import { useMsme } from '../app/context';
import { CertificationCard, certificationCardState } from '../components/CertificationCard';
import { ClickableOption } from '../components/ClickableOption';
import { SyncAllButton } from '../components/SyncAllButton';
import {
  anyActiveNc,
  certificationDetailsOf,
  isAnyCertificationCompleted,
  isSurveillanceActive,
  isSurveillanceNcActive,
  parsedSurveillanceDate,
  Status,
  type CertificationType,
} from '../models';

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
      nav.push('BasicInformation', { certificationType: type });
    }
  };

  const ncActive = details ? anyActiveNc(details) : null;
  const showCertificate = !!details?.certificate?.trim();
  const showReport = !!details?.report?.trim();
  const showIncentives = (status ? isAnyCertificationCompleted(status) : false) && !!details?.incentives?.trim();
  const showRemote = details?.remoteStatus === '1';
  const showSurveillance = details ? isSurveillanceActive(details) : false;
  const image = type === 'Bronze' ? images.bronze : type === 'Silver' ? images.silver : images.gold;

  return (
    <ScreenFrame title="Bronze Surveillance" onMenu={openDrawer} headerRight={<SyncAllButton />}>
      <View style={{ flex: 1, backgroundColor: colors.white }}>
        <BackBar zedId={app.user?.MsmeDetails?.ZedId} onBack={() => nav.pop()} />
        <ScrollView contentContainerStyle={{ margin: dimens.padding1 }}>
          <CertificationCard
            title=""
            titleColor={colors.bronze}
            showTitle={false}
            image={image}
            action="gone"
            state={{ ...certificationCardState(details, type === 'Bronze', false), overlay: false }}
            testID="options-card"
          />
          <ClickableOption
            label="Basic Information & Document Upload"
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
              onPress={() => nav.push('NonConformances', { certificationType: type, isSurveillance: false })}
              testID="option-nc"
            />
          ) : null}
          {showCertificate ? (
            <ClickableOption
              label="Certificate Download"
              left={icons.ic_basic_info_doc_upload}
              right={icons.ic_download}
              onPress={() => open(details!.certificate!)}
              testID="option-certificate"
            />
          ) : null}
          {showReport ? (
            // The legacy option has no click listener.
            <ClickableOption label="Download Report" left={icons.ic_basic_info_doc_upload} right={icons.ic_download} testID="option-report" />
          ) : null}
          {showIncentives ? (
            <ClickableOption
              label="Incentives"
              left={icons.ic_incentives}
              right={icons.ic_external_link}
              onPress={() => open(details!.incentives!)}
              testID="option-incentives"
            />
          ) : null}
          {showRemote ? (
            <ClickableOption
              label="Remote Assessment"
              right={sharedIcons.ic_forward_arrow}
              onPress={() => nav.push('RemoteAssessmentInitial', { certificationType: type })}
              testID="option-remote"
            />
          ) : null}
          {showSurveillance ? (
            <ClickableOption
              label="Surveillance Assessment"
              right={sharedIcons.ic_forward_arrow}
              style={shapes.ncRectangle}
              testID="option-surveillance"
              onPress={() => {
                if (isToday(parsedSurveillanceDate(details!))) {
                  if (isSurveillanceNcActive(details!)) nav.push('NonConformances', { certificationType: type, isSurveillance: true });
                  else nav.push('Surveillance', { certificationType: type });
                } else {
                  alert('This module will be activated on the scheduled assessment date only');
                }
              }}
            />
          ) : null}
        </ScrollView>
      </View>
    </ScreenFrame>
  );
}
