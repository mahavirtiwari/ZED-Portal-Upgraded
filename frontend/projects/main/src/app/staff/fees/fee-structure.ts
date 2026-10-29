import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { PORTAL_SYSTEM } from '../../portal-system';
import { ENTERPRISE_TYPES, FeeRow, FeesApi, LevelFee } from './fees.api';

const LEVELS = ['Bronze', 'Silver', 'Gold', 'ZEDX'] as const;
/** The name shown for a level's code (ZEDX is ZED-X, migration 0028). */
export const LEVEL_NAMES: Record<string, string> = { ZEDX: 'ZED-X' };

/** AssessmentFee.SpecialCategory of the payment procedures: what the code and name of each category are on this portal. */
const CATEGORIES: Record<number, { code: string; name: string }> = PORTAL_SYSTEM === 'surveillance'
  ? { 0: { code: 'GEN', name: 'General' }, 1: { code: 'SPL', name: 'Woman / SC / ST-owned or aspirational district MSME' } }
  : { 0: { code: 'GEN', name: 'General' }, 1: { code: 'SC/ST', name: 'SC / ST-owned or aspirational district MSME' }, 2: { code: 'WOM', name: 'Woman-owned MSME' } };

/** A row of the Payment Structure: its fee row and what its subsidy is made of. */
interface StructureRow {
  row: FeeRow;
  category: number;
  code: string;
  name: string;
  share: number;
  additional: number;
  goiShare: number;
}

/** The subsidy share being edited. */
interface ShareEdit {
  category: number;
  code: string;
  name: string;
  base: number;
  additional: number;
  allLevels: boolean;
}

/**
 * Admin → Masters → Payments, Main and Surveillance (V4, as the LEAN portal's Fee Structure): per level and enterprise
 * type, the certification fee and joining reward, the payment structure of each subsidy category (the Government of India's
 * share, the MSME's share with GST) with an Edit of the category's subsidy share (base plus additional), and the TDS
 * deductions with the net payable. Bronze, Silver and Gold have the same structure, only the fee differs. Every amount is
 * worked out by the server (AssessmentFeesController); the joining reward rows keep their logic (the reward comes off the
 * total before the subsidy). Consultancy keeps its fee per milestone (assessment-fees.ts).
 */
@Component({
  selector: 'zed-staff-fee-structure',
  imports: [FormsModule, DecimalPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Fee Structure — {{ levelName(level()) }}</h3>
        <p class="page-sub">Fee, subsidy split, GST and both TDS deductions for {{ levelName(level()) }} certification of {{ type() }} enterprises.</p>
      </div>
      <div class="fs-pick">
        <div class="btn-group" role="group" aria-label="Certification level">
          @for (l of levels; track l) {
            <button type="button" class="btn btn-sm" [class.btn-primary]="level() === l" [class.btn-outline-primary]="level() !== l" [attr.aria-pressed]="level() === l" (click)="pickLevel(l)">{{ levelName(l) }}</button>
          }
        </div>
        <select class="form-select form-select-sm" aria-label="Enterprise type" [ngModel]="type()" (ngModelChange)="pickType($event)">
          @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
        </select>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (fee(); as f) {
      <section class="zed-card" aria-labelledby="fs-rates">
        <h5 class="fs-h" id="fs-rates">Certification Fee &amp; Rates <span class="zed-chip">{{ levelName(level()) }}</span></h5>
        <p class="muted">{{ rejected() ? 'Units whose certification was rejected pay the full fee again: no subsidy and no joining reward.' : 'The fee is before GST. It is split by subsidy category first; GST and TDS then apply to the MSME share only.' }}</p>
        <div class="fs-rates">
          <div>
            <label class="form-label" for="fs-fee">Fee (before GST)<span class="req">*</span></label>
            <input class="form-control" id="fs-fee" type="number" min="0" step="0.01" [(ngModel)]="feeInput" (ngModelChange)="feeChanged.set(true)" />
            <small class="muted">With GST: ₹ {{ (feeInput ?? 0) * 1.18 | number: '1.2-2' }}</small>
          </div>
          @if (f.hasCouponRows && !rejected()) {
            <div>
              <label class="form-label" for="fs-reward">Joining reward (₹)<span class="req">*</span></label>
              <input class="form-control" id="fs-reward" type="number" min="0" step="0.01" [(ngModel)]="rewardInput" (ngModelChange)="feeChanged.set(true)" />
              <small class="muted">Comes off the total with GST for units that get it.</small>
            </div>
          }
          <div><label class="form-label" for="fs-gst">GST</label><input class="form-control fs-fixed" id="fs-gst" readonly value="18%" /></div>
          <div><label class="form-label" for="fs-194c">TDS 194C</label><input class="form-control fs-fixed" id="fs-194c" readonly value="2%" /></div>
          <div><label class="form-label" for="fs-194j">TDS 194J</label><input class="form-control fs-fixed" id="fs-194j" readonly value="10%" /></div>
        </div>
        <div class="form-actions">
          @if (feeChanged()) { <span class="muted me-auto">Not saved yet.</span> }
          <button type="button" class="btn btn-primary" [disabled]="busy() || !feeChanged()" (click)="saveFee()">Save Fee</button>
        </div>
      </section>

      <section class="zed-card" aria-labelledby="fs-structure">
        <h5 class="fs-h" id="fs-structure">Payment Structure</h5>
        <p class="muted">The Government of India's share is released against the fee and carries no GST. The MSME share includes 18% GST; its taxable value is the base for TDS.</p>
        <div class="table-responsive">
          <table class="table table-zed fs-table">
            <thead>
              <tr>
                <th>Code</th><th>Category</th><th class="text-end">Subsidy</th><th class="text-end">GoI share</th><th class="text-end">MSME share</th>
                <th class="text-end">GST &#64; 18%</th><th class="text-end">MSME taxable</th><th class="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (s of structure(); track s.row.id) {
                <tr>
                  <td class="fs-code">{{ s.code }}</td>
                  <td>
                    <strong>{{ s.name }}</strong>
                    @if (s.row.isCouponRow) { <small class="d-block muted">with joining reward ₹ {{ s.row.coupon | number: '1.0-2' }}</small> }
                  </td>
                  <td class="text-end">
                    <strong class="fs-share">{{ s.share | number: '1.0-2' }}%</strong>
                    @if (s.additional) { <small class="d-block muted">{{ s.share - s.additional | number: '1.0-2' }}% base + {{ s.additional | number: '1.0-2' }}% additional</small> }
                  </td>
                  <td class="text-end">₹ {{ s.goiShare | number: '1.2-2' }}</td>
                  <td class="text-end"><strong>₹ {{ s.row.applicantContributionAfterSubsidy | number: '1.2-2' }}</strong></td>
                  <td class="text-end">₹ {{ s.row.gstAfterSubsidy | number: '1.2-2' }}</td>
                  <td class="text-end"><strong>₹ {{ s.row.subsidyPer | number: '1.2-2' }}</strong></td>
                  <td class="text-center">
                    @if (!rejected() && !s.row.isCouponRow) {
                      <button type="button" class="btn btn-sm btn-outline-primary" [attr.aria-label]="'Edit the subsidy of ' + s.name" (click)="edit(s)">Edit</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="8" style="padding: 0"><div class="no-data">No fee rows for {{ type() }} {{ levelName(level()) }}.</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      <section class="zed-card" aria-labelledby="fs-tds">
        <h5 class="fs-h" id="fs-tds">TDS Deduction &amp; Net Payable <span class="zed-chip">194C &#64; 2%</span> <span class="zed-chip">194J &#64; 10%</span></h5>
        <div class="table-responsive">
          <table class="table table-zed fs-table">
            <thead>
              <tr>
                <th>Code</th><th>Category</th><th class="text-end">MSME taxable</th><th class="text-end">TDS 194C</th><th class="text-end">Net after 194C</th>
                <th class="text-end">TDS 194J</th><th class="text-end">Net after 194J</th>
              </tr>
            </thead>
            <tbody>
              @for (s of structure(); track s.row.id) {
                <tr>
                  <td class="fs-code">{{ s.code }}</td>
                  <td>{{ s.name }}@if (s.row.isCouponRow) { <small class="d-block muted">with joining reward</small> }</td>
                  <td class="text-end">₹ {{ s.row.subsidyPer | number: '1.2-2' }}</td>
                  <td class="text-end">₹ {{ s.row.tds15 | number: '1.2-2' }}</td>
                  <td class="text-end"><strong>₹ {{ s.row.netPaybleTds15 | number: '1.2-2' }}</strong></td>
                  <td class="text-end">₹ {{ s.row.tds75 | number: '1.2-2' }}</td>
                  <td class="text-end"><strong>₹ {{ s.row.netPaybleTds75 | number: '1.2-2' }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (loaded()) {
      <div class="no-data">No fees are set for {{ type() }} {{ levelName(level()) }}.</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fs-edit-title">
        <div class="modal-dialog modal-dialog-centered">
          <div class="modal-content">
            <div class="modal-header">
              <div>
                <h4 class="m-0" id="fs-edit-title">{{ e.name }}</h4>
                <small class="muted">{{ e.code }} · subsidy share</small>
              </div>
              <button type="button" class="btn-close" aria-label="Close" (click)="editing.set(null)"></button>
            </div>
            <div class="modal-body">
              <div class="alert alert-warning py-2">
                {{ e.category === 0 ? 'The base share is what every unit of this type receives; the other categories keep their additional share on top of it.' : 'The share is the base every unit receives plus the extra this category is granted.' }}
                Changing it changes what every {{ type() }} unit in this category pays.
              </div>
              <div class="fs-share-grid">
                <div>
                  <label class="form-label" for="fs-base">Base share (%)</label>
                  <input class="form-control" id="fs-base" type="number" min="0" max="100" step="0.01" [disabled]="e.category !== 0" [(ngModel)]="e.base" />
                </div>
                <div>
                  <label class="form-label" for="fs-additional">Additional (%)</label>
                  <input class="form-control" id="fs-additional" type="number" min="0" max="100" step="0.01" [disabled]="e.category === 0" [(ngModel)]="e.additional" />
                </div>
                <div>
                  <label class="form-label" for="fs-total">Total</label>
                  <input class="form-control fs-fixed fs-share" id="fs-total" readonly [value]="((e.base ?? 0) + (e.additional ?? 0) | number: '1.0-2') + '%'" />
                </div>
              </div>
              <p class="muted mt-2 mb-2">The MSME pays the remaining {{ 100 - (e.base ?? 0) - (e.additional ?? 0) | number: '1.0-2' }}%.@if (e.category !== 0) { The base share is changed on General. }</p>
              <label class="fs-check" for="fs-all">
                <input class="form-check-input" type="checkbox" id="fs-all" [(ngModel)]="e.allLevels" />
                Apply to Bronze, Silver and Gold
              </label>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="saveShare(e)">Save Share</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .page-head { align-items: center; }
    .fs-pick { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; }
    .fs-pick .form-select { width: auto; }
    .zed-card { margin-bottom: 16px; }
    .fs-h { font-weight: 700; color: #23474a; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .fs-rates { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px 16px; }
    .fs-fixed { background: #f6f9f9; font-weight: 600; }
    .fs-fixed:focus { box-shadow: none; }
    .fs-table td, .fs-table th { vertical-align: middle; white-space: nowrap; }
    .fs-code { font-weight: 700; color: #2f7c83; }
    .fs-share { color: #2f7c83; }
    .fs-rates, .fs-share-grid { align-items: start; }
    .fs-share-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
    .fs-share-grid .form-label, .fs-rates .form-label { display: block; margin-bottom: 4px; }
    .fs-check { display: flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; }
    .fs-check .form-check-input { float: none; margin: 0; flex: none; }
    .form-actions { align-items: center; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class FeeStructurePage {
  private readonly api = inject(FeesApi);

  protected readonly levels = LEVELS;
  protected readonly types = ENTERPRISE_TYPES;
  protected readonly level = signal<string>('Bronze');
  protected readonly type = signal<string>('Micro');
  protected readonly rejected = computed(() => this.type() === 'Rejected');
  private readonly levelFees = signal<LevelFee[]>([]);
  private readonly rows = signal<FeeRow[]>([]);
  /** The fee and joining reward of the level shown, or null when the type has no rows for it. */
  protected readonly fee = computed(() => this.levelFees().find((l) => l.certification === this.level()) ?? null);
  protected feeInput: number | null = null;
  protected rewardInput: number | null = null;
  protected readonly feeChanged = signal(false);

  protected readonly structure = computed<StructureRow[]>(() => {
    const of = this.rows().filter((r) => r.certification === this.level());
    const general = of.find((r) => (r.specialCategory ?? 0) === 0 && !r.isCouponRow) ?? of.find((r) => (r.specialCategory ?? 0) === 0);
    const base = general?.subsidyPercentage ?? 0;
    return of
      .map((row) => {
        const category = row.specialCategory ?? 0;
        const c = CATEGORIES[category] ?? { code: `CAT ${category}`, name: `Special category ${category}` };
        const share = row.subsidyPercentage ?? 0;
        const taxableBase = row.isCouponRow ? (row.assessmentFeeAfterCoupon ?? 0) : (row.assessmentFee ?? 0);
        return { row, category, code: c.code, name: c.name, share, additional: category === 0 ? 0 : share - base, goiShare: taxableBase - (row.subsidyPer ?? 0) };
      })
      .sort((a, b) => a.category - b.category || Number(a.row.isCouponRow) - Number(b.row.isCouponRow) || a.row.id - b.row.id);
  });

  protected readonly editing = signal<ShareEdit | null>(null);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected levelName(code: string): string {
    return LEVEL_NAMES[code] ?? code;
  }

  protected pickLevel(level: string): void {
    this.level.set(level);
    this.success.set('');
    this.resetInputs();
  }

  protected pickType(type: string): void {
    this.type.set(type);
    this.success.set('');
    void this.load();
  }

  protected edit(s: StructureRow): void {
    const base = s.category === 0 ? s.share : s.share - s.additional;
    this.error.set('');
    this.success.set('');
    this.editing.set({ category: s.category, code: s.code, name: s.name, base, additional: s.additional, allLevels: true });
  }

  protected async saveFee(): Promise<void> {
    const f = this.fee();
    if (!f) return;
    const reward = f.hasCouponRows && !this.rejected();
    if (this.feeInput === null || this.feeInput === undefined || (reward && (this.rewardInput === null || this.rewardInput === undefined))) {
      this.error.set('Please enter the fee and the joining reward.');
      return;
    }
    await this.run(() => this.api.save(this.type(), [{ certification: f.certification, assessmentFee: this.feeInput, coupon: reward ? this.rewardInput : null }]));
  }

  protected async saveShare(e: ShareEdit): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.api.saveSubsidy(this.type(), {
        certification: this.level(), category: e.category, allLevels: e.allLevels,
        baseShare: e.category === 0 ? e.base : null, additionalShare: e.category === 0 ? null : e.additional,
      }));
      this.editing.set(null);
      return r;
    });
  }

  private async run(action: () => Promise<{ message: string }> | Observable<{ message: string }>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const result = action();
      const r = result instanceof Promise ? await result : await firstValueFrom(result);
      await this.load(false);
      this.success.set(r.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private resetInputs(): void {
    const f = this.fee();
    this.feeInput = f?.assessmentFee ?? null;
    this.rewardInput = f?.coupon ?? null;
    this.feeChanged.set(false);
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.fees(this.type()));
      this.levelFees.set(res.levels);
      this.rows.set(res.rows);
      if (!res.levels.some((l) => l.certification === this.level()) && res.levels.length) this.level.set(res.levels[0].certification);
      this.resetInputs();
      this.loaded.set(true);
    } catch (err) {
      this.levelFees.set([]);
      this.rows.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
