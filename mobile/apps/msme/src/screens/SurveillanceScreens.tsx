import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  isNetworkAvailable,
  isNetworkError,
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
  ZedDialog,
  type BaseServiceResponse,
  type PhotoData,
} from '@zed/shared';
import { useMsme } from '../app/context';
import { useScreenCapture } from '../components/capture';
import { certificationDetailsOf, remoteAssessmentIsValid, surveillanceInfo, type CertificationType } from '../models';
import { queueSurveillance } from '../sync/queue';
import { submitSurveillance } from '../sync/submissions';

const NETWORK_UNAVAILABLE = 'Network Unavailable';

/** SurveillanceActivity (reached only when the server marks the surveillance active for today). */
export function SurveillanceScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const capturer = useScreenCapture('toast');
  const details = certificationDetailsOf(app.user?.MsmeDetails?.msmeStatus, type);
  const [askingName, setAskingName] = useState<((name: string | null) => void) | null>(null);
  const [, rerender] = useState(0);
  if (!details) return null;
  const data = surveillanceInfo(details);

  const update = (fn: () => void) => {
    fn();
    rerender(x => x + 1);
    app.persist();
  };

  const sync = async () => {
    if (!app.loginId) return;
    if (!(await isNetworkAvailable())) {
      // New: kept and sent when the connection returns.
      await queueSurveillance(app, type);
      ui.toast('Saved on the phone. It will be sent when the connection returns.', { long: true });
      return;
    }
    ui.showLoading();
    let r: BaseServiceResponse;
    try {
      r = await submitSurveillance(app, type);
    } catch (e) {
      if (isNetworkError(e)) await queueSurveillance(app, type);
      r = { status: '0', errorMessage: UNKNOWN_ERROR };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r)) ui.showAlert('Data submitted successfully');
    else ui.showAlert(errorOf(r));
    rerender(x => x + 1);
  };

  return (
    <ScreenFrame title="Surveillance Assessment" backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="surveillance">
      <ScrollView>
        <PhotosField
          label="Selfie"
          photos={data.selfie ? [data.selfie] : []}
          onChange={l => update(() => (data.selfie = l[0] ?? null))}
          capturer={capturer}
          store={app.photos}
          testID="surveillance-selfie"
        />
        <PhotosField
          label="Exterior Photo with name board (2 photographs required)"
          photos={data.exteriorPhotos}
          maxPhotos={2}
          onChange={l => update(() => (data.exteriorPhotos = l))}
          capturer={capturer}
          store={app.photos}
          testID="surveillance-exterior"
        />
        <PhotosField
          label="Interior Photo (2 photographs required)"
          photos={data.interiorPhotos}
          maxPhotos={2}
          onChange={l => update(() => (data.interiorPhotos = l))}
          capturer={capturer}
          store={app.photos}
          testID="surveillance-interior"
        />
        <PhotosField
          label="Site Tour"
          photos={data.siteTourPhotos}
          maxPhotos={100}
          allowReplace
          askName={() => new Promise<string | null>(resolve => setAskingName(() => resolve))}
          onChange={l => update(() => (data.siteTourPhotos = l))}
          capturer={capturer}
          store={app.photos}
          testID="surveillance-site-tour"
        />
        <ZedButton title="Sync" small onPress={sync} testID="surveillance-sync" />
      </ScrollView>
      {askingName ? (
        <SitePhotoNameDialog
          onDone={name => {
            askingName(name);
            setAskingName(null);
          }}
        />
      ) : null}
    </ScreenFrame>
  );
}

/** SitePhotoNameFragment: the name is mandatory (the close button only says so). */
function SitePhotoNameDialog({ onDone }: { onDone: (name: string) => void }) {
  const ui = useUi();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | undefined>();
  return (
    <ZedDialog visible title="Site Tour Photo Name" cancelable={false} onClose={() => ui.snackbar('Photo name is mandatory')} testID="site-photo-name">
      <TextField label="Please enter site tour photo name" value={name} onChange={v => (setName(v), setError(undefined))} error={error} testID="site-photo-name-input" />
      <ZedButton
        title="Done"
        small
        testID="site-photo-name-done"
        onPress={() => {
          const v = valueOrNull(name);
          if (v == null) return setError(REQUIRED);
          onDone(v);
        }}
      />
    </ZedDialog>
  );
}

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

  const startAssessment = async () => {
    if (!(await isNetworkAvailable())) return ui.toast(NETWORK_UNAVAILABLE, { long: true });
    if (!app.loginId) return;
    ui.showLoading();
    try {
      const r = await app.api.getTwilioToken(app.loginId, type);
      if (r.token && r.token.trim() !== '') {
        // The legacy app opened Twilio's video sample (quickstart VideoActivity); see mobile/docs/MSME-PARITY.md.
        ui.showAlert('The video assessment is not available in this version of the app. Please use the meeting link shared by QCI.');
      } else {
        ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
      }
    } catch (e) {
      ui.toast(e instanceof Error ? e.message : UNKNOWN_ERROR, { long: true });
    } finally {
      ui.hideLoading();
    }
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
        {data.isSelfieSubmitted ? (
          <ZedButton title="Start Assessment" onPress={startAssessment} testID="remote-start" />
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
