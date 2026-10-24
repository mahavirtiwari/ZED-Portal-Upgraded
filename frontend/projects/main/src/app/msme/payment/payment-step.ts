import { DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { CheckoutRequest, FeeRow, PaymentApi, PaymentOptions, postToGateway } from './payment.api';

const GSTIN = /^([0][1-9]|[1-2][0-9]|[3][0-8])[A-Za-z]{5}[0-9]{4}[A-Za-z][1-9A-Za-z][zZ][0-9A-Za-z]$/;
const TAN = /^[A-Za-z]{4}[0-9]{5}[A-Za-z]$/;

/**
 * Payment step of the dashboard (Views/Msme/Dashboard.cshtml DisplayStep 4 and the PAN mismatch
 * pop-up). The summary is computed from the fee rows for display only; the API decides the amount.
 */
@Component({
  selector: 'zed-payment-step',
  imports: [FormsModule, DecimalPipe, AlertDialog],
  templateUrl: './payment-step.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .payment-summary .panel-body > div { display: flex; justify-content: space-between; gap: 12px; }
  `,
})
export class PaymentStep implements OnInit {
  private readonly api = inject(PaymentApi);
  private readonly router = inject(Router);

  readonly certification = input.required<string>();
  readonly back = output<void>();

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
