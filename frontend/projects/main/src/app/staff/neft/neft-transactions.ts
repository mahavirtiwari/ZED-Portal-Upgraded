import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { NeftApi, NeftList, NeftTransaction } from './neft.api';
import { TuApi } from '../consultancy/technology/tu.api';
import { STAFF_SYSTEM } from '../staff-menu';

interface ApprovalForm {
  transaction: NeftTransaction;
  date: string;
  referenceNo: string;
  amount: string;
  submitted: boolean;
}

const TITLES: Record<NeftList, string> = {
  new: 'New Transactions',
  approved: 'Approved Transactions',
  rejected: 'Rejected Transactions',
};

/** Consultancy's titles (ZEDCS_CONSULTANCY Frontend/Neft). */
const CONSULTANCY_TITLES: Record<NeftList, string> = { ...TITLES, approved: 'Approved Transaction' };

/** Local date as yyyy-MM-dd (the max of the date picker: no payment date in the future). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * NEFT reimbursements of financial assistance for state coordinators. Port of Views/Neft/NewTransactions,
 * ApprovedTransactions and RejectedTransactions (one component; the route's `data.list` picks the list).
 * The API shows only the coordinator's state and allows each approval once.
 */
@Component({
  selector: 'zed-staff-neft-transactions',
  imports: [FormsModule, RouterLink],
  templateUrl: './neft-transactions.html',
  styles: `
    table tbody tr td { font-size: 14px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .help-block { color: #a94442; font-size: 13px; }
  `,
})
export class NeftTransactionsPage {
  /**
   * Consultancy: the rows are Technology Upgradation reimbursements, one per technology, with the old page's columns,
   * "View Details" (the TU verification page) and "Visit Report" (the TU report).
   */
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy';

  protected tuLink(t: NeftTransaction): string[] {
    return ['/staff/consultancy/technology/verification', t.ZedId, t.CertificationType ?? ''];
  }

  protected reportLink(t: NeftTransaction): string {
    return this.tu.reportUrl(t.ZedId, t.CertificationType ?? '');
  }

  private readonly api = inject(NeftApi);
  private readonly tu = inject(TuApi);

  protected readonly list: NeftList = (inject(ActivatedRoute).snapshot.data['list'] as NeftList) ?? 'new';
  protected readonly title = (this.consultancy ? CONSULTANCY_TITLES : TITLES)[this.list] ?? TITLES.new;
  protected readonly maxDate = today();

  protected readonly transactions = signal<NeftTransaction[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly form = signal<ApprovalForm | null>(null);
  protected readonly formError = signal('');
  protected readonly saving = signal(false);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.transactions.set((await firstValueFrom(this.api.list(this.list))).transactions ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected open(t: NeftTransaction): void {
    this.success.set('');
    this.formError.set('');
    this.form.set({ transaction: t, date: '', referenceNo: '', amount: '', submitted: false });
  }

  protected close(): void {
    if (!this.saving()) this.form.set(null);
  }

  protected update(patch: Partial<ApprovalForm>): void {
    const f = this.form();
    if (f) this.form.set({ ...f, ...patch });
  }

  protected async submit(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.update({ submitted: true });
    if (!f.date || !f.referenceNo.trim() || !String(f.amount).trim()) {
      this.formError.set('Please enter all the required details.');
      return;
    }
    if (f.date > this.maxDate) {
      this.formError.set('The date of receipt of payment cannot be in the future.');
      return;
    }
    this.saving.set(true);
    this.formError.set('');
    try {
      const r = await firstValueFrom(
        this.api.approve(f.transaction.TransactionId, {
          zedId: f.transaction.ZedId,
          dateOfReceiptOfPayment: f.date,
          referenceNo: f.referenceNo.trim(),
          amount: String(f.amount).trim(),
        }),
      );
      this.form.set(null);
      this.success.set(r.message || 'Transaction Approved.');
      // Approved rows leave the "new" list (VerificationStatus 6).
      this.transactions.update((rows) => rows.filter((x) => x.TransactionId !== f.transaction.TransactionId));
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
