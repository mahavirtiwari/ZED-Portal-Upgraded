import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AdminPortalService, PortalSwitchComponent } from '../admin-portal';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ENTERPRISE_TYPES, FeeRow, FeesApi, LevelFee, MAIN_ENTERPRISE_TYPES, PaymentSchedule, isFullFee } from './fees.api';

const LEVELS = ['Bronze', 'Silver', 'Gold', 'ZEDX'] as const;
/** Consultancy's handholding milestones (AssessmentFee.MileStone); one fee each per handholding level. */
const MILESTONES = ['1', '2', '3'] as const;
const HANDHOLDING_LEVELS: readonly string[] = ['Silver', 'Gold'];
/** The name shown for a level's code (ZEDX is ZED-X, migration 0028). */
export const LEVEL_NAMES: Record<string, string> = { ZEDX: 'ZED-X' };

/**
 * AssessmentFee.SpecialCategory, the same on the three portals (migration 0041): the payment charges a unit the category it
 * fits with the highest subsidy; the regions come from Admin → Masters → Subsidy Regions.
 */
const CATEGORIES: Record<number, { code: string; name: string }> = {
  0: { code: 'GEN', name: 'General' },
  1: { code: 'SC', name: 'SC-owned MSME' },
  3: { code: 'ST', name: 'ST-owned MSME' },
  2: { code: 'WOM', name: 'Woman-owned MSME' },
  4: { code: 'ASP', name: 'Aspirational district' },
  5: { code: 'LWE', name: 'LWE district' },
  6: { code: 'HIM', name: 'Himalayan region' },
  7: { code: 'ISL', name: 'Island territory' },
  8: { code: 'NER', name: 'North Eastern Region' },
};
/** The order the categories are listed in: General, the owners' categories, then the regions. */
const CATEGORY_ORDER = [0, 1, 3, 2, 4, 5, 6, 7, 8];
const categoryRank = (category: number) => { const i = CATEGORY_ORDER.indexOf(category); return i < 0 ? 99 : i; };

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

/** A level's card at the top: its fee, joining reward, and the General unit's subsidy and payment (server amounts). */
interface LevelSummary {
  code: string;
  set: boolean;
  fee: number | null;
  reward: number | null;
  subsidy: number | null;
  msmePays: number | null;
}

/** The Add fees form of a level (or milestone) without fees. */
interface AddForm {
  fee: number | null;
  reward: number | null;
  general: number | null;
  additional: Record<number, number | null>;
  alsoOthers: boolean;
  /** Consultancy: also the other handholding level (when it has no fees for the milestone either). */
  alsoOtherLevel: boolean;
}

/** Consultancy: the payment schedule being edited. */
interface ScheduleForm {
  payAll: boolean;
  from: string;
}

/** The pop-up's preview of a share: what a unit of the category (no joining reward) would pay on the level's fee. */
interface SharePreview {
  fee: number;
  pct: number;
  outOfRange: boolean;
  goi: number;
  taxable: number;
  gst: number;
  pays: number;
  tds194c: number;
  tds194j: number;
}

/**
 * Admin → Masters → Payments, Main and Surveillance (V4, as the LEAN portal's Fee Structure): per level and enterprise
 * type, the certification fee and joining reward, the payment structure of each subsidy category (the Government of India's
 * share, the MSME's share with GST) with an Edit of the category's subsidy share (base plus additional), and the TDS
 * deductions with the net payable. Bronze, Silver and Gold have the same structure, only the fee differs. Every amount is
 * worked out by the server (AssessmentFeesController); the joining reward rows keep their logic (the reward comes off the
 * total before the subsidy). Consultancy has the same page per handholding level (Silver, Gold) and milestone: its own fee
 * per level and milestone, the subsidy share per milestone or for all three of the level, and the payment schedule (each
 * milestone paid in turn, or all three at milestone 1 from a date; migration 0044). Main also has the Recertification type
 * (the full fee to re-certify a level, migration 0046). A level (or milestone)
 * without fees offers Add fees, which makes the rows the payment page reads. V4 layout: the enterprise type
 * as a segmented switch, a card per level (fee, General subsidy, what the MSME pays) that picks the level, category chips,
 * the MSME share and net payable columns highlighted, a card per row on phones, and the share pop-up with a preview of
 * the amounts beside the fields.
 */
@Component({
  selector: 'zed-staff-fee-structure',
  imports: [FormsModule, DecimalPipe, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ consultancy ? 'Handholding Fee' : 'Fee Structure' }} — {{ consultancy ? hhLevel() + ', ' : '' }}{{ levelName(level()) }}</h3>
        <p class="page-sub">Fee, subsidy split, GST and both TDS deductions for {{ consultancy ? hhLevel() + ' handholding, ' + levelName(level()).toLowerCase() : levelName(level()) + (type() === 'Recertification' ? ' recertification' : ' certification') }} of {{ type() === 'Recertification' ? 'all' : type() }} enterprises.</p>
      </div>
      <div class="page-actions fs-type">
        <span class="fs-type-label">Enterprise type</span>
        <div class="seg" role="group" aria-label="Enterprise type">
          @for (t of types; track t) {
            <button type="button" [class.active]="type() === t" [attr.aria-pressed]="type() === t" (click)="pickType(t)">{{ t }}</button>
          }
        </div>
      </div>
    </div>
    <!-- One Admin (V4): the portal whose settings these are (each portal has its own fees). -->
    <zed-portal-switch />

    @if (consultancy && loaded()) {
      <section class="zed-card schedule" aria-labelledby="fs-schedule">
        <h5 class="fs-h" id="fs-schedule">Payment schedule
          <span class="zed-chip">{{ schedule()?.payAllAtMilestone1 ? 'All at milestone 1 from ' + dmy(schedule()?.from) : 'Milestone by milestone' }}</span>
        </h5>
        <p class="muted">The same for Micro, Small and Medium. Units that have already paid milestone 1 keep their schedule.</p>
        <div class="sched-options" role="radiogroup" aria-label="Payment schedule">
          <label class="toggle-card" [class.active]="!sched.payAll" for="fs-sched-each">
            <input class="form-check-input" type="radio" name="fs-sched" id="fs-sched-each" [value]="false" [(ngModel)]="sched.payAll" (ngModelChange)="schedChanged.set(true)" />
            <span>Pay at each milestone<small>Milestones 1, 2 and 3 are paid one by one, each after the previous one is accepted.</small></span>
          </label>
          <label class="toggle-card" [class.active]="sched.payAll" for="fs-sched-all">
            <input class="form-check-input" type="radio" name="fs-sched" id="fs-sched-all" [value]="true" [(ngModel)]="sched.payAll" (ngModelChange)="schedChanged.set(true)" />
            <span>Pay all at milestone 1<small>Milestone 1 charges the three milestones' fees together; milestones 2 and 3 open with nothing to pay.</small></span>
          </label>
        </div>
        @if (sched.payAll) {
          <div class="sched-date">
            <label class="form-label" for="fs-sched-from">For units whose milestone 1 is paid from<span class="req">*</span></label>
            <input class="form-control" id="fs-sched-from" type="date" [min]="today" [(ngModel)]="sched.from" (ngModelChange)="schedChanged.set(true)" />
          </div>
        }
        <div class="save-bar" [class.is-dirty]="schedChanged()">
          @if (schedChanged()) { <span class="unsaved me-auto">Not saved yet.</span> } @else { <span class="muted me-auto">No unsaved changes.</span> }
          <button type="button" class="btn btn-primary" [disabled]="busy() || !schedChanged()" (click)="saveSchedule()">Save Schedule</button>
        </div>
      </section>

      <div class="hh-level">
        <span class="fs-type-label">Handholding level</span>
        <div class="seg" role="group" aria-label="Handholding level">
          @for (l of handholdingLevels; track l) {
            <button type="button" [class.active]="hhLevel() === l" [attr.aria-pressed]="hhLevel() === l" (click)="pickHhLevel(l)">{{ l }}</button>
          }
        </div>
        <span class="muted">Silver and Gold have their own fee for each milestone.</span>
      </div>
    }

    <nav class="lv-cards" [class.three]="consultancy" [attr.aria-label]="consultancy ? 'Milestone' : 'Certification level'">
      @for (c of summary(); track c.code) {
        <button type="button" class="lv-card" [class.active]="level() === c.code" [class.is-unset]="!c.set" [attr.aria-pressed]="level() === c.code"
                [attr.data-level]="c.code" (click)="pickLevel(c.code)">
          <span class="lv-name">{{ levelName(c.code) }}</span>
          @if (c.set) {
            <span class="lv-fee">₹ {{ c.fee | number: '1.0-2' }} <small>+ GST</small></span>
            <span class="lv-line"><span>Subsidy (General)</span><b>{{ (c.subsidy ?? 0) | number: '1.0-2' }}%</b></span>
            <span class="lv-line lv-pays"><span>MSME pays</span><b>{{ c.msmePays === null ? '—' : '₹ ' + (c.msmePays | number: '1.2-2') }}</b></span>
            @if (c.reward !== null) { <span class="lv-reward">Joining reward ₹ {{ c.reward | number: '1.0-2' }}</span> }
          } @else {
            <span class="lv-none">No fee set for {{ type() }}</span>
          }
        </button>
      }
    </nav>
    @if (consultancy && levelTotal(); as t) {
      <div class="hh-total" data-testid="hh-total">
        <span>{{ hhLevel() }} handholding, all three milestones (General)</span>
        <span>₹ {{ t.fee | number: '1.0-2' }} + GST · <b>MSME pays ₹ {{ t.pays | number: '1.2-2' }}</b>@if (schedule()?.payAllAtMilestone1) { <small> at milestone 1</small> }</span>
      </div>
    }

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (fee(); as f) {
      <section class="zed-card" aria-labelledby="fs-rates">
        <h5 class="fs-h" id="fs-rates">{{ consultancy ? 'Handholding' : 'Certification' }} Fee &amp; Rates <span class="zed-chip">{{ levelName(level()) }}</span><span class="zed-chip">{{ type() }}</span></h5>
        <p class="muted">{{ type() === 'Recertification' ? 'Units re-certifying a level pay this full fee: no subsidy and no joining reward. It is separate from the Rejected fee.'
          : rejected() ? 'Units whose certification was rejected pay the full fee again: no subsidy and no joining reward.'
          : consultancy ? 'The fee of ' + hhLevel() + ' handholding for this milestone (Gold has its own). GST and TDS apply to the MSME share only; the joining reward is kept.'
          : 'The fee is before GST. It is split by subsidy category first; GST and TDS then apply to the MSME share only.' }}</p>
        <div class="fs-rates">
          <div>
            <label class="form-label" for="fs-fee">Fee (before GST)<span class="req">*</span></label>
            <input class="form-control" id="fs-fee" type="number" min="0" step="0.01" [(ngModel)]="feeInput" (ngModelChange)="feeChanged.set(true)" />
            <small class="muted">With GST: ₹ {{ (feeInput ?? 0) * 1.18 | number: '1.2-2' }}</small>
          </div>
          @if (f.hasCouponRows && !rejected() && !consultancy) {
            <div>
              <label class="form-label" for="fs-reward">Joining reward (₹)<span class="req">*</span></label>
              <input class="form-control" id="fs-reward" type="number" min="0" step="0.01" [(ngModel)]="rewardInput" (ngModelChange)="feeChanged.set(true)" />
              <small class="muted">Comes off the total with GST for units that get it.</small>
            </div>
          }
          <div>
            <span class="form-label d-block">Fixed rates</span>
            <div class="rate-tiles">
              <span class="rate"><b>18%</b>GST</span>
              <span class="rate"><b>2%</b>TDS 194C</span>
              <span class="rate"><b>10%</b>TDS 194J</span>
            </div>
          </div>
        </div>
        <div class="save-bar" [class.is-dirty]="feeChanged()">
          @if (feeChanged()) { <span class="unsaved me-auto">Not saved yet.</span> } @else { <span class="muted me-auto">No unsaved changes.</span> }
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
                <th>Code</th><th>Category</th><th class="text-end">Subsidy</th><th class="text-end">GoI share</th><th class="text-end col-pay">MSME share</th>
                <th class="text-end">GST &#64; 18%</th><th class="text-end">MSME taxable</th><th class="text-center">Actions</th>
              </tr>
            </thead>
            <tbody>
              @for (s of structure(); track s.row.id) {
                <tr>
                  <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1 || s.category === 3" [class.cat-2]="s.category === 2" [class.cat-region]="s.category >= 4">{{ s.code }}</span></td>
                  <td class="fs-cat">
                    <strong>{{ s.name }}</strong>
                    @if (s.row.isCouponRow) { <small class="d-block reward-note">with joining reward ₹ {{ s.row.coupon | number: '1.0-2' }}</small> }
                  </td>
                  <td class="text-end" data-label="Subsidy">
                    <span>
                      <strong class="fs-share">{{ s.share | number: '1.0-2' }}%</strong>
                      @if (s.additional) { <small class="d-block muted">{{ s.share - s.additional | number: '1.0-2' }}% base + {{ s.additional | number: '1.0-2' }}% additional</small> }
                    </span>
                  </td>
                  <td class="text-end" data-label="GoI share">₹ {{ s.goiShare | number: '1.2-2' }}</td>
                  <td class="text-end col-pay" data-label="MSME share"><strong>₹ {{ s.row.applicantContributionAfterSubsidy | number: '1.2-2' }}</strong></td>
                  <td class="text-end" data-label="GST @ 18%">₹ {{ s.row.gstAfterSubsidy | number: '1.2-2' }}</td>
                  <td class="text-end" data-label="MSME taxable"><strong>₹ {{ s.row.subsidyPer | number: '1.2-2' }}</strong></td>
                  <td class="text-center fs-actions">
                    @if (!rejected() && !s.row.isCouponRow) {
                      <button type="button" class="btn btn-sm btn-outline-primary" [attr.aria-label]="'Edit the subsidy of ' + s.name" (click)="edit(s)">Edit</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="8" style="padding: 0"><div class="no-data">No fee rows for {{ type() }} {{ consultancy ? hhLevel() + ' ' : '' }}{{ levelName(level()) }}.</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (payAllRows().length) {
        <section class="zed-card" aria-labelledby="fs-payall">
          <h5 class="fs-h" id="fs-payall">All three milestones at milestone 1 <span class="zed-chip">{{ hhLevel() }}</span><span class="zed-chip">{{ type() }}</span>
            <span class="zed-chip" [class.chip-off]="!schedule()?.payAllAtMilestone1">{{ schedule()?.payAllAtMilestone1 ? 'From ' + dmy(schedule()?.from) : 'Schedule off' }}</span></h5>
          <p class="muted">What milestone 1 charges a unit paying all three milestones at once: the three milestones' amounts added up. Its milestones 2 and 3 then have nothing to pay. Worked out from the fees above.</p>
          <div class="table-responsive">
            <table class="table table-zed fs-table">
              <thead>
                <tr><th>Code</th><th>Category</th><th class="text-end">Fee</th><th class="text-end col-pay">MSME share</th><th class="text-end">GST &#64; 18%</th>
                  <th class="text-end col-net">Net after 194C</th><th class="text-end col-net">Net after 194J</th></tr>
              </thead>
              <tbody>
                @for (s of payAllRows(); track s.row.id) {
                  <tr>
                    <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1 || s.category === 3" [class.cat-2]="s.category === 2" [class.cat-region]="s.category >= 4">{{ s.code }}</span></td>
                    <td class="fs-cat"><strong>{{ s.name }}</strong></td>
                    <td class="text-end" data-label="Fee">₹ {{ s.row.assessmentFee | number: '1.2-2' }}</td>
                    <td class="text-end col-pay" data-label="MSME share"><strong>₹ {{ s.row.applicantContributionAfterSubsidy | number: '1.2-2' }}</strong></td>
                    <td class="text-end" data-label="GST @ 18%">₹ {{ s.row.gstAfterSubsidy | number: '1.2-2' }}</td>
                    <td class="text-end col-net" data-label="Net after 194C"><strong>₹ {{ s.row.netPaybleTds15 | number: '1.2-2' }}</strong></td>
                    <td class="text-end col-net" data-label="Net after 194J"><strong>₹ {{ s.row.netPaybleTds75 | number: '1.2-2' }}</strong></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="zed-card" aria-labelledby="fs-tds">
        <h5 class="fs-h" id="fs-tds">TDS Deduction &amp; Net Payable <span class="zed-chip">194C &#64; 2%</span><span class="zed-chip">194J &#64; 10%</span></h5>
        <p class="muted">The net payable is the MSME share with GST less the TDS the unit deducts.</p>
        <div class="table-responsive">
          <table class="table table-zed fs-table">
            <thead>
              <tr>
                <th>Code</th><th>Category</th><th class="text-end">MSME taxable</th><th class="text-end">TDS 194C</th><th class="text-end col-net">Net after 194C</th>
                <th class="text-end">TDS 194J</th><th class="text-end col-net">Net after 194J</th>
              </tr>
            </thead>
            <tbody>
              @for (s of structure(); track s.row.id) {
                <tr>
                  <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1 || s.category === 3" [class.cat-2]="s.category === 2" [class.cat-region]="s.category >= 4">{{ s.code }}</span></td>
                  <td class="fs-cat">{{ s.name }}@if (s.row.isCouponRow) { <small class="d-block reward-note">with joining reward</small> }</td>
                  <td class="text-end" data-label="MSME taxable">₹ {{ s.row.subsidyPer | number: '1.2-2' }}</td>
                  <td class="text-end" data-label="TDS 194C">₹ {{ s.row.tds15 | number: '1.2-2' }}</td>
                  <td class="text-end col-net" data-label="Net after 194C"><strong>₹ {{ s.row.netPaybleTds15 | number: '1.2-2' }}</strong></td>
                  <td class="text-end" data-label="TDS 194J">₹ {{ s.row.tds75 | number: '1.2-2' }}</td>
                  <td class="text-end col-net" data-label="Net after 194J"><strong>₹ {{ s.row.netPaybleTds75 | number: '1.2-2' }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (loaded()) {
      <section class="zed-card add-fees" aria-labelledby="fs-add">
        <h5 class="fs-h" id="fs-add">Add fees @if (consultancy) { <span class="zed-chip">{{ hhLevel() }}</span> }<span class="zed-chip">{{ levelName(level()) }}</span><span class="zed-chip">{{ type() }}</span></h5>
        <p class="muted">No fees are set for {{ type() }} {{ consultancy ? hhLevel() + ' ' : '' }}{{ levelName(level()) }} on this portal, so {{ type() === 'Recertification' ? 'units' : type() + ' units' }} can't pay for it yet. Enter them here; every amount is worked out by the server.</p>
        <div class="fs-rates">
          <div>
            <label class="form-label" for="fs-add-fee">Fee (before GST)<span class="req">*</span></label>
            <input class="form-control" id="fs-add-fee" type="number" min="0" step="0.01" [(ngModel)]="add.fee" />
            <small class="muted">With GST: ₹ {{ (add.fee ?? 0) * 1.18 | number: '1.2-2' }}</small>
          </div>
          @if (!rejected()) {
            <div>
              <label class="form-label" for="fs-add-reward">Joining reward (₹)</label>
              <input class="form-control" id="fs-add-reward" type="number" min="0" step="0.01" placeholder="0 if none" [(ngModel)]="add.reward" />
              <small class="muted">Comes off the total with GST for units that get it.</small>
            </div>
            <div>
              <label class="form-label" for="fs-add-general">Subsidy, General (%)<span class="req">*</span></label>
              <input class="form-control" id="fs-add-general" type="number" min="0" max="100" step="0.01" [(ngModel)]="add.general" />
            </div>
            @for (c of specialCategories; track c.id) {
              <div>
                <label class="form-label" [for]="'fs-add-cat-' + c.id">Additional subsidy, {{ c.code }} (%)</label>
                <input class="form-control" [id]="'fs-add-cat-' + c.id" type="number" min="0" max="100" step="0.01" placeholder="0 if none" [(ngModel)]="add.additional[c.id]" />
                <small class="muted">{{ c.name }}</small>
              </div>
            }
          }
        </div>
        @if (consultancy && otherLevelFree()) {
          <label class="toggle-card mt-3" [class.active]="add.alsoOtherLevel" for="fs-add-level">
            <input class="form-check-input" type="checkbox" id="fs-add-level" [(ngModel)]="add.alsoOtherLevel" />
            <span>Also add {{ otherLevel() }} {{ levelName(level()).toLowerCase() }} with the same fee and shares
              <small>Change either level's fee on this page afterwards.</small></span>
          </label>
        }
        @if (!rejected() && otherTypes().length) {
          <label class="toggle-card mt-3" [class.active]="add.alsoOthers" for="fs-add-others">
            <input class="form-check-input" type="checkbox" id="fs-add-others" [(ngModel)]="add.alsoOthers" />
            <span>Also add {{ otherTypes().join(' and ') }} with the same fee and shares
              <small>Types that already have {{ levelName(level()) }} fees are left as they are.</small></span>
          </label>
        }
        <p class="add-note">{{ addNote() }}</p>
        <div class="save-bar">
          <span class="muted me-auto">Nothing is saved until you press Add Fees.</span>
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="addFees()">Add Fees</button>
        </div>
      </section>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fs-edit-title">
        <div class="modal-dialog modal-lg modal-dialog-centered fs-dialog">
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
              <div class="fs-edit">
                <div>
                  <h6 class="fs-group">Subsidy share</h6>
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
                  <p class="muted mt-2 mb-3">The MSME pays the remaining {{ 100 - (e.base ?? 0) - (e.additional ?? 0) | number: '1.0-2' }}%.@if (e.category !== 0) { The base share is changed on General. }</p>
                  <h6 class="fs-group">Applies to</h6>
                  <label class="toggle-card" [class.active]="e.allLevels" for="fs-all">
                    <input class="form-check-input" type="checkbox" id="fs-all" [(ngModel)]="e.allLevels" />
                    <span>{{ consultancy ? 'Apply to all three milestones of ' + hhLevel() : 'Apply to Bronze, Silver and Gold' }}
                      <small>{{ e.allLevels ? (consultancy ? 'The three ' + hhLevel() + ' milestones get the same share.' : 'The three levels get the same share.')
                        : 'Only ' + (consultancy ? hhLevel() + ' ' : '') + levelName(level()) + ' changes.' }}</small></span>
                  </label>
                </div>
                @if (sharePreview(e); as p) {
                  <aside class="fs-preview" aria-label="Preview">
                    <h6>Preview · {{ consultancy ? hhLevel() + ' ' : '' }}{{ levelName(level()) }}, {{ type() }}</h6>
                    @if (p.outOfRange) {
                      <p class="pv-warn">The total share must be between 0 and 100%.</p>
                    } @else {
                      <div class="pv-bar" aria-hidden="true"><span class="pv-goi" [style.width.%]="p.pct"></span><span class="pv-msme" [style.width.%]="100 - p.pct"></span></div>
                      <div class="pv-legend"><span><i class="pv-goi"></i>GoI {{ p.pct | number: '1.0-2' }}%</span><span><i class="pv-msme"></i>MSME {{ 100 - p.pct | number: '1.0-2' }}%</span></div>
                      <dl class="pv-numbers">
                        <dt>Fee (before GST)</dt><dd>₹ {{ p.fee | number: '1.2-2' }}</dd>
                        <dt>GoI share</dt><dd>₹ {{ p.goi | number: '1.2-2' }}</dd>
                        <dt>MSME taxable</dt><dd>₹ {{ p.taxable | number: '1.2-2' }}</dd>
                        <dt>GST &#64; 18%</dt><dd>₹ {{ p.gst | number: '1.2-2' }}</dd>
                        <dt class="pv-pays">MSME share</dt><dd class="pv-pays">₹ {{ p.pays | number: '1.2-2' }}</dd>
                        <dt>Net after 194C</dt><dd>₹ {{ p.pays - p.tds194c | number: '1.2-2' }}</dd>
                        <dt>Net after 194J</dt><dd>₹ {{ p.pays - p.tds194j | number: '1.2-2' }}</dd>
                      </dl>
                    }
                    <small class="muted d-block mt-2">A {{ e.code }} unit without a joining reward. The server works out the saved amounts.</small>
                  </aside>
                }
              </div>
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
    .page-head { align-items: flex-end; }
    .fs-type { flex-direction: column; align-items: flex-start; gap: 4px; }
    .fs-type-label { font-size: 12px; font-weight: 600; color: #5f6f70; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }

    /* A card per level: picks the level shown below. */
    .lv-cards { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .lv-cards.three { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    /* Consultancy: the payment schedule, the level switch and the level's total. */
    .schedule .sched-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .schedule .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-weight: 600; margin: 0; }
    .schedule .toggle-card .form-check-input { float: none; flex: none; margin: 3px 0 0; }
    .schedule .toggle-card small { display: block; color: #5f6f70; font-size: 12px; font-weight: 400; }
    .sched-date { margin-top: 12px; max-width: 320px; }
    .sched-date .form-label { display: block; margin-bottom: 4px; }
    .hh-level { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
    .hh-total { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 6px 12px; margin: -4px 0 16px; padding: 10px 14px; border-radius: 10px;
      background: #f4f8f8; font-size: 14px; color: #23474a; }
    .hh-total b { color: #1e7a3c; }
    .zed-chip.chip-off { background: #f1f1f1; color: #5f6f70; }
    .add-fees .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; cursor: pointer; font-weight: 600; }
    .add-fees .toggle-card .form-check-input { float: none; flex: none; margin: 3px 0 0; }
    .add-fees .toggle-card small { display: block; color: #5f6f70; font-size: 12px; font-weight: 400; }
    .add-note { margin: 12px 0 0; padding: 8px 12px; border-radius: 8px; background: #f4f8f8; font-size: 13px; color: #5f6f70; }
    .lv-card { display: flex; flex-direction: column; gap: 4px; text-align: left; background: #fff; border: 1px solid #dfe9ea; border-radius: 12px;
      padding: 12px 16px; cursor: pointer; min-width: 0; color: #232527; border-top: 4px solid #cbd9da; }
    .lv-card:hover { border-color: #45a5ad; background: #f7fbfb; }
    .lv-card.active { border-color: #45a5ad; border-top-color: #2f7c83; background: #eef6f6; box-shadow: 0 2px 10px rgba(16, 61, 64, 0.1); }
    .lv-card.is-unset { background: #fafcfc; }
    .lv-name { font-weight: 700; color: #23474a; font-size: 15px; }
    .lv-fee { font-size: 22px; font-weight: 700; color: #23474a; line-height: 1.2; font-variant-numeric: tabular-nums; }
    .lv-fee small { font-size: 12px; font-weight: 600; color: #5f6f70; }
    .lv-line { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; color: #5f6f70; }
    .lv-line b { color: #23474a; font-variant-numeric: tabular-nums; white-space: nowrap; }
    .lv-pays b { color: #1e7a3c; }
    .lv-reward { align-self: flex-start; margin-top: 2px; font-size: 12px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: #f1f0fb; color: #3f3a7a; }
    .lv-none { font-size: 13px; color: #5f6f70; }

    .zed-card { margin-bottom: 16px; }
    .zed-card .zed-chip { margin: 0; }
    .fs-h { font-weight: 700; color: #23474a; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .fs-rates { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px 16px; align-items: start; }
    .fs-rates .form-label, .fs-share-grid .form-label { display: block; margin-bottom: 4px; }
    .rate-tiles { display: flex; gap: 8px; }
    .rate { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; padding: 6px 4px; border-radius: 8px; background: #f6f9f9;
      border: 1px solid #dfe9ea; font-size: 12px; color: #5f6f70; white-space: nowrap; }
    .rate b { font-size: 16px; color: #23474a; }
    .fs-fixed { background: #f6f9f9; font-weight: 600; }
    .fs-fixed:focus { box-shadow: none; }

    .save-bar { display: flex; align-items: center; gap: 8px; margin-top: 16px; font-size: 14px; padding: 10px 14px; background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; }
    .save-bar.is-dirty { position: sticky; bottom: 0; z-index: 5; border-color: #e9c46a; background: #fffcf2; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .unsaved { font-weight: 600; color: #8a6100; }

    .fs-table td, .fs-table th { vertical-align: middle; white-space: nowrap; font-variant-numeric: tabular-nums; }
    .fs-table td.fs-cat { white-space: normal; overflow-wrap: anywhere; min-width: 180px; }
    .fs-table tbody tr:hover td { background-color: #f7fbfb; }
    .fs-table td.col-pay, .fs-table td.col-net { background-color: #eaf6ee; color: #1e7a3c; }
    .fs-table tbody tr:hover td.col-pay, .fs-table tbody tr:hover td.col-net { background-color: #dff0e5; }
    .cat-chip { display: inline-block; min-width: 52px; text-align: center; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 700;
      background: #eef6f6; color: #2f7c83; white-space: nowrap; }
    .cat-chip.cat-1 { background: #f1f0fb; color: #3f3a7a; }
    .cat-chip.cat-2 { background: #fff4d6; color: #8a6100; }
    .cat-chip.cat-region { background: #eaf6ee; color: #1e7a3c; }
    .reward-note { color: #3f3a7a; font-weight: 600; }
    .fs-share { color: #2f7c83; }

    /* The share pop-up: the fields, and a preview beside them. */
    .modal > .modal-dialog.modal-lg.fs-dialog { max-width: 880px; width: calc(100% - 32px); margin-left: auto; margin-right: auto; }
    .fs-edit { display: grid; grid-template-columns: minmax(0, 1fr) 290px; gap: 20px; align-items: start; }
    .fs-group { font-size: 13px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
    .fs-share-grid { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; align-items: start; }
    .modal .fs-dialog label.toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px;
      margin: 0; cursor: pointer; font-weight: 600; }
    .toggle-card.active { border-color: #45a5ad; background: #f4fafa; }
    .toggle-card .form-check-input { float: none; flex: none; margin: 3px 0 0; }
    .toggle-card small { display: block; color: #5f6f70; font-size: 12px; font-weight: 400; }
    .fs-preview { background: #f4f8f8; border-radius: 12px; padding: 14px; }
    .fs-preview h6 { font-size: 13px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 10px; }
    .pv-bar { display: flex; height: 10px; border-radius: 5px; overflow: hidden; background: #dfe9ea; }
    .pv-bar span { display: block; height: 100%; }
    .pv-goi { background: #45a5ad; }
    .pv-msme { background: #2e9e5b; }
    .pv-legend { display: flex; justify-content: space-between; gap: 8px; font-size: 12px; color: #5f6f70; margin: 6px 0 10px; }
    .pv-legend i { display: inline-block; width: 8px; height: 8px; border-radius: 4px; margin-right: 5px; }
    .pv-numbers { display: grid; grid-template-columns: minmax(0, 1fr) max-content; gap: 5px 10px; margin: 0; font-size: 13px; }
    .pv-numbers dt { color: #5f6f70; font-weight: 600; }
    .pv-numbers dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; color: #232527; }
    .pv-numbers .pv-pays { color: #1e7a3c; font-weight: 700; border-top: 1px solid #dfe9ea; padding-top: 5px; }
    .pv-warn { color: #a8303a; background: #fdeef0; border-radius: 8px; padding: 8px 10px; font-size: 13px; margin: 0; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 991.98px) {
      .lv-cards, .lv-cards.three { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 767.98px) {
      .schedule .sched-options { grid-template-columns: minmax(0, 1fr); }
      .fs-edit { grid-template-columns: minmax(0, 1fr); }
      .fs-share-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .lv-card { padding: 10px 12px; }
      .lv-fee { font-size: 18px; }
      .lv-line { font-size: 12px; }
      .lv-reward { font-size: 11px; white-space: nowrap; }
      /* Phones: a card per row. */
      .fs-table thead { display: none; }
      .fs-table, .fs-table tbody, .fs-table tr, .fs-table td { display: block; width: 100%; box-sizing: border-box; }
      .fs-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 8px 12px; }
      .fs-table tr.empty-row { border: 0; padding: 0; }
      .fs-table td { border: 0; padding: 4px 0; white-space: normal; }
      .fs-table td[data-label] { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; }
      .fs-table td[data-label]::before { content: attr(data-label); font-size: 12px; font-weight: 600; color: #5f6f70; text-align: left; }
      .fs-table td.fs-cat { min-width: 0; padding-bottom: 6px; }
      .fs-table td.col-pay, .fs-table td.col-net { border-radius: 6px; padding: 4px 6px; margin: 2px 0; }
      .fs-table td.fs-actions { text-align: left !important; }
      .fs-table td.fs-actions:empty { display: none; }
    }
  `,
})
export class FeeStructurePage {
  /** The portal whose fees these are (the switch on main; the build's own elsewhere). */
  private readonly portal = inject(AdminPortalService).effective();
  /** Consultancy: the handholding fee per milestone; "level" below is then the milestone. */
  protected readonly consultancy = this.portal === 'consultancy';
  private readonly categories = CATEGORIES;
  /** The special categories, in their order (the Add fees form's additional shares). */
  protected readonly specialCategories = CATEGORY_ORDER.filter((id) => id !== 0).map((id) => ({ id, ...CATEGORIES[id] }));
  private readonly api = inject(FeesApi);
  private readonly units: readonly string[] = this.consultancy ? MILESTONES : LEVELS;

  /** Consultancy's fee page offered Micro, Small and Medium only; main also has the Recertification fee. */
  protected readonly types: readonly string[] = this.consultancy ? ENTERPRISE_TYPES.filter((t) => t !== 'Rejected')
    : this.portal === 'main' ? MAIN_ENTERPRISE_TYPES : ENTERPRISE_TYPES;
  protected readonly level = signal<string>(this.consultancy ? '1' : 'Bronze');
  protected readonly type = signal<string>('Micro');
  /** Rejected and Recertification: the full fee, no subsidy, no joining reward. */
  protected readonly rejected = computed(() => isFullFee(this.type()));
  /** Consultancy: the handholding level shown (each has its own milestone fees). */
  protected readonly handholdingLevels = HANDHOLDING_LEVELS;
  protected readonly hhLevel = signal<string>('Silver');
  /** Consultancy: how units pay the three milestones (saved), and the form. */
  protected readonly schedule = signal<PaymentSchedule | null>(null);
  protected sched: ScheduleForm = { payAll: false, from: '' };
  protected readonly schedChanged = signal(false);
  protected readonly today = FeeStructurePage.isoDate(new Date());
  private readonly levelFees = signal<LevelFee[]>([]);
  private readonly rows = signal<FeeRow[]>([]);
  /** The fee and joining reward of the level shown (Consultancy: of the handholding level's milestone), or null when there are no rows for it. */
  protected readonly fee = computed(() => this.levelFees().find((l) => l.certification === this.level()
    && (!this.consultancy || (l.level ?? '').toLowerCase() === this.hhLevel().toLowerCase())) ?? null);
  protected feeInput: number | null = null;
  protected rewardInput: number | null = null;
  protected readonly feeChanged = signal(false);

  /** One card per level (milestone), with the saved amounts of the type's General unit (no joining reward). */
  protected readonly summary = computed<LevelSummary[]>(() =>
    this.units.map((code) => {
      const f = this.levelFees().find((l) => l.certification === code
        && (!this.consultancy || (l.level ?? '').toLowerCase() === this.hhLevel().toLowerCase()));
      const general = this.rows().find((r) => this.inUnit(r, code) && (r.specialCategory ?? 0) === 0 && !r.isCouponRow);
      return {
        code, set: !!f, fee: f?.assessmentFee ?? null, reward: f?.hasCouponRows && !this.rejected() ? f.coupon : null,
        subsidy: general?.subsidyPercentage ?? null, msmePays: general?.applicantContributionAfterSubsidy ?? null,
      };
    }),
  );

  protected readonly structure = computed<StructureRow[]>(() => {
    const of = this.rows().filter((r) => this.inUnit(r, this.level()));
    // Each level against its own General row (Consultancy: Silver and Gold of the milestone).
    const baseOf = (level: string) => {
      const mine = of.filter((r) => r.certification === level);
      const general = mine.find((r) => (r.specialCategory ?? 0) === 0 && !r.isCouponRow) ?? mine.find((r) => (r.specialCategory ?? 0) === 0);
      return general?.subsidyPercentage ?? 0;
    };
    const levelOrder = (l: string) => HANDHOLDING_LEVELS.indexOf(l);
    return of
      .map((row) => {
        const base = baseOf(row.certification);
        const category = row.specialCategory ?? 0;
        const c = this.categories[category] ?? { code: `CAT ${category}`, name: `Special category ${category}` };
        const share = row.subsidyPercentage ?? 0;
        const taxableBase = row.isCouponRow ? (row.assessmentFeeAfterCoupon ?? 0) : (row.assessmentFee ?? 0);
        return { row, category, code: c.code, name: c.name, share, additional: category === 0 ? 0 : share - base, goiShare: taxableBase - (row.subsidyPer ?? 0) };
      })
      .sort((a, b) => levelOrder(a.row.certification) - levelOrder(b.row.certification) || categoryRank(a.category) - categoryRank(b.category)
        || Number(a.row.isCouponRow) - Number(b.row.isCouponRow) || a.row.id - b.row.id);
  });

  /** Consultancy: the "pay all at milestone 1" rows of the handholding level, shown on milestone 1 (what it then charges). */
  protected readonly payAllRows = computed<StructureRow[]>(() => {
    if (!this.consultancy || this.level() !== '1') return [];
    return this.rows()
      .filter((r) => r.payAllAtMilestone1 && String(r.mileStone ?? '').trim() === '1' && r.certification?.toLowerCase() === this.hhLevel().toLowerCase())
      .map((row) => {
        const category = row.specialCategory ?? 0;
        const c = this.categories[category] ?? { code: `CAT ${category}`, name: `Special category ${category}` };
        return { row, category, code: c.code, name: c.name, share: row.subsidyPercentage ?? 0, additional: 0, goiShare: (row.assessmentFee ?? 0) - (row.subsidyPer ?? 0) };
      })
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.row.id - b.row.id);
  });

  /** Consultancy: the three milestones of the handholding level for a General unit (null unless all three have fees). */
  protected readonly levelTotal = computed<{ fee: number; pays: number } | null>(() => {
    if (!this.consultancy) return null;
    const general = MILESTONES.map((m) => this.rows().find((r) => this.inUnit(r, m) && (r.specialCategory ?? 0) === 0 && !r.isCouponRow));
    if (general.some((r) => !r)) return null;
    return {
      fee: general.reduce((t, r) => t + (r!.assessmentFee ?? 0), 0),
      pays: general.reduce((t, r) => t + (r!.applicantContributionAfterSubsidy ?? 0), 0),
    };
  });

  /** Consultancy: the other handholding level, and whether it has no fees for the milestone either (Add fees can make both). */
  protected readonly otherLevel = computed(() => HANDHOLDING_LEVELS.find((l) => l !== this.hhLevel()) ?? '');
  protected readonly otherLevelFree = computed(() => this.consultancy
    && !this.levelFees().some((l) => l.certification === this.level() && (l.level ?? '').toLowerCase() === this.otherLevel().toLowerCase()));

  /** Add fees: the other types the same fees can go to (not Rejected or Recertification). */
  protected readonly otherTypes = computed(() => this.rejected() ? [] : this.types.filter((t) => t !== this.type() && !isFullFee(t)));
  protected add: AddForm = FeeStructurePage.emptyAdd();

  /** The handholding levels Add fees makes rows for. */
  private addLevels(): string[] {
    return this.add.alsoOtherLevel && this.otherLevelFree() ? [...HANDHOLDING_LEVELS] : [this.hhLevel()];
  }

  /** What Add fees makes, as the server does (AssessmentFeesController.NewRows). */
  protected addNote(): string {
    const levels = this.consultancy ? this.addLevels() : [];
    const name = `${this.type()} ${levels.length ? levels.join(' and ') + ' ' : ''}${this.levelName(this.level())}`;
    if (this.rejected()) return `Creates one row for ${name}: the full fee with GST, no subsidy and no joining reward.`;
    const count = Object.keys(this.categories).length * 2 * Math.max(levels.length, 1);
    return `Creates ${count} rows for ${name}: the ${Object.keys(this.categories).length} subsidy categories, each without and with the joining reward. That's what the payment page reads.`;
  }

  protected readonly editing = signal<ShareEdit | null>(null);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected levelName(code: string): string {
    return this.consultancy ? `Milestone ${code}` : LEVEL_NAMES[code] ?? code;
  }

  /** Whether a row belongs to a level (Consultancy: to a milestone of the handholding level shown; not a pay-all row). */
  private inUnit(r: FeeRow, code: string): boolean {
    return this.consultancy
      ? String(r.mileStone ?? '').trim() === code && r.certification?.toLowerCase() === this.hhLevel().toLowerCase() && !r.payAllAtMilestone1
      : r.certification === code;
  }

  private static emptyAdd(): AddForm {
    return { fee: null, reward: null, general: null, additional: {}, alsoOthers: true, alsoOtherLevel: true };
  }

  private static isoDate(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  /** yyyy-MM-dd as dd-MM-yyyy. */
  protected dmy(iso: string | null | undefined): string {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '');
    return m ? `${m[3]}-${m[2]}-${m[1]}` : '';
  }

  protected pickHhLevel(level: string): void {
    this.hhLevel.set(level);
    this.success.set('');
    this.add = FeeStructurePage.emptyAdd();
    this.resetInputs();
  }

  /** Consultancy: milestone by milestone, or all three at milestone 1 from the date (Micro, Small and Medium alike). */
  protected async saveSchedule(): Promise<void> {
    if (this.sched.payAll && !this.sched.from) {
      this.error.set('Please enter the date from which units pay all three milestones at milestone 1.');
      return;
    }
    await this.run(() => this.api.saveSchedule(this.sched.payAll, this.sched.payAll ? this.sched.from : null));
  }

  protected async addFees(): Promise<void> {
    const a = this.add;
    if (a.fee === null || a.fee === undefined || (!this.rejected() && (a.general === null || a.general === undefined))) {
      this.error.set(this.rejected() ? 'Please enter the fee.' : 'Please enter the fee and the General subsidy.');
      return;
    }
    await this.run(() => this.api.add(this.type(), {
      certification: this.level(), assessmentFee: a.fee, reward: this.rejected() ? null : (a.reward ?? 0), generalShare: this.rejected() ? null : a.general,
      additionalShares: this.rejected() ? {} : a.additional, alsoTypes: a.alsoOthers ? this.otherTypes() : [],
      ...(this.consultancy ? { levels: this.addLevels() } : {}),
    }));
  }

  protected pickLevel(level: string): void {
    this.level.set(level);
    this.success.set('');
    this.add = FeeStructurePage.emptyAdd();
    this.resetInputs();
  }

  protected pickType(type: string): void {
    this.type.set(type);
    this.success.set('');
    this.add = FeeStructurePage.emptyAdd();
    void this.load();
  }

  protected edit(s: StructureRow): void {
    const base = s.category === 0 ? s.share : s.share - s.additional;
    this.error.set('');
    this.success.set('');
    this.editing.set({ category: s.category, code: s.code, name: s.name, base, additional: s.additional, allLevels: true });
  }

  /** The pop-up's preview on the saved fee of the level (the server's rule: GoI share off the fee, GST and TDS on the rest). */
  protected sharePreview(e: ShareEdit): SharePreview | null {
    const fee = this.fee()?.assessmentFee;
    if (fee === null || fee === undefined) return null;
    const pct = (e.base ?? 0) + (e.additional ?? 0);
    const goi = (fee * pct) / 100;
    const taxable = fee - goi;
    const gst = taxable * 0.18;
    return { fee, pct, outOfRange: pct < 0 || pct > 100, goi, taxable, gst, pays: taxable + gst, tds194c: taxable * 0.02, tds194j: taxable * 0.1 };
  }

  protected async saveFee(): Promise<void> {
    const f = this.fee();
    if (!f) return;
    const reward = f.hasCouponRows && !this.rejected() && !this.consultancy;
    if (this.feeInput === null || this.feeInput === undefined || (reward && (this.rewardInput === null || this.rewardInput === undefined))) {
      this.error.set('Please enter the fee and the joining reward.');
      return;
    }
    // Consultancy keeps the stored joining reward (its milestone fee only).
    await this.run(() => this.api.save(this.type(), [{
      certification: f.certification, assessmentFee: this.feeInput, coupon: reward && !this.consultancy ? this.rewardInput : null,
      ...(this.consultancy ? { level: this.hhLevel() } : {}),
    }]));
  }

  protected async saveShare(e: ShareEdit): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.api.saveSubsidy(this.type(), {
        certification: this.level(), category: e.category, allLevels: e.allLevels,
        baseShare: e.category === 0 ? e.base : null, additionalShare: e.category === 0 ? null : e.additional,
        ...(this.consultancy ? { level: this.hhLevel() } : {}),
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
      this.schedule.set(res.schedule ?? null);
      this.sched = { payAll: !!res.schedule?.payAllAtMilestone1, from: res.schedule?.from ?? '' };
      this.schedChanged.set(false);
      if (!res.levels.some((l) => l.certification === this.level()) && res.levels.length && this.units.includes(res.levels[0].certification)) {
        this.level.set(res.levels[0].certification);
      }
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
