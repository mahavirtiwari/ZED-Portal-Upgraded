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

/** A level's card at the top: its fee, joining reward, and the General unit's subsidy and payment (server amounts). */
interface LevelSummary {
  code: string;
  set: boolean;
  fee: number | null;
  reward: number | null;
  subsidy: number | null;
  msmePays: number | null;
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
 * total before the subsidy). Consultancy keeps its fee per milestone (assessment-fees.ts). V4 layout: the enterprise type
 * as a segmented switch, a card per level (fee, General subsidy, what the MSME pays) that picks the level, category chips,
 * the MSME share and net payable columns highlighted, a card per row on phones, and the share pop-up with a preview of
 * the amounts beside the fields.
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
      <div class="page-actions fs-type">
        <span class="fs-type-label">Enterprise type</span>
        <div class="seg" role="group" aria-label="Enterprise type">
          @for (t of types; track t) {
            <button type="button" [class.active]="type() === t" [attr.aria-pressed]="type() === t" (click)="pickType(t)">{{ t }}</button>
          }
        </div>
      </div>
    </div>

    <nav class="lv-cards" aria-label="Certification level">
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

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (fee(); as f) {
      <section class="zed-card" aria-labelledby="fs-rates">
        <h5 class="fs-h" id="fs-rates">Certification Fee &amp; Rates <span class="zed-chip">{{ levelName(level()) }}</span><span class="zed-chip">{{ type() }}</span></h5>
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
                  <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1" [class.cat-2]="s.category >= 2">{{ s.code }}</span></td>
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
                <tr class="empty-row"><td colspan="8" style="padding: 0"><div class="no-data">No fee rows for {{ type() }} {{ levelName(level()) }}.</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

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
                  <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1" [class.cat-2]="s.category >= 2">{{ s.code }}</span></td>
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
      <div class="zed-card"><div class="no-data">No fees are set for {{ type() }} {{ levelName(level()) }}. Pick another level or enterprise type.</div></div>
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
                    <span>Apply to Bronze, Silver and Gold
                      <small>{{ e.allLevels ? 'The three levels get the same share.' : 'Only ' + levelName(level()) + ' changes.' }}</small></span>
                  </label>
                </div>
                @if (sharePreview(e); as p) {
                  <aside class="fs-preview" aria-label="Preview">
                    <h6>Preview · {{ levelName(level()) }}, {{ type() }}</h6>
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
      .lv-cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 767.98px) {
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
  private readonly api = inject(FeesApi);

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

  /** One card per level, with the saved amounts of the type's General unit (no joining reward). */
  protected readonly summary = computed<LevelSummary[]>(() =>
    LEVELS.map((code) => {
      const f = this.levelFees().find((l) => l.certification === code);
      const general = this.rows().find((r) => r.certification === code && (r.specialCategory ?? 0) === 0 && !r.isCouponRow);
      return {
        code, set: !!f, fee: f?.assessmentFee ?? null, reward: f?.hasCouponRows && !this.rejected() ? f.coupon : null,
        subsidy: general?.subsidyPercentage ?? null, msmePays: general?.applicantContributionAfterSubsidy ?? null,
      };
    }),
  );

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
