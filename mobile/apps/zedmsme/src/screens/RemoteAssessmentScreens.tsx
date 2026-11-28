import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  CustomFormField,
  customFieldsPayload,
  customRowPhotos,
  dimens,
  FieldHelp,
  htmlToPlain,
  isFieldShown,
  isFormChangedRefusal,
  isNetworkAvailable,
  isSuccess,
  PhotosField,
  REQUIRED,
  RowsFormField,
  ScreenFrame,
  shapes,
  TextField,
  UNKNOWN_ERROR,
  useAppText,
  useNavigation,
  useRoute,
  useUi,
  validateForm,
  valueOrNull,
  ZedButton,
  type BaseServiceResponse,
  type FormDefinition,
  type FormField,
  type PhotoData,
} from '@zed/shared';
import { useMsme } from '../app/context';
import { useScreenCapture } from '../components/capture';
import { MSME_REMOTE_ASSESSMENT } from '../forms';
import { type CertificationType, type RemoteAssessmentData } from '../models';

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

/** The value of a field of the Remote Assessment form in the kept data (standard fields in their legacy properties). */
function remoteValue(data: RemoteAssessmentData, f: Pick<FormField, 'key' | 'custom'>): unknown {
  if (f.custom) return data.customAnswers?.[f.key];
  switch (f.key) {
    case 'representativeName':
      return data.representativeName;
    case 'representativeDesignation':
      return data.representativeDesignation;
    case 'representativeSelfie':
      return data.selfie ? [data.selfie] : [];
    case 'siteExteriorPhoto':
      return data.siteExteriorPhoto ? [data.siteExteriorPhoto] : [];
    default:
      // A standard field this build does not know (kept, not sent: it has no request property here).
      return (data as unknown as Record<string, unknown>)[f.key];
  }
}

/** The form in use (the server's, kept for offline use, else the app's own); re-renders when it changes. */
function useRemoteForm(app: ReturnType<typeof useMsme>): FormDefinition {
  useSyncExternalStore(
    l => app.forms.subscribe(l),
    () => app.forms.getRevision(),
  );
  return app.forms.get(MSME_REMOTE_ASSESSMENT);
}

/**
 * RemoteAssessmentDetailsActivity: representative, selfie and site photo, then the assessor's call. 2026-11-28 (the owner):
 * built from Admin → App Forms (msme.remoteAssessment): labels, help, order, required and shown come from the definition;
 * the standard fields keep their controls; the Admin's own fields are added.
 */
export function RemoteAssessmentDetailsScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const capturer = useScreenCapture('toast');
  const def = useRemoteForm(app);
  const submitText = useAppText('app.msme.remote.submit');
  const submittedText = useAppText('app.msme.remote.submitted');
  const data = app.user!.remoteAssessmentData;
  const locked = data.isSelfieSubmitted;
  const [errors, setErrors] = useState<Map<string, string>>(new Map());
  const [, rerender] = useState(0);
  const update = (fn: () => void, key?: string) => {
    fn();
    if (key && errors.has(key)) {
      const e = new Map(errors);
      e.delete(key);
      setErrors(e);
    }
    rerender(x => x + 1);
    app.persist();
  };
  const valueOf = (key: string) => {
    const f = def.fields.find(x => x.key === key);
    return remoteValue(data, f ?? { key, custom: key.startsWith('cf_') });
  };

  // A newer definition is asked for when the screen opens online (the kept one is shown meanwhile).
  useEffect(() => {
    isNetworkAvailable()
      .then(online => (online ? app.forms.refresh(MSME_REMOTE_ASSESSMENT, () => app.api.getFormDefinition(MSME_REMOTE_ASSESSMENT)) : false))
      .catch(() => undefined);
  }, [app]);

  const withFile = async (p: PhotoData | null | undefined): Promise<PhotoData | null> =>
    p ? { ...p, photo: (await app.photos.get(p.photoId))?.photo ?? null } : null;

  const submit = async () => {
    const e = validateForm(def, f => remoteValue(data, f));
    setErrors(e);
    if (e.size > 0) return ui.showAlert([...e.values()].find(m => m !== REQUIRED) ?? 'Please provide required details');
    if (!app.loginId) return;
    const shown = new Set(def.fields.filter(f => !f.custom && isFieldShown(f, valueOf)).map(f => f.key));
    const answers = data.customAnswers ?? {};
    const rowPhotos = await Promise.all(customRowPhotos<PhotoData>(def, answers, valueOf).map(withFile));
    ui.showLoading();
    let r: BaseServiceResponse;
    try {
      r = await app.api.submitSelfie(app.loginId, type, {
        representativeName: shown.has('representativeName') ? valueOrNull(data.representativeName ?? '') : null,
        representativeDesignation: shown.has('representativeDesignation') ? valueOrNull(data.representativeDesignation ?? '') : null,
        photo: shown.has('representativeSelfie') ? await withFile(data.selfie) : null,
        siteExteriorPhoto: shown.has('siteExteriorPhoto') ? await withFile(data.siteExteriorPhoto) : null,
        customFields: customFieldsPayload(def, answers, valueOf),
        formVersion: def.version,
        customPhotos: rowPhotos.filter((p): p is PhotoData => p != null && !!p.photo),
      });
    } catch (err) {
      r = { status: '0', errorMessage: err instanceof Error ? err.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r)) update(() => (data.isSelfieSubmitted = true));
    else {
      ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
      // The Admin changed the form since it was loaded: the new one is shown to be filled in again.
      if (isFormChangedRefusal(r.errorMessage)) await app.forms.refresh(MSME_REMOTE_ASSESSMENT, () => app.api.getFormDefinition(MSME_REMOTE_ASSESSMENT));
    }
  };

  const renderField = (f: FormField) => {
    if (!isFieldShown(f, valueOf)) return null;
    const error = errors.get(f.key);
    const setCustom = (v: unknown) => update(() => (data.customAnswers = { ...(data.customAnswers ?? {}), [f.key]: v }), f.key);
    if (f.custom && f.type === 'rows') {
      return (
        <RowsFormField key={f.key} field={f} value={data.customAnswers?.[f.key]} onChange={setCustom} error={error} capturer={capturer} store={app.photos} />
      );
    }
    if (f.custom) return <CustomFormField key={f.key} field={f} value={data.customAnswers?.[f.key]} onChange={setCustom} error={error} />;
    let control: React.ReactNode;
    switch (f.key) {
      case 'representativeName':
      case 'representativeDesignation': {
        const prop = f.key;
        control = (
          <TextField
            label={f.label}
            value={data[prop] ?? ''}
            onChange={v => update(() => (data[prop] = v), f.key)}
            disabled={locked}
            error={error}
            testID={prop === 'representativeName' ? 'remote-name' : 'remote-designation'}
          />
        );
        break;
      }
      case 'representativeSelfie':
      case 'siteExteriorPhoto': {
        const selfie = f.key === 'representativeSelfie';
        const current = selfie ? data.selfie : data.siteExteriorPhoto;
        control = (
          <PhotosField
            label={f.label}
            photos={current ? [current] : []}
            maxPhotos={1}
            allowDelete={!locked}
            onChange={l => update(() => (selfie ? (data.selfie = l[0] ?? null) : (data.siteExteriorPhoto = l[0] ?? null)), f.key)}
            capturer={capturer}
            store={app.photos}
            testID={selfie ? 'remote-selfie' : 'remote-site-photo'}
          />
        );
        break;
      }
      default:
        // A standard field this build does not know: shown with the control of its type and kept with the data.
        return (
          <CustomFormField
            key={f.key}
            field={f}
            value={remoteValue(data, f)}
            onChange={v => update(() => ((data as unknown as Record<string, unknown>)[f.key] = v), f.key)}
            error={error}
          />
        );
    }
    return (
      <View key={f.key}>
        {control}
        <FieldHelp text={f.help} />
      </View>
    );
  };

  return (
    <ScreenFrame title={def.name || 'Remote Assessment'} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID="remote-details">
      <ScrollView contentContainerStyle={{ padding: dimens.padding1 }} keyboardShouldPersistTaps="handled">
        {def.sections.map(section => {
          const fields = def.fields.filter(f => f.section === section.key);
          return fields.length ? <View key={section.key}>{fields.map(renderField)}</View> : null;
        })}
        {def.fields.filter(f => !def.sections.some(s => s.key === f.section)).map(renderField)}
        {/* ZED MSME: no "Start Assessment": video calls (Twilio) were removed from ZED; the assessor contacts the unit. */}
        {locked ? (
          <Text style={styles.value} testID="remote-submitted">
            {submittedText ? htmlToPlain(submittedText.html) : 'Remote assessment details submitted.'}
          </Text>
        ) : (
          <ZedButton title={submitText ? htmlToPlain(submitText.html) : 'Submit'} onPress={submit} testID="remote-submit-selfie" />
        )}
      </ScrollView>
    </ScreenFrame>
  );
}

const styles = StyleSheet.create({
  label: { padding: 3, color: colors.labelColor, fontSize: dimens.textSize },
  value: { padding: 3, color: colors.textColor, fontSize: dimens.textSize },
});
