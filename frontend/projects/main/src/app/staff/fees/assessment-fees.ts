import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { AdminPortalService, PortalSwitchComponent } from '../admin-portal';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ENTERPRISE_TYPES, FeeRow, FeesApi, LevelFee, LevelRequest } from './fees.api';

interface LevelInput {
  certification: string;
  fee: number | null;
  coupon: number | null;
  hasCouponRows: boolean;
}

/**
 * Certification Payments (assessment fee master, Admin). Port of Views/Assessment/PaymentDetails.cshtml:
 * per enterprise type, the assessment fee and coupon of each level. The old page computed GST, subsidy,
 * TDS and net payable amounts in the browser and posted every column; now the server computes them
 * (shown here through the preview call) and only the fee and coupon are sent. V4 layout: the enterprise type as a
 * segmented switch, a card per level with its fee and coupon, the breakdown table grouped (fee, after coupon, after
 * subsidy, TDS and net payable) with the amounts right-aligned and the net payable highlighted, and SAVE in a save bar
 * that shows unsaved changes.
 */
@Component({
  selector: 'zed-staff-assessment-fees',
  imports: [FormsModule, DecimalPipe, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ consultancy ? 'Handholding Payments' : 'Certification Payments' }}</h3>
        <p class="page-sub">
          {{ consultancy ? 'The handholding fee of each milestone' : 'The assessment fee and coupon of each level' }} per enterprise type; GST, subsidy,
          TDS and net payable amounts are worked out by the server.
        </p>
      </div>
      <div class="page-actions af-type">
        <span class="af-type-label">Enterprise type</span>
        <div class="seg" role="group" aria-label="Enterprise type">
          @for (t of types; track t) {
            <button type="button" [class.active]="type() === t" [attr.aria-pressed]="type() === t" (click)="changeType(t)">{{ t }}</button>
          }
        </div>
      </div>
    </div>
    <!-- One Admin (V4): the portal whose settings these are (each portal has its own fees). -->
    <zed-portal-switch />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <form (ngSubmit)="save()" novalidate>
      @if (levels().length) {
        <div class="af-levels">
          @for (l of levels(); track l.certification) {
            <div class="af-level">
              <h5 class="af-level-name">{{ l.certification }}</h5>
              <label class="form-label" [for]="'fee-' + l.certification">{{ byMilestone() ? 'Handholding fee (₹)' : 'Assessment fee (₹)' }}</label>
              <input type="number" class="form-control" min="0" step="0.01" [id]="'fee-' + l.certification" [name]="'fee-' + l.certification"
                     [(ngModel)]="l.fee" (change)="recalculate()" />
              @if (type() !== 'Rejected' && !byMilestone() && l.hasCouponRows) {
                <label class="form-label mt-2" [for]="'coupon-' + l.certification">Coupon (₹)</label>
                <input type="number" class="form-control" min="0" step="0.01" [id]="'coupon-' + l.certification" [name]="'coupon-' + l.certification"
                       [(ngModel)]="l.coupon" (change)="recalculate()" />
              }
            </div>
          }
        </div>
      }

      <div class="zed-card af-table-card">
        <h5 class="af-h">Breakdown <span class="zed-chip">{{ type() }}</span></h5>
        <p class="muted">Amounts in ₹. The net payable columns are what the unit pays after deducting TDS.</p>
        <div class="table-responsive">
          <table class="table table-zed table-bordered fees">
            <thead>
              <tr class="af-groups">
                <th rowspan="2" class="af-first">{{ byMilestone() ? 'Milestone' : 'Certification' }}</th>
                <th colspan="3" class="text-center">Fee</th>
                <th colspan="4" class="text-center">After coupon</th>
                <th colspan="4" class="text-center g-sub">After subsidy</th>
                <th colspan="4" class="text-center g-net">TDS and net payable</th>
              </tr>
              <tr>
                <th class="text-end">Amount</th>
                <th class="text-end">GST (18%)</th>
                <th class="text-end">Total</th>
                <th class="text-end">Coupon</th>
                <th class="text-end">Assessment Fee After Coupon</th>
                <th class="text-end">GST&#64;18%</th>
                <th class="text-end">Total</th>
                <th class="text-end">Subsidy (%)</th>
                <th class="text-end">Assessment Fee after Subsidy</th>
                <th class="text-end">GST&#64;18%</th>
                <th class="text-end">Applicant Contribution after subsidy</th>
                <th class="text-end">TDS &#64;2%</th>
                <th class="text-end">TDS &#64;10%</th>
                <th class="text-end">Net Payable after &#64;2%</th>
                <th class="text-end">Net Payable after &#64;10%</th>
              </tr>
            </thead>
            <tbody>
              @for (a of rows(); track a.id) {
                <tr>
                  <td class="af-first">
                    <strong>{{ a.certification }}</strong>
                    @if (a.mileStone) { <span class="d-block af-milestone">{{ a.mileStone }}</span> }
                    @if (a.isCouponRow) { <span class="af-chip is-coupon">with coupon</span> }
                    @if (a.specialCategory) { <span class="af-chip">special category {{ a.specialCategory }}</span> }
                  </td>
                  <td class="text-end">{{ a.assessmentFee | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.gst | number: '1.2-2' }}</td>
                  <td class="text-end hl-total">{{ a.total | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.coupon | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.assessmentFeeAfterCoupon | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.gstAfterCoupon | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.totalAfterCoupon | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.subsidyPercentage }}</td>
                  <td class="text-end">{{ a.subsidyPer | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.gstAfterSubsidy | number: '1.2-2' }}</td>
                  <td class="text-end hl-pay">{{ a.applicantContributionAfterSubsidy | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.tds15 | number: '1.2-2' }}</td>
                  <td class="text-end">{{ a.tds75 | number: '1.2-2' }}</td>
                  <td class="text-end hl-pay">{{ a.netPaybleTds15 | number: '1.2-2' }}</td>
                  <td class="text-end hl-pay">{{ a.netPaybleTds75 | number: '1.2-2' }}</td>
                </tr>
              } @empty {
                <tr><td colspan="16" style="padding: 0"><div class="no-data">No amounts are set for {{ type() }} yet.</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </div>
      <div class="save-bar" [class.is-dirty]="dirty()">
        @if (dirty()) { <span class="unsaved me-auto" role="status">The amounts above are not saved yet. Press SAVE to apply them.</span> } @else { <span class="muted me-auto">No unsaved changes.</span> }
        <button type="submit" class="btn btn-primary" [disabled]="saving() || !levels().length">SAVE</button>
      </div>
    </form>

    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite">
        <div class="text-center text-white"><div class="spinner-border text-light"></div><div><small>Please wait ...</small></div></div>
      </div>
    }
  `,
  styles: `
    .page-head { align-items: flex-end; }
    .af-type { flex-direction: column; align-items: flex-start; gap: 4px; }
    .af-type-label { font-size: 12px; font-weight: 600; color: #5f6f70; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }

    /* A card per level (or milestone) with its amounts. */
    .af-levels { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .af-level { background: #fff; border: 1px solid #dfe9ea; border-top: 4px solid #45a5ad; border-radius: 12px; padding: 12px 16px; min-width: 0; }
    .af-level-name { font-size: 15px; font-weight: 700; color: #23474a; margin: 0 0 8px; overflow-wrap: anywhere; }
    .af-level .form-label { display: block; margin-bottom: 4px; font-size: 13px; }

    .af-table-card { margin-bottom: 0; }
    .af-h { font-weight: 700; color: #23474a; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .af-h .zed-chip { margin: 0; }
    table.fees th, table.fees td { vertical-align: middle; }
    table.fees tbody td { font-size: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
    table.fees thead th { font-size: 12px; min-width: 84px; }
    table.fees .af-groups th { font-size: 13px; letter-spacing: .02em; }
    table.fees .af-groups th.g-sub { background-color: #2f7c83; }
    table.fees .af-groups th.g-net { background-color: #1e7a3c; }
    table.fees .af-first { position: sticky; left: 0; z-index: 1; min-width: 150px; white-space: normal; text-align: left; }
    table.fees tbody td.af-first { background-color: #fff; }
    .af-milestone { font-weight: 600; color: #23474a; }
    .af-chip { display: inline-block; margin: 4px 4px 0 0; border-radius: 10px; padding: 1px 8px; font-size: 11px; font-weight: 600; background: #f1f0fb; color: #3f3a7a; }
    .af-chip.is-coupon { background: #fff4d6; color: #8a6100; }
    td.hl-total { background-color: #f6f9f9; font-weight: 600; }
    td.hl-pay { background-color: #eaf6ee; color: #1e7a3c; font-weight: 700; }

    .save-bar { display: flex; align-items: center; gap: 8px; margin-top: 12px; padding: 10px 14px; font-size: 14px; background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; }
    .save-bar.is-dirty { position: sticky; bottom: 0; z-index: 5; border-color: #e9c46a; background: #fffcf2; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .unsaved { font-weight: 600; color: #8a6100; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class AssessmentFeesPage {
  private readonly api = inject(FeesApi);

  /** Consultancy: handholding fees per milestone, Micro / Small / Medium only (old PaymentDetails page). */
  protected readonly consultancy = inject(AdminPortalService).effective() === 'consultancy';
  protected readonly types: readonly string[] = this.consultancy ? ENTERPRISE_TYPES.filter((t) => t !== 'Rejected') : ENTERPRISE_TYPES;
  protected readonly byMilestone = signal(false);
  protected readonly type = signal<string>('Micro');
  protected readonly levels = signal<LevelInput[]>([]);
  protected readonly rows = signal<FeeRow[]>([]);
  protected readonly dirty = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected changeType(type: string): void {
    this.type.set(type);
    this.success.set('');
    void this.load();
  }

  private request(): LevelRequest[] {
    return this.levels().map((l) => ({
      certification: l.certification,
      assessmentFee: l.fee,
      // Consultancy: the fee per milestone only; the stored coupons stay as they are.
      coupon: this.type() !== 'Rejected' && l.hasCouponRows && !this.byMilestone() ? l.coupon : null,
    }));
  }

  private static inputs(levels: LevelFee[]): LevelInput[] {
    return levels.map((l) => ({ certification: l.certification, fee: l.assessmentFee, coupon: l.coupon, hasCouponRows: l.hasCouponRows }));
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.fees(this.type()));
      this.levels.set(AssessmentFeesPage.inputs(res.levels));
      this.rows.set(res.rows);
      this.byMilestone.set(res.groupBy === 'MileStone');
      this.dirty.set(false);
    } catch (err) {
      this.levels.set([]);
      this.rows.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Shows the amounts the server would save for the entered fees (nothing is saved). */
  protected async recalculate(): Promise<void> {
    this.error.set('');
    this.success.set('');
    try {
      const res = await firstValueFrom(this.api.preview(this.type(), this.request()));
      this.rows.set(res.rows);
      this.dirty.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected async save(): Promise<void> {
    this.error.set('');
    this.success.set('');
    if (this.levels().some((l) => l.fee === null || l.fee === undefined || (l.hasCouponRows && this.type() !== 'Rejected' && !this.byMilestone() && (l.coupon === null || l.coupon === undefined)))) {
      this.error.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.save(this.type(), this.request()))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
