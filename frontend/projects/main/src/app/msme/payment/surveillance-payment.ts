import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { canonicalLevelCode, levelLogo, levelName } from '../shared/levels';
import { CheckoutRequest, FeeRow, postToGateway } from './payment.api';
import { SurveillanceOptions, SurveillancePaymentApi } from './surveillance-payment.api';
import { PageHead } from '../shared/page-head';
import { StepTracker, TrackerStep } from '../shared/step-tracker';
import { ProfileApi } from '../profile/profile.api';
import { PaymentBilling } from './payment-step';
import { PayDisclaimer, PayRail, billingOf } from './pay-disclaimer';

const GSTIN = /^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][zZ][0-9A-Za-z]$/;
const TAN = /^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/;

type Step = 'disclaimer' | 'instructions' | 'payment';

/**
 * Surveillance assessment payment. Port of Frontend/SurveillancePay/Index.cshtml: disclaimer,
 * instructions, payment options and summary, and the PAN mismatch pop-up. The page is only for a
 * level whose surveillance can be paid now (the old Index action sent anything else back to the
 * dashboard); the API checks that again on every call and decides the amount.
 * 2026-11-17 (the user's apply-and-pay designs, as the certification apply flow): page head with "Step n of 4", the four-step
 * tracker, the disclaimer card with an explicit consent tick and "You are paying for" on the right, then the fee and tax step
 * (Yes / No toggles, billing details, the fee summary card beside the form).
 */
@Component({
  selector: 'zed-surveillance-payment',
  imports: [FormsModule, DecimalPipe, AlertDialog, RouterLink, ContentTextComponent, PageHead, StepTracker, PayDisclaimer],
  templateUrl: './surveillance-payment.html',
  styleUrl: './payment-step.scss',
})
export class SurveillancePaymentPage implements OnInit {
  private readonly api = inject(SurveillancePaymentApi);
  private readonly profile = inject(ProfileApi);
  private readonly router = inject(Router);

  /** Route parameter (Bronze, Silver, Gold, ZEDX or a level the Admin added; any case). */
  readonly certification = input<string>('');

  /** The level as stored: every level of Administration → Certification Levels (2026-11-08), not only the built-in four. */
  protected readonly level = computed(() => canonicalLevelCode(this.certification()));
  /** What the page shows for the level (ZEDX is ZED-X) and its picture. */
  protected readonly name = computed(() => levelName(this.level()));
  protected readonly logo = computed(() => levelLogo(this.level() ?? 'Bronze'));
  protected readonly step = signal<Step | null>(null);
  protected readonly options = signal<SurveillanceOptions | null>(null);
  protected readonly busy = signal(false);
  /** 2026-11-18 (the user's applicant designs, zed-msme-08): the browser is leaving for the payment gateway (the hand-off card). */
  protected readonly leaving = signal(false);
  /** Error / success pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly submitted = signal(false);
  protected readonly panModal = signal(false);

  /** The unit's billing details (api/msme/profile); the card is left out when they cannot be read. */
  protected readonly billing = signal<PaymentBilling | null>(null);

  protected readonly subtitle = computed(() =>
    this.step() === 'payment' ? 'Step 2 of 4: confirm tax details and the amount before you pay.'
      : this.step() === 'instructions' ? 'Step 1 of 4: read the instructions before payment.'
        : this.step() ? 'Step 1 of 4: read and accept the disclaimer before payment.' : null);

  protected readonly steps = computed<TrackerStep[]>(() => {
    const atFee = this.step() === 'payment';
    return [
      { label: 'Disclaimer', note: atFee ? 'Read and accept' : 'You are here' },
      { label: 'Fee & tax details', note: atFee ? 'You are here' : 'GSTIN, TDS, coupon' },
      { label: 'Payment', note: 'Secure gateway' },
      { label: 'Confirmation', note: 'Receipt and next steps' },
    ];
  });

  /** "You are paying for": the level's surveillance assessment. */
  protected readonly rail = computed<PayRail>(() => ({
    logo: this.logo(),
    title: `${this.name()} Surveillance`,
    sub: this.billing()?.unit ?? null,
    facts: [
      { label: 'Payment for', value: 'Surveillance assessment' },
      { label: 'Certification', value: `${this.name()} Certification` },
    ],
  }));

  protected gstinApplicable: 'Yes' | 'No' | null = null;
  protected gstin = '';
  protected tdsDeductible: 'Yes' | 'No' | null = null;
  protected tds: '1.5' | '7.5' | null = null;
  protected tan = '';
  protected readonly useReward = signal(false);
  protected correctedPan = '';
  private gstinPan = '';

  protected readonly fee = computed<FeeRow>(() => {
    const o = this.options();
    if (!o) return {};
    return (this.useReward() && o.withReward) || o.withoutReward;
  });

  async ngOnInit(): Promise<void> {
    const level = this.level();
    if (!level) {
      this.alert.set(errorAlert('Invalid certification.'));
      return;
    }
    const status = await this.call(this.api.status(level));
    if (!status) return;
    if (!status.eligible) {
      await this.router.navigate(['/msme/dashboard']);
      return;
    }
    this.goStep('disclaimer');
    // The unit's name and address for the rail and the billing card (best effort: the page works without them).
    firstValueFrom(this.profile.get()).then((p) => this.billing.set(billingOf(p?.msme))).catch(() => undefined);
  }

  /** The page head's Back: from the fee step to the disclaimer, else to the dashboard. */
  protected back(): void {
    if (this.step() === 'payment') this.goStep('disclaimer');
    else void this.router.navigate(['/msme/dashboard']);
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
    const p = o.prefill;
    this.gstinApplicable = p?.unitGstin ?? null;
    this.gstin = p?.unitGstin === 'Yes' ? (p.gstin ?? '') : '';
    this.tdsDeductible = p?.tdsDeductible ?? null;
    this.tds = p?.tdsDeductible === 'Yes' ? p.tds : null;
    this.tan = p?.tdsDeductible === 'Yes' ? (p.tan ?? '') : '';
    this.submitted.set(false);
    this.goStep('payment');
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
      !this.gstinInvalid() &&
      (this.tdsDeductible === 'No' || (!!this.tds && !this.tanInvalid()))
    );
  }

  /** "PROCEED TO PAY": GSTIN check (and PAN correction if needed), then checkout. */
  protected async proceed(): Promise<void> {
    this.submitted.set(true);
    if (!this.formValid()) {
      this.alert.set(errorAlert('Please enter required data.'));
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
      this.alert.set(errorAlert('Please enter a valid 10-character PAN.'));
      return;
    }
    if (pan !== this.gstinPan) {
      this.alert.set(errorAlert('Please enter the correct PAN associated with that GSTIN.'));
      return;
    }
    this.panModal.set(false);
    const ok = await this.call(this.api.correctPan(this.level()!, this.gstin.trim().toUpperCase(), pan));
    if (!ok) return;
    this.alert.set(successAlert('PAN updated successfully. Proceeding...'));
    await this.checkout();
  }

  private async checkout(): Promise<void> {
    const level = this.level()!;
    const req: CheckoutRequest = {
      useReward: this.useReward(),
      gstinApplicable: this.gstinApplicable === 'Yes',
      gstin: this.gstinApplicable === 'Yes' ? this.gstin.trim().toUpperCase() : null,
      tdsDeductible: this.tdsDeductible === 'Yes',
      tds: this.tdsDeductible === 'Yes' ? this.tds : null,
      tan: this.tdsDeductible === 'Yes' ? this.tan.trim().toUpperCase() : null,
    };
    const res = await this.call(this.api.checkout(level, req));
    if (!res) return;
    if (res.status === 'paid') {
      await this.router.navigate(['/msme/payment/result'], { queryParams: { status: 'success', certification: level, kind: 'surveillance' } });
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
