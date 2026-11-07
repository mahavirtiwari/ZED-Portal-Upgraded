import React, { useEffect, useState } from 'react';
import { Image, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  Icon,
  isSuccess,
  lineHeight,
  OutlinedInput,
  RadioButton,
  ScreenFrame,
  shapes,
  textStyles,
  useBackHandler,
  useNavigation,
  useRoute,
  useUi,
  YesNo,
  ZedButton,
  ZedDialog,
  HtmlText,
  htmlToPlain,
  useAppText,
  type BaseServiceResponse,
} from '@zed/shared';
import type { PaymentDetails, PaymentDetailsResponse, PaymentTokenRequest, VerifyGstinResponse } from '../api';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useMsme } from '../app/context';
import { checkoutOrder, isPaid, startCheckout } from '../ccavenue';
import { levelName, NO, YES, type CertificationType } from '../models';
import { Footer as LegacyFooter } from '../ui/legacy';
import { refreshStatus, useCertificationClick } from './DashboardScreen';

const RS = '₹';
const TDS_TWO = '2';
const TDS_TEN = '10';

// The disclaimer, instructions, joining reward notes and result messages are Admin texts (app.msme.certification.payment.*,
// app.msme.payment.*), the legacy wording until the server's arrives.
const PAYMENT_ERROR = 'Unknown error occurred while making the payment';
// The web payment page's formats (payment-step.ts).
const GSTIN = /^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][zZ][0-9A-Za-z]$/;
const TAN = /^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/;
const FEE_ERROR = 'The fee could not be loaded. Check your internet connection and try again.';
const AMOUNT_ERROR = 'The amount to pay could not be worked out. Go back and open the payment again.';

/** BigDecimal.toString of the server's amounts. */
const num = (v: number | null | undefined) => (v == null ? '' : String(v));
const formatCurrency = (v: number | null | undefined) => `${RS} ${num(v)}`;
const minus = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : round(a - b));
const round = (n: number) => Math.round(n * 100) / 100;

type Summary = { rows: Array<{ key: string; label: string; value: string; color?: string; bold?: boolean }>; due: number | null | undefined };

/** showPaymentSummary of PaymentDetailsFragment / PaymentSummaryFragment. */
export function paymentSummary(details: PaymentDetails, tds: string | null, certification: CertificationType): Summary {
  void certification;
  const rows: Summary['rows'] = [{ key: 'fee', label: 'Certification Fee', value: formatCurrency(details.Total) }];
  if (!(details.Coupon == null || details.Coupon === 0)) {
    rows.push({ key: 'reward', label: 'Joining Reward', value: formatCurrency(details.Coupon), color: colors.couponBorder });
    rows.push({ key: 'afterReward', label: 'Final Certification Fee\n(After adjusting joining reward)', value: formatCurrency(details.TotalAfterCoupon) });
  }
  rows.push({
    key: 'subsidy',
    label: `Subsidy (${details.SubsidyPercentage}%)\n(On Final certification fee)`,
    value: formatCurrency(
      details.TotalAfterCoupon != null
        ? minus(details.ApplicantContributionAfterSubsidy, details.TotalAfterCoupon)
        : minus(details.ApplicantContributionAfterSubsidy, details.Total),
    ),
  });
  rows.push({ key: 'payable', label: 'Amount Payable', value: formatCurrency(details.ApplicantContributionAfterSubsidy) });
  rows.push({ key: 'amount', label: 'Amount', value: details.GstAfterSubsidy != null ? formatCurrency(minus(details.ApplicantContributionAfterSubsidy, details.GstAfterSubsidy)) : '' });
  rows.push({ key: 'gst', label: 'GST(18%)', value: details.GstAfterSubsidy != null ? formatCurrency(details.GstAfterSubsidy) : '' });
  let due = details.ApplicantContributionAfterSubsidy;
  if (tds === TDS_TWO) {
    due = details.NetPaybleTds15;
    rows.push({ key: 'tds', label: 'TDS Deducted (2%)', value: formatCurrency(details.Tds15) });
  } else if (tds === TDS_TEN) {
    due = details.NetPaybleTds75;
    rows.push({ key: 'tds', label: 'TDS Deducted (10%)', value: formatCurrency(details.Tds75) });
  }
  rows.push({ key: 'due', label: 'Net Payable Amount', value: formatCurrency(due), bold: true });
  return { rows, due };
}

/** PaymentActivity: a 4-page pager (disclaimer, instructions, details, result). */
export function PaymentScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const type = useRoute<{ certificationType: CertificationType }>().params.certificationType;
  const [page, setPage] = useState(0);
  const [response, setResponse] = useState<PaymentDetailsResponse | null>(null);
  // New in V4: the fee could not be loaded (no connection, a server error, no fee row): a message with BACK / RETRY
  // instead of the disclaimer and an empty summary that led nowhere.
  const [loadError, setLoadError] = useState<string | null>(null);
  const [success, setSuccess] = useState<boolean | null>(null);
  const zedId = app.user?.MsmeDetails?.ZedId ?? '';

  const loadFee = async () => {
    ui.showLoading();
    setLoadError(null);
    try {
      const r = await app.api.getPaymentDetailsByType(type, zedId);
      if (r?.WithOutCoupon?.[0] == null) {
        setResponse(null);
        setLoadError(r?.errorMessage?.trim() || FEE_ERROR);
      } else setResponse(r);
    } catch (e) {
      setResponse(null);
      setLoadError(e instanceof Error && e.message.trim() ? e.message : FEE_ERROR);
    } finally {
      ui.hideLoading();
    }
  };

  useEffect(() => {
    void loadFee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBack = () => {
    if (page > 0) {
      if (page === 3 && success) nav.pop();
      else setPage(page - 1);
    } else nav.pop();
  };
  useBackHandler(() => {
    onBack();
    return true;
  });

  const onPaymentClick = async (request: PaymentTokenRequest) => {
    ui.showLoading();
    try {
      // An empty amount is not a zero one (Number('') is 0): never a free payment for an amount the app does not have.
      const amount = request.Amount.trim() === '' ? NaN : Number(request.Amount);
      if (!Number.isFinite(amount)) return ui.showAlert(AMOUNT_ERROR);
      if (amount === 0) {
        const r = await app.api.submitZeroPaymentDetails(request);
        if (isSuccess(r)) {
          setSuccess(true);
          setPage(3);
        } else ui.showAlert(r.errorMessage ?? 'Error occurred while while processing request, please try again');
      } else {
        const r = await app.api.getPaymentToken(request);
        if (!isSuccess(r)) return ui.showAlert(r.errorMessage ?? 'Error occurred while getting data');
        ui.hideLoading();
        // AvenuesApplication.startTransaction; the callbacks as PaymentActivity's.
        const result = await startCheckout(checkoutOrder(r, app.user?.MsmeDetails, type, app.api.site));
        if (result.outcome === 'cancel') ui.toast('Transaction cancelled', { long: true });
        else if (result.outcome === 'error') ui.showAlert(result.error?.trim() ? result.error : PAYMENT_ERROR);
        else if (!result.status && result.description) ui.showAlert(result.description);
        else {
          setSuccess(isPaid(result));
          setPage(3);
        }
      }
    } catch (e) {
      ui.showAlert(e instanceof Error ? e.message : 'Error occurred while getting data');
    } finally {
      ui.hideLoading();
    }
  };

  const startCertification = useCertificationClick();
  const backToDashboard = async (start: boolean) => {
    if (!start) return nav.reset([{ name: 'Dashboard' }]);
    // Fixed 2026-11-07: "Start Certification Process" opens the paid level's steps (Basic Information & Document
    // Upload ...) with the fresh status, the Dashboard under it; it used to land on the Dashboard only.
    ui.showLoading();
    try {
      await refreshStatus(app);
    } catch {
      // the steps open with the status on the phone
    } finally {
      ui.hideLoading();
    }
    nav.reset([{ name: 'Dashboard' }]);
    await startCertification(type);
  };

  const title = page === 3 ? (success ? 'Success' : 'Failure') : 'Payment';
  return (
    <ScreenFrame title={title} backBar={{ zedId, onBack }} testID="payment">
      {loadError != null ? (
        <FeeError message={loadError} onBack={() => nav.pop()} onRetry={() => void loadFee()} />
      ) : response == null ? null : page === 0 ? (
        <TextPage title="Disclaimer" textKey="app.msme.certification.payment.disclaimer" onBack={onBack} onProceed={() => setPage(1)} />
      ) : page === 1 ? (
        <TextPage title="Instructions" textKey="app.msme.certification.payment.instructions" onBack={onBack} onProceed={() => setPage(2)} />
      ) : page === 2 ? (
        <DetailsPage type={type} response={response} zedId={zedId} onBack={onBack} onPay={onPaymentClick} />
      ) : (
        <ResultPage type={type} success={!!success} onDashboard={() => void backToDashboard(false)} onStart={() => void backToDashboard(true)} onRetry={() => setPage(2)} />
      )}
    </ScreenFrame>
  );
}

/** registration_footer of the payment pages. */
function Footer({ onBack, proceedTitle, onProceed, proceedEnabled = true }: { onBack: () => void; proceedTitle: string; onProceed: () => void; proceedEnabled?: boolean }) {
  return <LegacyFooter onBack={onBack} proceedTitle={proceedTitle} onProceed={onProceed} proceedEnabled={proceedEnabled} backTestID="payment-back" proceedTestID="payment-proceed" />;
}

/** The fee could not be loaded: the reason, BACK and RETRY. */
function FeeError({ message, onBack, onRetry }: { message: string; onBack: () => void; onRetry: () => void }) {
  return (
    <View style={{ flex: 1 }} testID="payment-fee-error">
      <View style={{ flex: 1, justifyContent: 'center', padding: dimens.padding4 }}>
        <Text style={[textStyles.subheading, { textAlign: 'center' }]}>Payment</Text>
        <Text style={[styles.body, { textAlign: 'center' }]}>{message}</Text>
      </View>
      <LegacyFooter onBack={onBack} proceedTitle="RETRY" onProceed={onRetry} backTestID="payment-back" proceedTestID="payment-retry" />
    </View>
  );
}

function TextPage({ title, textKey, onBack, onProceed }: { title: string; textKey: string; onBack: () => void; onProceed: () => void }) {
  const text = useAppText(textKey);
  return (
    <View style={{ flex: 1 }}>
      <ScrollView>
        <View style={{ margin: dimens.padding2, padding: dimens.padding2 }}>
          <Text style={textStyles.subheading}>{title}</Text>
          {text ? <HtmlText html={text.html} style={styles.body} paragraphGap={0} testID={textKey} /> : null}
        </View>
      </ScrollView>
      <Footer onBack={onBack} proceedTitle="Accept & Proceed" onProceed={onProceed} />
    </View>
  );
}

/** PaymentDetailsFragment */
function DetailsPage({
  type,
  response,
  zedId,
  onBack,
  onPay,
}: {
  type: CertificationType;
  response: PaymentDetailsResponse;
  zedId: string;
  onBack: () => void;
  onPay: (r: PaymentTokenRequest) => void;
}) {
  const ui = useUi();
  const rewardNote = useAppText('app.msme.payment.joiningReward.note');
  const bronzeNote = useAppText('app.msme.payment.joiningReward.bronzeNote');
  const withoutCoupon = response.WithOutCoupon?.[0] ?? null;
  const withCoupon = response.WithCoupon?.[0] ?? null;
  const couponUsed = response.CouponStatus?.[0]?.IsCouponUsed;
  const [details, setDetails] = useState<PaymentDetails | null>(withoutCoupon);
  const [rewardApplied, setRewardApplied] = useState(false);
  const [gst, setGst] = useState<string | null>(null);
  const [gstNum, setGstNum] = useState('');
  const [gstError, setGstError] = useState<string | undefined>();
  const [tdsDeductible, setTdsDeductible] = useState<string | null>(null);
  const [tds, setTds] = useState<string | null>(null);
  const [tan, setTan] = useState('');
  const [tanError, setTanError] = useState<string | undefined>();
  const [summaryOpen, setSummaryOpen] = useState<PaymentTokenRequest | null>(null);
  const [panMismatch, setPanMismatch] = useState<{ request: PaymentTokenRequest; gstinPan: string } | null>(null);
  const [correctedPan, setCorrectedPan] = useState('');
  const api = useMsme().api;
  const showCoupon = couponUsed != null && couponUsed !== 1 && withCoupon?.Coupon != null;
  const summary = details ? paymentSummary(details, tdsDeductible === YES ? tds : null, type) : null;
  const due = summary?.due;

  const prepare = (): PaymentTokenRequest | null => {
    if (details?.Id == null) return null;
    if (due == null) {
      ui.showAlert(AMOUNT_ERROR);
      return null;
    }
    const req: PaymentTokenRequest = { PaymentRefId: String(details.Id), ZedId: zedId, Certification: type, Amount: num(due), UseCoupon: details.Coupon != null ? YES : NO };
    if (gst == null) {
      ui.snackbar('GSTIN Applicable?');
      return null;
    } else if (gst === YES) {
      req.Gst = YES;
      if (gstNum.trim() === '') {
        setGstError('Required');
        return null;
      }
      if (!GSTIN.test(gstNum.trim())) {
        setGstError('Please enter valid GSTIN.');
        return null;
      }
      setGstError(undefined);
      req.UnitGstin = gstNum.trim().toUpperCase();
    } else req.Gst = NO;
    if (tdsDeductible == null) {
      ui.snackbar('TDS Deductible?');
      return null;
    } else if (tdsDeductible === YES) {
      req.TdsDeductible = YES;
      if (tds == null) {
        ui.snackbar('Select TDS Percentage');
        return null;
      }
      req.Tds = tds === TDS_TWO ? '15' : '75';
      if (tan.trim() === '') {
        setTanError('Required');
        return null;
      }
      if (!TAN.test(tan.trim())) {
        setTanError('Please enter valid TAN Number.');
        return null;
      }
      setTanError(undefined);
      req.Tan = tan.trim().toUpperCase();
    } else req.TdsDeductible = NO;
    return req;
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView keyboardShouldPersistTaps="handled">
        <View style={{ margin: dimens.padding2, padding: dimens.padding2 }}>
          <Text style={textStyles.subheading}>Payment Options</Text>
          <YesNo singleRow label="GSTIN Applicable?" value={gst} onChange={setGst} testID="gst" />
          {gst === YES ? (
            <View style={{ marginHorizontal: dimens.padding1 }}>
              <OutlinedInput value={gstNum} onChangeText={t => (setGstNum(t), t.trim() && setGstError(undefined))} placeholder="Enter Unit GSTIN (required)" error={gstError} autoCapitalize="characters" testID="gstin" />
            </View>
          ) : null}
          <YesNo singleRow label="TDS Deductible?" value={tdsDeductible} onChange={v => (setTdsDeductible(v), v !== YES && setTds(null))} testID="tds" />
          {tdsDeductible === YES ? (
            <>
              <View style={{ flexDirection: 'row', padding: dimens.padding2 }}>
                <RadioButton label="2%" selected={tds === TDS_TWO} onPress={() => setTds(TDS_TWO)} style={{ flex: 1 }} tinted />
                <RadioButton label="10%" selected={tds === TDS_TEN} onPress={() => setTds(TDS_TEN)} style={{ flex: 1 }} tinted />
              </View>
              <View style={{ marginHorizontal: dimens.padding1 }}>
                <OutlinedInput value={tan} onChangeText={t => (setTan(t), t.trim() && setTanError(undefined))} placeholder="TAN Number" error={tanError} autoCapitalize="characters" testID="tan" />
              </View>
            </>
          ) : null}
          {showCoupon ? (
            // coupon_container (coupon_outline_rectangle): the title and amount, the note with Apply Reward (or Reward
            // Applied / Remove) beside it, then the balance note across the box.
            <View style={styles.coupon} testID="joining-reward">
              <Text style={styles.couponTitle}>Joining Reward*</Text>
              <Text style={styles.couponAmount}>{formatCurrency(withCoupon!.Coupon)}</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                <Text style={[styles.couponText, { flex: 1 }]}>{rewardNote ? htmlToPlain(rewardNote.html) : ''}</Text>
                {rewardApplied ? (
                  <View style={{ alignItems: 'center' }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: dimens.padding1 }}>
                      <Icon icon={icons.ic_green_tick} />
                      <Text style={{ color: colors.green, fontWeight: 'bold', marginLeft: dimens.padding1 }}>{'Reward\nApplied'}</Text>
                    </View>
                    <ZedButton title="Remove" small style={{ backgroundColor: colors.ncRed }} onPress={() => (setRewardApplied(false), setDetails(withoutCoupon))} testID="remove-reward" />
                  </View>
                ) : (
                  <ZedButton title={'Apply\nReward'} small onPress={() => (setRewardApplied(true), setDetails(withCoupon))} textStyle={{ textAlign: 'center' }} testID="apply-reward" />
                )}
              </View>
              {type === 'Bronze' && bronzeNote ? <Text style={styles.couponText}>{htmlToPlain(bronzeNote.html)}</Text> : null}
            </View>
          ) : null}
          <Text style={textStyles.subheading}>Summary</Text>
          {summary ? <SummaryRows summary={summary} /> : null}
        </View>
      </ScrollView>
      <Footer
        onBack={onBack}
        proceedTitle={due == null || due === 0 ? 'PROCEED TO PAY' : `PROCEED TO PAY ${formatCurrency(due)}`}
        proceedEnabled={due != null}
        onProceed={async () => {
          const req = prepare();
          if (!req) return;
          // As the web: a GSTIN is verified first; a GSTIN whose PAN is not the Udyam PAN asks for the PAN correction.
          if (req.Gst === YES && req.UnitGstin) {
            ui.showLoading();
            let g: VerifyGstinResponse;
            try {
              g = await api.verifyGstin(type, req.UnitGstin);
            } catch (e) {
              g = { status: '0', errorMessage: e instanceof Error ? e.message : null };
            } finally {
              ui.hideLoading();
            }
            if (!isSuccess(g)) return ui.showAlert(g.errorMessage?.trim() || 'Please enter valid GSTIN.');
            if (g.PanMatches === false) {
              setCorrectedPan('');
              setPanMismatch({ request: req, gstinPan: g.GstinPan ?? '' });
              return;
            }
          }
          setSummaryOpen(req);
        }}
      />
      {panMismatch ? (
        <ZedDialog visible title="PAN Mismatch Detected" cancelable={false} onClose={() => setPanMismatch(null)}>
          <Text style={styles.body}>PAN registered in your Udyam portal is not matching with given GSTIN Number.</Text>
          <Text style={textStyles.defaultLabel}>Please enter the correct PAN number:</Text>
          <OutlinedInput value={correctedPan} onChangeText={setCorrectedPan} placeholder="Enter Correct PAN" autoCapitalize="characters" maxLength={10} testID="corrected-pan" />
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end', marginTop: dimens.padding3 }}>
            <ZedButton title="Cancel" small style={{ backgroundColor: colors.labelColor, marginRight: dimens.padding2 }} onPress={() => setPanMismatch(null)} testID="pan-cancel" />
            <ZedButton
              title="Save & Proceed"
              small
              testID="pan-save"
              onPress={async () => {
                const pan = correctedPan.trim().toUpperCase();
                if (pan.length !== 10) return ui.showAlert('Please enter a valid 10-character PAN.');
                if (pan !== panMismatch.gstinPan.toUpperCase()) return ui.showAlert('Please enter the correct PAN associated with that GSTIN.');
                ui.showLoading();
                let r: BaseServiceResponse;
                try {
                  r = await api.correctPan(type, panMismatch.request.UnitGstin ?? '', pan);
                } catch (e) {
                  r = { status: '0', errorMessage: e instanceof Error ? e.message : null };
                } finally {
                  ui.hideLoading();
                }
                if (!isSuccess(r)) return ui.showAlert(r.errorMessage?.trim() || 'Failed to update PAN. Please try again.');
                const request = panMismatch.request;
                setPanMismatch(null);
                ui.toast('PAN updated successfully. Proceeding...');
                setSummaryOpen(request);
              }}
            />
          </View>
        </ZedDialog>
      ) : null}
      {summaryOpen && details ? (
        <ZedDialog visible title="Summary" cancelable={false} onClose={() => setSummaryOpen(null)}>
          <SummaryRows summary={paymentSummary(details, tdsDeductible === YES ? tds : null, type)} />
          <ZedButton
            title="PROCEED TO PAYMENT"
            small
            style={{ alignSelf: 'center' }}
            testID="payment-confirm"
            onPress={() => {
              const req = summaryOpen;
              setSummaryOpen(null);
              onPay(req);
            }}
          />
        </ZedDialog>
      ) : null}
    </View>
  );
}

function SummaryRows({ summary }: { summary: Summary }) {
  return (
    <View style={[shapes.greyOutlineRectangle, { margin: dimens.padding2 }]}>
      {summary.rows.map(r => (
        <View key={r.key} style={styles.summaryRow}>
          <Text style={[styles.summaryLabel, r.color ? { color: r.color } : null, r.bold ? { fontWeight: 'bold' } : null]}>{r.label}</Text>
          <Text style={[styles.summaryValue, r.color ? { color: r.color } : null]}>{r.value}</Text>
        </View>
      ))}
    </View>
  );
}

/** PaymentResultFragment */
function ResultPage({ type, success, onDashboard, onStart, onRetry }: { type: CertificationType; success: boolean; onDashboard: () => void; onStart: () => void; onRetry: () => void }) {
  const text = useAppText(success ? 'app.msme.payment.success' : 'app.msme.payment.failure', { Certification: levelName(type) });
  // The built-in wording keeps the legacy look (paragraphs, the quoted certification in bold); the Admin's HTML is shown as written.
  const message = text && !text.fromServer ? htmlToPlain(text.html).replace(/\n/g, '\n\n') : '';
  const q1 = message.indexOf('"');
  const q2 = message.lastIndexOf('"');
  return (
    <ScrollView contentContainerStyle={{ padding: dimens.padding4 }}>
      <View style={[shapes.greyRectangle, { margin: dimens.padding3, padding: dimens.padding4 }]}>
        <Image source={success ? images.ic_payment_success : images.ic_payment_failure} style={{ width: 256, height: 180, alignSelf: 'center' }} resizeMode="contain" />
        <Text style={{ textAlign: 'center', fontSize: dimens.textSize3, color: colors.black }}>{success ? 'Payment Successful!' : 'Error'}</Text>
        {text?.fromServer ? (
          <HtmlText html={text.html} style={styles.centered} testID="payment-result-message" />
        ) : success && q1 >= 0 ? (
          <Text style={styles.centered}>
            {message.substring(0, q1)}
            <Text style={{ fontWeight: 'bold' }}>{message.substring(q1, q2)}</Text>
            {message.substring(q2)}
          </Text>
        ) : (
          <Text style={styles.centered}>{message}</Text>
        )}
      </View>
      {success ? <ZedButton title="Start Certification Process" small style={{ alignSelf: 'center' }} onPress={onStart} /> : null}
      {!success ? (
        <ZedButton title="Retry Payment" small style={{ alignSelf: 'center', backgroundColor: colors.lightGrey }} textStyle={{ color: colors.textColor }} onPress={onRetry} />
      ) : null}
      <ZedButton title="back to dashboard" small style={{ alignSelf: 'center', backgroundColor: colors.lightGrey }} textStyle={{ color: colors.textColor }} onPress={onDashboard} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  body: { paddingBottom: dimens.padding4, fontSize: dimens.textSize, color: colors.black },
  coupon: {
    margin: dimens.padding2,
    padding: dimens.padding2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.couponBorder,
    borderRadius: 5,
  },
  couponTitle: { padding: dimens.padding1, color: colors.couponBorder, fontWeight: 'bold', fontSize: dimens.textSize },
  couponAmount: { padding: dimens.padding1, fontWeight: 'bold', color: colors.black, fontSize: dimens.textSize },
  couponText: { padding: dimens.padding1, color: colors.black, fontSize: dimens.textSize, lineHeight: lineHeight(dimens.textSize) },
  summaryRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.progressBarColor },
  summaryLabel: { flex: 65, padding: dimens.padding2, color: colors.textColor, fontSize: dimens.textSize },
  summaryValue: { flex: 35, padding: dimens.padding2, color: colors.textColor, fontWeight: 'bold', fontSize: dimens.textSize },
  centered: { textAlign: 'center', fontSize: dimens.textSize, color: colors.black },
});
