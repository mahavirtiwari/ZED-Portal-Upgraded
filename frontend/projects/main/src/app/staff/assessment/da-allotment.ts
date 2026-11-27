import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { MessageResponse } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM, Expanded, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, Person, RejectionReason, Row } from './assessment.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog, ConfirmResult } from '../confirm-dialog';
import { AllotAssessorDialog, AllotChoice, agencyRejectAsk, assessorsForUnit, rejectionOf } from './da-allot-actions';
import { ToastService } from '../toast';
import { TextPipe, t } from '../../content/page-text';

type Stage = 'pending' | 'allotted' | 'rejected';

/**
 * Agency (desktop verification): allot its MSMEs to its desktop assessors, or reject them. Port of
 * Views/Assessment/DaAllotment.cshtml (Assessment/GetList 'DA', AcceptUnitForDa, RejectUnitForDa).
 * Surveillance ("Allot Surveillance Assessments", Bronze): one assessor list; allotting needs no acceptance by the
 * assessor, and the unit can be re-allotted until the assessor starts it in the Surveillance app (status 1).
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, one search
 * box, the SPOC's mobile and e-mail masked (the MSME profile has them), Accept / Re-allot on the row and View profile and
 * Reject in its menu, the reason for a rejection in the confirmation pop-up, a toast when done.</p>
 * <p>2026-11-18 (the user: "show assessment detail during the allocation in the login of assessment agency"): View details
 * on the row and in its menu opens the assessment details page of the unit, a read-only preview of what the applicant
 * submitted with the same Accept / Re-allot and Reject (da-allot-actions.ts). The SPOC's mobile and e-mail in full (the
 * user: nothing masked in the signed-in portal).</p>
 */
@Component({
  selector: 'zed-staff-da-allotment',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, RowMenu, ConfirmDialog, AllotAssessorDialog, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="pageTitle()" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="load()">{{ 'Refresh' | t: 'staff.daAllotment.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage()" [label]="'Units by status' | t: 'staff.daAllotment.countsLabel'" (pick)="pickStage($event.key)" />

    <div class="zed-card da-filters">
      <input type="search" id="da-allot-search" class="form-control da-q" maxlength="50" [placeholder]="'Search ZED ID, unit, SPOC or assessor' | t: 'staff.daAllotment.search.placeholder'"
             [attr.aria-label]="'Search ZED ID, unit, SPOC or assessor' | t: 'staff.daAllotment.search.placeholder'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      @if (surveillance) {
        <!-- That portal's DaAllotment.cshtml: an "Enter ZED ID" search box, applied on Search / Enter. -->
        <div class="input-group da-zed">
          <input type="text" class="form-control" [placeholder]="'Enter ZED ID' | t: 'staff.daAllotment.zedId.placeholder'" [attr.aria-label]="'Enter ZED ID' | t: 'staff.daAllotment.zedId.placeholder'" maxlength="50" [(ngModel)]="zedIdText" (keyup.enter)="searchZedId()" />
          <button type="button" class="btn btn-primary search-zed" [attr.aria-label]="'Search' | t: 'staff.daAllotment.zedId.searchAria'" (click)="searchZedId()"><i class="fa fa-search"></i></button>
        </div>
      }
    </div>

    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>{{ 'Unit' | t: 'staff.daAllotment.column.unit' }}</th>
            <th>{{ 'Level' | t: 'staff.daAllotment.column.level' }}</th>
            <th>{{ 'Unit SPOC' | t: 'staff.daAllotment.column.spoc' }}</th>
            <th>{{ 'Assessor' | t: 'staff.daAllotment.column.assessor' }}</th>
            <th>{{ 'Status' | t: 'staff.daAllotment.column.status' }}</th>
            <th>{{ 'Reason for rejection' | t: 'staff.daAllotment.column.reason' }}</th>
            <th class="text-end">{{ 'Actions' | t: 'staff.daAllotment.column.actions' }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track key(s)) {
            <tr [class.da-flag]="!!col(s, 'DesktopReasonForRejection')">
              <td class="unit unit-cell">
                <b>{{ col(s, 'PUnitName') }}</b>
                <span class="dash-text-clr da-id">{{ col(s, 'ZedId') }}</span>
                <small class="da-addr" [title]="col(s, 'UnitAddress')">{{ col(s, 'UnitAddress') }}</small>
              </td>
              <td><span [class]="'lv-tag lv-' + col(s, 'Certification').toLowerCase()">{{ col(s, 'Certification') }}</span></td>
              <td><b>{{ col(s, 'UnitSpocName') }}</b><span class="sub">{{ col(s, 'UnitSpocMobileNo') }}</span><span class="sub">{{ col(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ col(s, 'DaAssessorName') }}<span class="sub">{{ col(s, 'DesktopAssessorId') }}</span></td>
              <td>
                @if (col(s, 'DesktopReasonForRejection')) { <span class="chip is-bad">{{ 'Assessor rejected' | t: 'staff.daAllotment.row.chip.rejected' }}</span> }
                @if (!col(s, 'DesktopReasonForRejection') && col(s, 'DesktopAssessorId') && (surveillance || !f(s, 'DesktopAccepted'))) {
                  <span class="chip is-info">{{ 'Allotted to assessor' | t: 'staff.daAllotment.row.chip.allotted' }}</span>
                }
                @if (!col(s, 'DesktopAssessorId')) { <span class="chip is-warn">{{ 'Allotment Pending' | t: 'staff.daAllotment.row.chip.pending' }}</span> }
              </td>
              <td class="reason">
                @if (col(s, 'DesktopReasonForRejection'); as reason) {
                  <div [class.clamp-3]="!more.has(key(s))" [title]="reason">{{ reason }}</div>
                  @if (reason.length > 120) {
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="more.toggle(key(s))">{{ more.has(key(s)) ? ('less' | t: 'staff.daAllotment.row.lessButton') : ('more' | t: 'staff.daAllotment.row.moreButton') }}</button>
                  }
                }
              </td>
              <td class="text-end text-nowrap">
                @if (!col(s, 'DesktopAssessorId') && !col(s, 'ReasonForRejection')) {
                  <button type="button" class="btn btn-primary da-act" (click)="openAllot(s)">{{ 'Accept' | t: 'staff.daAllotment.row.acceptButton' }}</button>
                }
                @if (canReallot(s)) {
                  <button type="button" class="btn da-act re-allot" (click)="openAllot(s)">{{ 'Re-allot' | t: 'staff.daAllotment.row.reallotButton' }}</button>
                }
                <a class="btn btn-outline-primary da-act da-view" [routerLink]="detailsLink(s)">{{ 'View details' | t: 'staff.daAllotment.row.detailsButton' }}</a>
                <zed-row-menu [items]="menu(s)" [label]="'More actions for {zedId}' | t: 'staff.daAllotment.row.menuAria' : { zedId: col(s, 'ZedId') }" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr><td colspan="7" style="padding: 0"><div class="no-data">{{ loading() ? ('Loading…' | t: 'staff.daAllotment.loading.text') : ('No unit to show. Units waiting for a desktop assessor, and those you have allotted, are listed here.' | t: 'staff.daAllotment.empty') }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

    @if (allotFor(); as c) {
      <zed-allot-assessor-dialog [unit]="c" [assessors]="assessorsFor(c)" [busy]="busy()" [failed]="modalError()"
                                 (allot)="allot($event)" (cancel)="allotFor.set(null)" />
    }

    @if (rejectFor(); as r) {
      <zed-confirm-dialog [ask]="rejectAsk(r)" [busy]="busy()" [failed]="modalError()" inputId="daRejectReason"
                          (decided)="reject($event)" (cancel)="rejectFor.set(null)" />
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
    .da-act.da-view { min-width: 0; }
  `,
})
export class DaAllotmentPage {
  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  protected readonly legacy = useLegacyPortal();
  protected readonly col = text;
  protected readonly f = flag;
  protected readonly surveillance = inject(ASSESSMENT_SYSTEM) === 'surveillance';

  protected readonly rows = signal<Row[]>([]);
  protected readonly pageTitle = computed(() => this.surveillance ? t('staff.daAllotment.surveillanceTitle', 'Allot Surveillance Assessments')
    : t('staff.daAllotment.title', 'Allot DA Assessments'));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.pageTitle() }));
  protected readonly subtitle = computed(() => this.surveillance
    ? t('staff.daAllotment.surveillance.sub', 'Allot the surveillance assessments to your assessors, re-allot them or reject them.')
    : t('staff.daAllotment.sub', 'Allot the units to your desktop assessors, re-allot the ones an assessor rejected, or reject them.'));
  /** The tile chosen (null: every unit). */
  protected readonly stage = signal<Stage | null>(null);
  private readonly stageOf = (r: Row): Stage =>
    !text(r, 'DesktopAssessorId') ? 'pending' : text(r, 'DesktopReasonForRejection') ? 'rejected' : 'allotted';
  /** Waiting, allotted and rejected by the assessor (the tiles above the list; a click filters it). */
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const n = (s: Stage) => rows.filter((r) => this.stageOf(r) === s).length;
    return [
      { key: 'pending', label: t('staff.daAllotment.count.pendingLabel', 'Allotment pending'), value: n('pending'), tone: 'warn' },
      { key: 'allotted', label: t('staff.daAllotment.count.allottedLabel', 'Allotted to an assessor'), value: n('allotted'), tone: 'good' },
      { key: 'rejected', label: t('staff.daAllotment.count.rejectedLabel', 'Rejected by the assessor'), value: n('rejected'), tone: 'bad' },
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
  /** The active rejection reasons, loaded when the Reject pop-up opens. */
  private readonly reasons = signal<RejectionReason[]>([]);
  protected readonly modalError = signal('');
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

  /** The agency's assessors who may assess the unit (da-allot-actions.ts). */
  protected assessorsFor(s: Row): Person[] {
    return assessorsForUnit(s, this.assessors(), this.bronzeAssessors());
  }

  /** The assessment details page of the unit (a read-only preview while it waits here). */
  protected detailsLink(s: Row): string {
    return `/staff/assessment/da-details/${encodeURIComponent(text(s, 'ZedId'))}/${encodeURIComponent(text(s, 'Certification'))}`;
  }

  /**
   * Main: after the assessor rejected, or while it has not accepted. Surveillance: any allotted unit the assessor has
   * not started in the app (the list holds only those, status 1).
   */
  protected canReallot(s: Row): boolean {
    if (!text(s, 'DesktopAssessorId')) return false;
    return this.surveillance ? num(s, 'CertificationStatus') < 2 : !!text(s, 'DesktopReasonForRejection') || !flag(s, 'DesktopAccepted');
  }

  /** The row menu: the details, the profile, and Reject (as the old REJECT button: before allotment or after the assessor rejected). */
  protected menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [{ key: 'details', label: t('staff.daAllotment.menu.detailsLabel', 'View details'), icon: 'eye' },
      { key: 'profile', label: t('staff.daAllotment.menu.profileLabel', 'View MSME profile'), icon: 'people' }];
    if (!text(s, 'DesktopAssessorId') || text(s, 'DesktopReasonForRejection')) items.push({ key: 'reject', label: t('staff.daAllotment.menu.rejectLabel', 'Reject'), danger: true });
    return items;
  }

  protected act(s: Row, key: string): void {
    if (key === 'details') void this.router.navigateByUrl(this.detailsLink(s));
    else if (key === 'profile') void this.router.navigateByUrl('/' + this.legacy.profile(text(s, 'ZedId')));
    else if (key === 'reject') this.openReject(s);
  }

  protected searchZedId(): void {
    this.zedIdFilter.set(this.zedIdText.trim());
  }

  /** As the old pop-up (a copy of the row): Re-allot opens with the current assessor selected. */
  protected openAllot(s: Row): void {
    this.modalError.set('');
    this.allotFor.set(s);
  }

  /** 2026-11-19 (rejection reasons, approved): the pop-up opens with the reasons the Admin manages. */
  protected async openReject(s: Row): Promise<void> {
    this.modalError.set('');
    this.busy.set(true);
    try {
      this.reasons.set(await firstValueFrom(this.api.rejectionReasons()));
      this.rejectFor.set(s);
    } catch (err) {
      this.toast.error(apiErrorMessage(err), null);
    } finally {
      this.busy.set(false);
    }
  }

  protected rejectAsk(s: Row): ConfirmAsk {
    return agencyRejectAsk(s, this.reasons());
  }

  protected async allot(choice: AllotChoice): Promise<void> {
    const s = this.allotFor();
    if (!s) return;
    await this.run(
      () => this.api.allotToAssessor(text(s, 'ZedId'), text(s, 'Certification'), choice.assessorId),
      () => this.allotFor.set(null),
      t('staff.daAllotment.toast.allotted', '{zedId} allotted', { zedId: text(s, 'ZedId') }),
      t('staff.daAllotment.toast.allottedTo', 'To {name}.', { name: choice.assessorName }),
    );
  }

  /** The toast says what the server did (another agency got the unit, or the ZED team). */
  protected async reject(result: ConfirmResult): Promise<void> {
    const s = this.rejectFor();
    const rejection = rejectionOf(result);
    if (!s || !rejection) return;
    await this.run(
      () => this.api.agencyReject(text(s, 'ZedId'), text(s, 'Certification'), rejection),
      () => this.rejectFor.set(null),
      t('staff.daAllotment.toast.rejected', '{zedId} rejected', { zedId: text(s, 'ZedId') }), (r) => r.message || null,
    );
  }

  private async run(call: () => Observable<MessageResponse>, close: () => void, done: string,
    detail: string | null | ((r: MessageResponse) => string | null)): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      const res = await firstValueFrom(call());
      close();
      this.toast.success(done, typeof detail === 'function' ? detail(res) : detail);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
