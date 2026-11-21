import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { handholdingLevel, handholdingLevelName } from '../handholding/handholding.api';
import { ConsultancyOptions, ConsultancyPaymentApi, ConsultantOrganisation, milestoneTitle } from './consultancy-payment.api';
import { FeeRow, postToGateway } from './payment.api';
import { PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
import { levelLogo } from '../shared/levels';
import { ProfileApi } from '../profile/profile.api';
import { PaymentBilling } from './payment-step';
import { PayDisclaimer, PayRail, billingOf } from './pay-disclaimer';

const GSTIN = /^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][zZ][0-9A-Za-z]$/;
const TAN = /^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/;

type Step = 'disclaimer' | 'instructions' | 'payment';

/**
 * Paying for the next Handholding Support milestone. Port of steps 2–4 of
 * Frontend/Msme/HandholdingSupport.cshtml (disclaimer, instructions, payment options and summary, PAN
 * mismatch pop-up). The milestone, fee and amount are decided by the API, which re-checks on every call
 * that the milestone can be paid (previous milestone accepted).
 * 2026-11-17 (the user's apply-and-pay designs, as the certification apply flow): page head with "Step n of 4", the four-step
 * tracker, the disclaimer card with an explicit consent tick and "You are paying for" (the milestone) on the right, then the fee
 * and tax step (Yes / No toggles, billing details, the fee summary card beside the form).
 * 2026-11-21 (the product owner's rule): milestone 1 also asks "Did any Consultant Organisation assist you?" (required); Yes opens a
 * searchable list of the organisations the unit may name (active, purchase order not used up) and one must be chosen. The paid
 * milestone then goes straight to that organisation, else by round robin (the server).
 */
@Component({
  selector: 'zed-consultancy-payment',
  imports: [FormsModule, DecimalPipe, AlertDialog, RouterLink, ContentTextComponent, PageHead, StepTracker, PayDisclaimer, TextPipe],
  templateUrl: './consultancy-payment.html',
  styleUrl: './payment-step.scss',
})
export class ConsultancyPaymentPage implements OnInit {
  private readonly api = inject(ConsultancyPaymentApi);
  private readonly profile = inject(ProfileApi);
  private readonly router = inject(Router);

  /** Route parameter (Silver or Gold; any case). */
  readonly certification = input<string>('');

  protected readonly level = computed(() => handholdingLevel(this.certification()));
  /** The level as shown (ZED-X for ZEDX). */
  protected readonly levelLabel = computed(() => { const l = this.level(); return l ? handholdingLevelName(l) : ''; });
  protected readonly step = signal<Step | null>(null);
  protected readonly milestone = signal(0);
  protected readonly options = signal<ConsultancyOptions | null>(null);
  protected readonly busy = signal(false);
  /** 2026-11-18 (the user's applicant designs, zed-msme-08): the browser is leaving for the payment gateway (the hand-off card). */
  protected readonly leaving = signal(false);
  /** Error / success pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly submitted = signal(false);
  protected readonly panModal = signal(false);

  /** The unit's billing details (api/msme/profile); the card is left out when they cannot be read. */
  protected readonly billing = signal<PaymentBilling | null>(null);
  protected readonly logo = computed(() => levelLogo(this.level() ?? 'Silver'));
  /** "Milestone 1: Baseline Diagnostic Study and Handholding Action Plan". */
  protected readonly milestoneLabel = computed(() => milestoneTitle(this.milestone()));

  protected readonly crumbs = computed(() => [
    { label: t('msme.handholdingPayment.crumb.home', 'Home'), link: '/msme/dashboard' },
    { label: t('msme.handholdingPayment.crumb.incentives', 'Incentives'), link: '/msme/dashboard', fragment: 'incentives' },
    { label: t('msme.handholdingPayment.crumb.handholding', 'Handholding support'), link: '/msme/handholding' },
    { label: t('msme.handholdingPayment.crumb.payment', 'Payment') },
  ]);

  protected readonly subtitle = computed(() =>
    this.step() === 'payment' ? t('msme.payment.step2.sub', 'Step 2 of 4: confirm tax details and the amount before you pay.')
      : this.step() === 'instructions' ? t('msme.payment.instructionsStep.sub', 'Step 1 of 4: read the instructions before payment.')
        : this.step() ? t('msme.payment.disclaimerStep.sub', 'Step 1 of 4: read and accept the disclaimer before payment.') : null);

  protected readonly steps = computed<TrackerStep[]>(() => {
    const atFee = this.step() === 'payment';
    const here = t('msme.payment.tracker.hereNote', 'You are here');
    return [
      { label: t('msme.payment.tracker.disclaimerLabel', 'Disclaimer'), note: atFee ? t('msme.payment.tracker.disclaimerNote', 'Read and accept') : here },
      { label: t('msme.payment.tracker.feeLabel', 'Fee & tax details'), note: atFee ? here : t('msme.payment.tracker.feeNote', 'GSTIN, TDS, coupon') },
      { label: t('msme.payment.tracker.paymentLabel', 'Payment'), note: t('msme.payment.tracker.paymentNote', 'Secure gateway') },
      { label: t('msme.payment.tracker.confirmationLabel', 'Confirmation'), note: t('msme.payment.tracker.confirmationNote', 'Receipt and next steps') },
    ];
  });

  /** "You are paying for": the level's handholding milestone due. */
  protected readonly rail = computed<PayRail>(() => ({
    logo: this.logo(),
    title: t('msme.handholdingPayment.rail.title', '{level} Handholding support', { level: this.levelLabel() }),
    sub: this.billing()?.unit ?? null,
    facts: [
      { label: t('msme.handholdingPayment.rail.milestoneLabel', 'Milestone'),
        value: this.milestone() ? t('msme.handholdingPayment.rail.milestoneText', 'Milestone {milestone}', { milestone: this.milestone() }) : '—' },
      ...(this.milestoneLabel() ? [{ label: t('msme.handholdingPayment.rail.coversLabel', 'Covers'), value: this.milestoneLabel()! }] : []),
    ],
  }));

  /** "GST @ 18%" (written here: an @ in the template would start a block). */
  protected gstLabel(): string {
    return t('msme.payment.summary.gstLabel', 'GST @ 18%');
  }

  protected gstinApplicable: 'Yes' | 'No' | null = null;
  protected gstin = '';
  protected tdsDeductible: 'Yes' | 'No' | null = null;
  protected tds: '1.5' | '7.5' | null = null;
  protected tan = '';
  protected readonly useReward = signal(false);
  protected correctedPan = '';

  /** Milestone 1: "Did any Consultant Organisation assist you?" (null until answered). */
  protected readonly assisted = signal<'Yes' | 'No' | null>(null);
  /** The organisations offered with Yes (loaded once, when Yes is first chosen). */
  protected readonly organisations = signal<ConsultantOrganisation[] | null>(null);
  protected readonly organisationsError = signal<string | null>(null);
  protected readonly coId = signal<string | null>(null);
  protected readonly coQuery = signal('');
  protected readonly coOpen = signal(false);
  /** The question is asked for milestone 1 only. */
  protected readonly askCo = computed(() => this.options()?.milestone === 1);
  protected readonly chosenCo = computed(() => this.organisations()?.find((o) => o.userId === this.coId()) ?? null);
  /** The list filtered by name or ID (all of it while the box shows the chosen one). */
  protected readonly shownOrganisations = computed(() => {
    const all = this.organisations() ?? [];
    const q = this.coQuery().trim().toLowerCase();
    const chosen = this.chosenCo();
    if (!q || (chosen && q === chosen.name.toLowerCase())) return all;
    return all.filter((o) => o.name.toLowerCase().includes(q) || o.userId.toLowerCase().includes(q));
  });
  private gstinPan = '';

  protected readonly fee = computed<FeeRow>(() => {
    const o = this.options();
    if (!o) return {};
    return (this.useReward() && o.withReward) || o.withoutReward;
  });

  async ngOnInit(): Promise<void> {
    const level = this.level();
    if (!level) {
      this.alert.set(errorAlert(t('msme.handholdingPayment.error.invalidLevel', 'Invalid certification.')));
      return;
    }
    const status = await this.call(this.api.status(level));
    if (!status) return;
    if (!status.canPay) {
      this.alert.set(errorAlert(status.refusal ?? t('msme.handholdingPayment.error.notAvailable', 'Handholding Support is not available for this level.')));
      return;
    }
    this.milestone.set(status.nextMilestone);
    this.goStep('disclaimer');
    // The unit's name and address for the rail and the billing card (best effort: the page works without them).
    firstValueFrom(this.profile.get()).then((p) => this.billing.set(billingOf(p?.msme))).catch(() => undefined);
  }

  /** The page head's Back: from the fee step to the disclaimer, else to Handholding support. */
  protected back(): void {
    if (this.step() === 'payment') this.goStep('disclaimer');
    else void this.router.navigate(['/msme/handholding'], { queryParams: { level: this.level() } });
  }

  protected goStep(step: Step): void {
    this.step.set(step);
    window.scrollTo(0, 0);
  }

  /** Instructions accepted: load the fee summary (the API refreshes the enterprise type from Udyam first). */
  protected async openPayment(): Promise<void> {
    const o = await this.call(this.api.options(this.level()!));
    if (!o) return;
    this.options.set(o);
    this.milestone.set(o.milestone);
    this.gstinApplicable = null;
    this.gstin = '';
    this.tdsDeductible = null;
    this.tds = null;
    this.tan = '';
    this.useReward.set(false);
    this.assisted.set(null);
    this.coId.set(null);
    this.coQuery.set('');
    this.coOpen.set(false);
    this.submitted.set(false);
    this.goStep('payment');
  }

  /** The answer to the milestone 1 question; Yes loads the organisations the first time. */
  protected async answerAssisted(answer: 'Yes' | 'No'): Promise<void> {
    this.assisted.set(answer);
    if (answer === 'No') {
      this.coId.set(null);
      this.coQuery.set('');
      this.coOpen.set(false);
      return;
    }
    if (this.organisations() !== null) return;
    this.organisationsError.set(null);
    try {
      this.organisations.set(await firstValueFrom(this.api.consultantOrganisations(this.level()!)));
    } catch (err) {
      this.organisationsError.set(apiErrorMessage(err));
    }
  }

  protected retryOrganisations(): void {
    this.organisations.set(null);
    void this.answerAssisted('Yes');
  }

  protected searchCo(text: string): void {
    this.coQuery.set(text);
    this.coOpen.set(true);
    // Typing over the chosen name starts a new choice.
    if (this.chosenCo() && text.trim().toLowerCase() !== this.chosenCo()!.name.toLowerCase()) this.coId.set(null);
  }

  protected pickCo(o: ConsultantOrganisation): void {
    this.coId.set(o.userId);
    this.coQuery.set(o.name);
    this.coOpen.set(false);
  }

  /** The list closes when the focus leaves the search box and the list. */
  protected coLeft(event: FocusEvent, box: HTMLElement): void {
    if (!box.contains(event.relatedTarget as Node | null)) this.coOpen.set(false);
  }

  protected coInvalid(): boolean {
    return this.askCo() && (!this.assisted() || (this.assisted() === 'Yes' && !this.coId()));
  }

  protected n(field: string): number {
    return Number(this.fee()[field] ?? 0) || 0;
  }

  protected text(field: string): string {
    return String(this.fee()[field] ?? '');
  }

  /**
   * 2026-11-17 (the user): nothing to pay after the subsidy / reward (the server's own test: the contribution after subsidy
   * is 0). The payment is then recorded without the gateway, as a zero-amount payment; the button says so.
   */
  protected nothingToPay(): boolean {
    return this.n('ApplicantContributionAfterSubsidy') <= 0;
  }

  protected netPayable(): number {
    if (this.tdsDeductible === 'Yes' && this.tds === '1.5') return this.n('NetPaybleTds15');
    if (this.tdsDeductible === 'Yes' && this.tds === '7.5') return this.n('NetPaybleTds75');
    return this.n('ApplicantContributionAfterSubsidy');
  }

  protected gstinInvalid(): boolean {
    return this.gstinApplicable === 'Yes' && !GSTIN.test(this.gstin.trim());
  }

  protected tanInvalid(): boolean {
    return this.tdsDeductible === 'Yes' && !TAN.test(this.tan.trim());
  }

  protected formValid(): boolean {
    return (
      !!this.gstinApplicable &&
      !!this.tdsDeductible &&
      !this.coInvalid() &&
      !this.gstinInvalid() &&
      (this.tdsDeductible === 'No' || (!!this.tds && !this.tanInvalid()))
    );
  }

  /** "PROCEED TO PAY": GSTIN check (and PAN correction if needed), then checkout. */
  protected async proceed(): Promise<void> {
    this.submitted.set(true);
    if (!this.formValid()) {
      this.alert.set(errorAlert(t('msme.payment.error.required', 'Please enter required data.')));
      return;
    }
    if (this.gstinApplicable === 'Yes') {
      const g = await this.call(this.api.verifyGstin(this.level()!, this.gstin.trim().toUpperCase()));
      if (!g) return;
      if (!g.panMatches) {
        this.gstinPan = g.gstinPan;
        this.correctedPan = '';
        this.panModal.set(true);
        return;
      }
    }
    await this.checkout();
  }

  protected async savePan(): Promise<void> {
    const pan = this.correctedPan.trim().toUpperCase();
    if (pan.length !== 10) {
      this.alert.set(errorAlert(t('msme.payment.error.panLength', 'Please enter a valid 10-character PAN.')));
      return;
    }
    if (pan !== this.gstinPan) {
      this.alert.set(errorAlert(t('msme.payment.error.panMismatch', 'Please enter the correct PAN associated with that GSTIN.')));
      return;
    }
    this.panModal.set(false);
    const ok = await this.call(this.api.correctPan(this.level()!, this.gstin.trim().toUpperCase(), pan));
    if (!ok) return;
    this.alert.set(successAlert(t('msme.payment.toast.panUpdated', 'PAN updated successfully. Proceeding...')));
    await this.checkout();
  }

  private async checkout(): Promise<void> {
    const level = this.level()!;
    const res = await this.call(
      this.api.checkout(level, {
        useReward: this.useReward(),
        gstinApplicable: this.gstinApplicable === 'Yes',
        gstin: this.gstinApplicable === 'Yes' ? this.gstin.trim().toUpperCase() : null,
        tdsDeductible: this.tdsDeductible === 'Yes',
        tds: this.tdsDeductible === 'Yes' ? this.tds : null,
        tan: this.tdsDeductible === 'Yes' ? this.tan.trim().toUpperCase() : null,
        milestone: this.milestone(),
        // Milestone 1 only; milestones 2 and 3 send what they always sent.
        ...(this.askCo() ? { assistedByCo: this.assisted() === 'Yes', assistedCoId: this.assisted() === 'Yes' ? this.coId() : null } : {}),
      }),
    );
    if (!res) return;
    if (res.status === 'paid') {
      await this.router.navigate(['/msme/payment/consultancy-result'], {
        queryParams: { status: 'success', certification: level, milestone: this.milestone() },
      });
    } else {
      this.busy.set(true); // keep the overlay while the browser leaves for the gateway
      this.leaving.set(true);
      postToGateway(res);
    }
  }

  private async call<T>(req: Observable<T>): Promise<T | null> {
    this.busy.set(true);
    try {
      return await firstValueFrom(req);
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
