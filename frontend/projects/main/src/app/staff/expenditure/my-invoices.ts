import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { ChipFilter, FilterChip } from '../chip-filter';
import { ListCount, ListCounts } from '../list-counts';
import { RowMenu, RowMenuItem } from '../row-menu';
import { staffCrumbs } from '../staff-crumbs';
import { ExportSheet, TableExport } from '../table-export';
import { ToastService } from '../toast';
import { ExpenditureCasesDialog } from './cases-dialog';
import {
  ExpenditureApi, ExpenditureCase, ExpenditureFilter, ExpenditureRow, ExpenditureSummary, MyInvoices, MyMonth, PoLevel, PoView, caseText, openBlob, poPill,
  rupees, rupeesShort, shownDate, statusTone,
} from './expenditure.api';
import { InvoiceReviewDialog } from './invoice-review';
import { TaxDetailsCard } from './tax-details';
import { TextPipe, t } from '../../content/page-text';

/** The upload pop-up's fields. */
interface Upload { month: MyMonth; invoiceNo: string; invoiceDate: string; invoiceAmount: number | null; file: File | null }

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * 2026-11-18 (the user: the agency "is not able to view the performance of his agency. Please make a screen similar to master
 * admin expenditure section where he can see all his purchase order added. He can upload invoices month-wise and also export
 * the Excel sheet month-wise."): the agency's (consultant organisation's) Expenditure page, its own data only (the API
 * scopes every call to the signed-in agency):
 * <ul>
 * <li>its one-time GSTIN and PAN with their documents (<code>zed-tax-details</code>): required before any invoice upload,
 * locked once submitted;</li>
 * <li>filters (level, month or a date range), headline cards, its purchase orders per level (read-only: PO, date, cases,
 * used and in progress, balance, use bar, Open / N left / Stopped), a row per level with the Cases pop-up;</li>
 * <li>the months (the current one and the 12 before): cases, amount excl. GST, GST, total, the invoice's status, Upload
 * Invoice / Upload Again after Returned, View, and Export Excel of the month's cases; Export All for the filtered period.</li>
 * </ul>
 */
@Component({
  selector: 'zed-staff-my-invoices',
  imports: [FormsModule, PageHead, ChipFilter, ListCounts, RowMenu, ExpenditureCasesDialog, InvoiceReviewDialog, TaxDetailsCard, TextPipe],
  templateUrl: './my-invoices.html',
  styleUrl: './exp-dialog.scss',
  styles: `
    .mi-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px 14px; padding: 12px 16px; margin-bottom: 16px; }
    .mi-bar label { display: flex; flex-direction: column; gap: 3px; font-size: 12px; font-weight: 600; color: #6f8487; }
    .mi-bar .form-select, .mi-bar .form-control { height: 38px; min-width: 150px; }
    .mi-bar .zed-chip-filter { flex-basis: 100%; }
    .mi-clear { margin-left: auto; border: 0; background: none; font-weight: 700; font-size: 12.5px; color: #6f8487; }
    .mi-card { padding: 0; overflow: hidden; margin-bottom: 16px; }
    .mi-card h2 { margin: 0; padding: 14px 16px; font-size: 16px; font-weight: 700; color: #17373b; }
    .mi-table { min-width: 960px; margin: 0; }
    td small { display: block; color: #6f8487; font-size: 11.5px; }
    .owe { color: #9a5f06; font-weight: 700; }
    .bar { display: inline-block; width: 90px; height: 8px; border-radius: 4px; background: #ecf0f0; overflow: hidden; vertical-align: middle; margin-right: 6px; }
    .bar i { display: block; height: 100%; background: #3ba3ad; }
    .bar i.low { background: #d98a12; }
    .bar i.stop { background: #c8473c; }
    .mi-acts { display: inline-flex; gap: 6px; align-items: center; justify-content: flex-end; }
    .mi-note { margin: 0; padding: 10px 16px; font-size: 12.5px; color: #6f8487; border-top: 1px solid #dde7e8; }
    .mi-gate { margin: 0; padding: 10px 16px; font-size: 13px; color: #9a5f06; background: #fdf6e9; border-bottom: 1px solid #f1e2c4; }
  `,
})
export class MyInvoicesPage {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.myInvoices.crumb', 'Expenditure') }));
  protected readonly money = rupees;
  protected readonly date = shownDate;
  protected readonly tone = statusTone;

  protected readonly data = signal<MyInvoices | null>(null);
  protected readonly summary = signal<ExpenditureSummary | null>(null);
  protected readonly po = signal<PoView | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  protected readonly level = signal('');
  protected readonly month = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');

  protected readonly upload = signal<Upload | null>(null);
  protected readonly formError = signal('');
  protected readonly busy = signal(false);
  protected readonly casesOf = signal<{ row: ExpenditureRow; filter: ExpenditureFilter } | null>(null);
  protected readonly viewing = signal<number | null>(null);

  protected readonly consultant = computed(() => this.data()?.kind === 'Consultant');
  protected readonly partyId = computed(() => this.data()?.partyId ?? '');
  /** Invoices can be uploaded once the GSTIN and PAN were submitted. */
  protected readonly taxReady = computed(() => !!this.data()?.tax?.submitted);
  protected readonly filtering = computed(() => !!(this.level() || this.from() || this.to()));

  protected readonly levelChips = computed<FilterChip[]>(() => [
    { key: '', label: t('staff.myInvoices.filter.allLevels', 'All levels') },
    ...(this.summary()?.levels ?? []).map((l) => ({ key: l.code, label: l.name })),
  ]);

  protected readonly counts = computed<ListCount[]>(() => {
    const c = this.summary()?.cards;
    if (!c) return [];
    const list: ListCount[] = [{ label: t('staff.myInvoices.count.poCases', 'Cases in POs'), value: c.poCases }];
    if (this.consultant()) list.push({ label: t('staff.myInvoices.count.milestones', 'Milestones counted'), value: c.milestones, tone: 'good' });
    else
      list.push(
        { label: t('staff.myInvoices.count.completed', 'Completed'), value: c.completed, tone: 'good' },
        { label: t('staff.myInvoices.count.rejected', 'Rejected after assessment'), value: c.rejected, tone: 'bad' },
        { label: t('staff.myInvoices.count.surveillance', 'Surveillance visits'), value: c.surveillance, tone: 'warn' },
      );
    const exGst = t('staff.myInvoices.count.exGstNote', 'excl. GST');
    list.push(
      { label: t('staff.myInvoices.count.payable', 'Payable'), value: rupeesShort(c.payable), sub: exGst },
      { label: t('staff.myInvoices.count.invoiced', 'Invoiced'), value: rupeesShort(c.invoiced ?? 0), tone: 'info', sub: exGst },
      { label: t('staff.myInvoices.count.approved', 'Approved'), value: rupeesShort(c.approved), tone: 'good', sub: exGst },
      {
        label: t('staff.myInvoices.count.outstanding', 'Outstanding'), value: rupeesShort(c.outstanding ?? 0), tone: (c.outstanding ?? 0) > 0 ? 'warn' : undefined,
        sub: t('staff.myInvoices.count.outstandingNote', 'not invoiced'),
      },
    );
    return list;
  });

  /** Its POs per level (the level filter applies). */
  protected readonly poLevels = computed<PoLevel[]>(() => (this.po()?.levels ?? []).filter((l) => !this.level() || l.level === this.level()));
  protected readonly rows = computed<ExpenditureRow[]>(() => this.summary()?.rows ?? []);
  protected readonly months = computed<MyMonth[]>(() => this.data()?.months ?? []);

  constructor() {
    void this.load();
  }

  private filter(): ExpenditureFilter {
    return { partyId: this.partyId(), level: this.level(), from: this.from(), to: this.to() };
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const my = await firstValueFrom(this.api.my());
      this.data.set(my);
      const [summary, po] = await Promise.all([firstValueFrom(this.api.summary(this.filter())), firstValueFrom(this.api.po(my.partyId))]);
      this.summary.set(summary);
      this.po.set(po);
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  /** The figures again for the filters (the POs and months do not change with them). */
  protected async refilter(): Promise<void> {
    this.loading.set(true);
    try {
      this.summary.set(await firstValueFrom(this.api.summary(this.filter())));
      this.error.set('');
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected setLevel(code: string): void {
    this.level.set(code);
    void this.refilter();
  }

  /** A month of the list as the date range ("" = any). */
  protected setMonth(month: string): void {
    this.month.set(month);
    const [from, to] = month ? monthRange(month) : ['', ''];
    this.from.set(from);
    this.to.set(to);
    void this.refilter();
  }

  protected setDate(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value);
    this.month.set('');
    void this.refilter();
  }

  protected clearAll(): void {
    this.level.set('');
    this.month.set('');
    this.from.set('');
    this.to.set('');
    void this.refilter();
  }

  protected pill(l: PoLevel) {
    return poPill(l.state, l.left);
  }

  protected rowPill(r: ExpenditureRow) {
    return poPill(r.poState, r.balance);
  }

  protected openCases(row: ExpenditureRow): void {
    this.casesOf.set({ row, filter: { ...this.filter(), level: row.level } });
  }

  protected breakdown(m: MyMonth): string {
    if (this.consultant()) {
      return m.milestones === 1
        ? t('staff.myInvoices.month.milestone', '{count} milestone', { count: m.milestones })
        : t('staff.myInvoices.month.milestones', '{count} milestones', { count: m.milestones });
    }
    return t('staff.myInvoices.month.breakdownText', '{completed} completed · {rejected} rejected · {surveillance} surveillance',
      { completed: m.completed, rejected: m.rejected, surveillance: m.surveillance });
  }

  /** "12 cases" under the PO. */
  protected casesText(n: number): string {
    return n === 1 ? t('staff.myInvoices.row.case', '{count} case', { count: n }) : t('staff.myInvoices.row.cases', '{count} cases', { count: n });
  }

  /** The row menu of a month with an invoice. */
  protected readonly menu = computed<RowMenuItem[]>(() => [
    { key: 'view', label: t('staff.myInvoices.menu.view', 'View Invoice'), icon: 'eye' },
    { key: 'pdf', label: t('staff.myInvoices.menu.pdf', 'Open Invoice PDF'), icon: 'file' },
  ]);

  protected picked(m: MyMonth, key: string): void {
    if (!m.invoice) return;
    if (key === 'view') this.viewing.set(m.invoice.id);
    else if (key === 'pdf') void this.pdf(m.invoice.id);
  }

  // ------------------------------------------------------------------ upload

  protected start(m: MyMonth): void {
    if (!this.taxReady()) return;
    this.formError.set('');
    this.upload.set({ month: m, invoiceNo: '', invoiceDate: '', invoiceAmount: null, file: null });
  }

  protected pick(ev: Event): void {
    const file = (ev.target as HTMLInputElement).files?.[0] ?? null;
    const u = this.upload();
    if (u) u.file = file;
  }

  protected async send(): Promise<void> {
    const u = this.upload();
    if (!u) return;
    if (!u.file) return this.formError.set(t('staff.myInvoices.upload.fileError', 'Please choose the invoice PDF.'));
    if (u.file.size > MAX_PDF_BYTES) return this.formError.set(t('staff.myInvoices.upload.sizeError', 'The PDF is larger than 5 MB.'));
    if (!/\.pdf$/i.test(u.file.name)) return this.formError.set(t('staff.myInvoices.upload.typeError', 'Please upload the invoice as a PDF.'));
    const form = new FormData();
    form.append('month', u.month.month);
    form.append('invoiceNo', u.invoiceNo.trim());
    form.append('invoiceDate', u.invoiceDate);
    form.append('invoiceAmount', u.invoiceAmount === null ? '' : String(u.invoiceAmount));
    form.append('file', u.file, u.file.name);
    this.busy.set(true);
    this.formError.set('');
    try {
      const r = await firstValueFrom(this.api.upload(form));
      this.toast.success(r.message);
      this.upload.set(null);
      await this.load();
    } catch (e) {
      this.formError.set(apiErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }

  protected async pdf(id: number): Promise<void> {
    try {
      openBlob(await firstValueFrom(this.api.invoicePdf(id)));
    } catch (e) {
      this.toast.error(t('staff.myInvoices.toast.pdfFailed', 'The PDF could not be opened'), apiErrorMessage(e));
    }
  }

  // ------------------------------------------------------------------ Excel

  private casesSheet(cases: ExpenditureCase[]): ExportSheet {
    return {
      name: 'Cases',
      columns: [
        t('staff.myInvoices.export.cases.zedId', 'ZED ID'), t('staff.myInvoices.export.cases.unit', 'Unit'), t('staff.myInvoices.export.cases.state', 'State'),
        t('staff.myInvoices.export.cases.level', 'Level'), t('staff.myInvoices.export.cases.case', 'Case'), t('staff.myInvoices.export.cases.countedOn', 'Counted on'),
        t('staff.myInvoices.export.cases.rate', 'Rate (₹, excl. GST)'), t('staff.myInvoices.export.cases.amount', 'Amount (₹, excl. GST)'),
      ],
      rows: cases.map((c) => [c.zedId, c.unitName, c.state, c.level, caseText(c), c.countedOn, c.rate, c.rate ?? 0]),
    };
  }

  private monthsSheet(months: MyMonth[]): ExportSheet {
    return {
      name: 'Months',
      columns: [
        t('staff.myInvoices.export.months.month', 'Month'),
        this.consultant() ? t('staff.myInvoices.export.milestones', 'Milestones') : t('staff.myInvoices.export.completed', 'Completed'),
        t('staff.myInvoices.export.rejected', 'Rejected'), t('staff.myInvoices.export.surveillance', 'Surveillance'),
        t('staff.myInvoices.export.months.cases', 'Cases'), t('staff.myInvoices.export.months.amount', 'Amount excl. GST (₹)'),
        t('staff.myInvoices.export.months.gstPercent', 'GST %'), t('staff.myInvoices.export.months.gst', 'GST (₹)'),
        t('staff.myInvoices.export.months.total', 'Total incl. GST (₹)'), t('staff.myInvoices.export.months.invoice', 'Invoice'),
        t('staff.myInvoices.export.months.invoiceDate', 'Invoice date'), t('staff.myInvoices.export.months.invoiceAmount', 'Invoice amount (₹)'),
        t('staff.myInvoices.export.months.status', 'Status'), t('staff.myInvoices.export.months.remarks', 'Remarks'),
      ],
      rows: months.map((m) => [m.label, this.consultant() ? m.milestones : m.completed, m.rejected, m.surveillance, m.cases, m.amount, m.gstPercent,
        m.gstAmount, m.total, m.invoice?.invoiceNo, m.invoice?.invoiceDate, m.invoice?.invoiceAmount, this.status(m), m.invoice?.remarks]),
    };
  }

  /** "Not uploaded", "Month in progress", or the invoice's status. */
  protected status(m: MyMonth): string {
    return m.invoice?.status ?? (m.ended ? t('staff.myInvoices.month.notUploaded', 'Not uploaded') : t('staff.myInvoices.month.inProgress', 'Month in progress'));
  }

  /** The month's cases (every level) with their dates, rates and amounts, and the month's figures. */
  protected async exportMonth(m: MyMonth): Promise<void> {
    const [from, to] = monthRange(m.month);
    try {
      const cases = await firstValueFrom(this.api.cases({ partyId: this.partyId(), from, to }));
      await this.excel.xlsx(`expenditure-${this.partyId()}-${m.month}`, [this.casesSheet(cases), this.monthsSheet([m])]);
    } catch (e) {
      this.toast.error(t('staff.myInvoices.toast.exportFailed', 'Export failed'), apiErrorMessage(e));
    }
  }

  /** The filtered period: every case, the levels' figures, the POs and the months. */
  protected async exportAll(): Promise<void> {
    const consultant = this.consultant();
    const level = t('staff.myInvoices.export.level', 'Level');
    const casesInPo = t('staff.myInvoices.export.casesInPo', 'Cases in PO');
    const balance = t('staff.myInvoices.export.balance', 'Balance');
    const noPo = t('staff.expenditure.po.noPoLabel', 'No PO');
    try {
      const cases = await firstValueFrom(this.api.cases(this.filter()));
      await this.excel.xlsx(`expenditure-${this.partyId()}`, [
        this.casesSheet(cases),
        {
          name: 'Levels',
          columns: [
            level, t('staff.myInvoices.export.levels.po', 'PO'), casesInPo,
            ...(consultant ? [t('staff.myInvoices.export.milestones', 'Milestones')]
              : [t('staff.myInvoices.export.completed', 'Completed'), t('staff.myInvoices.export.rejected', 'Rejected'), t('staff.myInvoices.export.surveillance', 'Surveillance')]),
            balance, t('staff.myInvoices.export.levels.payable', 'Payable (₹)'), t('staff.myInvoices.export.levels.invoiced', 'Invoiced (₹)'),
            t('staff.myInvoices.export.levels.outstanding', 'Outstanding (₹)'),
          ],
          rows: this.rows().map((r) => [r.levelName, r.poLabel ?? noPo, r.poCases, ...(consultant ? [r.milestones] : [r.completed, r.rejected, r.surveillance]),
            r.poState === 'NoPo' ? null : r.balance, r.payable, r.invoiced, r.outstanding]),
        },
        {
          name: 'Purchase orders',
          columns: [
            level, t('staff.myInvoices.export.po.number', 'PO number'), t('staff.myInvoices.export.po.date', 'PO date'), casesInPo,
            t('staff.myInvoices.export.po.used', 'Used'), t('staff.myInvoices.export.po.inProgress', 'In progress'), balance,
            t('staff.myInvoices.export.po.usePercent', 'Use %'), t('staff.myInvoices.export.po.allotment', 'Allotment'),
          ],
          rows: this.poLevels().flatMap((l) => l.pos.map((p) => [l.name, p.poNumber, p.poDate, p.cases, l.used, l.inProgress, l.left, l.percent, this.pill(l).text])),
        },
        this.monthsSheet(this.months()),
      ]);
    } catch (e) {
      this.toast.error(t('staff.myInvoices.toast.exportFailed', 'Export failed'), apiErrorMessage(e));
    }
  }

  /** The page head's sub-line: the agency's name and ID. */
  protected headSub(): string {
    const d = this.data();
    return d ? t('staff.myInvoices.sub', '{name} · {id}', { name: d.partyName, id: d.partyId }) : '';
  }

  /** The upload pop-up's line under the title. */
  protected portalLine(m: MyMonth): string {
    const total = rupees(m.total);
    return m.cases === 1
      ? t('staff.myInvoices.upload.portalCase', 'Portal: {count} case, {total} incl. GST', { count: m.cases, total })
      : t('staff.myInvoices.upload.portalCases', 'Portal: {count} cases, {total} incl. GST', { count: m.cases, total });
  }
}

/** "2026-10" → ["2026-10-01", "2026-10-31"]. */
export function monthRange(month: string): [string, string] {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return [`${month}-01`, `${month}-${String(last).padStart(2, '0')}`];
}
