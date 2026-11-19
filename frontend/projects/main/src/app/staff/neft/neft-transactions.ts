import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { NeftApi, NeftList, NeftTransaction } from './neft.api';
import { TuApi } from '../consultancy/technology/tu.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';
import { STAFF_SYSTEM } from '../staff-menu';
import { AdminPortalService, NEFT_PORTALS, PORTAL_API_BASE, PortalSwitchComponent, neftPortals } from '../admin-portal';
import { TextPipe, t } from '../../content/page-text';

interface ApprovalForm {
  transaction: NeftTransaction;
  date: string;
  referenceNo: string;
  amount: string;
  submitted: boolean;
}

/** The page's title by list (consultancy's approved list keeps its own: ZEDCS_CONSULTANCY Frontend/Neft). */
function titleOf(list: NeftList, consultancy: boolean): string {
  switch (list) {
    case 'approved':
      return consultancy ? t('staff.neft.approved.consultancy.title', 'Approved Transaction') : t('staff.neft.approved.title', 'Approved Transactions');
    case 'rejected':
      return t('staff.neft.rejected.title', 'Rejected Transactions');
    default:
      return t('staff.neft.new.title', 'New Transactions');
  }
}

/** Local date as yyyy-MM-dd (the max of the date picker: no payment date in the future). */
function today(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * NEFT reimbursements of financial assistance for state coordinators. Port of Views/Neft/NewTransactions,
 * ApprovedTransactions and RejectedTransactions (one component; the route's `data.list` picks the list).
 * The API shows only the coordinator's state and allows each approval once.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the count (on the consultancy's new list: to approve /
 * approved as tiles that filter), one search box, the actions at the end of the row (the TU report in the row menu), the
 * light table header, a toast when a transaction is approved. The bank details stay in full: they are what is paid.</p>
 */
@Component({
  selector: 'zed-staff-neft-transactions',
  imports: [FormsModule, NgTemplateOutlet, RouterLink, PagerComponent, PortalSwitchComponent, PageHead, ListCounts, RowMenu, TextPipe],
  host: { class: 'list-v2 d-block' },
  templateUrl: './neft-transactions.html',
  styles: `
    .nf-filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-bottom: 14px; }
    .nf-q { flex: 1 1 260px; max-width: 460px; }
    .nf-act { margin-left: 6px; font-weight: 600; }
    .nf-done { margin-right: 4px; }
    .nf-pop { border: 0; border-radius: 12px; }
    .nf-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .nf-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
    .help-block { color: #a94442; font-size: 13px; }
    /* Several values in one cell, one per line (the old pages separated them with <br /><br />). */
    .cell-lines > * { display: block; }
    .cell-lines > * + * { margin-top: 4px; }
    .comments { white-space: pre-wrap; min-width: 180px; }
  `,
})
export class NeftTransactionsPage {
  /**
   * Consultancy: the rows are Technology Upgradation reimbursements, one per technology, with the old page's columns,
   * "View Details" (the TU verification page) and "Visit Report" (the TU report).
   */
  private readonly portals = inject(AdminPortalService);
  /** The NEFT Admin on the main portal (2026-11-07): one login for financial assistance and Technology Upgradation. */
  private readonly myNeftPortals = inject(STAFF_SYSTEM) === 'main' ? neftPortals(inject(AuthService).currentUser()) : null;
  /** The NEFT Admin, or an MSME DFO with the Handholding list: one login, a switch between the two (2026-11-07). */
  protected readonly neftAdmin = !!this.myNeftPortals?.includes('consultancy');
  protected readonly allStates = !!inject(AuthService).currentUser()?.isNeftAdmin;
  protected readonly neftPortals = this.myNeftPortals ?? NEFT_PORTALS;
  protected readonly neftLabels = computed(() => ({
    main: t('staff.neft.portalSwitch.main.label', 'Financial Assistance'), consultancy: t('staff.neft.portalSwitch.consultancy.label', 'Technology Upgradation'),
  }));
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy' || (this.neftAdmin && this.portals.effective(this.neftPortals) === 'consultancy');

  protected tuLink(t: NeftTransaction): string[] {
    return ['/staff/consultancy/technology/verification', t.ZedId, t.CertificationType ?? ''];
  }

  protected reportLink(t: NeftTransaction): string {
    const url = this.tu.reportUrl(t.ZedId, t.CertificationType ?? '');
    // The NEFT Admin on main opens the Consultancy portal's report (its sign-in there came with the switch).
    return this.neftAdmin && url.startsWith('/api/') ? PORTAL_API_BASE.consultancy + url : url;
  }

  private readonly api = inject(NeftApi);
  private readonly tu = inject(TuApi);
  private readonly toast = inject(ToastService);
  protected readonly reportMenu = computed((): RowMenuItem[] => [{ key: 'report', label: t('staff.neft.menu.report', 'Visit report'), icon: 'download' }]);

  protected openReport(t: NeftTransaction): void {
    window.open(this.reportLink(t), '_blank', 'noopener');
  }

  protected readonly list: NeftList = (inject(ActivatedRoute).snapshot.data['list'] as NeftList) ?? 'new';
  protected readonly title = computed(() => titleOf(this.list, this.consultancy));
  /** The line under the title: what is reimbursed, and whose (every state for the NEFT Admin). */
  protected readonly subtitle = computed(() => this.consultancy
    ? (this.allStates ? t('staff.neft.consultancy.allStates.sub', 'Technology upgradation reimbursements of the units of every state, paid by NEFT.')
      : t('staff.neft.consultancy.sub', 'Technology upgradation reimbursements of the units in your area, paid by NEFT.'))
    : (this.allStates ? t('staff.neft.allStates.sub', 'Financial assistance reimbursements of the units of every state, paid by NEFT.')
      : t('staff.neft.sub', 'Financial assistance reimbursements of the units in your area, paid by NEFT.')));
  protected readonly maxDate = today();
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));
  /** The consultancy's new list has two states (to approve, approved): tiles that filter it. */
  protected readonly filterable = this.consultancy && this.list === 'new';
  protected readonly stage = signal<string | null>(null);
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.transactions();
    if (!this.filterable) return [{ label: this.title(), value: rows.length, tone: this.list === 'rejected' ? 'bad' : this.list === 'approved' ? 'good' : 'warn' }];
    return [
      { key: 'all', label: t('staff.neft.count.all', 'Transactions'), value: rows.length },
      { key: '4', label: t('staff.neft.count.toApprove', 'To approve'), value: rows.filter((x) => x.VerificationStatus === 4).length, tone: 'warn' },
      { key: '6', label: t('staff.neft.count.approved', 'Approved'), value: rows.filter((x) => x.VerificationStatus === 6).length, tone: 'good' },
    ];
  });

  /** A tile filters the list; "Transactions" (or the chosen tile again) shows every one. */
  protected pickStage(key: string | undefined): void {
    if (this.filterable) this.stage.set(!key || key === 'all' || key === this.stage() ? null : key);
  }

  protected readonly transactions = signal<NeftTransaction[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  private readonly shown = computed(() => {
    const stage = this.stage();
    return stage ? this.transactions().filter((t) => String(t.VerificationStatus) === stage) : this.transactions();
  });
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly form = signal<ApprovalForm | null>(null);
  protected readonly formError = signal('');
  protected readonly saving = signal(false);
  /** Transactions whose comments are unfolded (long comments show three lines). */
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());

  constructor() {
    void this.load();
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
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
      this.formError.set(t('staff.neft.approve.required.error', 'Please enter all the required details.'));
      return;
    }
    if (f.date > this.maxDate) {
      this.formError.set(t('staff.neft.approve.future.error', 'The date of receipt of payment cannot be in the future.'));
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
      this.toast.success(r.message || t('staff.neft.approve.toast', 'Transaction Approved.'), f.transaction.ZedId);
      // Approved rows leave the "new" list (VerificationStatus 6).
      this.transactions.update((rows) => rows.filter((x) => x.TransactionId !== f.transaction.TransactionId));
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
