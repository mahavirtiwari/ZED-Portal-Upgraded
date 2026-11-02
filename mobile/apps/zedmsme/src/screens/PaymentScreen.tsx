import React, { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  Icon,
  isSuccess,
  OutlinedInput,
  RadioButton,
  ScreenFrame,
  sharedIcons,
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
} from '@zed/shared';
import type { PaymentDetails, PaymentDetailsResponse, PaymentTokenRequest } from '../api';
import { icons } from '../assets/icons';
import { images } from '../assets/images';
import { useMsme } from '../app/context';
import { NO, YES, type CertificationType } from '../models';

const RS = '₹';
const TDS_TWO = '2';
const TDS_TEN = '10';

// The disclaimer, instructions, joining reward notes and result messages are Admin texts (app.msme.certification.payment.*,
// app.msme.payment.*), the legacy wording until the server's arrives.
export const CCAVENUE_NOT_AVAILABLE =
  'Online payment through CCAvenue is not available in this version of the app. Please make the payment on the ZED portal.';

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
  const [success, setSuccess] = useState<boolean | null>(null);
  const zedId = app.user?.MsmeDetails?.ZedId ?? '';

  useEffect(() => {
    (async () => {
      ui.showLoading();
      try {
        setResponse(await app.api.getPaymentDetailsByType(type, zedId));
      } catch (e) {
        setResponse({ status: '0', errorMessage: e instanceof Error ? e.message : null });
      } finally {
        ui.hideLoading();
      }
    })();
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
      if (Number(request.Amount) === 0) {
        const r = await app.api.submitZeroPaymentDetails(request);
        if (isSuccess(r)) {
          setSuccess(true);
          setPage(3);
        } else ui.showAlert(r.errorMessage ?? 'Error occurred while while processing request, please try again');
      } else {
        const r = await app.api.getPaymentToken(request);
        if (isSuccess(r)) ui.showAlert(CCAVENUE_NOT_AVAILABLE);
        else ui.showAlert(r.errorMessage ?? 'Error occurred while getting data');
      }
    } catch (e) {
      ui.showAlert(e instanceof Error ? e.message : 'Error occurred while getting data');
    } finally {
      ui.hideLoading();
    }
  };

  const backToDashboard = (startCertification: boolean) => {
    nav.reset([{ name: 'Dashboard' }]);
    void startCertification; // the legacy dashboard ignored the type after payment (status refresh is disabled)
  };

  const title = page === 3 ? (success ? 'Success' : 'Failure') : 'Payment';
  return (
    <ScreenFrame title={title} backBar={{ zedId, onBack }} testID="payment">
      {response == null ? null : page === 0 ? (
        <TextPage title="Disclaimer" textKey="app.msme.certification.payment.disclaimer" onBack={onBack} onProceed={() => setPage(1)} />
      ) : page === 1 ? (
        <TextPage title="Instructions" textKey="app.msme.certification.payment.instructions" onBack={onBack} onProceed={() => setPage(2)} />
      ) : page === 2 ? (
        <DetailsPage type={type} response={response} zedId={zedId} onBack={onBack} onPay={onPaymentClick} />
      ) : (
        <ResultPage type={type} success={!!success} onDashboard={() => backToDashboard(false)} onStart={() => backToDashboard(true)} onRetry={() => setPage(2)} />
      )}
    </ScreenFrame>
  );
}

function Footer({ onBack, proceedTitle, onProceed }: { onBack: () => void; proceedTitle: string; onProceed: () => void }) {
  return (
    <View style={styles.footer}>
      <Pressable style={styles.footerBack} onPress={onBack} testID="payment-back">
        <Icon icon={sharedIcons.ic_back_arrow} />
        <Text style={{ fontSize: 13, color: colors.black, fontWeight: 'bold', marginLeft: 4 }}>BACK</Text>
      </Pressable>
      <ZedButton title={proceedTitle} onPress={onProceed} small style={{ alignSelf: 'auto' }} testID="payment-proceed" />
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
  const showCoupon = couponUsed != null && couponUsed !== 1 && withCoupon?.Coupon != null;
  const summary = details ? paymentSummary(details, tdsDeductible === YES ? tds : null, type) : null;
  const due = summary?.due;

  const prepare = (): PaymentTokenRequest | null => {
    if (details?.Id == null) return null;
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
      setGstError(undefined);
      req.UnitGstin = gstNum;
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
      setTanError(undefined);
      req.Tan = tan;
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
              <OutlinedInput value={gstNum} onChangeText={t => (setGstNum(t), t.trim() && setGstError(undefined))} placeholder="Enter Unit GSTIN (required)" error={gstError} />
            </View>
          ) : null}
          <YesNo singleRow label="TDS Deductible?" value={tdsDeductible} onChange={v => (setTdsDeductible(v), v !== YES && setTds(null))} testID="tds" />
          {tdsDeductible === YES ? (
            <>
              <View style={{ flexDirection: 'row', padding: dimens.padding2 }}>
                <RadioButton label="2%" selected={tds === TDS_TWO} onPress={() => setTds(TDS_TWO)} style={{ flex: 1 }} />
                <RadioButton label="10%" selected={tds === TDS_TEN} onPress={() => setTds(TDS_TEN)} style={{ flex: 1 }} />
              </View>
              <View style={{ marginHorizontal: dimens.padding1 }}>
                <OutlinedInput value={tan} onChangeText={t => (setTan(t), t.trim() && setTanError(undefined))} placeholder="TAN Number" error={tanError} />
              </View>
            </>
          ) : null}
          {showCoupon ? (
            <View style={styles.coupon}>
              <View style={{ flex: 1 }}>
                <Text style={{ padding: dimens.padding1, color: colors.couponBorder, fontWeight: 'bold' }}>Joining Reward*</Text>
                <Text style={{ padding: dimens.padding1, fontWeight: 'bold', color: colors.black }}>{formatCurrency(withCoupon!.Coupon)}</Text>
                {rewardNote ? <Text style={{ padding: dimens.padding1, color: colors.black }}>{htmlToPlain(rewardNote.html)}</Text> : null}
                {type === 'Bronze' && bronzeNote ? <Text style={{ padding: dimens.padding1, color: colors.black }}>{htmlToPlain(bronzeNote.html)}</Text> : null}
              </View>
              {rewardApplied ? (
                <View style={{ alignItems: 'center' }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                    <Icon icon={icons.ic_green_tick} />
                    <Text style={{ color: colors.green, fontWeight: 'bold' }}>{'Reward\nApplied'}</Text>
                  </View>
                  <ZedButton title="Remove" small style={{ backgroundColor: colors.ncRed }} onPress={() => (setRewardApplied(false), setDetails(withoutCoupon))} />
                </View>
              ) : (
                <ZedButton title={'Apply\nReward'} small onPress={() => (setRewardApplied(true), setDetails(withCoupon))} testID="apply-reward" />
              )}
            </View>
          ) : null}
          <Text style={textStyles.subheading}>Summary</Text>
          {summary ? <SummaryRows summary={summary} /> : null}
        </View>
      </ScrollView>
      <Footer
        onBack={onBack}
        proceedTitle={due == null || due === 0 ? 'PROCEED TO PAY' : `PROCEED TO PAY ${formatCurrency(due)}`}
        onProceed={() => {
          const req = prepare();
          if (req) setSummaryOpen(req);
        }}
      />
      {summaryOpen && details ? (
        <ZedDialog visible title="Summary" cancelable={false} onClose={() => setSummaryOpen(null)}>
          <SummaryRows summary={paymentSummary(details, tdsDeductible === YES ? tds : null, type)} />
          <ZedButton
            title="PROCEED TO PAYMENT"
            small
            style={{ alignSelf: 'center' }}
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
  const text = useAppText(success ? 'app.msme.payment.success' : 'app.msme.payment.failure', { Certification: type });
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
  footer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: colors.lightGrey, padding: dimens.padding2 },
  footerBack: { flexDirection: 'row', alignItems: 'center', padding: dimens.padding2 },
  coupon: {
    flexDirection: 'row',
    alignItems: 'center',
    margin: dimens.padding2,
    padding: dimens.padding2,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.couponBorder,
    borderRadius: 5,
  },
  summaryRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: colors.progressBarColor },
  summaryLabel: { flex: 65, padding: dimens.padding2, color: colors.textColor, fontSize: dimens.textSize },
  summaryValue: { flex: 35, padding: dimens.padding2, color: colors.textColor, fontWeight: 'bold', fontSize: dimens.textSize },
  centered: { textAlign: 'center', fontSize: dimens.textSize, color: colors.black },
});
