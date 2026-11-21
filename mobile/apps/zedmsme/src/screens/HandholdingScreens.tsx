import React, { useCallback, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import {
  colors,
  dimens,
  htmlToPlain,
  isSuccess,
  ScreenFrame,
  useAppText,
  useBackHandler,
  useFocusEffect,
  useNavigation,
  useRoute,
  useUi,
  ZedButton,
} from '@zed/shared';
import type { HandholdingLevel, PaymentDetails, PaymentDetailsResponse, PaymentTokenRequest } from '../api';
import { useMsme } from '../app/context';
import { checkoutOrder, isPaid, startCheckout } from '../ccavenue';
import { coAnswerFields, coAnswerProblem, CoAssistQuestion, NO_CO_ANSWER, type CoAnswer } from '../components/CoAssistQuestion';
import type { CertificationType } from '../models';
import { Footer as LegacyFooter } from '../ui/legacy';
import { AMOUNT_ERROR, DetailsPage, FEE_ERROR, FeeError, PAYMENT_ERROR, TextPage } from './PaymentScreen';

/**
 * 2026-11-21 (the user: "Please add handholding payment screens also with the question"): Handholding Support in the ZED MSME
 * app, as the web page (msme/handholding, msme/payment/consultancy-payment) instead of opening the web. The levels open to the
 * unit with their milestones (ConsultancyPay/GetHandholdingStatus), and the payment of the milestone due: disclaimer,
 * instructions, GSTIN / TDS / joining reward, at milestone 1 "Did any Consultant Organisation assist you?" (CoAssistQuestion),
 * the summary, then the CCAvenue checkout (ConsultancyPay/GetToken) or, with nothing to pay, the confirmation
 * (ConsultancyPay/SubmitZeroPaymentDetails). The server checks everything again.
 */

const STATUS_ERROR = 'Handholding Support could not be loaded. Check your internet connection and try again.';
const MILESTONE_TITLES = [
  'Baseline Diagnostic Study and Handholding Action Plan',
  'Implementation & Progress Review 1',
  'Implementation & Progress Review 2',
];

export const milestoneTitle = (n: number) => MILESTONE_TITLES[n - 1] ?? '';

const yes = (v: unknown) => v === true || v === 1 || v === '1' || (typeof v === 'string' && v.toLowerCase() === 'true');

/** The web page's notes over the summary: a state subsidy row, "pay all at milestone 1" (milestone 1, or 2 and 3 already paid). */
export function handholdingNotes(fee: PaymentDetails | null | undefined, level: string): string[] {
  if (!fee) return [];
  const notes: string[] = [];
  const state = (fee.StateSubsidyLabel ?? '').trim();
  if (state) notes.push(state);
  else if (yes(fee.PayAllAtMilestone1)) {
    const m = String(fee.MileStone ?? '');
    if (m === '1') notes.push(`This payment covers all three milestones of ${level} handholding. Milestones 2 and 3 will have nothing more to pay.`);
    else if (m === '2' || m === '3') notes.push(`Milestone ${m} was paid with milestone 1: there is nothing to pay. Proceed to start it.`);
  }
  return notes;
}

/** The unit's handholding levels: the milestones, the one due and its payment. */
export function HandholdingScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const zedId = app.user?.MsmeDetails?.ZedId ?? '';
  const [levels, setLevels] = useState<HandholdingLevel[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    ui.showLoading();
    setError(null);
    try {
      const r = await app.api.getHandholdingStatus(zedId);
      if (!isSuccess(r)) throw new Error(r.errorMessage?.trim() || STATUS_ERROR);
      setLevels(r.levels ?? []);
    } catch (e) {
      setLevels(null);
      setError(e instanceof Error && e.message.trim() ? e.message : STATUS_ERROR);
    } finally {
      ui.hideLoading();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [app, zedId]);

  // Again after a payment (back from the payment screen).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return (
    <ScreenFrame title="Handholding Support" backBar={{ zedId, onBack: () => nav.pop() }} testID="handholding">
      {error != null ? (
        <View style={{ flex: 1 }} testID="handholding-error">
          <View style={styles.centre}>
            <Text style={styles.message}>{error}</Text>
          </View>
          <LegacyFooter onBack={() => nav.pop()} proceedTitle="RETRY" onProceed={() => void load()} backTestID="handholding-back" proceedTestID="handholding-retry" />
        </View>
      ) : levels == null ? null : levels.length === 0 ? (
        <View style={styles.centre} testID="handholding-none">
          <Text style={styles.message}>Handholding Support is not open for your unit yet. It opens for the next level once your unit is ZED certified.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: dimens.padding2 }}>
          {levels.map(l => (
            <LevelCard
              key={l.certification}
              level={l}
              onPay={() => nav.push('HandholdingPayment', { certification: l.certification, name: l.name, milestone: l.nextMilestone })}
            />
          ))}
        </ScrollView>
      )}
    </ScreenFrame>
  );
}

function LevelCard({ level, onPay }: { level: HandholdingLevel; onPay: () => void }) {
  const id = `handholding-${level.certification}`;
  const allPaid = level.milestonesStarted >= 3;
  return (
    <View style={styles.card} testID={id}>
      <Text style={styles.cardTitle}>{`${level.name} Handholding Support`}</Text>
      {[1, 2, 3].map(n => {
        const paid = level.milestonesStarted >= n;
        const waiting = level.awaitingAcceptance === n;
        return (
          <View key={n} style={styles.milestone} testID={`${id}-m${n}`}>
            <View style={[styles.dot, paid ? styles.dotDone : n === level.nextMilestone && !allPaid ? styles.dotDue : null]}>
              <Text style={[styles.dotText, paid || (n === level.nextMilestone && !allPaid) ? { color: colors.white } : null]}>{paid ? '✓' : n}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.milestoneTitle}>{`Milestone ${n}`}</Text>
              <Text style={styles.milestoneText}>{milestoneTitle(n)}</Text>
              <Text style={[styles.milestoneState, waiting ? { color: colors.couponBorder } : null]}>
                {waiting ? 'Waiting for your acceptance' : paid ? 'Paid' : n === level.nextMilestone ? (level.canPay ? 'Due now' : 'Not open yet') : 'Not open yet'}
              </Text>
            </View>
          </View>
        );
      })}
      {level.canPay ? (
        <ZedButton title={`Pay Milestone ${level.nextMilestone}`} onPress={onPay} style={{ marginTop: dimens.padding2 }} testID={`${id}-pay`} />
      ) : (
        <Text style={styles.refusal} testID={`${id}-refusal`}>
          {allPaid ? 'All three milestones are paid.' : level.refusal ?? ''}
        </Text>
      )}
    </View>
  );
}

type PaymentParams = { certification: string; name: string; milestone: number };
type Receipt = { amount: string; orderId: string | null; at: Date };

/** The payment of a level's milestone due: disclaimer, instructions, options with the question, summary, checkout, result. */
export function HandholdingPaymentScreen() {
  const app = useMsme();
  const nav = useNavigation();
  const ui = useUi();
  const { certification, name, milestone } = useRoute<PaymentParams>().params;
  const zedId = app.user?.MsmeDetails?.ZedId ?? '';
  const [page, setPage] = useState(0);
  const [response, setResponse] = useState<PaymentDetailsResponse | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [answer, setAnswer] = useState<CoAnswer>(NO_CO_ANSWER);
  const [success, setSuccess] = useState<boolean | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const loadFee = async () => {
    ui.showLoading();
    setLoadError(null);
    try {
      const r = await app.api.getConsultancyPaymentDetails(certification, zedId);
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

  React.useEffect(() => {
    void loadFee();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onBack = () => {
    if (page > 0 && !(page === 3 && success)) setPage(page === 3 ? 2 : page - 1);
    else nav.pop();
  };
  useBackHandler(() => {
    onBack();
    return true;
  });

  /** Milestone 1: the answer must be given (and an organisation chosen with Yes); its fields go with the request. */
  const complete = (req: PaymentTokenRequest): PaymentTokenRequest | null => {
    if (milestone !== 1) return req;
    const problem = coAnswerProblem(answer);
    if (problem) {
      ui.showAlert(problem);
      return null;
    }
    return { ...req, ...coAnswerFields(answer) };
  };

  const pay = async (request: PaymentTokenRequest) => {
    ui.showLoading();
    try {
      const amount = request.Amount.trim() === '' ? NaN : Number(request.Amount);
      if (!Number.isFinite(amount)) return ui.showAlert(AMOUNT_ERROR);
      if (amount === 0) {
        const r = await app.api.submitConsultancyZeroPayment(request);
        if (!isSuccess(r)) return ui.showAlert(r.errorMessage ?? 'Error occurred while while processing request, please try again');
        setReceipt({ amount: '0', orderId: null, at: new Date() });
        setSuccess(true);
        setPage(3);
      } else {
        const r = await app.api.getConsultancyPaymentToken(request);
        if (!isSuccess(r)) return ui.showAlert(r.errorMessage ?? 'Error occurred while getting data');
        ui.hideLoading();
        const result = await startCheckout(checkoutOrder(r, app.user?.MsmeDetails, certification, app.api.site, { milestone }));
        if (result.outcome === 'cancel') ui.toast('Transaction cancelled', { long: true });
        else if (result.outcome === 'error') ui.showAlert(result.error?.trim() ? result.error : PAYMENT_ERROR);
        else if (!result.status && result.description) ui.showAlert(result.description);
        else {
          setReceipt({ amount: request.Amount, orderId: r.orderId ?? null, at: new Date() });
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

  const fee = response?.WithOutCoupon?.[0] ?? null;
  const title = page === 3 ? (success ? 'Success' : 'Failure') : 'Handholding Payment';
  return (
    <ScreenFrame title={title} backBar={{ zedId, onBack }} testID="handholding-payment">
      {loadError != null ? (
        <FeeError message={loadError} onBack={() => nav.pop()} onRetry={() => void loadFee()} />
      ) : response == null ? null : page === 0 ? (
        <TextPage title="Disclaimer" textKey="app.msme.handholding.payment.disclaimer" onBack={onBack} onProceed={() => setPage(1)} />
      ) : page === 1 ? (
        <TextPage title="Instructions" textKey="app.msme.handholding.payment.instructions" onBack={onBack} onProceed={() => setPage(2)} />
      ) : page === 2 ? (
        <DetailsPage
          type={certification as CertificationType}
          response={response}
          zedId={zedId}
          onBack={onBack}
          onPay={req => void pay(req)}
          feeLabel="Handholding Fee"
          notes={[`Milestone ${milestone}: ${milestoneTitle(milestone)}`, ...handholdingNotes(fee, name)]}
          complete={complete}>
          {milestone === 1 ? (
            <View style={{ marginTop: dimens.padding2 }}>
              <Text style={styles.sectionTitle}>Consultant Organisation</Text>
              <CoAssistQuestion value={answer} onChange={setAnswer} load={() => app.api.getConsultantOrganisations(certification, zedId)} />
              <Text style={styles.help}>If yes, choose it: milestone 1 is allotted to it. If no, a Consultant Organisation is allotted to you.</Text>
            </View>
          ) : null}
        </DetailsPage>
      ) : (
        <ResultPage
          name={name}
          milestone={milestone}
          success={!!success}
          receipt={receipt}
          assisted={answer.assisted}
          onDone={() => nav.pop()}
          onDashboard={() => nav.reset([{ name: 'Dashboard' }])}
          onRetry={() => setPage(2)}
        />
      )}
    </ScreenFrame>
  );
}

function ResultPage({
  name,
  milestone,
  success,
  receipt,
  assisted,
  onDone,
  onDashboard,
  onRetry,
}: {
  name: string;
  milestone: number;
  success: boolean;
  receipt: Receipt | null;
  assisted: CoAnswer['assisted'];
  onDone: () => void;
  onDashboard: () => void;
  onRetry: () => void;
}) {
  const failure = useAppText('app.msme.payment.failure', { Certification: `${name} Handholding` });
  const next =
    milestone !== 1
      ? `Milestone ${milestone} has started with your Consultant Organisation.`
      : assisted === 'yes'
        ? 'Milestone 1 is allotted to the Consultant Organisation you chose. It will contact you.'
        : 'A Consultant Organisation will be allotted to you. It will contact you.';
  return (
    <View style={{ flex: 1, backgroundColor: colors.white }} testID={success ? 'handholding-payment-success' : 'handholding-payment-failure'}>
      <ScrollView contentContainerStyle={styles.result}>
        <View style={[styles.badgeOuter, { backgroundColor: success ? colors.appColor3 : colors.ncBackground }]}>
          <View style={[styles.badgeInner, { backgroundColor: success ? colors.appColor : colors.ncRed }]}>
            <Text style={styles.badgeMark}>{success ? '✓' : '!'}</Text>
          </View>
        </View>
        <Text style={styles.resultTitle}>{success ? 'Payment successful' : 'Payment not completed'}</Text>
        <Text style={styles.levelChip}>{`${name} Handholding: Milestone ${milestone}`}</Text>
        {success && receipt ? (
          <View style={styles.receipt} testID="handholding-receipt">
            <Row label="Amount paid" value={`₹ ${receipt.amount}`} />
            {receipt.orderId ? <Row label="Order ID" value={receipt.orderId} /> : null}
            <Row
              label="Date"
              value={receipt.at.toLocaleString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}
            />
          </View>
        ) : null}
        <Text style={styles.resultText} testID="handholding-result-message">
          {success ? next : failure ? htmlToPlain(failure.html).trim() : ''}
        </Text>
      </ScrollView>
      <View style={styles.resultButtons}>
        {success ? (
          <ZedButton title="Back to Handholding Support" onPress={onDone} testID="handholding-done" />
        ) : (
          <ZedButton title="Retry Payment" onPress={onRetry} testID="handholding-retry-pay" />
        )}
        <ZedButton title="Back to Dashboard" style={styles.outlineButton} textStyle={{ color: colors.appColorDark }} onPress={onDashboard} testID="handholding-dashboard" />
      </View>
    </View>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.receiptRow}>
      <Text style={styles.receiptLabel}>{label}</Text>
      <Text style={styles.receiptValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  centre: { flex: 1, justifyContent: 'center', padding: dimens.padding4 },
  message: { textAlign: 'center', fontSize: dimens.textSize, color: colors.black },
  card: { margin: dimens.padding2, padding: dimens.padding4, borderWidth: 1, borderColor: colors.green, borderRadius: dimens.padding2, backgroundColor: colors.white },
  cardTitle: { fontSize: 17, fontWeight: 'bold', color: colors.appColorDark, marginBottom: dimens.padding2 },
  milestone: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: dimens.padding1 },
  dot: { width: 28, height: 28, borderRadius: 14, borderWidth: 1.5, borderColor: colors.appColor, alignItems: 'center', justifyContent: 'center', marginRight: dimens.padding2 },
  dotDone: { backgroundColor: colors.appColor },
  dotDue: { backgroundColor: colors.appColorDark, borderColor: colors.appColorDark },
  dotText: { fontWeight: 'bold', color: colors.appColorDark },
  milestoneTitle: { fontWeight: 'bold', color: colors.black, fontSize: dimens.textSize14 },
  milestoneText: { color: colors.textColor, fontSize: 13 },
  milestoneState: { color: colors.labelColor, fontSize: 12, marginTop: 2 },
  refusal: { marginTop: dimens.padding2, color: colors.couponBorder, fontSize: dimens.textSize14 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', color: colors.black, marginHorizontal: dimens.padding2, marginBottom: dimens.padding1 },
  help: { color: colors.labelColor, fontSize: 12, marginHorizontal: dimens.padding2, marginBottom: dimens.padding2 },
  result: { alignItems: 'center', padding: dimens.padding4, paddingTop: 36 },
  badgeOuter: { width: 96, height: 96, borderRadius: 48, alignItems: 'center', justifyContent: 'center' },
  badgeInner: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  badgeMark: { color: colors.white, fontSize: 32, fontWeight: 'bold' },
  resultTitle: { fontSize: 22, fontWeight: 'bold', color: colors.black, marginTop: dimens.padding4 },
  levelChip: {
    marginTop: dimens.padding2,
    borderWidth: 1.5,
    borderColor: colors.appColorDark,
    color: colors.appColorDark,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 3,
    fontWeight: 'bold',
    overflow: 'hidden',
  },
  receipt: { alignSelf: 'stretch', backgroundColor: colors.lightGrey2, borderRadius: 10, padding: dimens.padding3, marginTop: dimens.padding4 },
  receiptRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3 },
  receiptLabel: { color: colors.labelColor, fontSize: 14 },
  receiptValue: { color: colors.black, fontSize: 14, fontWeight: 'bold' },
  resultText: { fontSize: 15, color: colors.darkGrey2, textAlign: 'center', marginTop: dimens.padding4, lineHeight: 22 },
  resultButtons: { padding: dimens.padding4, gap: dimens.padding2, backgroundColor: colors.white },
  outlineButton: { backgroundColor: colors.white, borderWidth: 1.5, borderColor: colors.appColor },
});
