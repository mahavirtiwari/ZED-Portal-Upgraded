import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  isNetworkAvailable,
  isSuccess,
  PhotosField,
  REQUIRED,
  ScreenFrame,
  shapes,
  TextField,
  UNKNOWN_ERROR,
  useNavigation,
  useRoute,
  useUi,
  valueOrNull,
  ZedButton,
  type BaseServiceResponse,
  type PhotoData,
} from '@zed/shared';
import { useMsme } from '../app/context';
import { useScreenCapture } from '../components/capture';
import { remoteAssessmentIsValid, type CertificationType } from '../models';

const NETWORK_UNAVAILABLE = 'Network Unavailable';

/** RemoteAssessmentInitialActivity: checks the assessment with RA/CheckAssessment. */
export function RemoteAssessmentInitialScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const [date, setDate] = useState('');
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    (async () => {
      if (!(await isNetworkAvailable())) return ui.toast(NETWORK_UNAVAILABLE, { long: true });
      if (!app.loginId) return;
      ui.showLoading();
      try {
        const r = await app.api.checkAssessment(app.loginId, type);
        if (r.assementDate != null) setDate(r.assementDate);
        if (isSuccess(r) && r.allowCalling) setEnabled(true);
        else ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
      } catch (e) {
        ui.toast(e instanceof Error ? e.message : UNKNOWN_ERROR, { long: true });
      } finally {
        ui.hideLoading();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <ScreenFrame title="Remote Assessment" backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="remote-initial">
      <View style={{ padding: dimens.padding2, margin: dimens.padding1 }}>
        <View style={[shapes.greyRectangle, { padding: dimens.padding2 }]}>
          <Text style={styles.label}>Assessment Date</Text>
          <Text style={styles.value}>{date}</Text>
        </View>
        <ZedButton title="Proceed" disabled={!enabled} onPress={() => nav.replace('RemoteAssessmentDetails', { certificationType: type })} testID="remote-proceed" />
      </View>
    </ScreenFrame>
  );
}

/** RemoteAssessmentDetailsActivity: representative, selfie and site photo, then the video assessment. */
export function RemoteAssessmentDetailsScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const capturer = useScreenCapture('toast');
  const data = app.user!.remoteAssessmentData;
  const [name, setName] = useState(data.representativeName ?? '');
  const [designation, setDesignation] = useState(data.representativeDesignation ?? '');
  const [errors, setErrors] = useState<{ name?: string; designation?: string }>({});
  const [, rerender] = useState(0);
  const update = (fn: () => void) => {
    fn();
    rerender(x => x + 1);
    app.persist();
  };

  const submitSelfie = async () => {
    data.representativeName = valueOrNull(name);
    data.representativeDesignation = valueOrNull(designation);
    setErrors({ name: data.representativeName == null ? REQUIRED : undefined, designation: data.representativeDesignation == null ? REQUIRED : undefined });
    if (!remoteAssessmentIsValid(data)) return ui.showAlert('Please provide required details');
    if (!app.loginId) return;
    const selfie: PhotoData = { ...data.selfie!, photo: (await app.photos.get(data.selfie!.photoId))?.photo ?? null };
    const site: PhotoData = { ...data.siteExteriorPhoto!, photo: (await app.photos.get(data.siteExteriorPhoto!.photoId))?.photo ?? null };
    ui.showLoading();
    let r: BaseServiceResponse;
    try {
      r = await app.api.submitSelfie(app.loginId, type, selfie, data.representativeName!, data.representativeDesignation!, site);
    } catch (e) {
      r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r)) update(() => (data.isSelfieSubmitted = true));
    else ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
  };

  return (
    <ScreenFrame title="Remote Assessment" backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="remote-details">
      <ScrollView contentContainerStyle={{ padding: dimens.padding1 }}>
        <TextField label="Representative Name" value={name} onChange={setName} disabled={!!data.representativeName?.trim()} error={errors.name} />
        <TextField label="Representative Designation" value={designation} onChange={setDesignation} disabled={!!data.representativeDesignation?.trim()} error={errors.designation} />
        <PhotosField
          label="Representative Selfie"
          photos={data.selfie ? [data.selfie] : []}
          allowDelete={!data.isSelfieSubmitted}
          onChange={l => update(() => l.length > 0 && (data.selfie = l[0]))}
          capturer={capturer}
          store={app.photos}
        />
        <PhotosField
          label="Site Exterior Photo"
          photos={data.siteExteriorPhoto ? [data.siteExteriorPhoto] : []}
          allowDelete={!data.isSelfieSubmitted}
          onChange={l => update(() => l.length > 0 && (data.siteExteriorPhoto = l[0]))}
          capturer={capturer}
          store={app.photos}
        />
        {/* ZED MSME: no "Start Assessment": video calls (Twilio) were removed from ZED; the assessor contacts the unit. */}
        {data.isSelfieSubmitted ? (
          <Text style={styles.value} testID="remote-submitted">
            Selfie and site photo submitted.
          </Text>
        ) : (
          <ZedButton title="Submit Selfie" onPress={submitSelfie} testID="remote-submit-selfie" />
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  label: { padding: 3, color: colors.labelColor, fontSize: dimens.textSize },
  value: { padding: 3, color: colors.textColor, fontSize: dimens.textSize },
});
