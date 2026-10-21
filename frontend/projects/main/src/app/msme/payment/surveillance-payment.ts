import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { CheckoutRequest, FeeRow, postToGateway } from './payment.api';
import { SurveillanceOptions, SurveillancePaymentApi } from './surveillance-payment.api';

const LEVELS = ['Bronze', 'Silver', 'Gold'] as const;
const GSTIN = /^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][zZ][0-9A-Za-z]$/;
const TAN = /^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/;

type Step = 'disclaimer' | 'instructions' | 'payment';

/**
 * Surveillance assessment payment. Port of Frontend/SurveillancePay/Index.cshtml: disclaimer,
 * instructions, payment options and summary, and the PAN mismatch pop-up. The page is only for a
 * level whose surveillance can be paid now (the old Index action sent anything else back to the
 * dashboard); the API checks that again on every call and decides the amount.
 */
@Component({
  selector: 'zed-surveillance-payment',
  imports: [FormsModule, DecimalPipe, RouterLink],
  templateUrl: './surveillance-payment.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .payment-summary .panel-body > div { display: flex; justify-content: space-between; gap: 12px; }
  `,
})
export class SurveillancePaymentPage implements OnInit {
  private readonly api = inject(SurveillancePaymentApi);
  private readonly router = inject(Router);

  /** Route parameter (Bronze, Silver or Gold; any case). */
  readonly certification = input<string>('');

  protected readonly level = computed(() => LEVELS.find((l) => l.toLowerCase() === this.certification().toLowerCase()) ?? null);
  protected readonly step = signal<Step | null>(null);
  protected readonly options = signal<SurveillanceOptions | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly submitted = signal(false);
  protected readonly panModal = signal(false);
  protected readonly panError = signal('');

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
      this.error.set('Invalid certification.');
      return;
    }
    const status = await this.call(this.api.status(level));
    if (!status) return;
    if (!status.eligible) {
      await this.router.navigate(['/msme/dashboard']);
      return;
    }
    this.goStep('disclaimer');
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
    this.error.set('');
    if (!this.formValid()) {
      this.error.set('Please enter required data.');
      return;
    }
    if (this.gstinApplicable === 'Yes') {
      const g = await this.call(this.api.verifyGstin(this.level()!, this.gstin.trim().toUpperCase()));
      if (!g) return;
      if (!g.panMatches) {
        this.gstinPan = g.gstinPan;
        this.correctedPan = '';
        this.panError.set('');
        this.panModal.set(true);
        return;
      }
    }
    await this.checkout();
  }

  protected async savePan(): Promise<void> {
    const pan = this.correctedPan.trim().toUpperCase();
    if (pan.length !== 10) {
      this.panError.set('Please enter a valid 10-character PAN.');
      return;
    }
    if (pan !== this.gstinPan) {
      this.panError.set('Please enter the correct PAN associated with that GSTIN.');
      return;
    }
    this.panModal.set(false);
    const ok = await this.call(this.api.correctPan(this.level()!, this.gstin.trim().toUpperCase(), pan));
    if (ok) await this.checkout();
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
      postToGateway(res);
    }
  }

  private async call<T>(req: Observable<T>): Promise<T | null> {
    this.busy.set(true);
    try {
      return await firstValueFrom(req);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
