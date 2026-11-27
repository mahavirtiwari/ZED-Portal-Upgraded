import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { Assessor, Row, SITE_SYSTEM, SiteAssessmentApi } from './site-assessment.api';
import { CoAllotmentPage } from './co-allotment';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { SaAllotDialog, SiteAllotChoice, siteRejectAsk } from './sa-allot-actions';
import { AssessmentApi, RejectionReason } from '../assessment/assessment.api';
import { rejectionOf } from '../assessment/da-allot-actions';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog, ConfirmResult } from '../confirm-dialog';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { ToastService } from '../toast';
import { TextPipe, t } from '../../content/page-text';

/**
 * "Allot SA Assessments" for agencies with the site verification sub-role. Port of
 * Views/Assessment/SaAllotment.cshtml (Assessment/GetList allotmentType SA, Assessment/AcceptUnitForSa).
 * The old page also had a Reject pop-up, but no button opened it; it is not ported.
 * Surveillance build: "Allot Surveillance" for Silver/Gold surveillance — surveillance date and round, the original
 * certification's assessors, and the meeting link of the external video meeting (mode stored as Onsite, shown as
 * Remote, as before); one "Assessor" and no co-assessor (that page's Co Assessor select was commented out). Consultancy build: the CO allotment page ({@link CoAllotmentPage}) instead.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, the mode as
 * chips, one search box, the SPOC's mobile and e-mail in full (2026-11-18, the user), Allot / Re-allot on the row, a toast when done.</p>
 * <p>2026-11-18 (the user: "accept, reject, view details and other option similar to combination one"): the desktop list's
 * actions: Accept (allot) / Re-allot and View details on the row, View details, View MSME profile and Reject (reason
 * required, back to the ZED team) in its menu. View details opens the assessment details page with the allotment banner
 * (the same Accept and Reject, sa-allot-actions.ts).</p>
 */
@Component({
  selector: 'zed-staff-sa-allotment',
  imports: [FormsModule, RouterLink, CoAllotmentPage, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu, ConfirmDialog, SaAllotDialog, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    @if (system === 'consultancy') {
      <zed-staff-co-allotment />
    } @else {
    <zed-page-head [crumbs]="crumbs()" [title]="pageTitle()" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="load()">{{ 'Refresh' | t: 'staff.saAllotment.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" [label]="'Units by status' | t: 'staff.saAllotment.counts.aria'" (pick)="pickStage($event.key)" />

    <div class="zed-card sa-filters">
      <input type="search" id="sa-allot-search" class="form-control sa-q" maxlength="50" [placeholder]="'Search ZED ID, unit, SPOC or assessor' | t: 'staff.saAllotment.search.placeholder'"
             [attr.aria-label]="'Search ZED ID, unit, SPOC or assessor' | t: 'staff.saAllotment.search.placeholder'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <zed-chip-filter [label]="'Mode' | t: 'staff.saAllotment.mode.label'" [chips]="modeChips()" [value]="mode()" (valueChange)="mode.set($event)" />
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>{{ 'Unit' | t: 'staff.saAllotment.column.unit' }}</th>
            <th>{{ 'Level' | t: 'staff.saAllotment.column.level' }}</th>
            <th>{{ 'Unit SPOC' | t: 'staff.saAllotment.column.spoc' }}</th>
            @if (surveillance) { <th>{{ 'Surveillance Date' | t: 'staff.saAllotment.column.surveillanceDate' }}</th> }
            <th>{{ 'Mode' | t: 'staff.saAllotment.column.mode' }}</th>
            <th>{{ 'Assessors' | t: 'staff.saAllotment.column.assessors' }}</th>
            <th>{{ 'Status' | t: 'staff.saAllotment.column.status' }}</th>
            <th class="text-end">{{ 'Action' | t: 'staff.saAllotment.column.action' }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
            <tr>
              <td class="unit unit-cell">
                <b>{{ s['PUnitName'] }}</b>
                <span class="dash-text-clr sa-id">{{ s['ZedId'] }}</span>
                <small class="sa-addr" [title]="s['UnitAddress'] ?? ''">{{ s['UnitAddress'] }}</small>
              </td>
              <td>
                <span [class]="'lv-tag lv-' + lc(s['Certification'])">{{ s['Certification'] }}</span>
                @if (surveillance && s['SurveillanceNo']) { <span class="sub">{{ s['SurveillanceNo'] }}</span> }
              </td>
              <!-- Masked in the list; the MSME profile has the full values. -->
              <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ str(s['UnitSpocMobileNo']) }}</span><span class="sub mail-cut" [title]="str(s['UnitSpocEmailId'])">{{ str(s['UnitSpocEmailId']) }}</span></td>
              @if (surveillance) { <td class="text-nowrap">{{ s['AssessmentDate'] }}</td> }
              <td>@if (modeOf(s); as m) { <span class="chip is-info">{{ modeName(m) }}</span> }</td>
              <td class="stack">
                <div><span class="muted">{{ s['SiteAssessorId'] }}</span> <strong>{{ s['SaAssessorName'] }}</strong></div>
                @if (surveillance) {
                  <div><span class="muted">{{ s['CoAssessorId'] }}</span> <strong>{{ s['CoAssessorName'] }}</strong></div>
                } @else if (s['CoAssessorName']) {
                  <div><strong>{{ s['CoAssessorName'] }}</strong></div>
                }
              </td>
              <td>
                @if (s['SiteAssessorId']) { <span class="chip is-good">{{ 'Allotted' | t: 'staff.saAllotment.status.allotted.chip' }}</span> }
                @else if (s['ReasonForRejection']) { <span class="chip is-bad">{{ 'Rejected' | t: 'staff.saAllotment.status.rejected.chip' }}</span> }
                @else { <span class="chip is-warn">{{ 'Waiting' | t: 'staff.saAllotment.status.waiting.chip' }}</span> }
              </td>
              <td class="text-end text-nowrap">
                @if (s['SiteAssessorId']) {
                  <button type="button" class="btn sa-act re-allot" (click)="open(s)">{{ 'Re-allot' | t: 'staff.saAllotment.reallotButton' }}</button>
                } @else if (!s['ReasonForRejection']) {
                  <button type="button" class="btn btn-primary sa-act" (click)="open(s)">{{ 'Accept' | t: 'staff.saAllotment.acceptButton' }}</button>
                }
                <a class="btn btn-outline-primary sa-act sa-view" [routerLink]="detailsLink(s)">{{ 'View details' | t: 'staff.saAllotment.viewDetailsButton' }}</a>
                <zed-row-menu [items]="menu(s)" [label]="'More actions for {zedId}' | t: 'staff.saAllotment.row.menuAria' : { zedId: s['ZedId'] }" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr>
              <td [attr.colspan]="surveillance ? 8 : 7" style="padding: 0px"><div class="no-data">{{ busy() ? ('Loading…' | t: 'staff.saAllotment.loading.text') : ('No unit to show. Units waiting for site assessors, and those you have allotted, are listed here.' | t: 'staff.saAllotment.empty') }}</div></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

    @if (form(); as u) {
      <zed-sa-allot-dialog [unit]="u" [assessors]="assessors()" [busy]="busy()" [failed]="formError()" (allot)="allot($event)" (cancel)="close()" />
    }

    @if (rejectFor(); as r) {
      <zed-confirm-dialog [ask]="rejectAsk(r)" [busy]="busy()" [failed]="formError()" inputId="saRejectReason"
                          (decided)="reject($event)" (cancel)="rejectFor.set(null)" />
    }

    @if (busy()) {
      <div class="loadingdiv" role="status" aria-live="polite">
        <div class="text-center text-white">
          <div class="spinner-border text-light"></div>
          <div><small>{{ 'Please wait ...' | t: 'staff.saAllotment.wait.text' }}</small></div>
        </div>
      </div>
    }
    }
  `,
  styles: `
    .sa-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 14px; margin-bottom: 14px; }
    .sa-q { flex: 1 1 260px; max-width: 420px; }
    .unit { min-width: 200px; }
    .sa-id { display: block; font-size: 12.5px; font-weight: 700; }
    .sa-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .stack > div + div { margin-top: 6px; }
    .sa-act { min-width: 82px; font-weight: 600; }
    .sa-act.re-allot { background: #fff1d6; border-color: #fff1d6; color: #7a4700; }
    .sa-act.re-allot:hover { background: #ffe6b5; }
    .sa-act + .sa-act { margin-left: 6px; }
    .sa-act.sa-view { min-width: 0; margin-right: 6px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SaAllotmentPage {
  private readonly api = inject(SiteAssessmentApi);
  private readonly assessmentApi = inject(AssessmentApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly system = inject(SITE_SYSTEM);
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

  protected readonly units = signal<Row[]>([]);
  /** The tile chosen ('waiting' / 'allotted' / 'rejected'; null: every unit) and the mode chip ('' all). */
  protected readonly stage = signal<string | null>(null);
  protected readonly mode = signal('');
  /** The search box above the list (any column). Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly search = signal('');
  private readonly shown = computed(() => {
    const stage = this.stage();
    const mode = this.mode();
    return this.units().filter((r) => (!stage || this.stageOf(r) === stage) && (!mode || this.modeOf(r) === mode));
  });
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));
  protected readonly assessors = signal<Assessor[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  /** The unit whose Accept / Re-allot pop-up is open. */
  protected readonly form = signal<Row | null>(null);
  protected readonly rejectFor = signal<Row | null>(null);
  /** The active rejection reasons, loaded when the Reject pop-up opens. */
  private readonly reasons = signal<RejectionReason[]>([]);

  protected readonly pageTitle = computed(() => this.surveillance
    ? t('staff.saAllotment.surveillance.title', 'Allot Surveillance Assessments (Site)') : t('staff.saAllotment.title', 'Allot SA Assessments'));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.pageTitle() }));
  protected readonly subtitle = computed(() => this.surveillance
    ? t('staff.saAllotment.surveillance.sub', 'Allot the surveillance assessments to your assessors with the date and the meeting link, or re-allot them.')
    : t('staff.saAllotment.sub', 'Allot the site assessments to your assessors with the date and the mode, or re-allot them.'));

  /** Allotted, rejected or waiting (the status chip of the row). */
  private stageOf(r: Row): string {
    return r['SiteAssessorId'] ? 'allotted' : r['ReasonForRejection'] ? 'rejected' : 'waiting';
  }

  /** A tile filters the list; "All units" (or the chosen tile again) shows every unit. */
  protected pickStage(key: string | undefined): void {
    this.stage.set(!key || key === 'all' || key === this.stage() ? null : key);
  }

  protected lc(v: unknown): string {
    return String(v ?? '').toLowerCase();
  }

  /** The unit's mode for the list: surveillance Onsite / Remote, a main unit's flow (Remote) or its allotted mode. */
  protected modeOf(s: Row): string {
    if (this.surveillance) return s['AssessmentMode'] === 'Onsite' ? 'Onsite' : 'Remote';
    if (s['AssessmentMode'] === 'Remote') return 'Remote';
    const m = String(s['ModeOfAssessment'] ?? '');
    return m === 'Remote Assessment' ? 'Remote' : m === 'Onsite Assessment' ? 'Onsite' : '';
  }

  /** The wording of a mode code (modeOf). */
  protected modeName(m: string): string {
    return m === 'Onsite' ? t('staff.saAllotment.mode.onsite.chip', 'Onsite') : m === 'Remote' ? t('staff.saAllotment.mode.remote.chip', 'Remote') : m;
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.units();
    const by = (k: string) => rows.filter((r) => this.stageOf(r) === k).length;
    return [
      { key: 'all', label: t('staff.saAllotment.count.all.label', 'All units'), value: rows.length },
      { key: 'waiting', label: t('staff.saAllotment.count.waiting.label', 'Waiting for allotment'), value: by('waiting'), tone: 'warn' },
      { key: 'allotted', label: t('staff.saAllotment.count.allotted.label', 'Allotted'), value: by('allotted'), tone: 'good' },
      { key: 'rejected', label: t('staff.saAllotment.count.rejected.label', 'Rejected'), value: by('rejected'), tone: 'bad' },
    ];
  });

  /** The units by mode (Onsite / Remote), as chips. */
  protected readonly modeChips = computed<FilterChip[]>(() => {
    const rows = this.units();
    return [
      { key: '', label: t('staff.saAllotment.mode.all.chip', 'All'), count: rows.length },
      { key: 'Onsite', label: this.modeName('Onsite'), count: rows.filter((r) => this.modeOf(r) === 'Onsite').length },
      { key: 'Remote', label: this.modeName('Remote'), count: rows.filter((r) => this.modeOf(r) === 'Remote').length },
    ];
  });

  /** The assessment details page of the unit (with the allotment banner while it waits here). */
  protected detailsLink(s: Row): string {
    return `/staff/assessment/da-details/${encodeURIComponent(this.str(s['ZedId']))}/${encodeURIComponent(this.str(s['Certification']))}`;
  }

  /** The row menu: the details, the profile, and Reject (before a site assessor is allotted, once). */
  protected menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { key: 'details', label: t('staff.saAllotment.menu.details.label', 'View details'), icon: 'eye' },
      { key: 'profile', label: t('staff.saAllotment.menu.profile.label', 'View MSME profile'), icon: 'people' },
    ];
    if (!s['SiteAssessorId'] && !s['ReasonForRejection']) items.push({ key: 'reject', label: t('staff.saAllotment.menu.reject.label', 'Reject'), danger: true });
    return items;
  }

  protected act(s: Row, key: string): void {
    if (key === 'details') void this.router.navigateByUrl(this.detailsLink(s));
    else if (key === 'profile') void this.router.navigateByUrl(`/staff/msme-profile/${encodeURIComponent(this.str(s['ZedId']))}`);
    else if (key === 'reject') void this.openReject(s);
  }

  /** 2026-11-19 (rejection reasons, approved): the pop-up opens with the reasons the Admin manages. */
  protected async openReject(s: Row): Promise<void> {
    this.formError.set('');
    this.busy.set(true);
    try {
      this.reasons.set(await firstValueFrom(this.assessmentApi.rejectionReasons()));
      this.rejectFor.set(s);
    } catch (err) {
      this.toast.error(apiErrorMessage(err), null);
    } finally {
      this.busy.set(false);
    }
  }

  protected rejectAsk(s: Row): ConfirmAsk {
    return siteRejectAsk(s, this.reasons());
  }

  /** The toast says what the server did (another agency got the unit, or the ZED team). */
  protected async reject(result: ConfirmResult): Promise<void> {
    const s = this.rejectFor();
    const rejection = rejectionOf(result);
    if (!s || !rejection) return;
    this.busy.set(true);
    this.formError.set('');
    try {
      const res = await firstValueFrom(this.api.reject(this.str(s['ZedId']), this.str(s['Certification']), rejection));
      this.rejectFor.set(null);
      this.toast.success(t('staff.saAllotment.toast.rejected', '{zedId} rejected', { zedId: s['ZedId'] }), res.message || null);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  constructor() {
    if (this.system !== 'consultancy') void this.load();
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.allotments());
      this.units.set(data.units ?? []);
      this.assessors.set(data.assessors ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Accept / Re-allot (the pop-up opens with the current assessor and meeting link filled in). */
  protected open(unit: Row): void {
    this.formError.set('');
    this.form.set(unit);
  }

  protected close(): void {
    this.form.set(null);
  }

  protected async allot(choice: SiteAllotChoice): Promise<void> {
    const unit = this.form();
    if (!unit) return;
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(this.api.allot(choice.request));
      this.form.set(null);
      this.toast.success(t('staff.saAllotment.toast.allotted', '{zedId} allotted', { zedId: unit['ZedId'] }),
        choice.assessorName ? t('staff.saAllotment.toast.allottedTo', 'To {name}.', { name: choice.assessorName }) : null);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
