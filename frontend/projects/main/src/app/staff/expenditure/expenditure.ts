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
import { TaxDetailsCard } from './tax-details';
import { TextPipe, t } from '../../content/page-text';
import { DashIcon } from '../../msme/dashboard/dash-icon';

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
  imports: [FormsModule, PageHead, ListCounts, PagerComponent, ExpenditureCasesDialog, InvoiceReviewDialog, TaxDetailsCard, TextPipe, DashIcon],
  templateUrl: './expenditure.html',
  styles: `
    .xp-tabs { display: inline-flex; border: 1px solid #dde7e8; border-radius: 9px; overflow: hidden; }
    .xp-tabs button { border: 0; background: #fff; padding: 8px 14px; font-weight: 600; font-size: 13px; color: #3d5559; }
    .xp-tabs button.on { background: var(--zt-dark, #24666b); color: #fff; }
    .xp-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; padding: 12px 16px; margin-bottom: 16px; }
    .xp-bar label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: #6f8487; flex: 1 1 160px; max-width: 260px; margin: 0; }
    .xp-bar .form-select, .xp-bar .form-control { height: 38px; width: 100%; min-width: 0; }
    .xp-clear { margin-left: auto; border: 0; background: none; font-weight: 700; font-size: 12.5px; color: #6f8487; }
    .xp-card { padding: 0; overflow: hidden; margin-bottom: 16px; }
    .xp-card h2 { margin: 0; padding: 14px 16px; font-size: 16px; font-weight: 700; color: #17373b; display: flex; align-items: center; gap: 8px; }
    .xp-card h2 .btn { margin-left: auto; }
    .xp-table { min-width: 1040px; margin: 0; }
    .xp-table th, .xp-table td { padding-left: 10px; padding-right: 10px; }
    .xp-table th { white-space: nowrap; }
    /* The row's button stays in view while the table scrolls sideways. */
    .xp-table th:last-child, .xp-table td:last-child { position: sticky; right: 0; background: #fff; box-shadow: -6px 0 8px -6px rgba(16, 61, 64, .18); }
    .xp-table tbody tr:hover td:last-child { background: #f4fafa; }
    .xp-table td:has(> .no-data) { position: static; box-shadow: none; }
    @media (max-width: 575.98px) { .xp-bar label { flex-basis: 100%; max-width: none; } .xp-clear { margin-left: 0; } }
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

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.expenditure.crumb', 'Expenditure') }));
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
  protected readonly word = computed(() => (this.consultant() ? t('staff.expenditure.organisationLabel', 'Consultant organisation') : t('staff.expenditure.agencyLabel', 'Agency')));

  protected readonly partyId = signal('');
  protected readonly level = signal('');
  protected readonly state = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly data = signal<ExpenditureSummary | null>(null);
  protected readonly invoices = signal<Invoice[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  // 2026-11-21 (UI audit C4): 10 rows per page, as the other staff lists.
  protected readonly rowsView = new PagedView<ExpenditureRow>(computed(() => this.data()?.rows ?? []), 10);
  protected readonly casesOf = signal<{ row: ExpenditureRow; filter: ExpenditureFilter } | null>(null);
  protected readonly reviewing = signal<number | null>(null);

  protected readonly counts = computed<ListCount[]>(() => {
    const c = this.data()?.cards;
    if (!c) return [];
    const list: ListCount[] = [{ label: t('staff.expenditure.count.poCases', 'Cases in POs'), value: c.poCases }];
    if (this.consultant()) list.push({ label: t('staff.expenditure.count.milestones', 'Milestones counted'), value: c.milestones, tone: 'good' });
    else
      list.push(
        { label: t('staff.expenditure.count.completed', 'Completed'), value: c.completed, tone: 'good' },
        { label: t('staff.expenditure.count.rejected', 'Rejected after assessment'), value: c.rejected, tone: 'bad' },
        { label: t('staff.expenditure.count.surveillance', 'Surveillance visits'), value: c.surveillance, tone: 'warn' },
      );
    list.push(
      { label: t('staff.expenditure.count.payable', 'Payable (excl. GST)'), value: rupeesShort(c.payable) },
      // 2026-11-21 (UI audit L6): worded as the Payable tile, "(excl. GST)" in the label.
      { label: t('staff.expenditure.count.approvedExclGst', 'Invoices approved (excl. GST)'), value: rupeesShort(c.approved), tone: 'good' },
    );
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
    return r.poState === 'Stopped' ? { ...p, text: t('staff.expenditure.po.stoppedBalanceLabel', '0 · stopped') } : r.poState === 'Low' ? { ...p, text: String(r.balance ?? 0) } : p;
  }

  protected openCases(row: ExpenditureRow): void {
    this.casesOf.set({ row, filter: { ...this.filter(), partyId: row.partyId, level: row.level } });
  }

  /** The Cases pop-up's title: the agency and the level. */
  protected casesTitle(row: ExpenditureRow): string {
    return t('staff.expenditure.cases.dialogTitle', '{party} · {level}', { party: row.partyName, level: row.levelName });
  }

  /** "12 cases" under the PO. */
  protected casesText(n: number): string {
    return n === 1 ? t('staff.expenditure.row.case', '{count} case', { count: n }) : t('staff.expenditure.row.cases', '{count} cases', { count: n });
  }

  protected reviewed(changed: boolean): void {
    this.reviewing.set(null);
    if (changed) void this.load();
  }

  protected async export(): Promise<void> {
    const rows = this.data()?.rows ?? [];
    const kind: PayeeKind = this.consultant() ? 'Consultant' : 'Agency';
    const x = (key: 'id' | 'level' | 'po' | 'poCases' | 'balance' | 'payable' | 'invoiced' | 'outstanding'): string => {
      switch (key) {
        case 'id': return t('staff.expenditure.export.column.id', 'ID');
        case 'level': return t('staff.expenditure.export.column.level', 'Level');
        case 'po': return t('staff.expenditure.export.column.po', 'PO');
        case 'poCases': return t('staff.expenditure.export.column.poCases', 'Cases in PO');
        case 'balance': return t('staff.expenditure.export.column.balance', 'Balance');
        case 'payable': return t('staff.expenditure.export.column.payable', 'Payable (₹)');
        case 'invoiced': return t('staff.expenditure.export.column.invoiced', 'Invoiced (₹)');
        default: return t('staff.expenditure.export.column.outstanding', 'Outstanding (₹)');
      }
    };
    const cols = this.consultant()
      ? [this.word(), x('id'), x('level'), x('po'), x('poCases'), t('staff.expenditure.export.column.milestones', 'Milestones'), x('balance'), x('payable'), x('invoiced'), x('outstanding')]
      : [this.word(), x('id'), x('level'), x('po'), x('poCases'), t('staff.expenditure.export.column.completed', 'Completed'),
        t('staff.expenditure.export.column.rejected', 'Rejected'), t('staff.expenditure.export.column.surveillance', 'Surveillance'), x('balance'), x('payable'),
        x('invoiced'), x('outstanding')];
    const noPo = t('staff.expenditure.po.noPoLabel', 'No PO');
    const body = rows.map((r) => [r.partyName, r.partyId, r.levelName, r.poLabel ?? noPo, r.poCases,
      ...(kind === 'Consultant' ? [r.milestones] : [r.completed, r.rejected, r.surveillance]),
      r.poState === 'NoPo' ? null : r.balance, r.payable, r.invoiced, r.outstanding]);
    const inv = this.invoices().map((i) => [i.partyName, i.monthLabel, i.invoiceNo, i.invoiceDate, i.portalCases, i.portalTotal, i.invoiceAmount, i.status,
      i.status === 'Approved' ? i.erpExport ?? t('staff.expenditure.export.erpPending', 'Pending') : null]);
    const invoiceColumns = [
      this.word(), t('staff.expenditure.export.invoice.month', 'Month'), t('staff.expenditure.export.invoice.invoice', 'Invoice'),
      t('staff.expenditure.export.invoice.date', 'Invoice date'), t('staff.expenditure.export.invoice.cases', 'Cases'),
      t('staff.expenditure.export.invoice.portalAmount', 'Portal amount incl. GST (₹)'), t('staff.expenditure.export.invoice.amount', 'Invoice amount (₹)'),
      t('staff.expenditure.export.invoice.status', 'Status'), t('staff.expenditure.export.invoice.erp', 'ERP'),
    ];
    try {
      await this.excel.xlsx(this.consultant() ? 'expenditure-consultant-organisations' : 'expenditure-assessment-agencies', [
        { name: 'Expenditure', columns: cols, rows: body },
        { name: 'Invoices', columns: invoiceColumns, rows: inv },
      ]);
    } catch (e) {
      this.toast.error(t('staff.expenditure.toast.exportFailed', 'Export failed'), apiErrorMessage(e));
    }
  }
}
