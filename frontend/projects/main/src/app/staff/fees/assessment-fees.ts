import { DecimalPipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
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
 * (shown here through the preview call) and only the fee and coupon are sent.
 */
@Component({
  selector: 'zed-staff-assessment-fees',
  imports: [FormsModule, DecimalPipe],
  template: `
    <div class="form-page" id="zed_user_form">
      <div class="container-fluid">
        <div class="row mt-4">
          <div class="col-sm-12"><h3 class="registration-title">Certification Payments</h3></div>
          <div class="col-sm-12">
            @if (error()) {
              <div class="alert alert-danger" role="alert">{{ error() }}</div>
            }
            @if (success()) {
              <div class="alert alert-success" role="status">{{ success() }}</div>
            }
            <form (ngSubmit)="save()" novalidate>
              <div class="card mb-3">
                <div class="card-body">
                  <div class="row">
                    <div class="col-sm-3">
                      <div class="input-group">
                        <label class="input-group-text" for="msmeType">Enterprise Type</label>
                        <select id="msmeType" name="msmeType" class="form-select" [ngModel]="type()" (ngModelChange)="changeType($event)">
                          @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
                        </select>
                      </div>
                    </div>
                    @for (l of levels(); track l.certification) {
                      <div class="col-sm-3">
                        <div class="input-group">
                          <label class="input-group-text" [for]="'fee-' + l.certification">{{ l.certification }}</label>
                          <input type="number" class="form-control" min="0" step="0.01" [id]="'fee-' + l.certification" [name]="'fee-' + l.certification"
                                 [(ngModel)]="l.fee" (change)="recalculate()" />
                        </div>
                      </div>
                    }
                  </div>
                  @if (type() !== 'Rejected') {
                    <div class="row mt-2">
                      <div class="col-sm-3"></div>
                      @for (l of levels(); track l.certification) {
                        <div class="col-sm-3">
                          @if (l.hasCouponRows) {
                            <div class="input-group">
                              <label class="input-group-text" [for]="'coupon-' + l.certification">Coupon</label>
                              <input type="number" class="form-control" min="0" step="0.01" [id]="'coupon-' + l.certification" [name]="'coupon-' + l.certification"
                                     [(ngModel)]="l.coupon" (change)="recalculate()" />
                            </div>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>

              @if (dirty()) {
                <div class="alert alert-warning" role="status">The amounts below are not saved yet. Press SAVE to apply them.</div>
              }

              <div class="table-responsive">
                <table class="table table-default table-zed table-bordered fees">
                  <thead>
                    <tr>
                      <th class="text-center">Certification</th>
                      <th class="text-center">Amount</th>
                      <th class="text-center">GST (18%)</th>
                      <th class="text-center hl-yellow">Total</th>
                      <th class="text-center">Coupon</th>
                      <th class="text-center">Assessment Fee After Coupon</th>
                      <th class="text-center">GST&#64;18%</th>
                      <th class="text-center">Total</th>
                      <th class="text-center hl-yellow">Subsidy (%)</th>
                      <th class="text-center hl-yellow">Assessment Fee after Subsidy</th>
                      <th class="text-center hl-yellow">GST&#64;18%</th>
                      <th class="text-center hl-blue">Applicant Contribution after subsidy</th>
                      <th class="text-center">TDS &#64;2%</th>
                      <th class="text-center">TDS &#64;10%</th>
                      <th class="text-center hl-blue">Net Payable after &#64;2%</th>
                      <th class="text-center hl-blue">Net Payable after &#64;10%</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (a of rows(); track a.id) {
                      <tr>
                        <td class="text-end">
                          {{ a.certification }}
                          @if (a.isCouponRow || a.specialCategory) {
                            <br /><small class="text-muted">{{ a.isCouponRow ? 'with coupon' : '' }}{{ a.isCouponRow && a.specialCategory ? ', ' : '' }}{{ a.specialCategory ? 'special category ' + a.specialCategory : '' }}</small>
                          }
                        </td>
                        <td class="text-end">{{ a.assessmentFee | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.gst | number: '1.2-2' }}</td>
                        <td class="text-end hl-yellow">{{ a.total | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.coupon | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.assessmentFeeAfterCoupon | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.gstAfterCoupon | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.totalAfterCoupon | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.subsidyPercentage }}</td>
                        <td class="text-end hl-yellow">{{ a.subsidyPer | number: '1.2-2' }}</td>
                        <td class="text-end hl-yellow">{{ a.gstAfterSubsidy | number: '1.2-2' }}</td>
                        <td class="text-end hl-blue">{{ a.applicantContributionAfterSubsidy | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.tds15 | number: '1.2-2' }}</td>
                        <td class="text-end">{{ a.tds75 | number: '1.2-2' }}</td>
                        <td class="text-end hl-blue">{{ a.netPaybleTds15 | number: '1.2-2' }}</td>
                        <td class="text-end hl-blue">{{ a.netPaybleTds75 | number: '1.2-2' }}</td>
                      </tr>
                    } @empty {
                      <tr><td colspan="16" style="padding: 0"><div class="no-data">No Data</div></td></tr>
                    }
                  </tbody>
                </table>
              </div>
              <div class="text-end">
                <hr />
                <button type="submit" class="btn btn-primary btn-md" [disabled]="saving() || !levels().length">SAVE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>

    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite">
        <div class="text-center text-white"><div class="spinner-border text-light"></div><div><small>Please wait ...</small></div></div>
      </div>
    }
  `,
  styles: `
    table tbody tr td { font-size: 12px; }
    .hl-yellow { background-color: yellow; color: black; }
    th.hl-blue, td.hl-blue { background-color: #9ec5fe; color: black; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class AssessmentFeesPage {
  private readonly api = inject(FeesApi);

  protected readonly types = ENTERPRISE_TYPES;
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
      coupon: this.type() !== 'Rejected' && l.hasCouponRows ? l.coupon : null,
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
    if (this.levels().some((l) => l.fee === null || l.fee === undefined || (l.hasCouponRows && this.type() !== 'Rejected' && (l.coupon === null || l.coupon === undefined)))) {
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
