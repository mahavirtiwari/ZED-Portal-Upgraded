import React, { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  errorOf,
  Icon,
  isNetworkAvailable,
  isNetworkError,
  isSuccess,
  PhotosField,
  REQUIRED,
  ScreenFrame,
  sharedIcons,
  shapes,
  StaticText,
  TextField,
  textStyles,
  UNKNOWN_ERROR,
  useNavigation,
  useRoute,
  useUi,
  valueOrNull,
  ZedButton,
  type BaseServiceResponse,
  HtmlText,
  useAppText,
} from '@zed/shared';
import { icons } from '../assets/icons';
import { useMsme } from '../app/context';
import { useScreenCapture } from '../components/capture';
import { OptionsList } from '../components/OptionsList';
import {
  certificationDetailsOf,
  normalizeNcDetails,
  requirementStatus,
  setNcDetails,
  Status,
  updateMsmeSurveillanceStatus,
  type CertificationDetails,
  type CertificationType,
  type NcDetails,
  type ProductDetailsNc,
  type Requirement,
} from '../models';
import { queueNcProduct, queueNcRequirement, queueNcSitePhotos } from '../sync/queue';
import { submitNcProduct, submitNcRequirement, submitNcSitePhotos } from '../sync/submissions';

const FINAL_SUBMIT_DONE = 'Final Submit Done';
const QUEUED = 'Saved on the phone. It will be sent when the connection returns.';

type NcParams = { certificationType: CertificationType; isSurveillance: boolean };

function useNcContext() {
  const app = useMsme();
  const { certificationType: type, isSurveillance } = useRoute<NcParams & Record<string, unknown>>().params;
  const status = isSurveillance ? app.user?.MsmeDetails?.msmeSurveillanceStatus : app.user?.MsmeDetails?.msmeStatus;
  const details = certificationDetailsOf(status, type);
  return { app, type, isSurveillance, details };
}

/** The legacy fragments of this activity show "Bronze Surveillance" in the header and keep the activity's back bar. */
function NcFrame({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  const app = useMsme();
  const nav = useNavigation();
  return (
    <ScreenFrame title={title} backBar={{ zedId: app.user?.MsmeDetails?.ZedId, onBack: () => nav.pop() }} testID={testID}>
      {children}
    </ScreenFrame>
  );
}

// ---------------------------------------------------------------------------------------------- NonConformancesActivity

export function NonConformancesScreen() {
  const { app, type, isSurveillance, details } = useNcContext();
  const nav = useNavigation();
  const ui = useUi();
  const [ready, setReady] = useState(!isSurveillance);
  const whatIsNc = useAppText('app.msme.nc.whatIsNc');

  // handleSurveillanceFlow: the surveillance statuses come from msme/GetMsmeStatus first.
  useEffect(() => {
    if (!isSurveillance || !app.loginId) return;
    (async () => {
      ui.showLoading();
      try {
        const s = await app.api.getMsmeStatus(app.loginId!, true);
        if (isSuccess(s) && app.user?.MsmeDetails) {
          updateMsmeSurveillanceStatus(app.user.MsmeDetails, s);
          await app.persist();
          setReady(true);
        } else {
          ui.toast(UNKNOWN_ERROR, { long: true });
          nav.pop();
        }
      } catch {
        ui.toast(UNKNOWN_ERROR, { long: true });
        nav.pop();
      } finally {
        ui.hideLoading();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNc = () => {
    if (details?.activeNcDetails != null) nav.push('NcDetails', { certificationType: type, isSurveillance });
  };

  const onNcClicked = async (ncStatus: number, ncCount: number, stored: NcDetails | null | undefined) => {
    if (ncStatus === 1) {
      if (stored == null) {
        if (!app.loginId) return;
        ui.showLoading();
        let r: NcDetails;
        try {
          r = await app.api.getNcDetails(app.loginId, type, ncCount, isSurveillance);
        } catch (e) {
          r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
        } finally {
          ui.hideLoading();
        }
        if (isSuccess(r) && details) {
          setNcDetails(details, normalizeNcDetails(r));
          await app.persist();
          openNc();
        } else {
          ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
        }
      } else {
        openNc();
      }
    } else if (ncStatus === 2) {
      ui.snackbar(FINAL_SUBMIT_DONE);
    }
  };

  const rows: Array<{ n: number; status: number; text?: string | null; stored?: NcDetails | null }> = details
    ? [
        { n: 1, status: details.nc1Status, text: details.nc1StatusText, stored: details.ncOneDetails },
        { n: 2, status: details.nc2Status, text: details.nc2StatusText, stored: details.ncTwoDetails },
        { n: 3, status: details.nc3Status, text: details.nc3StatusText, stored: details.ncThreeDetails },
        { n: 4, status: details.nc4Status, text: details.nc4StatusText, stored: details.ncFourDetails },
        { n: 5, status: details.nc5Status, text: details.nc5StatusText, stored: details.ncFiveDetails },
      ]
    : [];

  return (
    <NcFrame title={isSurveillance ? 'Non-Conformances(Surveillance)' : 'Non-Conformances'} testID="non-conformances">
      <ScrollView>
        <View style={{ margin: dimens.padding2 }}>
          <View style={[shapes.greyOutlineRectangle, { margin: dimens.padding3 }]}>
            {ready &&
              rows.map((row, i) =>
                row.status > 0 ? (
                  <Pressable key={row.n} onPress={() => onNcClicked(row.status, row.n, row.stored)} testID={`nc-${row.n}`}>
                    <View style={styles.ncRow}>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.ncCount}>{`Non-conformance ${row.n}`}</Text>
                        <Text style={styles.ncStatus}>{row.text ?? ''}</Text>
                      </View>
                      <Icon icon={sharedIcons.ic_forward_arrow} />
                    </View>
                    {/* the divider is hidden when the next NC is not active */}
                    {(rows[i + 1]?.status ?? 1) > 0 && row.n < 5 ? <View style={styles.divider} /> : row.n === 5 ? <View style={styles.divider} /> : null}
                  </Pressable>
                ) : null,
              )}
          </View>
          <View style={[shapes.greyRectangle, { margin: dimens.padding3, padding: dimens.padding2 }]}>
            {whatIsNc ? <HtmlText html={whatIsNc.html} style={styles.whatIsNc} paragraphGap={14} testID="what-is-nc" /> : null}
            <Legend icon={icons.nc_to_start} text="Yet to start" />
            <Legend icon={icons.nc_in_progress} text="In Progress" />
            <Legend icon={icons.nc_completed} text="Completed" />
          </View>
        </View>
      </ScrollView>
    </NcFrame>
  );
}

function Legend({ icon, text }: { icon: typeof icons.nc_to_start; text: string }) {
  return (
    <View style={styles.legend}>
      <Icon icon={icon} />
      <Text style={{ marginLeft: dimens.padding2, fontSize: dimens.textSize, color: colors.black }}>{text}</Text>
    </View>
  );
}

// ---------------------------------------------------------------------------------------------- NonConformanceFragment

export function NcDetailsScreen() {
  const { app, type, isSurveillance, details } = useNcContext();
  const nav = useNavigation();
  const ui = useUi();
  const nc = details?.activeNcDetails ?? null;
  if (!nc) return <NcFrame title="Bronze Surveillance">{null}</NcFrame>;

  let anyUnsubmitted = false;
  const sections: React.ReactNode[] = [];
  if (nc.siteExteriorPhotoData != null) {
    if (!nc.sitePhotosSubmitted) anyUnsubmitted = true;
    sections.push(
      <NcRow key="site" title="Site Exterior Photos">
        <NcOption label="Site Exterior Photos" submitted={!!nc.sitePhotosSubmitted} onPress={() => nav.push('NcSitePhotos', { certificationType: type, isSurveillance })} testID="nc-site" />
      </NcRow>,
    );
  }
  if (nc.products && nc.products.length > 0) {
    sections.push(
      <NcRow key="products" title="Products">
        {nc.products.map((p, i) => {
          if (p.status !== Status.SUBMITTED) anyUnsubmitted = true;
          return (
            <NcOption
              key={i}
              label={p.productName ?? ''}
              submitted={p.status === Status.SUBMITTED}
              onPress={() => nav.push('NcProduct', { certificationType: type, isSurveillance, index: i })}
              testID={`nc-product-${i}`}
            />
          );
        })}
      </NcRow>,
    );
  }
  for (const element of nc.parameters ?? []) {
    const major = element.code;
    sections.push(
      <NcRow key={`e${element.id}`} title={`${major}. ${element.label}`}>
        <View>
          {(element.requirements ?? []).map(r => {
            if (requirementStatus(r) !== Status.SUBMITTED) anyUnsubmitted = true;
            return (
              <View key={r.id}>
                <OptionsList options={r.options ?? []} major={major} requirementIndex={Number(r.code) - 1} />
                <NcOption
                  label="View NC"
                  submitted={requirementStatus(r) === Status.SUBMITTED}
                  onPress={() => nav.push('NcRequirement', { certificationType: type, isSurveillance, requirementId: r.id, elementName: element.label ?? '', elementCode: major })}
                  testID={`nc-requirement-${r.id}`}
                />
              </View>
            );
          })}
        </View>
      </NcRow>,
    );
  }

  const closeNc = async () => {
    if (!app.loginId) return;
    ui.showLoading();
    let r: BaseServiceResponse;
    try {
      r = await app.api.finalSubmitNc(app.loginId, type, isSurveillance);
    } catch (e) {
      r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
    } finally {
      ui.hideLoading();
    }
    if (isSuccess(r)) {
      if (details) details.activeNcDetails = null;
      await app.persist();
      ui.toast('Closed successfully', { long: true });
      nav.reset([{ name: 'Dashboard' }]);
    } else {
      ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
    }
  };

  return (
    <NcFrame title="Bronze Surveillance" testID="nc-details">
      <ScrollView>
        <View style={{ padding: dimens.padding2 }}>
          <View style={{ margin: dimens.padding1 }}>{sections}</View>
          {!anyUnsubmitted ? <ZedButton title="Close Non-Conformance" onPress={closeNc} testID="nc-close" /> : null}
        </View>
      </ScrollView>
    </NcFrame>
  );
}

function NcRow({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={[shapes.greyOutlineRectangle, { margin: dimens.padding2, padding: dimens.padding2 }]}>
      <Text style={textStyles.subheadingDark}>{title}</Text>
      {children}
    </View>
  );
}

function NcOption({ label, submitted, onPress, testID }: { label: string; submitted: boolean; onPress: () => void; testID?: string }) {
  return (
    <Pressable style={styles.option} onPress={onPress} testID={testID}>
      <Icon icon={submitted ? icons.nc_completed : icons.nc_to_start} />
      <Text style={styles.optionText}>{label}</Text>
      <Icon icon={icons.ic_forward_arrow} />
    </Pressable>
  );
}

// ---------------------------------------------------------------------------------------------- NC forms

/** Online: sent now, as before. Offline (or no answer): kept, queued and sent when the connection returns. */
async function sendOrQueue(
  ui: ReturnType<typeof useUi>,
  send: () => Promise<BaseServiceResponse>,
  queue: () => Promise<unknown>,
): Promise<'sent' | 'queued' | 'failed'> {
  if (!(await isNetworkAvailable())) {
    await queue();
    ui.toast(QUEUED, { long: true });
    return 'queued';
  }
  ui.showLoading();
  let r: BaseServiceResponse;
  try {
    r = await send();
  } catch (e) {
    if (isNetworkError(e)) {
      await queue();
      ui.hideLoading();
      ui.toast(QUEUED, { long: true });
      return 'queued';
    }
    r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
  } finally {
    ui.hideLoading();
  }
  if (isSuccess(r)) return 'sent';
  ui.toast(r.errorMessage ?? UNKNOWN_ERROR, { long: true });
  return 'failed';
}

function NcFormFrame({ title, children, testID }: { title: string; children: React.ReactNode; testID?: string }) {
  return (
    <NcFrame title="Bronze Surveillance" testID={testID}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ margin: dimens.padding2, padding: dimens.padding1 }}>
          <Text style={textStyles.subheading}>{title}</Text>
          {children}
        </View>
      </ScrollView>
    </NcFrame>
  );
}

/** NcSitePhotosFragment */
export function NcSitePhotosScreen() {
  const { app, type, isSurveillance, details } = useNcContext();
  const nav = useNavigation();
  const ui = useUi();
  const capturer = useScreenCapture('toast');
  const nc = details?.activeNcDetails;
  const [remarks, setRemarks] = useState(nc?.msmeRemarksSitePhoto ?? '');
  const [error, setError] = useState<string | undefined>();
  const [, rerender] = useState(0);
  if (!nc) return null;

  const submit = async () => {
    const value = valueOrNull(remarks);
    nc.msmeRemarksSitePhoto = value;
    if (value == null) return setError(REQUIRED);
    if (!nc.siteExteriorPhotoData || nc.siteExteriorPhotoData.length === 0) return ui.snackbar('Please capture Site Exterior Photos');
    await app.persist();
    const outcome = await sendOrQueue(ui, () => submitNcSitePhotos(app, type, isSurveillance), () => queueNcSitePhotos(app, type, isSurveillance));
    if (outcome === 'sent') ui.toast('Site photos submitted successfully', { long: true });
    if (outcome !== 'failed') nav.pop();
  };

  return (
    <NcFormFrame title="Site Exterior Photos" testID="nc-site-photos">
      <StaticText label="Assessor Remarks" value={nc.assessorRemarksSite ?? ''} onViewMore={t => ui.alert('Assessor Remarks', t, [{ text: 'OK' }], false)} />
      <TextField label="MSME Remarks" value={remarks} onChange={v => (setRemarks(v), setError(undefined))} multiline error={error} testID="nc-remarks" />
      <PhotosField
        label="Site Exterior Photos"
        photos={nc.siteExteriorPhotoData ?? []}
        maxPhotos={2}
        onChange={list => {
          nc.siteExteriorPhotoData = list;
          rerender(x => x + 1);
          app.persist();
        }}
        capturer={capturer}
        store={app.photos}
        testID="nc-site-photo"
      />
      <ZedButton title="Submit" small onPress={submit} testID="nc-submit" />
    </NcFormFrame>
  );
}

/** NcProductFragment */
export function NcProductScreen() {
  const { app, type, isSurveillance, details } = useNcContext();
  const nav = useNavigation();
  const ui = useUi();
  const capturer = useScreenCapture('toast');
  const index = useRoute<{ index: number }>().params.index;
  const product: ProductDetailsNc | undefined = details?.activeNcDetails?.products?.[index];
  const [remarks, setRemarks] = useState(product?.msmeRemarks ?? '');
  const [error, setError] = useState<string | undefined>();
  const [, rerender] = useState(0);
  if (!product) return null;

  const submit = async () => {
    const value = valueOrNull(remarks);
    product.msmeRemarks = value;
    if (value == null) return setError(REQUIRED);
    if (product.productPhoto == null || product.productDescriptionPhoto == null) return ui.snackbar('Please capture required photos');
    product.status = Status.COMPLETED;
    await app.persist();
    const outcome = await sendOrQueue(
      ui,
      () => submitNcProduct(app, type, isSurveillance, product),
      () => queueNcProduct(app, type, isSurveillance, index, product.productName ?? ''),
    );
    if (outcome === 'sent') ui.toast('Product submitted successfully', { long: true });
    if (outcome !== 'failed') nav.pop();
  };

  return (
    <NcFormFrame title="Products" testID="nc-product">
      <StaticText label="Assessor Remarks" value={product.assessorRemarks ?? ''} onViewMore={t => ui.alert('Assessor Remarks', t, [{ text: 'OK' }], false)} />
      <TextField label="MSME Remarks" value={remarks} onChange={v => (setRemarks(v), setError(undefined))} multiline error={error} testID="nc-remarks" />
      <PhotosField
        label="Product Photos"
        photos={product.productPhoto ? [product.productPhoto] : []}
        onChange={list => {
          if (list.length > 0) product.productPhoto = list[0];
          rerender(x => x + 1);
          app.persist();
        }}
        capturer={capturer}
        store={app.photos}
        testID="nc-product-photo"
      />
      <PhotosField
        label="Product Label/Description Photos"
        photos={product.productDescriptionPhoto ? [product.productDescriptionPhoto] : []}
        allowPick
        onChange={list => {
          if (list.length > 0) product.productDescriptionPhoto = list[0];
          rerender(x => x + 1);
          app.persist();
        }}
        capturer={capturer}
        store={app.photos}
        testID="nc-product-description"
      />
      <ZedButton title="Submit" small onPress={submit} testID="nc-submit" />
    </NcFormFrame>
  );
}

/** NcRequirementFragment */
export function NcRequirementScreen() {
  const { app, type, isSurveillance, details } = useNcContext();
  const nav = useNavigation();
  const ui = useUi();
  const capturer = useScreenCapture('toast');
  const { requirementId, elementName, elementCode } = useRoute<{ requirementId: string; elementName: string; elementCode: string }>().params;
  const requirement: Requirement | undefined = details?.activeNcDetails?.parameters?.flatMap(e => e.requirements ?? []).find(r => r.id === requirementId);
  const [remarks, setRemarks] = useState(requirement?.msmeRemarks ?? '');
  const [error, setError] = useState<string | undefined>();
  const [, rerender] = useState(0);
  if (!requirement) return null;

  const submit = async () => {
    const value = valueOrNull(remarks);
    requirement.msmeRemarks = value;
    if (value == null) return setError(REQUIRED);
    if (!requirement.photos || requirement.photos.length === 0) return ui.snackbar('Please capture required photos');
    requirement.status = Status.COMPLETED;
    await app.persist();
    const outcome = await sendOrQueue(
      ui,
      () => submitNcRequirement(app, type, isSurveillance, requirement),
      () => queueNcRequirement(app, type, isSurveillance, requirement.id, `${elementCode}. ${elementName}`),
    );
    // The legacy view model posted the requirement's answer to the product observer: same message.
    if (outcome === 'sent') ui.toast('Product submitted successfully', { long: true });
    if (outcome !== 'failed') nav.pop();
  };

  return (
    <NcFormFrame title={`${elementCode}. ${elementName}`} testID="nc-requirement">
      <OptionsList options={requirement.options ?? []} major={elementCode} requirementIndex={Number(requirement.code) - 1} />
      <StaticText label="Assessor Remarks" value={requirement.assessorRemarks ?? ''} onViewMore={t => ui.alert('Assessor Remarks', t, [{ text: 'OK' }], false)} />
      <TextField label="MSME Remarks" value={remarks} onChange={v => (setRemarks(v), setError(undefined))} multiline error={error} testID="nc-remarks" />
      <PhotosField
        label="Photos"
        photos={requirement.photos ?? []}
        maxPhotos={5}
        onChange={list => {
          if (list.length > 0) requirement.photos = list;
          rerender(x => x + 1);
          app.persist();
        }}
        capturer={capturer}
        store={app.photos}
        testID="nc-requirement-photos"
      />
      <ZedButton title="Submit" small onPress={submit} testID="nc-submit" />
    </NcFormFrame>
  );
}

export type { CertificationDetails };
export { errorOf };

const styles = StyleSheet.create({
  ncRow: { flexDirection: 'row', alignItems: 'center', paddingRight: dimens.padding2 },
  ncCount: { padding: dimens.padding3, color: colors.ncRed, fontSize: dimens.textSize2, fontWeight: 'bold' },
  ncStatus: { paddingHorizontal: dimens.padding3, paddingBottom: dimens.padding3, fontSize: dimens.textSize, color: colors.black },
  divider: { height: 1, backgroundColor: colors.progressBarColor },
  whatIsNc: { textAlign: 'center', padding: dimens.padding2, fontSize: dimens.textSize, color: colors.black },
  legend: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding3 },
  option: { flexDirection: 'row', alignItems: 'center', margin: dimens.padding2, backgroundColor: colors.lightGrey2, borderRadius: 5, padding: dimens.padding2 },
  optionText: { flex: 1, marginHorizontal: dimens.padding2, fontSize: dimens.textSize, color: colors.black },
});
