import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { levelLogo, levelName } from '../shared/levels';
import { CheckoutRequest, FeeRow, PaymentApi, PaymentOptions, postToGateway } from './payment.api';

/** The unit's billing details (from the dashboard's data). */
export interface PaymentBilling {
  name: string | null;
  address: string | null;
  zedId: string | null;
  /** "<unit> · <ZED ID>" under the level in the summary. */
  unit: string | null;
}

const GSTIN = /^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][zZ][0-9A-Za-z]$/;
const TAN = /^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/;

/**
 * Payment step of the dashboard (Views/Msme/Dashboard.cshtml DisplayStep 4 and the PAN mismatch
 * pop-up). The summary is computed from the fee rows for display only; the API decides the amount.
 * 2026-11-17 (the user's "Fee & tax details" design): GSTIN and TDS as Yes / No toggles (the GSTIN and TAN fields unlock when
 * needed), the billing details from the dashboard's data, and the fee summary card with Net payable and the pay button.
 */
@Component({
  selector: 'zed-payment-step',
  imports: [FormsModule, DecimalPipe, RouterLink, AlertDialog, ContentTextComponent],
  templateUrl: './payment-step.html',
  styleUrl: './payment-step.scss',
})
export class PaymentStep implements OnInit {
  private readonly api = inject(PaymentApi);
  private readonly router = inject(Router);

  readonly certification = input.required<string>();
  /** The level's name and picture (ZEDX is ZED-X). */
  protected readonly name = computed(() => levelName(this.certification()));
  protected readonly logo = computed(() => levelLogo(this.certification()));
  /** The unit as the dashboard has it (billing details card and the summary's head); hidden when not given. */
  readonly billing = input<PaymentBilling | null>(null);
  /** Cancel application: back to the dashboard. */
  readonly back = output<void>();
  /** Back to disclaimer. */
  readonly previous = output<void>();

  protected readonly options = signal<PaymentOptions | null>(null);
  protected readonly busy = signal(false);
  /** Error / success pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);
  protected readonly submitted = signal(false);
  protected readonly panModal = signal(false);

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
    const o = await this.call(this.api.options(this.certification()));
    if (o) this.options.set(o);
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
      const g = await this.call(this.api.verifyGstin(this.certification(), this.gstin.trim().toUpperCase()));
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
    const ok = await this.call(this.api.correctPan(this.certification(), this.gstin.trim().toUpperCase(), pan));
    if (!ok) return;
    this.alert.set(successAlert('PAN updated successfully. Proceeding...'));
    await this.checkout();
  }

  private async checkout(): Promise<void> {
    const req: CheckoutRequest = {
      useReward: this.useReward(),
      gstinApplicable: this.gstinApplicable === 'Yes',
      gstin: this.gstinApplicable === 'Yes' ? this.gstin.trim().toUpperCase() : null,
      tdsDeductible: this.tdsDeductible === 'Yes',
      tds: this.tdsDeductible === 'Yes' ? this.tds : null,
      tan: this.tdsDeductible === 'Yes' ? this.tan.trim().toUpperCase() : null,
    };
    const res = await this.call(this.api.checkout(this.certification(), req));
    if (!res) return;
    if (res.status === 'paid') {
      await this.router.navigate(['/msme/payment/result'], { queryParams: { status: 'success', certification: this.certification() } });
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
      this.alert.set(errorAlert(apiErrorMessage(err)));
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
