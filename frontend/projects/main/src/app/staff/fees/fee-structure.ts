import { DecimalPipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { AdminPortalService, PortalSwitchComponent } from '../admin-portal';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ActivatedRoute } from '@angular/router';
import { HANDHOLDING_LEVEL_CODES, levelCodes, levelName } from '../../msme/shared/levels';
import { ENTERPRISE_TYPES, FeeRow, FeeSet, FeesApi, LevelFee, OffCategory, MAIN_ENTERPRISE_TYPES, PaymentSchedule, isFullFee } from './fees.api';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

/** Consultancy's handholding milestones (AssessmentFee.MileStone); one fee each per handholding level. */
const MILESTONES = ['1', '2', '3'] as const;
const HANDHOLDING_LEVELS: readonly string[] = HANDHOLDING_LEVEL_CODES;

/**
 * AssessmentFee.SpecialCategory, the same on the three portals (migration 0041): the payment charges a unit the category it
 * fits with the highest subsidy; the regions come from Admin → Master → Subsidy Regions.
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
/** A category's name as shown (the code stays; the wording can be changed by the Admin). */
function categoryName(category: number): string {
  switch (category) {
    case 0: return t('staff.feeStructure.category.general', 'General');
    case 1: return t('staff.feeStructure.category.sc', 'SC-owned MSME');
    case 3: return t('staff.feeStructure.category.st', 'ST-owned MSME');
    case 2: return t('staff.feeStructure.category.woman', 'Woman-owned MSME');
    case 4: return t('staff.feeStructure.category.aspirational', 'Aspirational district');
    case 5: return t('staff.feeStructure.category.lwe', 'LWE district');
    case 6: return t('staff.feeStructure.category.himalayan', 'Himalayan region');
    case 7: return t('staff.feeStructure.category.island', 'Island territory');
    case 8: return t('staff.feeStructure.category.ner', 'North Eastern Region');
    default: return t('staff.feeStructure.category.other', 'Special category {number}', { number: category });
  }
}
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
 * Admin → Master → Payments, Main and Surveillance (V4, as the LEAN portal's Fee Structure): per level and enterprise
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
  imports: [FormsModule, DecimalPipe, PortalSwitchComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ heading() }}</h3>
        <p class="page-sub">{{ sub() }}</p>
      </div>
      <div class="page-actions fs-type">
        <span class="fs-type-label">{{ 'Enterprise type' | t: 'staff.feeStructure.type.label' }}</span>
        <div class="seg" role="group" [attr.aria-label]="'Enterprise type' | t: 'staff.feeStructure.type.aria'">
          @for (t of types; track t) {
            <button type="button" [class.active]="type() === t" [attr.aria-pressed]="type() === t" (click)="pickType(t)">{{ t }}</button>
          }
        </div>
      </div>
    </div>
    <!-- One Admin (V4): the portal whose settings these are (each portal has its own fees). -->
    <zed-portal-switch />

    <!-- 2026-11-23 (the user: "put the new fees effect from date ... keep date range"): the fees as dated fee sets, as
         Expenditure rates keeps its rate sets. Every fee below belongs to the set chosen here. -->
    <section class="zed-card fs-sets" aria-labelledby="fs-sets-label" data-fee-sets>
      <div class="fs-sets-row">
        <label class="fs-type-label" id="fs-sets-label" for="fs-set">{{ 'Date of effect' | t: 'staff.feeStructure.sets.label' }}</label>
        <select class="form-select fs-set-select" id="fs-set" [ngModel]="setPick()" (ngModelChange)="chooseSet($event)" [disabled]="busy()">
          @for (s of sets(); track s.key) { <option [value]="s.key">{{ setLabel(s) }}</option> }
          <option value="new">{{ '+ New fee set' | t: 'staff.feeStructure.sets.newOption' }}</option>
        </select>
        @if (newSet()) {
          <input type="date" class="form-control fs-set-date" id="fs-set-from" [min]="today" [(ngModel)]="newSetFrom"
                 [attr.aria-label]="'Date of effect of the new fee set' | t: 'staff.feeStructure.sets.dateAria'" />
          <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="addSet()">{{ 'Add Fee Set' | t: 'staff.feeStructure.sets.addButton' }}</button>
          <button type="button" class="btn btn-outline-secondary" [disabled]="busy()" (click)="cancelNewSet()">{{ 'Cancel' | t: 'staff.feeStructure.sets.cancelButton' }}</button>
        } @else if (shownSet()?.status === 'future') {
          <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="deleteSet()">{{ 'Delete Fee Set' | t: 'staff.feeStructure.sets.deleteButton' }}</button>
        }
      </div>
      <p class="muted fs-sets-note" data-set-note>{{ setNote() }}</p>
      @if (upcoming(); as u) {
        <p class="fs-upcoming" data-upcoming>{{ 'New fees from {date}: choose that date above to see or change them.' | t: 'staff.feeStructure.sets.upcoming' : { date: dmy(u.from) } }}</p>
      }
    </section>

    @if (consultancy && loaded()) {
      <section class="zed-card schedule" aria-labelledby="fs-schedule">
        <h5 class="fs-h" id="fs-schedule">{{ 'Payment schedule' | t: 'staff.feeStructure.schedule.title' }}
          <span class="zed-chip">{{ schedule()?.payAllAtMilestone1 ? ('All at milestone 1 from {date}' | t: 'staff.feeStructure.schedule.chip.payAll' : { date: dmy(schedule()?.from) }) : ('Milestone by milestone' | t: 'staff.feeStructure.schedule.chip.each') }}</span>
        </h5>
        <p class="muted">{{ 'The same for Micro, Small and Medium. Units that have already paid milestone 1 keep their schedule.' | t: 'staff.feeStructure.schedule.note' }}</p>
        <div class="sched-options" role="radiogroup" [attr.aria-label]="'Payment schedule' | t: 'staff.feeStructure.schedule.aria'">
          <label class="toggle-card" [class.active]="!sched.payAll" for="fs-sched-each">
            <input class="form-check-input" type="radio" name="fs-sched" id="fs-sched-each" [value]="false" [(ngModel)]="sched.payAll" (ngModelChange)="schedChanged.set(true)" />
            <span>{{ 'Pay at each milestone' | t: 'staff.feeStructure.schedule.each.label' }}<small>{{ 'Milestones 1, 2 and 3 are paid one by one, each after the previous one is accepted.' | t: 'staff.feeStructure.schedule.each.note' }}</small></span>
          </label>
          <label class="toggle-card" [class.active]="sched.payAll" for="fs-sched-all">
            <input class="form-check-input" type="radio" name="fs-sched" id="fs-sched-all" [value]="true" [(ngModel)]="sched.payAll" (ngModelChange)="schedChanged.set(true)" />
            <span>{{ 'Pay all at milestone 1' | t: 'staff.feeStructure.schedule.payAll.label' }}<small>{{ "Milestone 1 charges the three milestones' fees together; milestones 2 and 3 open with nothing to pay." | t: 'staff.feeStructure.schedule.payAll.note' }}</small></span>
          </label>
        </div>
        @if (sched.payAll) {
          <div class="sched-date">
            <label class="form-label" for="fs-sched-from">{{ 'For units whose milestone 1 is paid from' | t: 'staff.feeStructure.schedule.from.label' }}<span class="req">*</span></label>
            <input class="form-control" id="fs-sched-from" type="date" [min]="today" [(ngModel)]="sched.from" (ngModelChange)="schedChanged.set(true)" />
          </div>
        }
        <div class="save-bar" [class.is-dirty]="schedChanged()">
          @if (schedChanged()) { <span class="unsaved me-auto">{{ 'Not saved yet.' | t: 'staff.feeStructure.schedule.unsaved.note' }}</span> } @else { <span class="muted me-auto">{{ 'No unsaved changes.' | t: 'staff.feeStructure.schedule.saved.note' }}</span> }
          <button type="button" class="btn btn-primary" [disabled]="busy() || !schedChanged() || readOnly()" (click)="saveSchedule()">{{ 'Save Schedule' | t: 'staff.feeStructure.schedule.saveButton' }}</button>
        </div>
      </section>

      <div class="hh-level">
        <span class="fs-type-label">{{ 'Handholding level' | t: 'staff.feeStructure.hhLevel.label' }}</span>
        <div class="seg" role="group" [attr.aria-label]="'Handholding level' | t: 'staff.feeStructure.hhLevel.aria'">
          @for (l of handholdingLevels; track l) {
            <button type="button" [class.active]="hhLevel() === l" [attr.aria-pressed]="hhLevel() === l" (click)="pickHhLevel(l)">{{ hhName(l) }}</button>
          }
        </div>
        <span class="muted">{{ 'Silver and Gold have their own fee for each milestone.' | t: 'staff.feeStructure.hhLevel.note' }}</span>
      </div>
    }

    <nav class="lv-cards" [class.three]="consultancy" [attr.aria-label]="consultancy ? ('Milestone' | t: 'staff.feeStructure.cards.milestoneAria') : ('Certification level' | t: 'staff.feeStructure.cards.levelAria')">
      @for (c of summary(); track c.code) {
        <button type="button" class="lv-card" [class.active]="level() === c.code" [class.is-unset]="!c.set" [attr.aria-pressed]="level() === c.code"
                [attr.data-level]="c.code" (click)="pickLevel(c.code)">
          <span class="lv-name">{{ levelName(c.code) }}</span>
          @if (c.set) {
            <span class="lv-fee">₹ {{ c.fee | number: '1.0-2' }} <small>{{ '+ GST' | t: 'staff.feeStructure.card.gst' }}</small></span>
            <span class="lv-line"><span>{{ 'Subsidy (General)' | t: 'staff.feeStructure.card.subsidy' }}</span><b>{{ (c.subsidy ?? 0) | number: '1.0-2' }}%</b></span>
            <span class="lv-line lv-pays"><span>{{ 'MSME pays' | t: 'staff.feeStructure.card.pays' }}</span><b>{{ c.msmePays === null ? '—' : '₹ ' + (c.msmePays | number: '1.2-2') }}</b></span>
            @if (c.reward !== null) { <span class="lv-reward">{{ 'Joining reward ₹ {amount}' | t: 'staff.feeStructure.card.reward' : { amount: (c.reward | number: '1.0-2') } }}</span> }
          } @else {
            <span class="lv-none">{{ 'No fee set for {type}' | t: 'staff.feeStructure.card.none' : { type: type() } }}</span>
          }
        </button>
      }
    </nav>
    @if (consultancy && levelTotal(); as t) {
      <div class="hh-total" data-testid="hh-total">
        <span>{{ '{level} handholding, all three milestones (General)' | t: 'staff.feeStructure.total.label' : { level: hhName(hhLevel()) } }}</span>
        <span>{{ '₹ {fee} + GST' | t: 'staff.feeStructure.total.fee' : { fee: (t.fee | number: '1.0-2') } }} · <b>{{ 'MSME pays ₹ {amount}' | t: 'staff.feeStructure.total.pays' : { amount: (t.pays | number: '1.2-2') } }}</b>@if (schedule()?.payAllAtMilestone1) { <small> {{ 'at milestone 1' | t: 'staff.feeStructure.total.atMilestone1' }}</small> }</span>
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
        <h5 class="fs-h" id="fs-rates">{{ consultancy ? ('Handholding Fee & Rates' | t: 'staff.feeStructure.rates.handholdingTitle') : ('Certification Fee & Rates' | t: 'staff.feeStructure.rates.title') }} <span class="zed-chip">{{ levelName(level()) }}</span><span class="zed-chip">{{ type() }}</span></h5>
        <p class="muted">{{ rateNote() }}</p>
        <div class="fs-rates">
          <div>
            <label class="form-label" for="fs-fee">{{ 'Fee (before GST)' | t: 'staff.feeStructure.rates.fee.label' }}<span class="req">*</span></label>
            <input class="form-control" id="fs-fee" type="number" min="0" step="0.01" [disabled]="readOnly()" [(ngModel)]="feeInput" (ngModelChange)="feeChanged.set(true)" />
            <small class="muted">{{ 'With GST: ₹ {amount}' | t: 'staff.feeStructure.rates.withGst' : { amount: ((feeInput ?? 0) * 1.18 | number: '1.2-2') } }}</small>
          </div>
          @if (f.hasCouponRows && !rejected() && !consultancy) {
            <div>
              <label class="form-label" for="fs-reward">{{ 'Joining reward (₹)' | t: 'staff.feeStructure.rates.reward.label' }}<span class="req">*</span></label>
              <input class="form-control" id="fs-reward" type="number" min="0" step="0.01" [disabled]="readOnly()" [(ngModel)]="rewardInput" (ngModelChange)="feeChanged.set(true)" />
              <small class="muted">{{ 'Comes off the total with GST for units that get it.' | t: 'staff.feeStructure.rates.reward.note' }}</small>
            </div>
          }
          <div>
            <span class="form-label d-block">{{ 'Fixed rates' | t: 'staff.feeStructure.rates.fixed.label' }}</span>
            <div class="rate-tiles">
              <span class="rate"><b>18%</b>{{ 'GST' | t: 'staff.feeStructure.rates.gst.label' }}</span>
              <span class="rate"><b>2%</b>{{ 'TDS 194C' | t: 'staff.feeStructure.rates.tds194c.label' }}</span>
              <span class="rate"><b>10%</b>{{ 'TDS 194J' | t: 'staff.feeStructure.rates.tds194j.label' }}</span>
            </div>
          </div>
        </div>
        <div class="save-bar" [class.is-dirty]="feeChanged()">
          @if (feeChanged()) { <span class="unsaved me-auto">{{ 'Not saved yet.' | t: 'staff.feeStructure.rates.unsaved.note' }}</span> } @else { <span class="muted me-auto">{{ 'No unsaved changes.' | t: 'staff.feeStructure.rates.saved.note' }}</span> }
          <button type="button" class="btn btn-primary" [disabled]="busy() || !feeChanged() || readOnly()" (click)="saveFee()">{{ 'Save Fee' | t: 'staff.feeStructure.rates.saveButton' }}</button>
        </div>
      </section>

      <section class="zed-card" aria-labelledby="fs-structure">
        <h5 class="fs-h" id="fs-structure">{{ 'Payment Structure' | t: 'staff.feeStructure.structure.title' }}</h5>
        <p class="muted">{{ "The Government of India's share is released against the fee and carries no GST. The MSME share includes 18% GST; its taxable value is the base for TDS." | t: 'staff.feeStructure.structure.note' }}</p>
        <div class="table-responsive">
          <table class="table table-zed fs-table">
            <thead>
              <tr>
                <th>{{ 'Code' | t: 'staff.feeStructure.column.code' }}</th><th>{{ 'Category' | t: 'staff.feeStructure.column.category' }}</th><th class="text-end">{{ 'Subsidy' | t: 'staff.feeStructure.column.subsidy' }}</th><th class="text-end">{{ 'GoI share' | t: 'staff.feeStructure.column.goiShare' }}</th><th class="text-end col-pay">{{ 'MSME share' | t: 'staff.feeStructure.column.msmeShare' }}</th>
                <th class="text-end">{{ gstColumn() }}</th><th class="text-end">{{ 'MSME taxable' | t: 'staff.feeStructure.column.taxable' }}</th><th class="fs-actions-h">{{ 'Actions' | t: 'staff.feeStructure.column.actions' }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of structure(); track s.row.id) {
                <tr [class.fs-off]="offOf(s.category)">
                  <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1 || s.category === 3" [class.cat-2]="s.category === 2" [class.cat-region]="s.category >= 4">{{ s.code }}</span></td>
                  <td class="fs-cat">
                    <strong>{{ s.name }}</strong>
                    @if (offOf(s.category); as o) {
                      @if (!s.row.isCouponRow) {
                        <span class="off-badge">{{ 'Off' | t: 'staff.feeStructure.row.off' }}</span>
                        <small class="d-block off-note">{{ o.by ? ('Since {date} by {name} · units pay as their next category' | t: 'staff.feeStructure.row.offBy.note' : { date: dmy(o.on), name: o.by })
                          : ('Since {date} · units pay as their next category' | t: 'staff.feeStructure.row.offSince.note' : { date: dmy(o.on) }) }}@if (o.reason) {<br />“{{ o.reason }}”}</small>
                      }
                    }
                    @if (s.row.isCouponRow) { <small class="d-block reward-note">{{ 'with joining reward ₹ {amount}' | t: 'staff.feeStructure.row.reward' : { amount: (s.row.coupon | number: '1.0-2') } }}</small> }
                  </td>
                  <td class="text-end" [attr.data-label]="'Subsidy' | t: 'staff.feeStructure.column.subsidy'">
                    <span>
                      <strong class="fs-share">{{ s.share | number: '1.0-2' }}%</strong>
                      @if (s.additional) { <small class="d-block muted">{{ '{base}% base + {additional}% additional' | t: 'staff.feeStructure.row.shareSplit' : { base: (s.share - s.additional | number: '1.0-2'), additional: (s.additional | number: '1.0-2') } }}</small> }
                    </span>
                  </td>
                  <td class="text-end" [attr.data-label]="'GoI share' | t: 'staff.feeStructure.column.goiShare'">₹ {{ s.goiShare | number: '1.2-2' }}</td>
                  <td class="text-end col-pay" [attr.data-label]="'MSME share' | t: 'staff.feeStructure.column.msmeShare'"><strong>₹ {{ s.row.applicantContributionAfterSubsidy | number: '1.2-2' }}</strong></td>
                  <td class="text-end" [attr.data-label]="gstColumn()">₹ {{ s.row.gstAfterSubsidy | number: '1.2-2' }}</td>
                  <td class="text-end" [attr.data-label]="'MSME taxable' | t: 'staff.feeStructure.column.taxable'"><strong>₹ {{ s.row.subsidyPer | number: '1.2-2' }}</strong></td>
                  <td class="fs-actions">
                    @if (!rejected() && !s.row.isCouponRow && !readOnly()) {
                      <!-- Left-aligned: Edit stays at the same place on every row, with or without Disable / Enable. -->
                      <div class="row-actions justify-content-start">
                        <button type="button" class="btn btn-sm btn-outline-primary" [attr.aria-label]="'Edit the subsidy of {name}' | t: 'staff.feeStructure.row.editAria' : { name: s.name }" (click)="edit(s)">{{ 'Edit' | t: 'staff.feeStructure.row.editButton' }}</button>
                        @if (switchReady() && s.category !== 0) {
                          @if (offOf(s.category)) {
                            <button type="button" class="btn btn-sm btn-primary" [disabled]="busy()" [attr.aria-label]="'Enable the {name} subsidy' | t: 'staff.feeStructure.row.enableAria' : { name: s.name }" (click)="enableSubsidy(s)">{{ 'Enable' | t: 'staff.feeStructure.row.enableButton' }}</button>
                          } @else {
                            <button type="button" class="btn btn-sm btn-outline-danger" [attr.aria-label]="'Disable the {name} subsidy' | t: 'staff.feeStructure.row.disableAria' : { name: s.name }" (click)="openDisable(s)">{{ 'Disable' | t: 'staff.feeStructure.row.disableButton' }}</button>
                          }
                        }
                      </div>
                    }
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="8" style="padding: 0"><div class="no-data">{{ consultancy ? ('No fee rows for {type} {level} {milestone}.' | t: 'staff.feeStructure.structure.handholdingEmpty' : { type: type(), level: hhName(hhLevel()), milestone: levelName(level()) })
                  : ('No fee rows for {type} {level}.' | t: 'staff.feeStructure.structure.empty' : { type: type(), level: levelName(level()) }) }}</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>

      @if (payAllRows().length) {
        <section class="zed-card" aria-labelledby="fs-payall">
          <h5 class="fs-h" id="fs-payall">{{ 'All three milestones at milestone 1' | t: 'staff.feeStructure.payAll.title' }} <span class="zed-chip">{{ hhName(hhLevel()) }}</span><span class="zed-chip">{{ type() }}</span>
            <span class="zed-chip" [class.chip-off]="!schedule()?.payAllAtMilestone1">{{ schedule()?.payAllAtMilestone1 ? ('From {date}' | t: 'staff.feeStructure.payAll.chip.from' : { date: dmy(schedule()?.from) }) : ('Schedule off' | t: 'staff.feeStructure.payAll.chip.off') }}</span></h5>
          <p class="muted">{{ "What milestone 1 charges a unit paying all three milestones at once: the three milestones' amounts added up. Its milestones 2 and 3 then have nothing to pay. Worked out from the fees above." | t: 'staff.feeStructure.payAll.note' }}</p>
          <div class="table-responsive">
            <table class="table table-zed fs-table">
              <thead>
                <tr><th>{{ 'Code' | t: 'staff.feeStructure.column.code' }}</th><th>{{ 'Category' | t: 'staff.feeStructure.column.category' }}</th><th class="text-end">{{ 'Fee' | t: 'staff.feeStructure.column.fee' }}</th><th class="text-end col-pay">{{ 'MSME share' | t: 'staff.feeStructure.column.msmeShare' }}</th><th class="text-end">{{ gstColumn() }}</th>
                  <th class="text-end col-net">{{ 'Net after 194C' | t: 'staff.feeStructure.column.net194c' }}</th><th class="text-end col-net">{{ 'Net after 194J' | t: 'staff.feeStructure.column.net194j' }}</th></tr>
              </thead>
              <tbody>
                @for (s of payAllRows(); track s.row.id) {
                  <tr>
                    <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1 || s.category === 3" [class.cat-2]="s.category === 2" [class.cat-region]="s.category >= 4">{{ s.code }}</span></td>
                    <td class="fs-cat"><strong>{{ s.name }}</strong></td>
                    <td class="text-end" [attr.data-label]="'Fee' | t: 'staff.feeStructure.column.fee'">₹ {{ s.row.assessmentFee | number: '1.2-2' }}</td>
                    <td class="text-end col-pay" [attr.data-label]="'MSME share' | t: 'staff.feeStructure.column.msmeShare'"><strong>₹ {{ s.row.applicantContributionAfterSubsidy | number: '1.2-2' }}</strong></td>
                    <td class="text-end" [attr.data-label]="gstColumn()">₹ {{ s.row.gstAfterSubsidy | number: '1.2-2' }}</td>
                    <td class="text-end col-net" [attr.data-label]="'Net after 194C' | t: 'staff.feeStructure.column.net194c'"><strong>₹ {{ s.row.netPaybleTds15 | number: '1.2-2' }}</strong></td>
                    <td class="text-end col-net" [attr.data-label]="'Net after 194J' | t: 'staff.feeStructure.column.net194j'"><strong>₹ {{ s.row.netPaybleTds75 | number: '1.2-2' }}</strong></td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </section>
      }

      <section class="zed-card" aria-labelledby="fs-tds">
        <h5 class="fs-h" id="fs-tds">{{ 'TDS Deduction & Net Payable' | t: 'staff.feeStructure.tds.title' }} <span class="zed-chip">194C &#64; 2%</span><span class="zed-chip">194J &#64; 10%</span></h5>
        <p class="muted">{{ 'The net payable is the MSME share with GST less the TDS the unit deducts.' | t: 'staff.feeStructure.tds.note' }}</p>
        <div class="table-responsive">
          <table class="table table-zed fs-table">
            <thead>
              <tr>
                <th>{{ 'Code' | t: 'staff.feeStructure.column.code' }}</th><th>{{ 'Category' | t: 'staff.feeStructure.column.category' }}</th><th class="text-end">{{ 'MSME taxable' | t: 'staff.feeStructure.column.taxable' }}</th><th class="text-end">{{ 'TDS 194C' | t: 'staff.feeStructure.column.tds194c' }}</th><th class="text-end col-net">{{ 'Net after 194C' | t: 'staff.feeStructure.column.net194c' }}</th>
                <th class="text-end">{{ 'TDS 194J' | t: 'staff.feeStructure.column.tds194j' }}</th><th class="text-end col-net">{{ 'Net after 194J' | t: 'staff.feeStructure.column.net194j' }}</th>
              </tr>
            </thead>
            <tbody>
              @for (s of structure(); track s.row.id) {
                <tr>
                  <td class="fs-code"><span class="cat-chip" [class.cat-1]="s.category === 1 || s.category === 3" [class.cat-2]="s.category === 2" [class.cat-region]="s.category >= 4">{{ s.code }}</span></td>
                  <td class="fs-cat">{{ s.name }}@if (s.row.isCouponRow) { <small class="d-block reward-note">{{ 'with joining reward' | t: 'staff.feeStructure.tds.reward' }}</small> }</td>
                  <td class="text-end" [attr.data-label]="'MSME taxable' | t: 'staff.feeStructure.column.taxable'">₹ {{ s.row.subsidyPer | number: '1.2-2' }}</td>
                  <td class="text-end" [attr.data-label]="'TDS 194C' | t: 'staff.feeStructure.column.tds194c'">₹ {{ s.row.tds15 | number: '1.2-2' }}</td>
                  <td class="text-end col-net" [attr.data-label]="'Net after 194C' | t: 'staff.feeStructure.column.net194c'"><strong>₹ {{ s.row.netPaybleTds15 | number: '1.2-2' }}</strong></td>
                  <td class="text-end" [attr.data-label]="'TDS 194J' | t: 'staff.feeStructure.column.tds194j'">₹ {{ s.row.tds75 | number: '1.2-2' }}</td>
                  <td class="text-end col-net" [attr.data-label]="'Net after 194J' | t: 'staff.feeStructure.column.net194j'"><strong>₹ {{ s.row.netPaybleTds75 | number: '1.2-2' }}</strong></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    } @else if (loaded()) {
      <section class="zed-card add-fees" aria-labelledby="fs-add">
        <h5 class="fs-h" id="fs-add">{{ 'Add fees' | t: 'staff.feeStructure.add.title' }} @if (consultancy) { <span class="zed-chip">{{ hhName(hhLevel()) }}</span> }<span class="zed-chip">{{ levelName(level()) }}</span><span class="zed-chip">{{ type() }}</span></h5>
        <p class="muted">{{ addIntro() }}</p>
        <div class="fs-rates">
          <div>
            <label class="form-label" for="fs-add-fee">{{ 'Fee (before GST)' | t: 'staff.feeStructure.add.fee.label' }}<span class="req">*</span></label>
            <input class="form-control" id="fs-add-fee" type="number" min="0" step="0.01" [(ngModel)]="add.fee" />
            <small class="muted">{{ 'With GST: ₹ {amount}' | t: 'staff.feeStructure.add.withGst' : { amount: ((add.fee ?? 0) * 1.18 | number: '1.2-2') } }}</small>
          </div>
          @if (!rejected()) {
            <div>
              <label class="form-label" for="fs-add-reward">{{ 'Joining reward (₹)' | t: 'staff.feeStructure.add.reward.label' }}</label>
              <input class="form-control" id="fs-add-reward" type="number" min="0" step="0.01" [placeholder]="'0 if none' | t: 'staff.feeStructure.add.reward.placeholder'" [(ngModel)]="add.reward" />
              <small class="muted">{{ 'Comes off the total with GST for units that get it.' | t: 'staff.feeStructure.add.reward.note' }}</small>
            </div>
            <div>
              <label class="form-label" for="fs-add-general">{{ 'Subsidy, General (%)' | t: 'staff.feeStructure.add.general.label' }}<span class="req">*</span></label>
              <input class="form-control" id="fs-add-general" type="number" min="0" max="100" step="0.01" [(ngModel)]="add.general" />
            </div>
            @for (c of specialCategories(); track c.id) {
              <div>
                <label class="form-label" [for]="'fs-add-cat-' + c.id">{{ 'Additional subsidy, {code} (%)' | t: 'staff.feeStructure.add.additional.label' : { code: c.code } }}</label>
                <input class="form-control" [id]="'fs-add-cat-' + c.id" type="number" min="0" max="100" step="0.01" [placeholder]="'0 if none' | t: 'staff.feeStructure.add.additional.placeholder'" [(ngModel)]="add.additional[c.id]" />
                <small class="muted">{{ c.name }}</small>
              </div>
            }
          }
        </div>
        @if (consultancy && otherLevelFree()) {
          <label class="toggle-card mt-3" [class.active]="add.alsoOtherLevel" for="fs-add-level">
            <input class="form-check-input" type="checkbox" id="fs-add-level" [(ngModel)]="add.alsoOtherLevel" />
            <span>{{ 'Also add {levels} milestone {number} with the same fee and shares' | t: 'staff.feeStructure.add.otherLevels.label' : { levels: otherLevel(), number: level() } }}
              <small>{{ "Change each level's fee on this page afterwards." | t: 'staff.feeStructure.add.otherLevels.note' }}</small></span>
          </label>
        }
        @if (!rejected() && otherTypes().length) {
          <label class="toggle-card mt-3" [class.active]="add.alsoOthers" for="fs-add-others">
            <input class="form-check-input" type="checkbox" id="fs-add-others" [(ngModel)]="add.alsoOthers" />
            <span>{{ 'Also add {types} with the same fee and shares' | t: 'staff.feeStructure.add.otherTypes.label' : { types: otherTypes().join(' and ') } }}
              <small>{{ 'Types that already have {level} fees are left as they are.' | t: 'staff.feeStructure.add.otherTypes.note' : { level: levelName(level()) } }}</small></span>
          </label>
        }
        <p class="add-note">{{ addNote() }}</p>
        <div class="save-bar">
          <span class="muted me-auto">{{ 'Nothing is saved until you press Add Fees.' | t: 'staff.feeStructure.add.saveNote' }}</span>
          <button type="button" class="btn btn-primary" [disabled]="busy() || readOnly()" (click)="addFees()">{{ 'Add Fees' | t: 'staff.feeStructure.add.addButton' }}</button>
        </div>
      </section>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fs-edit-title">
        <div class="modal-dialog modal-lg modal-dialog-scrollable fs-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div>
                <h4 class="m-0 fs-title" id="fs-edit-title">{{ e.name }}</h4>
                <small class="muted">{{ '{code} · subsidy share' | t: 'staff.feeStructure.edit.sub' : { code: e.code } }}</small>
              </div>
              <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.feeStructure.edit.closeAria'" (click)="editing.set(null)"></button>
            </div>
            <div class="modal-body">
              <div class="alert alert-warning py-2">
                {{ e.category === 0 ? ('The base share is what every unit of this type receives; the other categories keep their additional share on top of it.' | t: 'staff.feeStructure.edit.generalWarning')
                  : ('The share is the base every unit receives plus the extra this category is granted.' | t: 'staff.feeStructure.edit.categoryWarning') }}
                {{ 'Changing it changes what every {type} unit in this category pays.' | t: 'staff.feeStructure.edit.changeWarning' : { type: type() } }}
              </div>
              <div class="fs-edit">
                <div>
                  <h6 class="fs-group">{{ 'Subsidy share' | t: 'staff.feeStructure.edit.share.title' }}</h6>
                  <div class="fs-share-grid">
                    <div>
                      <label class="form-label" for="fs-base">{{ 'Base share (%)' | t: 'staff.feeStructure.edit.base.label' }}</label>
                      <input class="form-control" id="fs-base" type="number" min="0" max="100" step="0.01" [disabled]="e.category !== 0" [(ngModel)]="e.base" />
                    </div>
                    <div>
                      <label class="form-label" for="fs-additional">{{ 'Additional (%)' | t: 'staff.feeStructure.edit.additional.label' }}</label>
                      <input class="form-control" id="fs-additional" type="number" min="0" max="100" step="0.01" [disabled]="e.category === 0" [(ngModel)]="e.additional" />
                    </div>
                    <div>
                      <label class="form-label" for="fs-total">{{ 'Total' | t: 'staff.feeStructure.edit.total.label' }}</label>
                      <input class="form-control fs-fixed fs-share" id="fs-total" readonly [value]="((e.base ?? 0) + (e.additional ?? 0) | number: '1.0-2') + '%'" />
                    </div>
                  </div>
                  <p class="muted mt-2 mb-3">{{ 'The MSME pays the remaining {percent}%.' | t: 'staff.feeStructure.edit.remaining' : { percent: (100 - (e.base ?? 0) - (e.additional ?? 0) | number: '1.0-2') } }}@if (e.category !== 0) { {{ 'The base share is changed on General.' | t: 'staff.feeStructure.edit.baseOnGeneral' }} }</p>
                  <h6 class="fs-group">{{ 'Applies to' | t: 'staff.feeStructure.edit.appliesTo.title' }}</h6>
                  <label class="toggle-card" [class.active]="e.allLevels" for="fs-all">
                    <input class="form-check-input" type="checkbox" id="fs-all" [(ngModel)]="e.allLevels" />
                    <span>{{ consultancy ? ('Apply to all three milestones of {level}' | t: 'staff.feeStructure.edit.allMilestones.label' : { level: hhName(hhLevel()) }) : ('Apply to Bronze, Silver and Gold' | t: 'staff.feeStructure.edit.allLevels.label') }}
                      <small>{{ shareScope(e) }}</small></span>
                  </label>
                </div>
                @if (sharePreview(e); as p) {
                  <aside class="fs-preview" [attr.aria-label]="'Preview' | t: 'staff.feeStructure.preview.aria'">
                    <h6>{{ consultancy ? ('Preview · {level} {milestone}, {type}' | t: 'staff.feeStructure.preview.handholdingTitle' : { level: hhName(hhLevel()), milestone: levelName(level()), type: type() })
                      : ('Preview · {level}, {type}' | t: 'staff.feeStructure.preview.title' : { level: levelName(level()), type: type() }) }}</h6>
                    @if (p.outOfRange) {
                      <p class="pv-warn">{{ 'The total share must be between 0 and 100%.' | t: 'staff.feeStructure.preview.rangeError' }}</p>
                    } @else {
                      <div class="pv-bar" aria-hidden="true"><span class="pv-goi" [style.width.%]="p.pct"></span><span class="pv-msme" [style.width.%]="100 - p.pct"></span></div>
                      <div class="pv-legend"><span><i class="pv-goi"></i>{{ 'GoI {percent}%' | t: 'staff.feeStructure.preview.goi' : { percent: (p.pct | number: '1.0-2') } }}</span><span><i class="pv-msme"></i>{{ 'MSME {percent}%' | t: 'staff.feeStructure.preview.msme' : { percent: (100 - p.pct | number: '1.0-2') } }}</span></div>
                      <dl class="pv-numbers">
                        <dt>{{ 'Fee (before GST)' | t: 'staff.feeStructure.preview.fee.label' }}</dt><dd>₹ {{ p.fee | number: '1.2-2' }}</dd>
                        <dt>{{ 'GoI share' | t: 'staff.feeStructure.column.goiShare' }}</dt><dd>₹ {{ p.goi | number: '1.2-2' }}</dd>
                        <dt>{{ 'MSME taxable' | t: 'staff.feeStructure.column.taxable' }}</dt><dd>₹ {{ p.taxable | number: '1.2-2' }}</dd>
                        <dt>{{ gstColumn() }}</dt><dd>₹ {{ p.gst | number: '1.2-2' }}</dd>
                        <dt class="pv-pays">{{ 'MSME share' | t: 'staff.feeStructure.column.msmeShare' }}</dt><dd class="pv-pays">₹ {{ p.pays | number: '1.2-2' }}</dd>
                        <dt>{{ 'Net after 194C' | t: 'staff.feeStructure.column.net194c' }}</dt><dd>₹ {{ p.pays - p.tds194c | number: '1.2-2' }}</dd>
                        <dt>{{ 'Net after 194J' | t: 'staff.feeStructure.column.net194j' }}</dt><dd>₹ {{ p.pays - p.tds194j | number: '1.2-2' }}</dd>
                      </dl>
                    }
                    <small class="muted d-block mt-2">{{ 'A {code} unit without a joining reward. The server works out the saved amounts.' | t: 'staff.feeStructure.preview.note' : { code: e.code } }}</small>
                  </aside>
                }
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.feeStructure.edit.cancelButton' }}</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="saveShare(e)">{{ 'Save Share' | t: 'staff.feeStructure.edit.saveButton' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (disabling(); as d) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="fs-off-title">
        <div class="modal-dialog modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <h4 class="m-0 fs-title" id="fs-off-title">{{ 'Disable the {name} subsidy?' | t: 'staff.feeStructure.disable.title' : { name: d.name } }}</h4>
              <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.feeStructure.disable.closeAria'" (click)="disabling.set(null)"></button>
            </div>
            <div class="modal-body">
              <p class="muted">{{ 'From the next payment, units in this category get their next eligible subsidy (SC, ST, woman-owned or a region), or General. It applies on the ZED Certification, Handholding and Surveillance portals. Payments already made do not change. You can enable it again at any time.' | t: 'staff.feeStructure.disable.note' }}</p>
              <label class="form-label" for="fs-off-reason">{{ 'Reason' | t: 'staff.feeStructure.disable.reason.label' }}<span class="req">*</span></label>
              <textarea class="form-control" id="fs-off-reason" rows="3" maxlength="500" [(ngModel)]="d.reason"></textarea>
              @if (switchError()) { <span class="help-block" role="alert">{{ switchError() }}</span> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="disabling.set(null)">{{ 'Cancel' | t: 'staff.feeStructure.disable.cancelButton' }}</button>
              <button type="button" class="btn btn-danger" [disabled]="busy()" (click)="disableSubsidy(d)">{{ 'Disable' | t: 'staff.feeStructure.disable.disableButton' }}</button>
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
  styleUrls: ['./fee-structure-switch.scss', './fee-structure-dialog.scss'],
  styles: `
    .page-head { align-items: flex-end; }
    .fs-type { flex-direction: column; align-items: flex-start; gap: 4px; }
    .fs-type-label { font-size: 12px; font-weight: 600; color: #5f6f70; }
    .fs-sets { padding-top: 12px; padding-bottom: 12px; }
    .fs-sets-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
    .fs-set-select { width: auto; min-width: 260px; max-width: 100%; }
    .fs-set-date { width: auto; }
    .fs-sets-note { margin: 8px 0 0; font-size: 13px; }
    .fs-upcoming { margin: 6px 0 0; padding: 6px 10px; border-radius: 8px; background: #fff4d6; color: #8a6100; font-size: 13px; font-weight: 600; }

    /* A card per level: picks the level shown below. */
    .lv-cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(170px, 1fr)); gap: 12px; margin-bottom: 16px; }
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
    .lv-card:hover { border-color: #45a5ad; background: var(--zt-pale); }
    .lv-card.active { border-color: #45a5ad; border-top-color: var(--zt-mid2); background: #eef6f6; box-shadow: 0 2px 10px rgba(16, 61, 64, 0.1); }
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
    .fs-table td.fs-cat { white-space: normal; overflow-wrap: break-word; min-width: 180px; }
    .fs-actions-h { width: 1%; }
    .fs-table tbody tr:hover td { background-color: var(--zt-pale); }
    .fs-table td.col-pay, .fs-table td.col-net { background-color: #eaf6ee; color: #1e7a3c; }
    .fs-table tbody tr:hover td.col-pay, .fs-table tbody tr:hover td.col-net { background-color: #dff0e5; }
    .cat-chip { display: inline-block; min-width: 52px; text-align: center; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 700;
      background: #eef6f6; color: var(--zt-mid2); white-space: nowrap; }
    .cat-chip.cat-1 { background: #f1f0fb; color: #3f3a7a; }
    .cat-chip.cat-2 { background: #fff4d6; color: #8a6100; }
    .cat-chip.cat-region { background: #eaf6ee; color: #1e7a3c; }
    .reward-note { color: #3f3a7a; font-weight: 600; }
    .fs-share { color: var(--zt-mid2); }

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
  protected readonly specialCategories = computed(() => CATEGORY_ORDER.filter((id) => id !== 0).map((id) => ({ id, code: CATEGORIES[id].code, name: categoryName(id) })));
  private readonly api = inject(FeesApi);
  private readonly confirms = inject(ConfirmService);
  /**
   * The cards: Consultancy's milestones; elsewhere every level of Administration → Certification Levels (2026-11-08: the
   * Admin's too, disabled ones included, so their fees can be added before they are enabled) and any level with fee rows.
   */
  private readonly units = computed<readonly string[]>(() => {
    if (this.consultancy) return MILESTONES;
    const codes = levelCodes();
    const known = new Set(codes.map((c) => c.toLowerCase()));
    const extra = this.levelFees().map((l) => l.certification).filter((c) => !!c && !known.has(c.toLowerCase()) && (known.add(c.toLowerCase()), true));
    return [...codes, ...extra];
  });

  /** Consultancy's fee page offered Micro, Small and Medium only; main also has the Recertification fee. */
  protected readonly types: readonly string[] = this.consultancy ? ENTERPRISE_TYPES.filter((x) => x !== 'Rejected')
    : this.portal === 'main' ? MAIN_ENTERPRISE_TYPES : ENTERPRISE_TYPES;
  /** The level the address names (?level=, from Administration → Certification Levels' checklist), kept on the first load even without fees. */
  private readonly askedLevel = this.consultancy ? null : (inject(ActivatedRoute, { optional: true })?.snapshot.queryParamMap.get('level') ?? null);
  private keepLevel = !!this.askedLevel;
  protected readonly level = signal<string>(this.consultancy ? '1' : (this.askedLevel || 'Bronze'));
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
    this.units().map((code) => {
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
        const code = this.categories[category]?.code ?? `CAT ${category}`;
        const share = row.subsidyPercentage ?? 0;
        const taxableBase = row.isCouponRow ? (row.assessmentFeeAfterCoupon ?? 0) : (row.assessmentFee ?? 0);
        return { row, category, code, name: categoryName(category), share, additional: category === 0 ? 0 : share - base, goiShare: taxableBase - (row.subsidyPer ?? 0) };
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
        const code = this.categories[category]?.code ?? `CAT ${category}`;
        return { row, category, code, name: categoryName(category), share: row.subsidyPercentage ?? 0, additional: 0, goiShare: (row.assessmentFee ?? 0) - (row.subsidyPer ?? 0) };
      })
      .sort((a, b) => categoryRank(a.category) - categoryRank(b.category) || a.row.id - b.row.id);
  });

  /** Consultancy: the three milestones of the handholding level for a General unit (null unless all three have fees). */
  protected readonly levelTotal = computed<{ fee: number; pays: number } | null>(() => {
    if (!this.consultancy) return null;
    const general = MILESTONES.map((m) => this.rows().find((r) => this.inUnit(r, m) && (r.specialCategory ?? 0) === 0 && !r.isCouponRow));
    if (general.some((r) => !r)) return null;
    return {
      fee: general.reduce((sum, r) => sum + (r!.assessmentFee ?? 0), 0),
      pays: general.reduce((sum, r) => sum + (r!.applicantContributionAfterSubsidy ?? 0), 0),
    };
  });

  /**
   * Consultancy: the other handholding levels that have no fees for the milestone either (Add fees can make them too), and
   * their names. 2026-11-16: Silver, Gold and ZED-X.
   */
  protected readonly freeOtherLevels = computed(() => HANDHOLDING_LEVELS.filter((h) => h !== this.hhLevel()
    && !this.levelFees().some((l) => l.certification === this.level() && (l.level ?? '').toLowerCase() === h.toLowerCase())));
  protected readonly otherLevelFree = computed(() => this.consultancy && this.freeOtherLevels().length > 0);
  protected readonly otherLevel = computed(() => this.freeOtherLevels().map((l) => levelName(l)).join(' and '));
  protected readonly otherHhLevels = computed(() => HANDHOLDING_LEVELS.filter((l) => l !== this.hhLevel()).map((l) => levelName(l)).join(' and '));

  /** Add fees: the other types the same fees can go to (not Rejected or Recertification). */
  protected readonly otherTypes = computed(() => this.rejected() ? [] : this.types.filter((x) => x !== this.type() && !isFullFee(x)));
  protected add: AddForm = FeeStructurePage.emptyAdd();

  /** The handholding levels Add fees makes rows for. */
  private addLevels(): string[] {
    return this.add.alsoOtherLevel && this.otherLevelFree() ? HANDHOLDING_LEVELS.filter((l) => l === this.hhLevel() || this.freeOtherLevels().includes(l)) : [this.hhLevel()];
  }

  /** What Add fees makes, as the server does (AssessmentFeesController.NewRows). */
  protected addNote(): string {
    const levels = this.consultancy ? this.addLevels() : [];
    const type = this.type();
    const level = this.levelName(this.level());
    const categories = Object.keys(this.categories).length;
    if (this.rejected()) return t('staff.feeStructure.add.rowsRejected.note', 'Creates one row for {type} {level}: the full fee with GST, no subsidy and no joining reward.', { type, level });
    const count = categories * 2 * Math.max(levels.length, 1);
    return levels.length
      ? t('staff.feeStructure.add.rowsHandholding.note',
        "Creates {count} rows for {type} {levels} {milestone}: the {categories} subsidy categories, each without and with the joining reward. That's what the payment page reads.",
        { count, type, levels: levels.map((l) => levelName(l)).join(' and '), milestone: level, categories })
      : t('staff.feeStructure.add.rows.note',
        "Creates {count} rows for {type} {level}: the {categories} subsidy categories, each without and with the joining reward. That's what the payment page reads.",
        { count, type, level, categories });
  }

  /** The page's heading: the fee structure of the level (Consultancy: the handholding level's milestone). */
  protected heading(): string {
    return this.consultancy
      ? t('staff.feeStructure.handholding.title', 'Handholding Fee — {level}, {milestone}', { level: this.hhName(this.hhLevel()), milestone: this.levelName(this.level()) })
      : t('staff.feeStructure.title', 'Fee Structure — {level}', { level: this.levelName(this.level()) });
  }

  protected sub(): string {
    const type = this.type();
    if (this.consultancy) {
      return t('staff.feeStructure.handholding.sub', 'Fee, subsidy split, GST and both TDS deductions for {level} handholding, milestone {number} of {type} enterprises.',
        { level: this.hhName(this.hhLevel()), number: this.level(), type });
    }
    const level = this.levelName(this.level());
    return type === 'Recertification'
      ? t('staff.feeStructure.recertification.sub', 'Fee, subsidy split, GST and both TDS deductions for {level} recertification of all enterprises.', { level })
      : t('staff.feeStructure.sub', 'Fee, subsidy split, GST and both TDS deductions for {level} certification of {type} enterprises.', { level, type });
  }

  /** The line under "Fee & Rates". */
  protected rateNote(): string {
    if (this.type() === 'Recertification') {
      return t('staff.feeStructure.rates.recertification.note', 'Units re-certifying a level pay this full fee: no subsidy and no joining reward. It is separate from the Rejected fee.');
    }
    if (this.rejected()) return t('staff.feeStructure.rates.rejected.note', 'Units whose certification was rejected pay the full fee again: no subsidy and no joining reward.');
    if (this.consultancy) {
      return t('staff.feeStructure.rates.handholding.note',
        'The fee of {level} handholding for this milestone ({others} have their own). GST and TDS apply to the MSME share only; the joining reward is kept.',
        { level: this.hhName(this.hhLevel()), others: this.otherHhLevels() });
    }
    return t('staff.feeStructure.rates.note', 'The fee is before GST. It is split by subsidy category first; GST and TDS then apply to the MSME share only.');
  }

  /** The line of Add fees: what has no fees, and who can't pay. */
  protected addIntro(): string {
    const type = this.type();
    if (this.consultancy) {
      return t('staff.feeStructure.add.handholding.note',
        "No fees are set for {type} {level} {milestone} on this portal, so {type} units can't pay for it yet. Enter them here; every amount is worked out by the server.",
        { type, level: this.hhName(this.hhLevel()), milestone: this.levelName(this.level()) });
    }
    const level = this.levelName(this.level());
    return type === 'Recertification'
      ? t('staff.feeStructure.add.recertification.note',
        "No fees are set for {type} {level} on this portal, so units can't pay for it yet. Enter them here; every amount is worked out by the server.", { type, level })
      : t('staff.feeStructure.add.note',
        "No fees are set for {type} {level} on this portal, so {type} units can't pay for it yet. Enter them here; every amount is worked out by the server.", { type, level });
  }

  /** The share pop-up: what "Apply to …" changes. */
  protected shareScope(e: ShareEdit): string {
    if (e.allLevels) {
      return this.consultancy
        ? t('staff.feeStructure.edit.allMilestones.note', 'The three {level} milestones get the same share.', { level: this.hhName(this.hhLevel()) })
        : t('staff.feeStructure.edit.allLevels.note', 'The three levels get the same share.');
    }
    return this.consultancy
      ? t('staff.feeStructure.edit.onlyMilestone.note', 'Only {level} {milestone} changes.', { level: this.hhName(this.hhLevel()), milestone: this.levelName(this.level()) })
      : t('staff.feeStructure.edit.onlyLevel.note', 'Only {level} changes.', { level: this.levelName(this.level()) });
  }

  /** The GST column (and the phone card's label): "GST @ 18%" (in code, as "@" starts a block in a template). */
  protected gstColumn(): string {
    return t('staff.feeStructure.column.gst', 'GST @ 18%');
  }

  protected readonly editing = signal<ShareEdit | null>(null);
  /** 2026-11-13: the subsidy categories switched off on the three portals (Disable / Enable), and the Disable pop-up. */
  protected readonly offCategories = signal<OffCategory[]>([]);
  protected readonly switchReady = signal(false);
  protected readonly disabling = signal<{ category: number; name: string; reason: string } | null>(null);
  protected readonly switchError = signal('');
  protected readonly loaded = signal(false);
  /** The portal's fee sets, oldest first (migration 0112). */
  protected readonly sets = signal<FeeSet[]>([]);
  /** The set the Admin chose; null: the set in force today (the server picks it). */
  private readonly setKey = signal<string | null>(null);
  /** The set the fees below belong to (from the server). */
  protected readonly shownSet = signal<FeeSet | null>(null);
  protected readonly newSet = signal(false);
  protected newSetFrom = '';
  protected readonly setPick = computed(() => this.newSet() ? 'new' : (this.setKey() ?? this.shownSet()?.key ?? ''));
  /** An ended set is history: nothing on it can be changed. */
  protected readonly readOnly = computed(() => this.shownSet()?.status === 'past');
  /** The next set after the one in force, while the set in force is shown. */
  protected readonly upcoming = computed(() => this.shownSet()?.status === 'current' ? (this.sets().find((s) => s.status === 'future') ?? null) : null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  /** A handholding level as shown (ZED-X for ZEDX). */
  protected hhName(code: string): string {
    return levelName(code);
  }

  protected levelName(code: string): string {
    return this.consultancy ? t('staff.feeStructure.milestone.label', 'Milestone {number}', { number: code }) : levelName(code);
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
      this.error.set(t('staff.feeStructure.error.scheduleDate', 'Please enter the date from which units pay all three milestones at milestone 1.'));
      return;
    }
    await this.run(() => this.api.saveSchedule(this.sched.payAll, this.sched.payAll ? this.sched.from : null, this.setKey()));
  }

  protected async addFees(): Promise<void> {
    const a = this.add;
    if (a.fee === null || a.fee === undefined || (!this.rejected() && (a.general === null || a.general === undefined))) {
      this.error.set(this.rejected() ? t('staff.feeStructure.error.fee', 'Please enter the fee.') : t('staff.feeStructure.error.feeAndGeneral', 'Please enter the fee and the General subsidy.'));
      return;
    }
    await this.run(() => this.api.add(this.type(), {
      certification: this.level(), assessmentFee: a.fee, reward: this.rejected() ? null : (a.reward ?? 0), generalShare: this.rejected() ? null : a.general,
      additionalShares: this.rejected() ? {} : a.additional, alsoTypes: a.alsoOthers ? this.otherTypes() : [],
      ...(this.consultancy ? { levels: this.addLevels() } : {}),
    }, this.setKey()));
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
      this.error.set(t('staff.feeStructure.error.feeAndReward', 'Please enter the fee and the joining reward.'));
      return;
    }
    // Consultancy keeps the stored joining reward (its milestone fee only).
    await this.run(() => this.api.save(this.type(), [{
      certification: f.certification, assessmentFee: this.feeInput, coupon: reward && !this.consultancy ? this.rewardInput : null,
      ...(this.consultancy ? { level: this.hhLevel() } : {}),
    }], this.setKey()));
  }

  protected offOf(category: number): OffCategory | undefined {
    return this.offCategories().find((o) => o.category === category);
  }

  /** A fee set in the "Date of effect" list: its dates and whether it ended, is in force or is still to come. */
  protected setLabel(s: FeeSet): string {
    const status = s.status === 'past' ? t('staff.feeStructure.sets.status.past', 'ended')
      : s.status === 'future' ? t('staff.feeStructure.sets.status.future', 'future') : t('staff.feeStructure.sets.status.current', 'in force');
    const from = this.dmy(s.from);
    const to = this.dmy(s.to);
    if (!s.from && !s.to) return t('staff.feeStructure.sets.label.always', 'Since the start ({status})', { status });
    if (!s.from) return t('staff.feeStructure.sets.label.until', 'Until {to} ({status})', { to, status });
    if (!s.to) return t('staff.feeStructure.sets.label.from', 'From {from} ({status})', { from, status });
    return t('staff.feeStructure.sets.label.range', '{from} – {to} ({status})', { from, to, status });
  }

  /** What the chosen set means for the units. */
  protected setNote(): string {
    const s = this.shownSet();
    if (this.newSet()) return t('staff.feeStructure.sets.note.new', 'A new fee set starts with every fee of this portal in force on its date (each enterprise type, level and subsidy category). Change them after adding it; units pay them from that date.');
    if (!s) return '';
    if (s.status === 'past') return t('staff.feeStructure.sets.note.past', 'Units paid these fees until {to}. An ended fee set is kept as history and cannot be changed.', { to: this.dmy(s.to) });
    if (s.status === 'future') return t('staff.feeStructure.sets.note.future', 'Units pay these fees from {from}. Until then they pay the fee set in force. The fees, shares and schedule saved here apply to this set only.', { from: this.dmy(s.from) });
    return s.to ? t('staff.feeStructure.sets.note.currentUntil', 'Units pay these fees now, until {to}.', { to: this.dmy(s.to) })
      : t('staff.feeStructure.sets.note.current', 'Units pay these fees now. To change the fees from a later date, choose "+ New fee set".');
  }

  protected chooseSet(key: string): void {
    this.success.set('');
    this.error.set('');
    if (key === 'new') {
      this.newSet.set(true);
      this.newSetFrom = '';
      return;
    }
    this.newSet.set(false);
    const current = this.sets().find((s) => s.status === 'current')?.key;
    this.setKey.set(key === current ? null : key);
    this.add = FeeStructurePage.emptyAdd();
    void this.load();
  }

  protected cancelNewSet(): void {
    this.newSet.set(false);
    this.newSetFrom = '';
  }

  protected async addSet(): Promise<void> {
    const from = this.newSetFrom;
    if (!from) {
      this.error.set(t('staff.feeStructure.sets.error.date', 'Please enter the date of effect.'));
      return;
    }
    if (from < this.today) {
      this.error.set(t('staff.feeStructure.sets.error.past', 'The date of effect cannot be in the past.'));
      return;
    }
    if (!(await this.confirms.ask({
      title: t('staff.feeStructure.sets.confirm.title', 'Add a Fee Set from {date}?', { date: this.dmy(from) }),
      message: t('staff.feeStructure.sets.confirm.message', 'Every fee of this portal in force on {date} is copied into the new set. You then change its fees; units pay them from {date}.', { date: this.dmy(from) }),
      confirmLabel: t('staff.feeStructure.sets.confirm.button', 'Add Fee Set'),
    }))) return;
    await this.run(async () => {
      const r = await firstValueFrom(this.api.addSet(from));
      this.newSet.set(false);
      this.newSetFrom = '';
      this.setKey.set(from === this.today ? null : from);
      return r;
    });
  }

  protected async deleteSet(): Promise<void> {
    const s = this.shownSet();
    if (!s || s.status !== 'future') return;
    if (!(await this.confirms.ask({
      title: t('staff.feeStructure.sets.delete.title', 'Delete the Fee Set from {date}?', { date: this.dmy(s.from) }),
      message: t('staff.feeStructure.sets.delete.message', 'Its fees are deleted and the fee set before it stays in force after {date}. This cannot be undone.', { date: this.dmy(s.from) }),
      confirmLabel: t('staff.feeStructure.sets.delete.button', 'Delete'),
      danger: true,
    }))) return;
    await this.run(async () => {
      const r = await firstValueFrom(this.api.deleteSet(s.key));
      this.setKey.set(null);
      return r;
    });
  }

  private async loadSets(): Promise<void> {
    try {
      this.sets.set((await firstValueFrom(this.api.sets())).sets ?? []);
    } catch {
      this.sets.set([]);
    }
  }

  private async loadSwitches(): Promise<void> {
    try {
      const r = await firstValueFrom(this.api.subsidySwitches());
      this.switchReady.set(r.ready);
      this.offCategories.set(r.off);
    } catch {
      this.switchReady.set(false);
    }
  }

  protected openDisable(s: StructureRow): void {
    this.switchError.set('');
    this.disabling.set({ category: s.category, name: s.name, reason: '' });
  }

  protected async disableSubsidy(d: { category: number; name: string; reason: string }): Promise<void> {
    if (!d.reason.trim()) {
      this.switchError.set(t('staff.feeStructure.error.reason', 'Please enter the reason.'));
      return;
    }
    await this.run(async () => {
      const r = await firstValueFrom(this.api.switchSubsidy(d.category, true, d.reason.trim()));
      this.disabling.set(null);
      return r;
    });
  }

  protected async enableSubsidy(s: StructureRow): Promise<void> {
    if (!(await this.confirms.ask({
      title: t('staff.feeStructure.enable.confirm.title', 'Enable the {name} Subsidy Again?', { name: s.name }),
      message: t('staff.feeStructure.enable.confirm.message', 'It is enabled on the three portals. Units in this category get it from their next payment.'),
      confirmLabel: t('staff.feeStructure.enable.confirm.button', 'Enable'),
    }))) return;
    await this.run(() => this.api.switchSubsidy(s.category, false, null));
  }

  protected async saveShare(e: ShareEdit): Promise<void> {
    await this.run(async () => {
      const r = await firstValueFrom(this.api.saveSubsidy(this.type(), {
        certification: this.level(), category: e.category, allLevels: e.allLevels,
        baseShare: e.category === 0 ? e.base : null, additionalShare: e.category === 0 ? null : e.additional,
        ...(this.consultancy ? { level: this.hhLevel() } : {}),
      }, this.setKey()));
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
      void this.loadSwitches();
      void this.loadSets();
      const res = await firstValueFrom(this.api.fees(this.type(), this.setKey()));
      this.shownSet.set(res.set ?? null);
      this.levelFees.set(res.levels);
      this.rows.set(res.rows);
      this.schedule.set(res.schedule ?? null);
      this.sched = { payAll: !!res.schedule?.payAllAtMilestone1, from: res.schedule?.from ?? '' };
      this.schedChanged.set(false);
      if (!res.levels.some((l) => l.certification === this.level()) && res.levels.length && this.units().includes(res.levels[0].certification)
        && !this.keepLevel) {
        this.level.set(res.levels[0].certification);
      }
      this.keepLevel = false;
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
