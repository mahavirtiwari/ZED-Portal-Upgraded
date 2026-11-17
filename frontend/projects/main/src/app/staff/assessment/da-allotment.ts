import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM, Expanded, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Person, Row, serves } from './assessment.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { mayAssess } from '../users/assessor-scope';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { maskEmail, maskMobile } from '../users/user-display';

type Stage = 'pending' | 'allotted' | 'rejected';

/**
 * Agency (desktop verification): allot its MSMEs to its desktop assessors, or reject them. Port of
 * Views/Assessment/DaAllotment.cshtml (Assessment/GetList 'DA', AcceptUnitForDa, RejectUnitForDa).
 * Surveillance ("Allot Surveillance Assessments", Bronze): one assessor list; allotting needs no acceptance by the
 * assessor, and the unit can be re-allotted until the assessor starts it in the Surveillance app (status 1).
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, one search
 * box, the SPOC's mobile and e-mail masked (the MSME profile has them), Accept / Re-allot on the row and View profile and
 * Reject in its menu, the reason for a rejection in the confirmation pop-up, a toast when done.</p>
 */
@Component({
  selector: 'zed-staff-da-allotment',
  imports: [FormsModule, PagerComponent, PageHead, ListCounts, RowMenu, ConfirmDialog],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" [title]="pageTitle" [subtitle]="subtitle">
      <button type="button" class="btn btn-ph" (click)="load()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage()" label="Units by status" (pick)="pickStage($event.key)" />

    <div class="zed-card da-filters">
      <input type="search" id="da-allot-search" class="form-control da-q" maxlength="50" placeholder="Search ZED ID, unit, SPOC or assessor"
             aria-label="Search ZED ID, unit, SPOC or assessor" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      @if (surveillance) {
        <!-- That portal's DaAllotment.cshtml: an "Enter ZED ID" search box, applied on Search / Enter. -->
        <div class="input-group da-zed">
          <input type="text" class="form-control" placeholder="Enter ZED ID" aria-label="Enter ZED ID" maxlength="50" [(ngModel)]="zedIdText" (keyup.enter)="searchZedId()" />
          <button type="button" class="btn btn-primary search-zed" aria-label="Search" (click)="searchZedId()"><i class="fa fa-search"></i></button>
        </div>
      }
    </div>

    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Level</th>
            <th>Unit SPOC</th>
            <th>Assessor</th>
            <th>Status</th>
            <th>Reason for rejection</th>
            <th class="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track key(s)) {
            <tr [class.da-flag]="!!t(s, 'DesktopReasonForRejection')">
              <td class="unit unit-cell">
                <b>{{ t(s, 'PUnitName') }}</b>
                <span class="dash-text-clr da-id">{{ t(s, 'ZedId') }}</span>
                <small class="da-addr" [title]="t(s, 'UnitAddress')">{{ t(s, 'UnitAddress') }}</small>
              </td>
              <td><span [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ t(s, 'Certification') }}</span></td>
              <!-- Masked in the list; the MSME profile has the full values. -->
              <td><b>{{ t(s, 'UnitSpocName') }}</b><span class="sub">{{ maskMobile(t(s, 'UnitSpocMobileNo')) }}</span><span class="sub">{{ maskEmail(t(s, 'UnitSpocEmailId')) }}</span></td>
              <td>{{ t(s, 'DaAssessorName') }}<span class="sub">{{ t(s, 'DesktopAssessorId') }}</span></td>
              <td>
                @if (t(s, 'DesktopReasonForRejection')) { <span class="chip is-bad">Assessor rejected</span> }
                @if (!t(s, 'DesktopReasonForRejection') && t(s, 'DesktopAssessorId') && (surveillance || !f(s, 'DesktopAccepted'))) {
                  <span class="chip is-info">Allotted to assessor</span>
                }
                @if (!t(s, 'DesktopAssessorId')) { <span class="chip is-warn">Allotment Pending</span> }
              </td>
              <td class="reason">
                @if (t(s, 'DesktopReasonForRejection'); as reason) {
                  <div [class.clamp-3]="!more.has(key(s))" [title]="reason">{{ reason }}</div>
                  @if (reason.length > 120) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="more.toggle(key(s))">{{ more.has(key(s)) ? 'less' : 'more' }}</button>
                  }
                }
              </td>
              <td class="text-end text-nowrap">
                @if (!t(s, 'DesktopAssessorId') && !t(s, 'ReasonForRejection')) {
                  <button type="button" class="btn btn-primary da-act" (click)="openAllot(s)">Accept</button>
                }
                @if (canReallot(s)) {
                  <button type="button" class="btn da-act re-allot" (click)="openAllot(s)">Re-allot</button>
                }
                <zed-row-menu [items]="menu(s)" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" style="padding: 0"><div class="no-data">{{ loading() ? 'Loading…' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

    @if (allotFor(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="daAllotTitle" (click)="allotFor.set(null)">
        <div class="modal-dialog modal-dialog-centered" (click)="$event.stopPropagation()">
          <div class="modal-content da-pop">
            <div class="modal-header justify-content-between">
              <div>
                <h3 class="da-pop-title" id="daAllotTitle">{{ t(c, 'DesktopAssessorId') ? 'Re-allot assessment' : 'Accept assessment' }}</h3>
                <p class="da-pop-sub">{{ t(c, 'ZedId') }} · {{ t(c, 'Certification') }}@if (t(c, 'PUnitName')) { · {{ t(c, 'PUnitName') }} }</p>
              </div>
              <button type="button" class="btn-close" aria-label="Close" (click)="allotFor.set(null)"></button>
            </div>
            <div class="modal-body">
              <label class="form-label" for="daAssessor">Assessor<span class="req">*</span></label>
              <select id="daAssessor" class="form-select" [(ngModel)]="assessorId">
                <option value="">--Select--</option>
                @for (a of assessorsFor(c); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
              </select>
              @if (modalError()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-light" (click)="allotFor.set(null)">Cancel</button>
              <button type="button" class="btn btn-primary da-ok" [disabled]="busy()" (click)="allot()">Allot to assessor</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (rejectFor(); as r) {
      <zed-confirm-dialog [ask]="rejectAsk(r)" [busy]="busy()" [failed]="modalError()" inputId="daRejectReason"
                          (confirmed)="reject($event)" (cancel)="rejectFor.set(null)" />
    }
  `,
  styles: `
    .da-filters { display: flex; flex-wrap: wrap; gap: 10px; padding: 12px 14px; margin-bottom: 14px; }
    .da-q { flex: 2 1 260px; max-width: 460px; }
    .da-zed { flex: 1 1 220px; max-width: 320px; }
    .unit { min-width: 200px; }
    .da-id { display: block; font-size: 12.5px; font-weight: 700; }
    .da-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .reason { min-width: 180px; max-width: 320px; white-space: pre-wrap; }
    tr.da-flag > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    .da-act { min-width: 82px; margin-right: 6px; font-weight: 600; }
    .da-act.re-allot { background: #fff1d6; border-color: #fff1d6; color: #7a4700; }
    .da-act.re-allot:hover { background: #ffe6b5; }
    .da-pop { border: 0; border-radius: 12px; }
    .da-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .da-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
  `,
})
export class DaAllotmentPage {
  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly legacy = useLegacyPortal();
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly maskEmail = maskEmail;
  protected readonly maskMobile = maskMobile;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  protected readonly pageTitle = this.surveillance ? 'Allot Surveillance Assessments' : 'Allot DA Assessments';
  protected readonly crumbs = staffCrumbs({ label: this.pageTitle });
  protected readonly subtitle = this.surveillance
    ? 'Allot the surveillance assessments to your assessors, re-allot them or reject them.'
    : 'Allot the units to your desktop assessors, re-allot the ones an assessor rejected, or reject them.';
  /** The tile chosen (null: every unit). */
  protected readonly stage = signal<Stage | null>(null);
  private readonly stageOf = (r: Row): Stage =>
    !text(r, 'DesktopAssessorId') ? 'pending' : text(r, 'DesktopReasonForRejection') ? 'rejected' : 'allotted';
  /** Waiting, allotted and rejected by the assessor (the tiles above the list; a click filters it). */
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const n = (s: Stage) => rows.filter((r) => this.stageOf(r) === s).length;
    return [
      { key: 'pending', label: 'Allotment pending', value: n('pending'), tone: 'warn' },
      { key: 'allotted', label: 'Allotted to an assessor', value: n('allotted'), tone: 'good' },
      { key: 'rejected', label: 'Rejected by the assessor', value: n('rejected'), tone: 'bad' },
    ];
  });
  /** Surveillance: the ZED ID searched for (applied on Search / Enter, as the old page reloaded the list then). */
  private readonly zedIdFilter = signal('');
  protected zedIdText = '';
  protected readonly filtered = computed(() => {
    const q = this.zedIdFilter().toLowerCase();
    const stage = this.stage();
    return this.rows().filter((s) => (!q || text(s, 'ZedId').toLowerCase().includes(q)) && (!stage || this.stageOf(s) === stage));
  });
  /** The search box above the list (any column). Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.filtered(), this.search()));
  private readonly assessors = signal<Person[]>([]);
  private readonly bronzeAssessors = signal<Person[]>([]);
  protected readonly loading = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly allotFor = signal<Row | null>(null);
  protected readonly rejectFor = signal<Row | null>(null);
  protected readonly modalError = signal('');
  protected assessorId = '';
  protected readonly more = new Expanded();
  protected readonly key = (s: Row) => text(s, 'ZedId') + text(s, 'Certification');

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.daAllotment());
      this.rows.set(res.rows);
      this.assessors.set(res.assessors);
      this.bronzeAssessors.set(res.bronzeAssessors);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** A tile filters the list; the chosen one again shows every unit. */
  protected pickStage(key: string | undefined): void {
    const k = (key ?? null) as Stage | null;
    this.stage.set(this.stage() === k ? null : k);
  }

  /**
   * 2026-11-14: the agency's assessors ticked for the unit's level at the desktop (one kind of assessor; main sends one
   * list with the ticks). Surveillance keeps its own list. V4: only those who assess the unit's kind (Manufacturing / Services).
   */
  protected assessorsFor(s: Row): Person[] {
    const level = text(s, 'Certification');
    const list = level === 'Bronze' ? this.bronzeAssessors() : this.assessors();
    return list.filter((a) => serves(a, s['SectorCategory']) && mayAssess(a, level, 'Desktop'));
  }

  /**
   * Main: after the assessor rejected, or while it has not accepted. Surveillance: any allotted unit the assessor has
   * not started in the app (the list holds only those, status 1).
   */
  protected canReallot(s: Row): boolean {
    if (!text(s, 'DesktopAssessorId')) return false;
    return this.surveillance ? num(s, 'CertificationStatus') < 2 : !!text(s, 'DesktopReasonForRejection') || !flag(s, 'DesktopAccepted');
  }

  /** The row menu: the profile, and Reject (as the old REJECT button: before allotment or after the assessor rejected). */
  protected menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'profile', label: 'View MSME profile', icon: 'people' }];
    if (!text(s, 'DesktopAssessorId') || text(s, 'DesktopReasonForRejection')) items.push({ key: 'reject', label: 'Reject', danger: true });
    return items;
  }

  protected act(s: Row, key: string): void {
    if (key === 'profile') void this.router.navigateByUrl('/' + this.legacy.profile(text(s, 'ZedId')));
    else if (key === 'reject') this.openReject(s);
  }

  protected searchZedId(): void {
    this.zedIdFilter.set(this.zedIdText.trim());
  }

  /** As the old pop-up (a copy of the row): Re-allot opens with the current assessor selected. */
  protected openAllot(s: Row): void {
    this.assessorId = text(s, 'DesktopAssessorId');
    this.modalError.set('');
    this.allotFor.set(s);
  }

  protected openReject(s: Row): void {
    this.modalError.set('');
    this.rejectFor.set(s);
  }

  protected rejectAsk(s: Row): ConfirmAsk {
    return {
      title: 'Reject assessment?',
      message: `${text(s, 'ZedId')} (${text(s, 'Certification')}) goes back to the ZED team with your reason.`,
      confirmLabel: 'Reject',
      danger: true,
      reason: { label: 'Reason for rejection', maxLength: 2000, requiredMessage: 'Please enter reason for rejection.' },
    };
  }

  protected async allot(): Promise<void> {
    const s = this.allotFor();
    if (!s) return;
    if (!this.assessorId) {
      this.modalError.set('Please select valid data.');
      return;
    }
    const to = this.assessorsFor(s).find((a) => a.userId === this.assessorId)?.userName ?? this.assessorId;
    await this.run(
      () => this.api.allotToAssessor(text(s, 'ZedId'), text(s, 'Certification'), this.assessorId),
      () => this.allotFor.set(null),
      `${text(s, 'ZedId')} allotted`, `To ${to}.`,
    );
  }

  protected async reject(reason: string): Promise<void> {
    const s = this.rejectFor();
    if (!s || !reason) return;
    await this.run(
      () => this.api.agencyReject(text(s, 'ZedId'), text(s, 'Certification'), reason),
      () => this.rejectFor.set(null),
      `${text(s, 'ZedId')} rejected`, null,
    );
  }

  private async run(call: () => ReturnType<AssessmentApi['agencyReject']>, close: () => void, done: string, detail: string | null): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(call());
      close();
      this.toast.success(done, detail);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
