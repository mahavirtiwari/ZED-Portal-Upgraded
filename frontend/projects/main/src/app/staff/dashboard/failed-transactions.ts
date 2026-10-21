import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardApi, ListFilter, Row, UpdatePaymentRequest } from './dashboard.api';
import { ClientPager, flag, text } from './dashboard-filters';
import { ListFiltersBar, PagerBar } from './list-controls';

export const PG_TYPES = [
  { value: 'Unified Payments', label: 'UPI' },
  { value: 'Debit Card', label: 'Debit Card' },
  { value: 'Credit Card', label: 'Credit Card' },
  { value: 'Net Banking', label: 'Internet Banking' },
];

const GSTIN = /^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}[1-9A-Za-z]{1}[Zz][0-9A-Za-z]{1}$/;

function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * Failed gateway transactions (SuperAdmin). Port of Views/Dashboard/FailedTransactions.cshtml with its
 * "Update Payment Status" pop-up. The API re-checks that the transaction may be updated.
 */
@Component({
  selector: 'zed-staff-failed-transactions',
  imports: [FormsModule, ListFiltersBar, PagerBar],
  templateUrl: './failed-transactions.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .help-block { color: #a94442; font-size: 13px; }
  `,
})
export class FailedTransactionsPage {
  private readonly api = inject(DashboardApi);

  protected readonly pager = new ClientPager();
  protected readonly filter = signal<ListFilter>({});
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly pgTypes = PG_TYPES;
  protected readonly maxDate = today();

  /** Transactions updated on this page (the row then shows SUCCESS, as before). */
  protected readonly updated = signal<ReadonlySet<string>>(new Set());
  protected readonly current = signal<Row | null>(null);
  protected form: UpdatePaymentRequest = this.emptyForm();
  protected readonly saving = signal(false);
  protected readonly modalError = signal('');

  protected readonly text = text;
  protected readonly flag = flag;

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.pager.set(await firstValueFrom(this.api.failedTransactions(this.filter())));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected onFilter(f: ListFilter): void {
    this.filter.set(f);
    this.pager.setSearch('');
    void this.load();
  }

  private key(row: Row): string {
    return `${text(row, 'ZedId')}|${text(row, 'TransactionId')}`;
  }

  protected isUpdated(row: Row): boolean {
    return this.updated().has(this.key(row));
  }

  /** Same condition as the old page: hidden for coupon payments and when the procedure disallows it. */
  protected canUpdate(row: Row): boolean {
    return !(flag(row, 'IsCouponUsed') && text(row, 'UseCoupon') === 'Yes') && Number(row['AllowManualUpdate']) !== 0;
  }

  private emptyForm(row?: Row): UpdatePaymentRequest {
    return {
      zedId: row ? text(row, 'ZedId') : '', transactionId: row ? text(row, 'TransactionId') : '', certification: row ? text(row, 'Certification') : '',
      pgType: '', trackingId: '', bankRefNumber: '', bankCode: '', paymentReceivedDate: '', gstNumber: '', paymentRemarks: '',
    };
  }

  protected open(row: Row): void {
    this.form = this.emptyForm(row);
    this.modalError.set('');
    this.current.set(row);
  }

  protected trackingIdValid(): boolean {
    return /^\d{12}$/.test(this.form.trackingId);
  }

  protected gstValid(): boolean {
    return !this.form.gstNumber || GSTIN.test(this.form.gstNumber);
  }

  protected canSubmit(): boolean {
    const f = this.form;
    return !!(f.paymentRemarks.trim() && f.pgType && this.trackingIdValid() && f.bankRefNumber.trim() && f.paymentReceivedDate && this.gstValid());
  }

  protected async submit(): Promise<void> {
    const row = this.current();
    if (!row || !this.canSubmit()) return;
    this.saving.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(this.api.updatePayment({ ...this.form, gstNumber: text(row, 'Gstin') ? '' : this.form.gstNumber }));
      this.updated.update((s) => new Set([...s, this.key(row)]));
      this.current.set(null);
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
