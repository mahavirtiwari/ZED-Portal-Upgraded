import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { AdminPortal } from '../admin-portal';
import { ListCount, ListCounts } from '../list-counts';
import { PagedView, PagerComponent } from '../pager';
import { staffCrumbs } from '../staff-crumbs';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { ExpenditureCasesDialog } from './cases-dialog';
import {
  ExpenditureApi, ExpenditureFilter, ExpenditureRow, ExpenditureSummary, Invoice, Option, PayeeKind, poPill, rupees, rupeesShort, shownDate, statusTone,
} from './expenditure.api';
import { InvoiceReviewDialog } from './invoice-review';

/** A view of the page: the assessment agencies (main) or the consultant organisations (Consultancy). */
type View = 'agencies' | 'organisations';

/**
 * 2026-11-18 (approved design "Expenditure monitoring", section 3): the Expenditure tab. Views "Assessment agencies" /
 * "Consultant organisations" (the Admin on main has both: the second reads the Consultancy portal through its hand-over; a
 * master admin has its portal's), filters (agency, level, state, dates), headline cards, a row per agency and level with the
 * PO, cases, balance, payable, invoiced and outstanding, the cases of a row ("Cases"), and the monthly invoices with their
 * review. Every list exports to Excel.
 */
@Component({
  selector: 'zed-staff-expenditure',
  imports: [FormsModule, PageHead, ListCounts, PagerComponent, ExpenditureCasesDialog, InvoiceReviewDialog],
  templateUrl: './expenditure.html',
  styles: `
    .xp-tabs { display: inline-flex; border: 1px solid #dde7e8; border-radius: 9px; overflow: hidden; }
    .xp-tabs button { border: 0; background: #fff; padding: 8px 14px; font-weight: 600; font-size: 13px; color: #3d5559; }
    .xp-tabs button.on { background: var(--zt-dark, #24666b); color: #fff; }
    .xp-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; padding: 12px 16px; margin-bottom: 16px; }
    .xp-bar label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: #6f8487; }
    .xp-bar .form-select, .xp-bar .form-control { height: 38px; min-width: 150px; }
    .xp-clear { margin-left: auto; border: 0; background: none; font-weight: 700; font-size: 12.5px; color: #6f8487; }
    .xp-card { padding: 0; overflow: hidden; margin-bottom: 16px; }
    .xp-card h2 { margin: 0; padding: 14px 16px; font-size: 16px; font-weight: 700; color: #17373b; display: flex; align-items: center; gap: 8px; }
    .xp-card h2 .btn { margin-left: auto; }
    .xp-table { min-width: 1100px; margin: 0; }
    .num { text-align: right; white-space: nowrap; }
    td small { display: block; color: #6f8487; font-size: 11.5px; }
    .owe { color: #9a5f06; font-weight: 700; }
  `,
})
export class ExpenditurePage {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);
  private readonly system = inject(STAFF_SYSTEM);
  private readonly user = inject(AuthService).currentUser;

  protected readonly crumbs = staffCrumbs({ label: 'Expenditure' });
  protected readonly money = rupees;
  protected readonly date = shownDate;
  protected readonly tone = statusTone;

  /** The views this user has: the Admin on main both; others their portal's. */
  protected readonly views = computed<View[]>(() =>
    this.system === 'consultancy' ? ['organisations'] : this.user()?.roleId === StaffRole.Admin ? ['agencies', 'organisations'] : ['agencies'],
  );
  protected readonly view = signal<View>(this.system === 'consultancy' ? 'organisations' : 'agencies');
  /** The Consultancy portal's API for the Admin's "Consultant organisations" view on main. */
  protected readonly portal = computed<AdminPortal | null>(() => (this.system === 'main' && this.view() === 'organisations' ? 'consultancy' : null));
  protected readonly consultant = computed(() => this.view() === 'organisations');
  protected readonly word = computed(() => (this.consultant() ? 'Consultant organisation' : 'Agency'));

  protected readonly partyId = signal('');
  protected readonly level = signal('');
  protected readonly state = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly data = signal<ExpenditureSummary | null>(null);
  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly rowsView = new PagedView<ExpenditureRow>(computed(() => this.data()?.rows ?? []), 20);
  protected readonly casesOf = signal<{ row: ExpenditureRow; filter: ExpenditureFilter } | null>(null);
  protected readonly reviewing = signal<number | null>(null);

  protected readonly counts = computed<ListCount[]>(() => {
    const c = this.data()?.cards;
    if (!c) return [];
    const list: ListCount[] = [{ label: 'Cases in POs', value: c.poCases }];
    if (this.consultant()) list.push({ label: 'Milestones counted', value: c.milestones, tone: 'good' });
    else
      list.push(
        { label: 'Completed', value: c.completed, tone: 'good' },
        { label: 'Rejected after assessment', value: c.rejected, tone: 'bad' },
        { label: 'Surveillance visits', value: c.surveillance, tone: 'warn' },
      );
    list.push({ label: 'Payable (excl. GST)', value: rupeesShort(c.payable) }, { label: 'Invoices approved', value: rupeesShort(c.approved), tone: 'good', sub: 'excl. GST' });
    return list;
  });

  protected readonly parties = computed<Option[]>(() => this.data()?.parties ?? []);
  protected readonly filtering = computed(() => !!(this.partyId() || this.level() || this.state() || this.from() || this.to()));

  constructor() {
    void this.load();
  }

  protected setView(v: View): void {
    if (v === this.view()) return;
    this.view.set(v);
    this.partyId.set('');
    this.level.set('');
    this.data.set(null);
    this.invoices.set([]);
    void this.load();
  }

  protected clearAll(): void {
    this.partyId.set('');
    this.level.set('');
    this.state.set('');
    this.from.set('');
    this.to.set('');
    void this.load();
  }

  private filter(): ExpenditureFilter {
    return { partyId: this.partyId(), level: this.level(), state: this.state(), from: this.from(), to: this.to() };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [summary, invoices] = await Promise.all([
        firstValueFrom(this.api.summary(this.filter(), this.portal())),
        firstValueFrom(this.api.invoices(this.partyId() || null, this.portal())),
      ]);
      this.data.set(summary);
      this.invoices.set(invoices);
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected pill(r: ExpenditureRow) {
    const p = poPill(r.poState, r.balance);
    return r.poState === 'Stopped' ? { ...p, text: '0 · stopped' } : r.poState === 'Low' ? { ...p, text: String(r.balance ?? 0) } : p;
  }

  protected openCases(row: ExpenditureRow): void {
    this.casesOf.set({ row, filter: { ...this.filter(), partyId: row.partyId, level: row.level } });
  }

  protected reviewed(changed: boolean): void {
    this.reviewing.set(null);
    if (changed) void this.load();
  }

  protected async export(): Promise<void> {
    const rows = this.data()?.rows ?? [];
    const kind: PayeeKind = this.consultant() ? 'Consultant' : 'Agency';
    const cols = this.consultant()
      ? ['Consultant organisation', 'ID', 'Level', 'PO', 'Cases in PO', 'Milestones', 'Balance', 'Payable (₹)', 'Invoiced (₹)', 'Outstanding (₹)']
      : ['Agency', 'ID', 'Level', 'PO', 'Cases in PO', 'Completed', 'Rejected', 'Surveillance', 'Balance', 'Payable (₹)', 'Invoiced (₹)', 'Outstanding (₹)'];
    const body = rows.map((r) => [r.partyName, r.partyId, r.levelName, r.poLabel ?? 'No PO', r.poCases,
      ...(kind === 'Consultant' ? [r.milestones] : [r.completed, r.rejected, r.surveillance]),
      r.poState === 'NoPo' ? null : r.balance, r.payable, r.invoiced, r.outstanding]);
    const inv = this.invoices().map((i) => [i.partyName, i.monthLabel, i.invoiceNo, i.invoiceDate, i.portalCases, i.portalTotal, i.invoiceAmount, i.status,
      i.status === 'Approved' ? i.erpExport ?? 'Pending' : null]);
    try {
      await this.excel.xlsx(this.consultant() ? 'expenditure-consultant-organisations' : 'expenditure-assessment-agencies', [
        { name: 'Expenditure', columns: cols, rows: body },
        { name: 'Invoices', columns: [this.word(), 'Month', 'Invoice', 'Invoice date', 'Cases', 'Portal amount incl. GST (₹)', 'Invoice amount (₹)', 'Status', 'ERP'], rows: inv },
      ]);
    } catch (e) {
      this.toast.error('Export failed', apiErrorMessage(e));
    }
  }
}
