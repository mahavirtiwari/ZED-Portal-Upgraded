import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { ExpenditureApi, MyInvoices, MyMonth, rupees, shownDate, statusTone } from './expenditure.api';

/** The upload pop-up's fields. */
interface Upload { month: MyMonth; invoiceNo: string; invoiceDate: string; invoiceAmount: number | null; file: File | null }

export const MAX_PDF_BYTES = 5 * 1024 * 1024;

/**
 * 2026-11-18 (approved design, section 4): the agency's (consultant organisation's) monthly invoices. Each ended month shows the
 * portal's cases and amount (completed, rejected after assessment, surveillance; milestones for an organisation) at their
 * frozen rates plus GST; "Upload invoice" sends the invoice number, date, amount and PDF (5 MB); the master admin approves it
 * or returns it with remarks, and a returned invoice is uploaded again.
 */
@Component({
  selector: 'zed-staff-my-invoices',
  imports: [FormsModule, PageHead],
  styleUrl: './exp-dialog.scss',
  styles: `
    .mi-card { padding: 0; overflow: hidden; }
    .mi-table { min-width: 900px; margin: 0; }
    td small { display: block; color: #6f8487; font-size: 11.5px; }
    .mi-note { margin: 0; padding: 10px 16px; font-size: 12.5px; color: #6f8487; border-top: 1px solid #dde7e8; }
  `,
  template: `
    <zed-page-head [crumbs]="crumbs" title="Invoices" [subtitle]="data()?.partyName ?? ''">
      <button type="button" class="btn btn-default" [disabled]="!data()" (click)="export()">Export</button>
    </zed-page-head>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="zed-card mi-card">
      <div class="table-responsive">
        <table class="table table-zed mi-table">
          <thead><tr><th>Month</th><th class="num">Cases (portal)</th><th class="num">Portal amount (incl. GST)</th><th>Invoice</th><th class="num">Invoice amount</th><th>Status</th><th></th></tr></thead>
          <tbody>
            @for (m of data()?.months ?? []; track m.month) {
              <tr>
                <td>{{ m.label }}</td>
                <td class="num">{{ m.cases }}<small>{{ breakdown(m) }}</small></td>
                <td class="num">{{ money(m.total) }}<small>{{ money(m.amount) }} + {{ m.gstPercent }}% GST</small></td>
                <td>@if (m.invoice) { {{ m.invoice.invoiceNo }}<small>{{ date(m.invoice.invoiceDate) }} · PDF</small> } @else { — }</td>
                <td class="num">{{ m.invoice ? money(m.invoice.invoiceAmount) : '—' }}</td>
                <td>@if (m.invoice) {
                    <span class="status-badge" [class]="tone(m.invoice.status)">{{ m.invoice.status }}</span>
                    @if (m.invoice.status === 'Returned' && m.invoice.remarks) { <small>{{ m.invoice.remarks }}</small> }
                  } @else { <span class="status-badge is-inactive">Not uploaded</span> }</td>
                <td class="num">
                  @if (m.invoice) { <button type="button" class="btn btn-default btn-sm" (click)="pdf(m.invoice.id)">View PDF</button> }
                  @if (m.canUpload) {
                    <button type="button" class="btn btn-primary btn-sm ms-1" (click)="start(m)">{{ m.invoice ? 'Upload again' : '+ Upload invoice' }}</button>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="7"><div class="no-data">{{ loading() ? 'Loading…' : 'No month to invoice yet.' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <p class="mi-note">The portal works out each month's cases and amount at the rates in force on the day each case counted. Enter your
        invoice number, date and amount and upload the PDF; if your amount differs from the portal's, the difference is shown to the master admin.</p>
    </div>

    @if (upload(); as u) {
      <div class="xd-back" (click)="upload.set(null)"></div>
      <form class="xd" role="dialog" aria-modal="true" aria-labelledby="up-title" (ngSubmit)="send()">
        <div class="xd-head"><span class="xd-ico" aria-hidden="true">₹</span>
          <div><h3 id="up-title">Upload invoice · {{ u.month.label }}</h3><small>Portal: {{ u.month.cases }} cases, {{ money(u.month.total) }} incl. GST</small></div>
          <button type="button" class="xd-x" aria-label="Close" (click)="upload.set(null)">×</button></div>
        <div class="xd-body">
          @if (formError()) { <div class="alert alert-danger xd-err" role="alert">{{ formError() }}</div> }
          <label class="xd-field"><span>Invoice number</span><input class="form-control" name="invoiceNo" maxlength="60" [(ngModel)]="u.invoiceNo" /></label>
          <label class="xd-field"><span>Invoice date</span><input type="date" class="form-control" name="invoiceDate" [(ngModel)]="u.invoiceDate" /></label>
          <label class="xd-field"><span>Invoice amount (₹, GST included)</span><input type="number" min="0" step="0.01" class="form-control" name="amount" [(ngModel)]="u.invoiceAmount" /></label>
          <label class="xd-field"><span>Invoice PDF (up to 5 MB)</span><input type="file" class="form-control" accept="application/pdf,.pdf" (change)="pick($event)" /></label>
        </div>
        <div class="xd-foot">
          <button type="button" class="btn btn-default" (click)="upload.set(null)">Cancel</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Submit</button>
        </div>
      </form>
    }
  `,
})
export class MyInvoicesPage {
  private readonly api = inject(ExpenditureApi);
  private readonly excel = inject(TableExport);
  private readonly toast = inject(ToastService);

  protected readonly crumbs = staffCrumbs({ label: 'Invoices' });
  protected readonly data = signal<MyInvoices | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly upload = signal<Upload | null>(null);
  protected readonly formError = signal('');
  protected readonly busy = signal(false);
  protected readonly consultant = computed(() => this.data()?.kind === 'Consultant');
  protected readonly money = rupees;
  protected readonly date = shownDate;
  protected readonly tone = statusTone;

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.data.set(await firstValueFrom(this.api.my()));
      this.error.set('');
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    } finally {
      this.loading.set(false);
    }
  }

  protected breakdown(m: MyMonth): string {
    if (this.consultant()) return `${m.milestones} milestone${m.milestones === 1 ? '' : 's'}`;
    return `${m.completed} completed · ${m.rejected} rejected · ${m.surveillance} surveillance`;
  }

  protected start(m: MyMonth): void {
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
    if (!u.file) return this.formError.set('Please choose the invoice PDF.');
    if (u.file.size > MAX_PDF_BYTES) return this.formError.set('The PDF is larger than 5 MB.');
    if (!/\.pdf$/i.test(u.file.name)) return this.formError.set('Please upload the invoice as a PDF.');
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
      const blob = await firstValueFrom(this.api.invoicePdf(id));
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener');
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (e) {
      this.toast.error('The PDF could not be opened', apiErrorMessage(e));
    }
  }

  protected async export(): Promise<void> {
    const months = this.data()?.months ?? [];
    try {
      await this.excel.xlsx('invoices', [{
        name: 'Invoices',
        columns: ['Month', 'Cases (portal)', this.consultant() ? 'Milestones' : 'Completed', 'Rejected', 'Surveillance', 'Portal amount excl. GST (₹)', 'GST %',
          'Portal amount incl. GST (₹)', 'Invoice', 'Invoice date', 'Invoice amount (₹)', 'Status', 'Remarks'],
        rows: months.map((m) => [m.label, m.cases, this.consultant() ? m.milestones : m.completed, m.rejected, m.surveillance, m.amount, m.gstPercent, m.total,
          m.invoice?.invoiceNo, m.invoice?.invoiceDate, m.invoice?.invoiceAmount, m.invoice?.status ?? 'Not uploaded', m.invoice?.remarks]),
      }]);
    } catch (e) {
      this.toast.error('Export failed', apiErrorMessage(e));
    }
  }
}
