import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmDialog } from '../confirm-dialog';
import { ListCount, ListCounts } from '../list-counts';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { RowMenu, RowMenuItem } from '../row-menu';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { SchemeDialogs, day, money, schemeAsks, statusLabel, statusTone } from './scheme-shared';
import {
  NO_SCHEME_FILTER, SCHEME_STATUSES, SchemeFilter, SchemeList, SchemeListItem, SchemeOption, SchemeRole, SchemeStatus, SchemeVerificationApi,
} from './scheme-verification.api';

type Action = 'allot' | 'reallot' | 'resume' | 'rejectHold' | 'accept' | 'reject' | 'approve' | 'back' | 'assessorAccept' | 'return' | 'open'
  | 'onsiteAllot' | 'onsiteReallot' | 'onsiteRename';

/**
 * Which list the route opens (route data): the Master Admin's, the agency's allotment or QC, the assessor's; phase 2: the onsite
 * verification agency's onsite allotment and onsite QC.
 */
type Mode = 'admin' | 'allotment' | 'qc' | 'assessor' | 'onsiteAllotment' | 'onsiteQc';

const TILES: Record<Mode, readonly SchemeStatus[]> = {
  admin: SCHEME_STATUSES,
  allotment: ['WithAgency', 'WithAssessor', 'Verifying', 'Correction', 'Qc', 'Approved', 'Paid', 'Rejected', 'OnHold'],
  qc: ['Qc', 'Approved', 'Paid', 'Rejected'],
  assessor: ['WithAssessor', 'Verifying', 'Correction', 'Qc', 'Approved', 'Paid', 'Rejected', 'OnHold'],
  onsiteAllotment: ['OnsiteWithAgency', 'OnsiteWithAssessor', 'OnsiteVisit', 'Qc', 'Approved', 'Paid', 'Rejected', 'OnHold'],
  onsiteQc: ['Qc', 'Approved', 'Paid', 'Rejected'],
};

const FIRST: Record<Mode, string> = { admin: '', allotment: 'WithAgency', qc: 'Qc', assessor: '', onsiteAllotment: 'OnsiteWithAgency', onsiteQc: 'Qc' };

const ONSITE_MODES: readonly Mode[] = ['onsiteAllotment', 'onsiteQc'];

/**
 * 2026-11-20 (incentive schemes, approved): the scheme applications' lists of the staff, in the staff lists' look (counts tiles that
 * filter, search and filters in one row, one button per row with the rest in the ⋮ menu, pop-ups for every action, the pager).
 * The Master Admin's "Scheme Applications" (allot / re-allot, resume or reject one on hold); the agency's "Scheme Allotment" (accept
 * naming an assessor, reject with a listed reason) and "Scheme QC" (approve an amount, back to the assessor); the assessor's
 * "Scheme Verification" (accept or return, then verify). The API checks every action again.
 */
@Component({
  selector: 'zed-staff-scheme-list',
  imports: [FormsModule, RouterLink, PageHead, ListCounts, PagerComponent, RowMenu, ConfirmDialog, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="title()" [subtitle]="subtitle()" />
    <zed-list-counts class="mb-3" [counts]="tiles()" [selected]="filter().status || null" [label]="'Applications by status' | t: 'staff.schemeVerification.list.countsAria'"
                     (pick)="pickStatus($event)" />
    <div class="zed-card sv-filters" data-filters>
      <div class="sv-row">
        <input type="search" class="form-control sv-q" maxlength="50" [placeholder]="'Search applications' | t: 'staff.schemeVerification.list.search'"
               [attr.aria-label]="'Search applications' | t: 'staff.schemeVerification.list.search'" [value]="search()" (input)="search.set($any($event.target).value)" />
        <select class="form-select sv-sel" [attr.aria-label]="'Scheme' | t: 'staff.schemeVerification.list.schemeAria'" [ngModel]="filter().scheme" (ngModelChange)="setFilter('scheme', $event)">
          <option value="">{{ 'All schemes' | t: 'staff.schemeVerification.list.allSchemes' }}</option>
          @for (s of schemes(); track s.code) { <option [value]="s.code">{{ s.name }}</option> }
        </select>
        @if (mode() === 'admin') {
          <select class="form-select sv-sel" [attr.aria-label]="'State' | t: 'staff.schemeVerification.list.stateAria'" [ngModel]="filter().state" (ngModelChange)="setFilter('state', $event)">
            <option value="">{{ 'All states' | t: 'staff.schemeVerification.list.allStates' }}</option>
            @for (s of states(); track s) { <option [value]="s">{{ s }}</option> }
          </select>
          <div class="sv-dates" role="group" [attr.aria-label]="'Submitted between' | t: 'staff.schemeVerification.list.datesAria'">
            <input type="date" class="form-control" [attr.aria-label]="'Submitted from' | t: 'staff.schemeVerification.list.fromAria'" [ngModel]="filter().from" (ngModelChange)="setFilter('from', $event)" />
            <span>{{ 'to' | t: 'staff.schemeVerification.list.to' }}</span>
            <input type="date" class="form-control" [attr.aria-label]="'Submitted to' | t: 'staff.schemeVerification.list.toAria'" [ngModel]="filter().to" (ngModelChange)="setFilter('to', $event)" />
          </div>
        }
        @if (filtering()) {
          <button type="button" class="btn btn-outline-primary btn-sm" (click)="clearFilters()">{{ 'Clear filters' | t: 'staff.schemeVerification.list.clear' }}</button>
        }
      </div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    <div class="list-card">
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>{{ 'Unit' | t: 'staff.schemeVerification.column.unit' }}</th>
              <th>{{ 'Scheme' | t: 'staff.schemeVerification.column.scheme' }}</th>
              <th>{{ 'Submitted on' | t: 'staff.schemeVerification.column.submitted' }}</th>
              <th class="text-end">{{ 'Claimed (Rs.)' | t: 'staff.schemeVerification.column.claimed' }}</th>
              <th class="text-end">{{ 'Eligible / approved (Rs.)' | t: 'staff.schemeVerification.column.eligible' }}</th>
              @if (mode() === 'admin') { <th>{{ 'Agency' | t: 'staff.schemeVerification.column.agency' }}</th> }
              @if (mode() !== 'assessor') { <th>{{ 'Verification Officer' | t: 'staff.schemeVerification.column.assessor' }}</th> }
              @if (onsite()) { <th>{{ 'Date of verification' | t: 'staff.schemeVerification.column.visit' }}</th> }
              <th>{{ 'Status' | t: 'staff.schemeVerification.column.status' }}</th>
              <th class="text-end">{{ 'Action' | t: 'staff.schemeVerification.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of view.page(); track r.id) {
              @let acts = actions(r);
              <tr>
                <td class="unit-cell"><b>{{ r.unitName || r.zedId }}</b><small>{{ r.zedId }}@if (onsite() && r.district) { · {{ r.district }} }@if (r.state) { · {{ r.state }} }</small></td>
                <td class="unit-cell"><b>{{ r.schemeName }}</b>@if (r.levelName) { <small>{{ r.levelName }}</small> }</td>
                <td class="text-nowrap">{{ day(r.submittedOn) }}</td>
                <td class="text-end">{{ money(r.claimAmount) }}</td>
                <td class="text-end">{{ r.approvedAmount !== null ? money(r.approvedAmount) : r.eligibleAmount !== null ? money(r.eligibleAmount) : '–' }}</td>
                @if (mode() === 'admin') {
                  <td class="unit-cell">
                    @if (r.agency) { <b>{{ r.agencyName || r.agency }}</b><small>{{ r.agency }}@if (r.allotmentType === 'RoundRobin') { <span class="zed-chip sv-auto">{{ 'Auto' | t: 'staff.schemeVerification.row.auto' }}</span> }</small> }
                    @else { <span class="sub">{{ 'Not yet allotted' | t: 'staff.schemeVerification.row.notAllotted' }}</span> }
                    @if (r.onsiteAgency) {
                      <small class="d-block sv-onsite">{{ 'Onsite: {name}' | t: 'staff.schemeVerification.row.onsiteAgency' : { name: r.onsiteAgencyName || r.onsiteAgency } }}@if (r.onsiteAllotmentType === 'RoundRobin') { <span class="zed-chip sv-auto">{{ 'Auto' | t: 'staff.schemeVerification.row.auto' }}</span> }</small>
                    }
                  </td>
                }
                @if (mode() !== 'assessor') {
                  <td class="unit-cell">
                    @if (onsite()) {
                      @if (r.onsiteAssessor) { <b>{{ r.onsiteAssessorName || r.onsiteAssessor }}</b><small>{{ r.onsiteAssessor }}</small> }
                      @else { <span class="sub">{{ 'Not yet named' | t: 'staff.schemeVerification.row.notNamed' }}</span> }
                    } @else {
                      @if (r.assessor) { <b>{{ r.assessorName || r.assessor }}</b><small>{{ r.assessor }}</small> }
                      @else { <span class="sub">{{ 'Not yet named' | t: 'staff.schemeVerification.row.notNamed' }}</span> }
                      @if (mode() === 'admin' && r.onsiteAssessor) {
                        <small class="d-block sv-onsite">{{ 'Onsite: {name}' | t: 'staff.schemeVerification.row.onsiteAssessor' : { name: r.onsiteAssessorName || r.onsiteAssessor } }}</small>
                        @if (r.visitStartedOn) { <small class="d-block sv-onsite">{{ 'Verified on {date}' | t: 'staff.schemeVerification.row.visitOn' : { date: day(r.visitStartedOn) } }}</small> }
                      }
                    }
                  </td>
                }
                @if (onsite()) { <td class="text-nowrap">{{ r.visitStartedOn ? day(r.visitStartedOn) : '–' }}</td> }
                <td>
                  <span class="chip" [class]="'chip ' + statusTone(r.status)" [attr.title]="r.holdReason || r.reasonForRejection || r.agencyRemarks || null">{{ statusLabel(r.status) }}</span>
                  @if (r.status === 'Correction' && r.correctionDueOn) {
                    <small class="d-block sub">{{ 'Round {round} · due {due}' | t: 'staff.schemeVerification.row.correctionDue' : { round: r.correctionRound, due: day(r.correctionDueOn) } }}</small>
                  }
                </td>
                <td class="text-end">
                  <div class="sv-act">
                    @if (acts[0]; as a) {
                      @if (a.key === 'open') {
                        <a class="btn btn-outline-primary btn-sm" [routerLink]="[r.id]">{{ a.label }}</a>
                      } @else {
                        <button type="button" class="btn btn-primary btn-sm" (click)="act(r, a.key)">{{ a.label }}</button>
                      }
                    }
                    @if (acts.length > 1) {
                      <zed-row-menu [items]="acts.slice(1)" [label]="'More actions for {name}' | t: 'staff.schemeVerification.row.menuAria' : { name: r.unitName || r.zedId }" (picked)="act(r, $event)" />
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!loading()) {
                <tr><td colspan="10" style="padding: 0"><div class="no-data">{{ search() || filtering() ? ('No application matches the search or filter.' | t: 'staff.schemeVerification.list.searchEmpty') : ('No application here.' | t: 'staff.schemeVerification.list.empty') }}</div></td></tr>
              }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>

    @if (dialogs.current(); as d) {
      <zed-confirm-dialog [ask]="d.ask" [busy]="dialogs.busy()" [failed]="dialogs.failed()" inputId="sv-dialog-text" (decided)="dialogs.confirm($event)" (cancel)="dialogs.close()" />
    }
    @if (loading()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .sv-filters { padding: 11px 15px; margin-bottom: 16px; }
    .sv-row { display: flex; flex-wrap: wrap; gap: 12px 16px; align-items: center; }
    .sv-q { flex: 0 1 300px; }
    .sv-sel { flex: 0 1 220px; }
    .sv-dates { display: flex; gap: 6px; align-items: center; flex: 0 1 340px; font-size: 13px; color: #5f6f70; }
    .sv-dates .form-control { min-width: 0; }
    .sv-row .form-select, .sv-row .form-control { height: 38px; border: 1.2px solid #b9cdcf; border-radius: 9px; font-size: 13px; }
    .sv-act { display: inline-flex; align-items: center; gap: 8px; white-space: nowrap; }
    .sv-auto { background: #e7f3f4; color: #2f6f75; margin-left: 4px; }
    .sv-onsite { color: #5f6f70; margin-top: 2px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SchemeListPage {
  private readonly api = inject(SchemeVerificationApi);
  private readonly toast = inject(ToastService);
  private readonly snapshot = inject(ActivatedRoute).snapshot;
  protected readonly mode = signal<Mode>((this.snapshot.data['mode'] as Mode) ?? 'admin');
  protected readonly onsite = computed(() => ONSITE_MODES.includes(this.mode()));
  protected readonly role = computed<SchemeRole>(() =>
    this.mode() === 'admin' ? 'admin' : this.mode() === 'assessor' ? 'assessor' : this.onsite() ? 'onsite' : 'agency');

  protected readonly title = computed(() => {
    switch (this.mode()) {
      case 'allotment': return t('staff.schemeVerification.allotment.title', 'Scheme Allotment');
      case 'qc': return t('staff.schemeVerification.qc.title', 'Scheme QC');
      case 'assessor': return t('staff.schemeVerification.assessor.title', 'Scheme Verification');
      case 'onsiteAllotment': return t('staff.schemeVerification.onsiteAllotment.title', 'Scheme Onsite Allotment');
      case 'onsiteQc': return t('staff.schemeVerification.onsiteQc.title', 'Scheme Onsite QC');
      default: return t('staff.schemeVerification.admin.title', 'Scheme Applications');
    }
  });
  protected readonly subtitle = computed(() => {
    switch (this.mode()) {
      case 'allotment': return t('staff.schemeVerification.allotment.sub', 'Accept the applications allotted to your agency naming a verification officer, or reject them with a reason.');
      case 'qc': return t('staff.schemeVerification.qc.sub', 'Approve the amount your verification officer recommended, or send the application back with remarks.');
      case 'assessor': return t('staff.schemeVerification.assessor.sub', 'Accept the applications your agency named you for and verify each answer and document.');
      case 'onsiteAllotment': return t('staff.schemeVerification.onsiteAllotment.sub', 'Accept the applications allotted to your agency for onsite verification naming a verification officer (no date: the day of the visit is the date of verification), or reject them with a reason.');
      case 'onsiteQc': return t('staff.schemeVerification.onsiteQc.sub', 'Check your verification officer’s onsite report and approve the amount, or send the application back to the verification officer with remarks.');
      default: return t('staff.schemeVerification.admin.sub', 'Applications go to agencies by round robin as they are submitted; you can allot, re-allot and decide on those on hold.');
    }
  });
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));

  protected readonly data = signal<SchemeList | null>(null);
  protected readonly rows = computed(() => this.data()?.rows ?? []);
  protected readonly schemes = computed<SchemeOption[]>(() => this.data()?.schemes ?? []);
  protected readonly states = computed(() => this.data()?.states ?? []);
  // 2026-11-24: ?status= (a status of this list's tiles) opens it on that status (the bell and the incentives dashboard link there).
  protected readonly filter = signal<SchemeFilter>({ ...NO_SCHEME_FILTER, status: this.startStatus() });
  private startStatus(): string {
    const asked = this.snapshot.queryParamMap?.get('status') ?? '';
    return asked && (TILES[this.mode()] as readonly string[]).includes(asked) ? asked : FIRST[this.mode()];
  }
  protected readonly filtering = computed(() => { const f = this.filter(); return !!(f.scheme || f.state || f.from || f.to); });
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.rows(), this.search()));
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly dialogs = new SchemeDialogs(this.toast, () => this.load());

  protected readonly tiles = computed<ListCount[]>(() => {
    const counts = this.data()?.counts ?? {};
    return TILES[this.mode()].map((s) => ({ key: s, label: statusLabel(s), value: counts[s] ?? 0, tone: s === FIRST[this.mode()] || s === 'OnHold' ? 'warn' : s === 'Rejected' ? 'bad' : s === 'Approved' || s === 'Paid' ? 'good' : undefined }));
  });

  protected readonly statusLabel = statusLabel;
  protected readonly statusTone = statusTone;
  protected readonly money = money;
  protected readonly day = day;

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.data.set(await firstValueFrom(this.api.list(this.role(), this.filter())));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected pickStatus(c: ListCount): void {
    const key = c.key ?? '';
    this.filter.set({ ...this.filter(), status: this.filter().status === key ? '' : key });
    void this.load();
  }

  protected setFilter(key: keyof SchemeFilter, value: string): void {
    const f = { ...this.filter(), [key]: value ?? '' };
    if (f.from && f.to && f.from > f.to) {
      this.error.set(t('staff.schemeVerification.list.datesError', "The 'from' date is after the 'to' date."));
      return;
    }
    this.filter.set(f);
    void this.load();
  }

  protected clearFilters(): void {
    this.filter.set({ ...NO_SCHEME_FILTER, status: this.filter().status });
    void this.load();
  }

  /** The row's actions: the first is its button, the others are in the ⋮ menu. */
  protected actions(r: SchemeListItem): (RowMenuItem & { key: Action })[] {
    const list: (RowMenuItem & { key: Action })[] = [];
    const add = (key: Action, label: string, icon: RowMenuItem['icon'], danger = false) => list.push({ key, label, icon, danger });
    switch (this.mode()) {
      case 'admin':
        if (r.status === 'Submitted') add('allot', t('staff.schemeVerification.action.allot', 'Allot'), 'people');
        if (r.status === 'WithAgency') add('reallot', t('staff.schemeVerification.action.reallot', 'Re-allot'), 'refresh');
        if (r.status === 'OnsiteAllot') add('onsiteAllot', t('staff.schemeVerification.action.onsiteAllot', 'Allot onsite'), 'people');
        if (r.status === 'OnsiteWithAgency') add('onsiteReallot', t('staff.schemeVerification.action.onsiteReallot', 'Re-allot onsite'), 'refresh');
        if (r.status === 'OnHold') {
          add('resume', t('staff.schemeVerification.action.resume', 'Resume'), 'unlock');
          add('rejectHold', t('staff.schemeVerification.action.reject', 'Reject'), 'trash', true);
        }
        break;
      case 'onsiteAllotment':
      case 'onsiteQc':
        if (r.status === 'OnsiteWithAgency') {
          add('accept', t('staff.schemeVerification.action.accept', 'Accept'), 'people');
          add('reject', t('staff.schemeVerification.action.reject', 'Reject'), 'trash', true);
        }
        if (r.status === 'OnsiteWithAssessor' && !r.visitStartedOn) add('onsiteRename', t('staff.schemeVerification.action.rename', 'Change verification officer'), 'people');
        if (r.status === 'Qc') {
          add('approve', t('staff.schemeVerification.action.approve', 'Approve'), 'award');
          add('back', t('staff.schemeVerification.action.back', 'Back to verification officer'), 'refresh');
        }
        break;
      case 'allotment':
      case 'qc':
        if (r.status === 'WithAgency') {
          add('accept', t('staff.schemeVerification.action.accept', 'Accept'), 'people');
          add('reject', t('staff.schemeVerification.action.reject', 'Reject'), 'trash', true);
        }
        if (r.status === 'Qc') {
          add('approve', t('staff.schemeVerification.action.approve', 'Approve'), 'award');
          add('back', t('staff.schemeVerification.action.back', 'Back to verification officer'), 'refresh');
        }
        break;
      case 'assessor':
        if (r.status === 'WithAssessor') {
          add('assessorAccept', t('staff.schemeVerification.action.accept', 'Accept'), 'people');
          add('return', t('staff.schemeVerification.action.return', 'Return to agency'), 'refresh', true);
        }
        break;
    }
    const verify = this.mode() === 'assessor' && r.status === 'Verifying';
    add('open', verify ? t('staff.schemeVerification.action.verify', 'Verify') : t('staff.schemeVerification.action.view', 'View details'), 'eye');
    return list;
  }

  protected async act(r: SchemeListItem, key: string): Promise<void> {
    const ref = { id: r.id, zedId: r.zedId, unitName: r.unitName, schemeName: r.schemeName, agency: r.agency, eligibleAmount: r.eligibleAmount, onsiteAgency: r.onsiteAgency ?? null };
    const onsite = this.onsite();
    try {
      let d;
      switch (key as Action) {
        case 'allot': case 'reallot': this.loading.set(true); d = await schemeAsks.allot(this.api, ref); break;
        case 'onsiteAllot': case 'onsiteReallot': this.loading.set(true); d = await schemeAsks.onsiteAllot(this.api, ref); break;
        case 'resume': d = schemeAsks.resume(this.api, ref); break;
        case 'rejectHold': d = schemeAsks.rejectOnHold(this.api, ref); break;
        case 'accept': this.loading.set(true); d = onsite ? await schemeAsks.accept(this.api, ref, true) : await schemeAsks.accept(this.api, ref); break;
        case 'onsiteRename': this.loading.set(true); d = await schemeAsks.accept(this.api, ref, true, true); break;
        case 'reject': this.loading.set(true); d = onsite ? await schemeAsks.agencyReject(this.api, ref, true) : await schemeAsks.agencyReject(this.api, ref); break;
        case 'approve': d = onsite ? schemeAsks.approve(this.api, ref, true) : schemeAsks.approve(this.api, ref); break;
        case 'back': d = onsite ? schemeAsks.back(this.api, ref, true) : schemeAsks.back(this.api, ref); break;
        case 'assessorAccept': d = schemeAsks.assessorAccept(this.api, ref); break;
        case 'return': d = schemeAsks.assessorReturn(this.api, ref); break;
        default: return;
      }
      this.dialogs.open(d.ask, d.run);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
