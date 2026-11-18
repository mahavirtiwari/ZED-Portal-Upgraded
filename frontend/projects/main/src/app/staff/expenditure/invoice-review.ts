import { Component, OnInit, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { AdminPortal } from '../admin-portal';
import { ToastService } from '../toast';
import { ExpenditureApi, InvoiceDetail, openBlob, rateLineText, rupees, shownDate, statusTone } from './expenditure.api';
import { TaxDetailsCard } from './tax-details';

/**
 * The invoice review pop-up (approved design, section 4): the month, the portal's cases and amount (per rate when a date of
 * effect falls in the month), the invoice's amount and the difference; Open PDF, Return (remarks required) or Approve. A
 * reviewed invoice opens read-only. 2026-11-18: with the agency's one-time GSTIN and PAN (and their documents); the agency
 * opens its own invoices here too, read-only.
 */
@Component({
  selector: 'zed-invoice-review',
  imports: [FormsModule, TaxDetailsCard],
  styleUrl: './exp-dialog.scss',
  styles: `
    .xr-lines { margin: 0 0 12px; padding-left: 18px; font-size: 13px; color: #3d5559; }
    .xr-diff { color: #9a5f06; font-weight: 700; }
  `,
  template: `
    <div class="xd-back" (click)="closed.emit(false)"></div>
    <div class="xd" role="dialog" aria-modal="true" aria-labelledby="xr-title">
      <div class="xd-head">
        <span class="xd-ico" aria-hidden="true">✓</span>
        <div><h3 id="xr-title">{{ d()?.invoice?.canReview ? 'Review' : 'Invoice' }} {{ d()?.invoice?.invoiceNo ?? '' }}</h3><small>{{ d()?.invoice?.partyName }}</small></div>
        <button type="button" class="xd-x" aria-label="Close" (click)="closed.emit(false)">×</button>
      </div>
      <div class="xd-body">
        @if (error()) { <div class="alert alert-danger xd-err" role="alert">{{ error() }}</div> }
        @if (d(); as x) {
          @let inv = x.invoice;
          @let f = inv.status === 'Submitted' ? x.live : null;
          <div class="xd-grid">
            <div><small>Month</small><b>{{ inv.monthLabel }}</b></div>
            <div><small>Status</small><span class="status-badge" [class]="tone(inv.status)">{{ inv.status }}</span>
              @if (inv.status === 'Approved') { <small>ERP: {{ (inv.erpExport || 'pending').toLowerCase() }}</small> }</div>
            <div><small>Cases (portal)</small>
              @if (f) { <b>{{ f.completed + f.rejected + f.surveillance + f.milestones }}</b> · {{ breakdown(f.completed, f.rejected, f.surveillance, f.milestones) }} }
              @else { <b>{{ inv.portalCases }}</b> · {{ breakdown(inv.portalCompleted, inv.portalRejected, inv.portalSurveillance, inv.portalMilestones) }} }</div>
            <div><small>Portal amount</small>
              <b>{{ money(f ? f.amount : inv.portalAmount) }} + {{ f ? f.gst : inv.gstPercent }}% GST = {{ money(f ? f.total : inv.portalTotal) }}</b></div>
            <div><small>Invoice amount</small><b>{{ money(inv.invoiceAmount) }}</b>
              @if ((f ? x.liveDifference : inv.difference) === 0) { <span class="status-badge is-active">matches</span> }
              @else { <span class="xr-diff">differs by {{ money(f ? x.liveDifference : inv.difference) }}</span> }</div>
            <div><small>Invoice date</small>{{ date(inv.invoiceDate) }}</div>
          </div>
          <zed-tax-details [tax]="x.tax" [partyId]="inv.partyId" [portal]="portal()" [compact]="true" />
          @if (x.lines.length) {
            <ul class="xr-lines" aria-label="Cases per rate">
              @for (l of x.lines; track $index) { <li>{{ line(l) }}</li> }
            </ul>
          }
          @if (inv.remarks) { <p class="xd-note">Remarks{{ inv.reviewedBy ? ' (' + inv.reviewedBy + ')' : '' }}: {{ inv.remarks }}</p> }
          @if (inv.canReview) {
            <label class="xd-field"><span>Remarks (required to return)</span>
              <textarea class="form-control" rows="3" maxlength="2000" name="remarks" placeholder="Optional when approving" [(ngModel)]="remarks"></textarea></label>
          }
        } @else if (!error()) {
          <p role="status">Loading…</p>
        }
      </div>
      <div class="xd-foot">
        <button type="button" class="btn btn-default" [disabled]="!d()" (click)="pdf()">Open PDF</button>
        @if (d()?.invoice?.canReview) {
          <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="decide('return')">Return</button>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="decide('approve')">Approve</button>
        } @else {
          <button type="button" class="btn btn-default" (click)="closed.emit(false)">Close</button>
        }
      </div>
    </div>
  `,
})
export class InvoiceReviewDialog implements OnInit {
  private readonly api = inject(ExpenditureApi);
  private readonly toast = inject(ToastService);

  readonly invoiceId = input.required<number>();
  readonly portal = input<AdminPortal | null>(null);
  /** True when the invoice was approved or returned (the page reloads). */
  readonly closed = output<boolean>();

  protected readonly d = signal<InvoiceDetail | null>(null);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected remarks = '';
  protected readonly money = rupees;
  protected readonly date = shownDate;
  protected readonly tone = statusTone;
  protected readonly line = rateLineText;

  ngOnInit(): void {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.d.set(await firstValueFrom(this.api.invoice(this.invoiceId(), this.portal())));
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    }
  }

  protected breakdown(completed: number, rejected: number, surveillance: number, milestones: number): string {
    if (milestones) return `${milestones} milestone${milestones === 1 ? '' : 's'}`;
    return `${completed} completed · ${rejected} rejected · ${surveillance} surveillance`;
  }

  protected async pdf(): Promise<void> {
    try {
      openBlob(await firstValueFrom(this.api.invoicePdf(this.invoiceId(), this.portal())));
    } catch (e) {
      this.toast.error('The PDF could not be opened', apiErrorMessage(e));
    }
  }

  protected async decide(what: 'approve' | 'return'): Promise<void> {
    const remarks = this.remarks.trim();
    if (what === 'return' && !remarks) {
      this.error.set('Please enter the remarks: they tell the agency what to correct.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.invoiceId();
      const r = await firstValueFrom(what === 'approve' ? this.api.approve(id, remarks, this.portal()) : this.api.returnInvoice(id, remarks, this.portal()));
      this.toast.success(r.message);
      this.closed.emit(true);
    } catch (e) {
      this.error.set(apiErrorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
