import { HttpClient } from '@angular/common/http';
import { Component, HostListener, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent } from '../pager';
import { ASSESSMENT_SYSTEM, Expanded, STATES, num, text, useLegacyPortal } from './assessment-shared';
import { LevelMedal } from './level-medal';
import { AssessmentApi, ListFilter, Row } from './assessment.api';
import { HANDHOLDING_LEVEL_CODES, levelCodes, levelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';
import { AttentionService } from '../attention';

// ---------------------------------------------------------------- dates (shared with the results and monitoring pages)

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];

/** A date of the rows: ISO ("2026-11-11T10:20:00") or the procedures' "November 11, 2026" / "Nov 11, 2026". Null otherwise. */
export function toDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const s = String(value).trim();
  const m = /^([A-Za-z]+)\.? (\d{1,2}),? (\d{4})/.exec(s);
  if (m) {
    const month = MONTHS.findIndex((x) => x.startsWith(m[1].toLowerCase().slice(0, 3)));
    return month < 0 ? null : new Date(Number(m[3]), month, Number(m[2]));
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(s)) return null;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

/** Whole days from today to the date (negative: past); null without a date. */
export function daysUntil(value: unknown, today = new Date()): number | null {
  const d = toDate(value);
  if (!d) return null;
  const a = Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const b = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((a - b) / 86_400_000);
}

/** "11 Nov 2026" ('' without a date). */
export function shortDate(value: unknown): string {
  const d = toDate(value);
  return d ? d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '';
}

/** "6 days", "1 day", "Today". */
export function dayCount(n: number): string {
  return n === 0 ? 'Today' : `${n} ${n === 1 ? 'day' : 'days'}`;
}

/** District and state of the unit ("Pune, Maharashtra"); the full address when the portal's rows have no district / state. */
export function place(s: Row): string {
  const parts = [text(s, 'PDistrictName'), text(s, 'PStateName')].filter((p) => p.trim());
  return parts.length ? parts.join(', ') : text(s, 'UnitAddress');
}

// ---------------------------------------------------------------- the allot pop-up

export interface BulkResult {
  zedId: string;
  certification: string;
  allotted: boolean;
  message: string;
}

interface BulkResponse {
  allotted: number;
  refused: number;
  results: BulkResult[];
}

interface Choice {
  userId: string;
  userName: string;
  /** How many of the chosen units this agency may take (the API's list for each unit). */
  takes: number;
}

/** Most units in one bulk allotment (the API's limit). */
export const BULK_LIMIT = 100;

/**
 * 2026-11-17 (approved popup-05): "Allot assessment" for one unit or several (bulk). The agencies are the ones the API offers
 * for each unit (allot/agencies: active, of the unit's state and sector, allowed for the level); for several units each
 * agency says how many of them it may take. One unit posts the single allotment (POST allot); several post allot/bulk, which
 * applies the same checks to each unit and answers per unit. The design's suggested agency, open load, due date and note
 * are not shown: the API has none of them.
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): popup-05's search with its icon on the left, "Covers
 * <state>" on each agency (the API offers only agencies of the unit's state), the 32px grey close button, 40px title-case footer
 * buttons and "The agency SPOC is told by e-mail."</p>
 */
@Component({
  selector: 'zed-allot-dialog',
  imports: [FormsModule],
  template: `
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allotTitle">
      <div class="modal-dialog modal-dialog-centered ad">
        <div class="modal-content">
          <div class="modal-header ad-head">
            <span class="ad-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6" /></svg></span>
            <div class="ad-title">
              <h2 id="allotTitle">{{ title }}</h2>
              @if (one(); as u) {
                <p>{{ t(u, 'ZedId') }} · {{ t(u, 'PUnitName') }}@if (place(u)) { · {{ place(u) }} }</p>
              } @else {
                <p>{{ units().length }} units selected</p>
              }
            </div>
            <button type="button" class="ad-x" aria-label="Close" (click)="closed.emit()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>

          @if (results(); as r) {
            <div class="modal-body">
              <p class="ad-sum"><b>{{ count(r, true) }}</b> allotted · <b>{{ count(r, false) }}</b> not allotted</p>
              <ul class="ad-res">
                @for (x of r; track x.zedId + x.certification) {
                  <li [class.no]="!x.allotted"><b>{{ x.zedId }}</b> {{ x.certification }}<small>{{ x.allotted ? 'Allotted' : x.message }}</small></li>
                }
              </ul>
            </div>
            <div class="modal-footer ad-foot"><button type="button" class="btn btn-primary" (click)="closed.emit()">Close</button></div>
          } @else {
            <div class="modal-body ad-body">
              <div class="ad-pick">
                <label class="form-label" for="adSearch">{{ chooseLabel }}</label>
                <div class="ad-q">
                  <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
                  <input id="adSearch" type="search" class="form-control" maxlength="60" autocomplete="off" [placeholder]="'Search ' + party + ' name or ID'"
                         [ngModel]="q()" (ngModelChange)="q.set($event)" />
                </div>
                <div class="ad-list" role="radiogroup" [attr.aria-label]="chooseLabel">
                  @for (a of shown(); track a.userId) {
                    <label class="ad-opt" [class.on]="choice() === a.userId">
                      <input type="radio" name="adAgency" [value]="a.userId" [checked]="choice() === a.userId" (change)="choice.set(a.userId)" />
                      <span class="ad-name"><b>{{ a.userName }}</b><small>{{ a.userId }}</small></span>
                      @if (one() && t(one()!, 'PStateName')) { <span class="chip is-good">Covers {{ t(one()!, 'PStateName') }}</span> }
                      @if (units().length > 1) {
                        <span class="chip" [class.is-good]="a.takes === units().length" [class.is-warn]="a.takes < units().length">May take {{ a.takes }} of {{ units().length }}</span>
                      }
                    </label>
                  } @empty {
                    <p class="muted ad-none">{{ loading() ? 'Loading…' : 'No ' + party + ' may take ' + (units().length > 1 ? 'these units.' : 'this unit.') }}</p>
                  }
                </div>
              </div>
              <aside class="ad-side">
                @if (one(); as u) {
                  <h3>Unit</h3>
                  <dl>
                    <dt>Level</dt><dd>{{ levelName(t(u, 'Certification')) }}@if (consultancy) { · Milestone {{ t(u, 'NcCount') }} }</dd>
                    @if (t(u, 'EnterpriseTypee')) { <dt>MSME size</dt><dd>{{ t(u, 'EnterpriseTypee') }}</dd> }
                    @if (paid(u)) { <dt>Paid on</dt><dd>{{ paid(u) }}</dd><dt>Waiting</dt><dd class="warn">{{ waiting(u) }}</dd> }
                    @if (t(u, 'UnitSpocName')) {
                      <dt>SPOC</dt><dd>{{ t(u, 'UnitSpocName') }}<small>{{ t(u, 'UnitSpocMobileNo') }}</small><small>{{ t(u, 'UnitSpocEmailId') }}</small></dd>
                    }
                  </dl>
                } @else {
                  <h3>Units</h3>
                  <ul class="ad-units">
                    @for (u of units(); track t(u, 'ZedId') + t(u, 'Certification')) { <li><b>{{ t(u, 'ZedId') }}</b> {{ levelName(t(u, 'Certification')) }}<small>{{ t(u, 'PUnitName') }}</small></li> }
                  </ul>
                }
              </aside>
            </div>
            @if (error()) { <div class="alert alert-danger mx-3" role="alert">{{ error() }}</div> }
            <div class="modal-footer ad-foot">
              <small class="muted">The {{ party }} SPOC is told by e-mail.</small>
              <button type="button" class="btn btn-light ad-cancel" (click)="closed.emit()">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="busy() || loading()" (click)="allot()">Allot to {{ party }}</button>
            </div>
          }
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .ad { max-width: 900px; }
    .ad .modal-content { border: 0; border-radius: 14px; }
    .ad-head { align-items: flex-start; gap: 14px; padding: 18px 22px; }
    .ad-icon { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: var(--zt-soft, #d4ebe6); }
    .ad-icon svg { width: 20px; fill: none; stroke: var(--zt-dark, #1f5c61); stroke-width: 1.8; }
    .ad-title { flex: 1; min-width: 0; }
    .ad-title h2 { margin: 0; font-size: 18px; font-weight: 700; color: #17373b; }
    .ad-title p { margin: 2px 0 0; font-size: 12.5px; color: #6f8487; overflow-wrap: anywhere; }
    .ad-x { flex: none; width: 32px; height: 32px; border: 0; border-radius: 8px; background: #eef3f3; display: grid; place-items: center; }
    .ad-x svg, .ad-q svg { width: 16px; fill: none; stroke: #17373b; stroke-width: 2; stroke-linecap: round; }
    .ad-q { position: relative; }
    .ad-q svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); stroke: #6f8487; }
    .ad-q input { padding-left: 36px; background-image: none !important; }
    .ad-body { display: grid; grid-template-columns: minmax(0, 1fr) 260px; gap: 0; padding: 0; }
    .ad-pick { padding: 18px 22px; }
    .ad-list { display: grid; gap: 10px; margin-top: 12px; max-height: 340px; overflow: auto; }
    .ad-opt { display: flex; align-items: center; gap: 12px; margin: 0; padding: 12px 14px; border: 1px solid #dfe9ea; border-radius: 12px; cursor: pointer; font-weight: 400; }
    .ad-opt .chip { flex: none; padding: 3px 10px; border-radius: 11px; font-size: 10.5px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; }
    .ad-opt .chip.is-good { background: #e5f5ea; color: #2f9e58; }
    .ad-opt .chip.is-warn { background: #fdf2dc; color: #9a5f06; }
    .ad-opt.on { border: 2px solid var(--zt-dark, #1f5c61); padding: 11px 13px; background: #f4faf9; }
    .ad-opt input { accent-color: var(--zt-dark, #1f5c61); }
    .ad-name { flex: 1; min-width: 0; }
    .ad-name b, .ad-name small, dd small, .ad-units small, .ad-res small { display: block; }
    .ad-name b { color: var(--zt-ink, #173f44); }
    .ad-name small, dd small, .ad-units small { color: #5f6f70; font-size: 12px; }
    .ad-side { padding: 18px 22px; border-left: 1px solid #e6eeee; }
    .ad-side h3 { font-size: 12px; font-weight: 800; letter-spacing: .5px; text-transform: uppercase; color: var(--zt-ink, #173f44); }
    dl { display: grid; grid-template-columns: auto 1fr; margin: 0; font-size: 13px; }
    dt, dd { margin: 0; padding: 7px 0; border-bottom: 1px solid #eef3f3; }
    dt { color: #5f6f70; font-weight: 400; }
    dd { text-align: right; overflow-wrap: anywhere; }
    dd.warn { color: #b26a00; font-weight: 700; }
    .ad-units, .ad-res { list-style: none; margin: 0; padding: 0; max-height: 300px; overflow: auto; font-size: 13px; }
    .ad-units li, .ad-res li { padding: 6px 0; border-bottom: 1px solid #eef3f3; }
    .ad-res li::before { content: '✓ '; color: #1e8a4c; font-weight: 700; }
    .ad-res li.no::before { content: '✕ '; color: #c0392b; }
    .ad-res li.no small { color: #c0392b; }
    .ad-foot { gap: 12px; padding: 14px 28px; }
    .ad-foot .btn { min-height: 40px; padding: 0 22px; font-weight: 700; }
    .ad-foot .ad-cancel { min-width: 110px; background: #e7eeee; border-color: #e7eeee; color: #17373b; }
    .ad-foot small { margin-right: auto; }
    .ad-none { margin: 8px 0; }
    @media (max-width: 767.98px) { .ad-body { grid-template-columns: minmax(0, 1fr); } .ad-side { border-left: 0; border-top: 1px solid #e6eeee; } }
  `,
})
export class AllotDialog {
  /** The units to allot (one, or several for a bulk allotment). */
  readonly units = input.required<Row[]>();
  /** Some units were allotted (the page reloads its list); the pop-up may stay open with the per-unit results. */
  readonly changed = output<number>();
  readonly closed = output<void>();

  private readonly api = inject(AssessmentApi);
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  protected readonly consultancy = inject(ASSESSMENT_SYSTEM) === 'consultancy';
  private readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';
  protected readonly party = this.consultancy ? 'CO' : 'agency';
  protected readonly title = this.consultancy ? 'Allot consultancy' : this.surveillance ? 'Allot surveillance' : 'Allot assessment';
  protected readonly chooseLabel = this.consultancy ? 'Choose the consultant organisation' : 'Choose the assessment agency';
  protected readonly t = text;
  protected readonly place = place;
  protected readonly levelName = levelName;

  protected readonly agencies = signal<Choice[]>([]);
  protected readonly q = signal('');
  protected readonly choice = signal('');
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly results = signal<BulkResult[] | null>(null);
  protected readonly one = computed(() => (this.units().length === 1 ? this.units()[0] : null));
  protected readonly shown = computed(() => {
    const q = this.q().trim().toLowerCase();
    return q ? this.agencies().filter((a) => (a.userName + ' ' + a.userId).toLowerCase().includes(q)) : this.agencies();
  });

  constructor() {
    effect(() => {
      const units = this.units();
      untracked(() => void this.loadAgencies(units));
    });
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    if (!this.busy()) this.closed.emit();
  }

  protected paid(u: Row): string {
    return shortDate(u['PaidOn']);
  }

  protected waiting(u: Row): string {
    const d = daysUntil(u['PaidOn']);
    return d === null ? '' : dayCount(Math.max(0, -d));
  }

  protected count(r: BulkResult[], allotted: boolean): number {
    return r.filter((x) => x.allotted === allotted).length;
  }

  private async loadAgencies(units: Row[]): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const lists = await Promise.all(units.map((u) => firstValueFrom(this.api.agencies(text(u, 'ZedId'), text(u, 'Certification')))));
      const all = new Map<string, Choice>();
      for (const list of lists) {
        for (const p of list) {
          const key = p.userId.toUpperCase();
          const c = all.get(key);
          if (c) c.takes++;
          else all.set(key, { userId: p.userId, userName: p.userName, takes: 1 });
        }
      }
      this.agencies.set([...all.values()].sort((a, b) => b.takes - a.takes || a.userName.localeCompare(b.userName)));
      this.choice.set('');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected async allot(): Promise<void> {
    const agency = this.agencies().find((a) => a.userId === this.choice());
    if (!agency) {
      this.error.set('Please select valid data.');
      return;
    }
    const units = this.units();
    this.busy.set(true);
    this.error.set('');
    try {
      if (units.length === 1) {
        const u = units[0];
        await firstValueFrom(this.api.allotToAgency(text(u, 'ZedId'), text(u, 'Certification'), agency.userId));
        this.toast.success(`${text(u, 'ZedId')} allotted`, `To ${agency.userName}.`);
        this.changed.emit(1);
        this.closed.emit();
        return;
      }
      const res = await firstValueFrom(this.http.post<BulkResponse>('/api/staff/assessment/allot/bulk', {
        units: units.map((u) => ({ zedId: text(u, 'ZedId'), certification: text(u, 'Certification') })),
        agencyUserId: agency.userId,
      }));
      if (res.allotted > 0) this.changed.emit(res.allotted);
      if (res.refused === 0) {
        this.toast.success(`${res.allotted} units allotted`, `To ${agency.userName}.`);
        this.closed.emit();
      } else {
        this.results.set(res.results);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

// ---------------------------------------------------------------- the page

type Tab = 'allot' | 'reallot';

/**
 * Master admin: allot MSMEs to assessment agencies. Port of Views/Assessment/Allot.cshtml
 * (Assessment/GetList, GetCb, AllotCb). Profile and site-assessment pages still open on the current portal.
 * Consultancy ("Allot Consultancy"): paid milestones go to Consultant Organisations (Silver/Gold, Milestone column).
 * Surveillance ("Allot Surveillance"): Surveillance No and the auto-allotment date. Neither old page linked the
 * assessment details from here.
 * <p>2026-11-17 (approved staff-09): "To allot" / "To re-allot" tabs with counts (the old ALLOT/RE-ALLOT filter; the
 * header bell opens them with ?type=ALLOT|REALLOT), a Waiting column from the payment date sorted oldest first, district and
 * state instead of the address, the row's other actions in its menu, and bulk allotment: tick units, "Allot N units", one
 * agency in the pop-up.</p>
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): as staff-09, no Refresh in the title row (the list reloads
 * after each allotment) and no "Show" label before the tabs; the search with its icon on the left and the drop-downs at the
 * design's fixed widths; the level as a medal. The "Suggested agency" column is not shown: the list has no suggestion or open
 * load per agency (the pop-up lists the agencies that may take the unit).</p>
 */
@Component({
  selector: 'zed-staff-allot',
  imports: [FormsModule, PagerComponent, PageHead, ChipFilter, RowMenu, AllotDialog, LevelMedal],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" [title]="title" [subtitle]="subtitle" />

    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    <div class="al-tabs">
      <zed-chip-filter label="Show" [chips]="chips()" [value]="tab()" (valueChange)="setTab($any($event))" />
      <button type="button" class="btn btn-link al-sort" (click)="newestFirst.set(!newestFirst())">{{ newestFirst() ? 'Newest first' : 'Oldest first' }}</button>
    </div>

    <div class="zed-card al-filters">
      <div class="al-q">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
        <input type="search" id="allotSearch" class="form-control" maxlength="50" placeholder="Search ZED ID, unit or SPOC" aria-label="Search ZED ID, unit or SPOC"
               [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </div>
      <select class="form-select" id="allotState" aria-label="State" [(ngModel)]="filter.state" (ngModelChange)="load()">
        <option value="">All states</option>
        @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
      </select>
      <select class="form-select" id="allotLevel" [attr.aria-label]="consultancy ? 'Desired Certification' : 'Certification Level'" [(ngModel)]="filter.certification" (ngModelChange)="load()">
        <option value="">All levels</option>
        @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
      </select>
      <select class="form-select" id="allotSize" aria-label="MSME Size" [(ngModel)]="filter.size" (ngModelChange)="load()">
        <option value="">All sizes</option>
        <option value="Micro">Micro</option>
        <option value="Small">Small</option>
        <option value="Medium">Medium</option>
      </select>
      <select class="form-select" id="allotGender" aria-label="Gender" [(ngModel)]="filter.gender" (ngModelChange)="load()">
        <option value="">All genders</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
        <option value="Others">Others</option>
      </select>
    </div>

    @if (picked().length) {
      <div class="al-bar" role="region" aria-label="Selected units">
        <b>{{ picked().length }} {{ picked().length === 1 ? 'unit' : 'units' }} selected</b>
        <button type="button" class="btn al-go" (click)="openAllot(picked())">Allot {{ picked().length }} {{ picked().length === 1 ? 'unit' : 'units' }}</button>
        <button type="button" class="btn btn-link al-clear" (click)="clearSelection()">Clear selection</button>
      </div>
    }

    <div class="list-card">
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th class="al-ck"><input type="checkbox" class="form-check-input" aria-label="Select the units of this page" [checked]="allOnPage()" (change)="selectPage($any($event.target).checked)" /></th>
              <th>Unit</th>
              <th>{{ consultancy ? 'Level / Milestone' : surveillance ? 'Level / Surveillance No' : 'Level' }}</th>
              <th>Size</th>
              <th>Paid on</th>
              <th>Waiting</th>
              <th>{{ tab() === 'allot' ? 'Status' : (consultancy ? 'CO' : 'Agency') }}</th>
              @if (tab() === 'reallot') { <th>Reason for rejection</th> }
              <th class="text-end">Action</th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track key(s)) {
              <tr [class.al-on]="isPicked(s)" [class.al-flag]="!!t(s, 'ReasonForRejection') || !!t(s, 'TimeDuration')">
                <td class="al-ck"><input type="checkbox" class="form-check-input" [attr.aria-label]="'Select ' + t(s, 'ZedId')" [checked]="isPicked(s)" (change)="toggle(s)" /></td>
                <td class="unit-cell">
                  <b>{{ t(s, 'PUnitName') }}</b>
                  <span class="dash-text-clr al-id">{{ t(s, 'ZedId') }}</span>
                  <small class="al-addr" [title]="t(s, 'UnitAddress')">{{ place(s) }}</small>
                  @if (main && t(s, 'UdyamStatus') === 'Duplicate') { <span class="chip is-warn">Duplicate Udyam</span> }
                </td>
                <td>
                  <zed-level-medal [level]="t(s, 'Certification')" />
                  @if (consultancy) { <small class="sub">Milestone {{ t(s, 'NcCount') }}</small> }
                  @if (surveillance) { <small class="sub">{{ t(s, 'SurveillanceNo') }}</small> }
                </td>
                <td>{{ t(s, 'EnterpriseTypee') }}</td>
                <td class="text-nowrap">{{ paidOn(s) }}</td>
                <td>@if (waitDays(s); as w) { <span class="chip" [class.is-warn]="w.days >= 5 && w.days < 10" [class.is-bad]="w.days >= 10">{{ w.label }}</span> }</td>
                @if (tab() === 'allot') {
                  <td><span class="status-badge" [class]="'status-badge ' + status(s).cls">{{ status(s).label }}</span></td>
                } @else {
                  <td>
                    <b>{{ t(s, 'AgencyName') }}</b><small class="sub">{{ t(s, 'CertificationBodyUserId') }}</small>
                    <span class="status-badge" [class]="'status-badge ' + status(s).cls">{{ status(s).label }}</span>
                    @if (t(s, 'TimeDuration')) { <span class="chip is-warn">No answer in 72 hours</span> }
                    @if (surveillance && t(s, 'CertificationBodyUserId') && t(s, 'AutoAllocationDate')) {
                      <small class="sub">Auto Alloted on: {{ t(s, 'AutoAllocationDate') }}</small>
                    }
                  </td>
                  <td class="al-reason">
                    @if (t(s, 'ReasonForRejection'); as reason) {
                      <div [class.clamp-3]="!more.has(key(s))" [title]="reason">{{ reason }}</div>
                      @if (reason.length > 120) {
                        <button type="button" class="btn btn-link btn-sm p-0" (click)="more.toggle(key(s))">{{ more.has(key(s)) ? 'less' : 'more' }}</button>
                      }
                    }
                  </td>
                }
                <td class="text-end text-nowrap">
                  <button type="button" class="btn btn-primary al-act" [class.re-allot]="reAllot(s)" (click)="openAllot([s])">{{ reAllot(s) ? 'Re-allot' : 'Allot' }}</button>
                  <zed-row-menu [items]="menu(s)" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" />
                </td>
              </tr>
            } @empty {
              <tr><td colspan="9" style="padding: 0"><div class="no-data">{{ loading() ? 'Loading…' : tab() === 'allot' ? 'No unit is waiting for allotment.' : 'No unit to re-allot.' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" [sizes]="[10, 20, 50, 100]" />
    </div>

    @if (dialog(); as units) {
      <zed-allot-dialog [units]="units" (changed)="allotted()" (closed)="dialog.set(null)" />
    }
  `,
  styles: `
    .al-tabs { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 12px; }
    .al-sort { font-weight: 600; color: var(--zt-dark, #1f5c61); text-decoration: none; padding: 0; }
    .al-tabs ::ng-deep .cf-label { display: none; }
    .al-filters { display: grid; grid-template-columns: 320px 190px 170px 150px 150px; gap: 12px; padding: 12px 14px; margin-bottom: 12px; }
    .al-q { position: relative; }
    .al-q svg { position: absolute; left: 12px; top: 50%; width: 16px; transform: translateY(-50%); fill: none; stroke: #6f8487; stroke-width: 2; }
    .al-q input { padding-left: 36px; background-image: none !important; }
    .al-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 14px; padding: 10px 16px; margin-bottom: 12px; border-radius: 12px;
      background: var(--zt-dark, #1f5c61); color: #fff; }
    .al-go { background: #a8e0b8; color: var(--zt-ink, #173f44); font-weight: 700; border: 0; padding: 7px 26px; }
    .al-go:hover { background: #bfe9c9; }
    .al-clear { margin-left: auto; color: #fff; text-decoration: none; font-weight: 600; }
    .al-ck { width: 40px; }
    .al-ck .form-check-input { width: 18px; height: 18px; margin: 0; }
    tr.al-on > td { background: #f2f9f8; }
    tr.al-flag > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    .al-id { display: block; font-size: 11.5px; font-weight: 700; color: #24666b; }
    .al-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .unit-cell { min-width: 200px; }
    .al-reason { min-width: 180px; max-width: 320px; white-space: pre-wrap; }
    td .status-badge { margin-top: 4px; }
    td .chip { margin-top: 4px; }
    .al-act { min-width: 82px; margin-right: 6px; font-weight: 600; }
    .al-act.re-allot { background: #fff1d6; border-color: #fff1d6; color: #7a4700; }
    .al-act.re-allot:hover { background: #ffe6b5; border-color: #ffe6b5; }
    @media (max-width: 1199.98px) { .al-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .al-q { grid-column: 1 / -1; } }
  `,
})
export class AllotPage {
  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  private readonly attention = inject(AttentionService);
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly t = text;
  protected readonly n = num;
  protected readonly place = place;
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly main = this.system === 'main';
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly title = this.consultancy ? 'Allot Consultancy' : this.surveillance ? 'Allot Surveillance' : 'Allot Assessment';
  protected readonly crumbs = staffCrumbs({ label: this.title });
  protected readonly subtitle = this.consultancy
    ? 'Allot the paid milestones of the MSMEs to Consultant Organisations, or re-allot them.'
    : this.surveillance ? 'Allot the surveillance assessments to assessment agencies, or re-allot the rejected and overdue ones.'
    : 'Allot units to assessment agencies, or re-allot the rejected and overdue ones.';
  /** Who the record is allotted to, in the status column. */
  protected readonly party = this.consultancy ? 'CO' : 'Agency';
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? [...HANDHOLDING_LEVEL_CODES] : levelCodes()));
  protected readonly levelName = levelName;

  /** The API's filters (the list loads both tabs at once: ALLOT/RE-ALLOT is the tab). */
  protected filter: Required<Omit<ListFilter, 'allotmentType'>> = { state: '', certification: '', size: '', gender: '' };
  protected readonly rows = signal<Row[]>([]);
  protected readonly tab = signal<Tab>('allot');
  protected readonly search = signal('');
  protected readonly newestFirst = signal(false);
  private readonly selected = signal<ReadonlySet<string>>(new Set());
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly dialog = signal<Row[] | null>(null);
  protected readonly more = new Expanded();
  protected readonly key = (s: Row) => text(s, 'ZedId') + '|' + text(s, 'Certification');
  private request = 0;

  /** As the procedure's ALLOT / RE-ALLOT: re-allot once an agency was given the record. */
  private readonly hasAgency = (s: Row) => !!text(s, 'CertificationBodyUserId');
  protected readonly chips = computed(() => [
    { key: 'allot', label: 'To allot', count: this.rows().filter((r) => !this.hasAgency(r)).length },
    { key: 'reallot', label: 'To re-allot', count: this.rows().filter(this.hasAgency).length },
  ]);
  /** The tab's rows matching the search box (any value, as the old search), by payment date (no date last). */
  protected readonly shown = computed(() => {
    const reallot = this.tab() === 'reallot';
    const q = this.search().trim().toLowerCase();
    const list = this.rows().filter((r) => this.hasAgency(r) === reallot &&
      (!q || Object.values(r).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))));
    const dir = this.newestFirst() ? -1 : 1;
    const at = (r: Row) => toDate(r['PaidOn'])?.getTime() ?? null;
    return list.sort((a, b) => {
      const x = at(a), y = at(b);
      return x === y ? 0 : x === null ? 1 : y === null ? -1 : (x - y) * dir;
    });
  });
  protected readonly view = new PagedView(() => this.shown(), 10);
  protected readonly picked = computed(() => this.shown().filter((r) => this.selected().has(this.key(r))));
  protected readonly allOnPage = computed(() => {
    const page = this.view.page();
    return page.length > 0 && page.every((r) => this.selected().has(this.key(r)));
  });

  constructor() {
    // The header bell opens a tab: ?type=ALLOT or ?type=REALLOT.
    const type = inject(ActivatedRoute).snapshot.queryParamMap.get('type')?.toUpperCase();
    if (type === 'REALLOT') this.tab.set('reallot');
    void this.load();
  }

  async load(keepPage = false): Promise<void> {
    const request = ++this.request;
    const page = this.view.pageNo();
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.allotList(this.filter));
      if (request !== this.request) return;
      this.rows.set(res.rows ?? []);
      const keys = new Set(this.rows().map(this.key));
      this.selected.update((s) => new Set([...s].filter((k) => keys.has(k))));
      if (keepPage) this.view.goTo(page);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  protected setTab(tab: Tab): void {
    this.tab.set(tab);
    this.clearSelection();
  }

  protected isPicked(s: Row): boolean {
    return this.selected().has(this.key(s));
  }

  protected toggle(s: Row): void {
    const k = this.key(s);
    this.selected.update((set) => {
      const next = new Set(set);
      if (next.has(k)) next.delete(k);
      else if (next.size < BULK_LIMIT) next.add(k);
      return next;
    });
  }

  protected selectPage(on: boolean): void {
    const keys = this.view.page().map(this.key);
    this.selected.update((set) => {
      const next = new Set(set);
      for (const k of keys) {
        if (!on) next.delete(k);
        else if (next.size < BULK_LIMIT) next.add(k);
      }
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Set());
  }

  protected paidOn(s: Row): string {
    return shortDate(s['PaidOn']);
  }

  protected waitDays(s: Row): { days: number; label: string } | null {
    const d = daysUntil(s['PaidOn']);
    if (d === null) return null;
    const days = Math.max(0, -d);
    return { days, label: dayCount(days) };
  }

  /** "Re-allot" as the old RE-ALLOT button: rejected, 72 hours without an answer, given to an agency (Consultancy: or a consultant). */
  protected reAllot(s: Row): boolean {
    return !!(text(s, 'ReasonForRejection') || text(s, 'TimeDuration') || text(s, 'CertificationBodyUserId') ||
      (this.consultancy && text(s, 'DesktopAssessorId')));
  }

  protected status(s: Row): { label: string; cls: string } {
    if (!text(s, 'CertificationBodyUserId')) return { label: 'Allotment Pending', cls: 'is-pending' };
    if (text(s, 'DesktopAssessorId')) return { label: `${this.party} Accepted`, cls: 'is-success' };
    if (text(s, 'ReasonForRejection')) return { label: `${this.party} Rejected`, cls: 'is-rejected' };
    return { label: `Allocated to ${this.party}`, cls: 'is-info' };
  }

  protected menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'profile', label: 'View MSME profile', icon: 'people' }];
    // Only main's old page linked the assessment details from here.
    if (this.main) items.push({ key: 'details', label: 'Assessment details', icon: 'eye' });
    return items;
  }

  /** Where a menu item goes. */
  href(s: Row, key: string): string {
    if (key === 'profile') return '/' + this.legacy.profile(text(s, 'ZedId'));
    const page = num(s, 'CertificationStatus') > 7 ? 'sa-details' : 'da-details';
    return `/staff/assessment/${page}/${encodeURIComponent(text(s, 'ZedId'))}/${encodeURIComponent(text(s, 'Certification'))}`;
  }

  protected act(s: Row, key: string): void {
    void this.router.navigateByUrl(this.href(s, key));
  }

  protected openAllot(units: Row[]): void {
    if (units.length) this.dialog.set([...units]);
  }

  protected allotted(): void {
    this.clearSelection();
    void this.attention.refresh().catch(() => undefined);
    void this.load(true);
  }
}
