import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { ASSESSMENT_SYSTEM, STATES, milestoneReportUrl, num, reportPageHref, text, useLegacyPortal } from './assessment-shared';
import { PagerComponent, ServerPager } from '../pager';
import { AssessmentApi, ResultsFilter, Row } from './assessment.api';
import { withApiBase } from '../../api-base';
import { HANDHOLDING_LEVEL_CODES, levelCodes, levelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';
import { AttentionService } from '../attention';
import { TableExport } from '../table-export';
import { AllotDialog, daysUntil, place, shortDate } from './allot';

/** Certificates and reports for staff (authorised downloads, same visibility as the DA review page). */
const DOCUMENTS_API = withApiBase('/api/staff/certification-documents');

/** Most rows one export reads (pages of 200 from the list's API). */
const EXPORT_LIMIT = 10_000;

/**
 * Completed and rejected certifications of the master admin, the agency or the assessor. Port of
 * Views/Assessment/Completed.cshtml and Rejected.cshtml (Assessment/GetCompletedList, paged on the
 * server). Certificates and reports download from this portal; profiles and site-assessment pages
 * open on the current portal.
 * <p>Consultancy ("Consultancy Completed"; no rejected list): one row per completed milestone, with the milestone
 * reports and "Recommended Technologies" after milestone 3. Surveillance ("Completed / Rejected Surveillance"):
 * Surveillance No; no phase, due-date, duplicates or pledge columns; Completed has a Gender filter and one search box that
 * searches any column as you type (on the server), Rejected only the Certification Level filter; the agency's "Assessment
 * Details" opens SaDetails from status 9.</p>
 * <p>2026-11-17 (approved staff-11 / staff-12): district and state instead of the address, the row's buttons in one row menu,
 * the surveillance due date flagged "in N days" within 90 days, Export (the rows the list's API returns for the filter), and
 * on the Rejected list the reason for rejection and, for the master admin, Re-allot on the row when the unit is back on the
 * Allot list (the allot pop-up and endpoint). The designs' "certified this month", "surveillance due in 90 days",
 * "duplicates", "waiting" and "re-allotted" tiles are not shown: the paged API gives no such counts.</p>
 */
@Component({
  selector: 'zed-staff-assessment-results',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, RowMenu, AllotDialog],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="heading()" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="search()">Refresh</button>
      @if (completed()) {
        <button type="button" class="btn btn-outline-primary" [disabled]="exporting() || !pager.total()" (click)="exportRows()">{{ exporting() ? 'Exporting…' : 'Export' }}</button>
      }
    </zed-page-head>
    <zed-list-counts [counts]="[{ label: completed() ? 'Completed' : 'Rejected', value: pager.total(), tone: completed() ? 'good' : 'bad' }]" />

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="zed-card rs-filters">
      @if (surveillance && !completed()) {
        <!-- Rejected Surveillance (that portal's Rejected.cshtml): only the level, Bronze/Silver/Gold. -->
        <div class="filter">
          <label class="form-label" for="resLevel">Certification level</label>
          <select class="form-select" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
            @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
          </select>
        </div>
      } @else {
        <div class="filter">
          <label class="form-label" for="resState">State</label>
          <select class="form-select" id="resState" [(ngModel)]="state" (ngModelChange)="search()">
            <option value="">Show all</option>
            @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="resLevel">{{ consultancy ? 'Desired certification' : 'Certification level' }}</label>
          <select class="form-select" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
            <option value="">Show all</option>
            @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="resSize">MSME size</label>
          <select class="form-select" id="resSize" [(ngModel)]="size" (ngModelChange)="search()">
            <option value="">Show all</option>
            <option value="Micro">Micro</option>
            <option value="Small">Small</option>
            <option value="Medium">Medium</option>
          </select>
        </div>
        @if (surveillance) {
          <!-- Completed Surveillance's Gender filter (the procedure's @Gender), with the old option values. -->
          <div class="filter">
            <label class="form-label" for="resGender">Gender</label>
            <select class="form-select" id="resGender" [(ngModel)]="gender" (ngModelChange)="search()">
              <option value="">Show all</option>
              @for (g of genders; track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }
            </select>
          </div>
          <!-- Completed Surveillance: one search box that filters as you type (the old SearchText). -->
          <div class="filter wide">
            <label class="form-label" for="resSearch">Search</label>
            <input type="text" id="resSearch" class="form-control" placeholder="Search" maxlength="50" [(ngModel)]="searchText" (ngModelChange)="search()" />
          </div>
        } @else {
          <div class="filter">
            <label class="form-label" for="resSearchBy">Search by</label>
            <select class="form-select" id="resSearchBy" [(ngModel)]="searchBy">
              <option value="Zed Id">ZED ID</option>
              <option value="Udyam Number">Udyam number</option>
              <option value="Unit Name">Unit name</option>
            </select>
          </div>
          <div class="filter wide">
            <label class="form-label" for="resSearch">{{ searchLabel() }}</label>
            <div class="rs-q">
              <input type="text" id="resSearch" class="form-control" maxlength="50" [(ngModel)]="searchText" (keyup.enter)="search()" />
              <button type="button" class="btn btn-primary" (click)="search()">Search</button>
            </div>
          </div>
        }
      }
    </div>

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          @if (consultancy) {
            <tr>
              <th>Unit</th>
              <th>Level / Milestone</th>
              @if (!isAgency()) { <th>CO</th> }
              @if (!isAssessor()) { <th>Consultants</th> }
              <th>Allotted / Completed</th>
              <th class="text-end">Actions</th>
            </tr>
          } @else if (completed()) {
            <tr>
              <th>Unit</th>
              <th>{{ surveillance ? 'Level / Surveillance No' : 'Level' }}</th>
              @if (!surveillance) { <th>Phase</th> }
              <th>Mode</th>
              @if (!isAgency()) { <th>Agency</th> }
              @if (!isAssessor()) { <th>Assessor</th> }
              @if (isAssessor()) {
                <th>Assessment allocated on</th>
                <th>Assessment completed on</th>
              } @else {
                <th>Completed on</th>
                @if (!surveillance) { <th>Surveillance due</th> }
              }
              @if (!surveillance) { <th class="text-center">Duplicates</th> }
              @if (!isAssessor()) { <th class="text-end">Actions</th> }
            </tr>
          } @else {
            <tr>
              <th>Unit</th>
              <th>Level</th>
              @if (isMasterAdmin()) { <th>Agency</th> }
              <th>Assessed on</th>
              <th>Rejected on</th>
              <th>Reason for rejection</th>
              <th class="text-end">Action</th>
            </tr>
          }
        </thead>
        <tbody>
          @for (s of rows(); track $index) {
            @if (consultancy) {
              <tr [class.rs-rej]="!!t(s, 'ReasonForRejection')">
                <td class="unit-cell">
                  <b>{{ t(s, 'PUnitName') }}</b><span class="dash-text-clr rs-id">{{ t(s, 'ZedId') }}</span><small>{{ place(s) }}</small>
                  @if (t(s, 'ReasonForRejection')) { <span class="chip is-bad" [title]="t(s, 'ReasonForRejection')">Rejected</span> }
                </td>
                <td><span [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ levelName(t(s, 'Certification')) }}</span><small class="sub">Milestone {{ t(s, 'NcCount') }}</small></td>
                @if (!isAgency()) {
                  <td><b>{{ t(s, 'AgencyName') }}</b><small class="sub">{{ t(s, 'CertificationBodyUserId') }}</small></td>
                }
                @if (!isAssessor()) {
                  <td class="stack">
                    <div><small class="sub">Lead consultant</small><b>{{ t(s, 'SiteAssessorName') }}</b><small class="sub">{{ t(s, 'SiteAssessorId') }}</small></div>
                    @if (t(s, 'CoAssessorName') || t(s, 'CoAssessorId')) {
                      <div><small class="sub">CO consultant</small><b>{{ t(s, 'CoAssessorName') }}</b><small class="sub">{{ t(s, 'CoAssessorId') }}</small></div>
                    }
                  </td>
                }
                <td class="stack text-nowrap"><div>{{ t(s, 'DocVerifiAllot') }}</div><div>{{ t(s, 'CertificationStatusDate') }}</div></td>
                <td class="text-end text-nowrap">
                  @if (recTech(s); as label) {
                    <a [routerLink]="['/staff/consultancy/technology', t(s, 'ZedId'), t(s, 'Certification')]" class="btn btn-sm rs-act"
                       [class.btn-primary]="label === 'Recommend Technologies'" [class.btn-outline-primary]="label !== 'Recommend Technologies'">{{ label }}</a>
                  }
                  @if (menu(s); as items) { @if (items.length) { <zed-row-menu [items]="items" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" /> } }
                </td>
              </tr>
            } @else if (completed()) {
              <!-- As the old Completed list: a rejected unit's row marked (the reason on hover). -->
              <tr [class.rs-rej]="!!t(s, 'ReasonForRejection')">
                <td class="unit-cell">
                  <b>{{ t(s, 'PUnitName') }}</b><span class="dash-text-clr rs-id">{{ t(s, 'ZedId') }}</span><small>{{ place(s) }}</small>
                  @if (t(s, 'ReasonForRejection')) { <span class="chip is-bad" [title]="t(s, 'ReasonForRejection')">Rejected</span> }
                </td>
                <td>
                  <span [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ levelName(t(s, 'Certification')) }}</span>
                  @if (surveillance) { <small class="sub">{{ t(s, 'SurveillanceNo') }}</small> }
                </td>
                @if (!surveillance) {
                  <td>@if (t(s, 'CertificationPhase'); as ph) { <span class="chip" [class.is-good]="ph === 'ACTIVE'" [class.is-bad]="badPhase(ph)">{{ ph }}</span> }</td>
                }
                <td><span class="chip is-info">{{ mode(s) }}</span></td>
                @if (!isAgency()) {
                  <td><b>{{ t(s, 'AgencyName') }}</b><small class="sub">{{ t(s, 'CertificationBodyUserId') }}</small></td>
                }
                @if (!isAssessor()) {
                  <td class="stack">
                    @for (p of assessors(s); track $index) { <div><b>{{ p.name }}</b><small class="sub">{{ p.id }}</small></div> }
                  </td>
                }
                @if (isAssessor()) {
                  <td class="stack">
                    <div>@if (t(s, 'DeskAssessment') === 'D') { {{ t(s, 'DocVerifiAllot') }} }</div>
                    <div>@if (t(s, 'SiteAssessment') === 'S') { {{ t(s, 'ScheduledOn') }} }</div>
                  </td>
                  <td class="stack">
                    <div>@if (t(s, 'DeskAssessment') === 'D') { {{ t(s, 'DesktopVerificationCompleted') }} }</div>
                    <div>@if (t(s, 'SiteAssessment') === 'S') { {{ t(s, 'CompletedOn') }} }</div>
                  </td>
                } @else {
                  <td class="text-nowrap">
                    {{ shortDate(t(s, 'CertificationStatusDate')) || t(s, 'CertificationStatusDate') }}
                    @if (t(s, 'DocVerifiAllot')) { <small class="sub">Allotted {{ t(s, 'DocVerifiAllot') }}</small> }
                    @if (t(s, 'SaAssessmentDate')) { <small class="sub">Assessed {{ t(s, 'SaAssessmentDate') }}</small> }
                  </td>
                  @if (!surveillance) {
                    <td class="text-nowrap">
                      @if (t(s, 'FirstSurveDueDate')) {
                        @if (t(s, 'Certification') !== 'Bronze') { <small class="sub">Surveillance 1</small> }
                        {{ shortDate(t(s, 'FirstSurveDueDate')) || t(s, 'FirstSurveDueDate') }}
                        @if (dueFlag(s); as f) { <span class="chip" [class]="'chip ' + f.cls">{{ f.label }}</span> }
                      }
                    </td>
                  }
                }
                @if (!surveillance) {
                  <td class="text-center"><b [class.rs-dup]="n(s, 'SameUdyamAddress') > 0">{{ t(s, 'SameUdyamAddress') }}</b></td>
                }
                @if (!isAssessor()) {
                  <td class="text-end"><zed-row-menu [items]="menu(s)" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" /></td>
                }
              </tr>
            } @else {
              <!-- As the old Rejected list: an open NC (NcStatus 2, status 4 or 14) marked. -->
              <tr [class.rs-nc]="n(s, 'NcStatus') === 2 && (n(s, 'CertificationStatus') === 4 || n(s, 'CertificationStatus') === 14)">
                <td class="unit-cell"><b>{{ t(s, 'PUnitName') }}</b><span class="dash-text-clr rs-id">{{ t(s, 'ZedId') }}</span><small>{{ place(s) }}</small></td>
                <td><span [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ levelName(t(s, 'Certification')) }}</span></td>
                @if (isMasterAdmin()) { <td><b>{{ t(s, 'AgencyName') }}</b><small class="sub">{{ t(s, 'CertificationBodyUserId') }}</small></td> }
                <td class="text-nowrap">{{ shortDate(t(s, 'SaAssessmentDate')) || t(s, 'SaAssessmentDate') }}</td>
                <td class="text-nowrap">{{ shortDate(t(s, 'CertificationStatusDate')) || t(s, 'CertificationStatusDate') }}</td>
                <td class="rs-reason">{{ t(s, 'ReasonForRejection') }}</td>
                <td class="text-end text-nowrap">
                  @if (reallotRow(s); as r) {
                    <button type="button" class="btn btn-primary btn-sm rs-act" (click)="reallot.set([r])">Re-allot</button>
                  }
                  <zed-row-menu [items]="menu(s)" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" />
                </td>
              </tr>
            }
          } @empty {
            <tr><td colspan="12" style="padding: 0"><div class="no-data">{{ loading() ? 'Loading…' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>

    <zed-pager [pager]="pager" [sizes]="sizes" />
    </div>

    @if (reallot(); as units) {
      <zed-allot-dialog [units]="units" (changed)="reallotted()" (closed)="reallot.set(null)" />
    }
  `,
  styles: `
    .rs-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 12px 14px; margin-bottom: 14px; }
    .rs-filters .filter { flex: 1 1 150px; min-width: 0; }
    .rs-filters .filter.wide { flex: 2 1 260px; }
    .rs-filters .form-label { font-size: 12.5px; color: #5f6f70; margin-bottom: 4px; }
    .rs-q { display: flex; gap: 8px; }
    .rs-id { display: block; font-size: 12.5px; font-weight: 700; }
    .unit-cell { min-width: 200px; }
    .stack > div + div { margin-top: 6px; }
    .stack b { display: block; }
    td .chip { margin-top: 4px; }
    tr.rs-rej > td:first-child, tr.rs-nc > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    tr.rs-nc > td:first-child { box-shadow: inset 3px 0 0 #e0a100; }
    .rs-dup { color: #c0392b; }
    .rs-reason { min-width: 200px; max-width: 360px; white-space: pre-wrap; }
    .rs-act { margin-right: 6px; font-weight: 600; }
  `,
})
export class AssessmentResultsPage {
  /** Route data: which list. */
  readonly kind = input<'completed' | 'rejected'>('completed');

  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly attention = inject(AttentionService);
  private readonly exporter = inject(TableExport);
  private readonly user = inject(AuthService).currentUser;
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly t = text;
  protected readonly n = num;
  protected readonly place = place;
  protected readonly shortDate = shortDate;
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? [...HANDHOLDING_LEVEL_CODES] : levelCodes()));
  protected readonly levelName = levelName;
  /** Consultancy rows open the milestone review page; the others the site assessment details page. */
  protected readonly milestoneDetailsRoute = this.system === 'consultancy' ? '/staff/consultancy/milestones' : '/staff/assessment/sa-details';

  protected state = '';
  protected level = '';
  protected size = '';
  /** Surveillance Completed only: value and label of the old Gender options, in their order. */
  protected readonly genders = [['male', 'Male'], ['female', 'Female'], ['Others', 'Others']] as const;
  protected gender = '';
  protected searchBy = 'Zed Id';
  protected searchText = '';

  protected readonly rows = signal<Row[]>([]);
  /**
   * Paged by the procedure, as the old pages: main 20 per page (up to 200), consultancy and surveillance 10 (up to 100).
   */
  protected readonly sizes = this.system === 'main' ? [10, 20, 50, 100, 200] : [10, 20, 50, 100];
  protected readonly pager = new ServerPager(this.system === 'main' ? 20 : 10, () => void this.load());
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');
  /** Master admin, Rejected: the units now on the Allot list (ZED ID|level → its allot row), offered Re-allot. */
  private readonly allotRows = signal<ReadonlyMap<string, Row>>(new Map());
  protected readonly reallot = signal<Row[] | null>(null);
  private request = 0;

  protected readonly completed = computed(() => this.kind() !== 'rejected');
  protected readonly heading = computed(() =>
    this.consultancy ? 'Consultancy Completed'
    : this.surveillance ? (this.completed() ? 'Completed Surveillance' : 'Rejected Surveillance')
    : this.completed() ? 'Completed Assessment' : 'Rejected Certification');
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.heading() }));
  protected readonly subtitle = computed(() =>
    this.consultancy ? 'Milestones the consultants completed, with their reports and recommended technologies.'
    : this.completed() ? 'Certifications whose assessment is complete, with their certificates and reports.'
    : 'Certifications rejected after the assessment.');
  protected searchLabel(): string {
    return this.searchBy === 'Udyam Number' ? 'Udyam number' : this.searchBy === 'Unit Name' ? 'Unit name' : 'ZED ID';
  }
  protected readonly isMasterAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isAssessor = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  constructor() {
    effect(() => {
      this.kind();
      untracked(() => {
        this.search();
        if (!this.completed() && !this.consultancy && this.isMasterAdmin()) void this.loadAllotRows();
      });
    });
  }

  protected search(): void {
    this.pager.reset();
    void this.load();
  }

  /** Consultancy: the report of each milestone up to the row's (Milestone 1 Report, Progress Review 1, Progress Review 2). */
  protected milestones(s: Row): { n: number; label: string; href: string }[] {
    const labels = ['MileStone 1 Report', 'Progress Review 1', 'Progress Review 2'];
    const upTo = Math.min(Math.max(num(s, 'NcCount'), 1), 3);
    return labels.slice(0, upTo).map((label, i) => ({ n: i + 1, label, href: milestoneReportUrl(text(s, 'ZedId'), text(s, 'Certification'), i + 1) }));
  }

  /**
   * Consultancy, after milestone 3 (as the old Completed page): master admin and CO view the recommended technologies
   * once recommended (TuStatus 1); the lead consultant recommends them (TuStatus 0) or views them, once the MSME accepted
   * the milestone (status 100) and before the TU application closed them (TuStatus 98+).
   */
  protected recTech(s: Row): string {
    if (num(s, 'DisplayRecTech') !== 1 || num(s, 'NcCount') !== 3) return '';
    const tu = num(s, 'TuStatus');
    if (this.isAssessor()) return num(s, 'CertificationStatus') === 100 && tu < 98 ? (tu === 0 ? 'Recommend Technologies' : 'View Recommended Technologies') : '';
    return tu === 1 ? 'View Recommended Technologies' : '';
  }

  /** V4: every MSME has its pledge certificate (drawn when opened): the page of the unit's ZED ID (not a rejected copy's). */
  protected pledgeUrl(s: Row): string {
    const zedId = text(s, 'ZedId').split('_')[0];
    return zedId ? `/staff/pledge-certificate/${encodeURIComponent(zedId)}` : '';
  }

  /** The server serves the stored certificate, or draws it when a certified record has none. */
  protected certificateUrl(s: Row): string {
    return `${DOCUMENTS_API}/${encodeURIComponent(text(s, 'ZedId'))}/${encodeURIComponent(text(s, 'Certification'))}/certificate`;
  }

  /** The report page (2026-11-15; the surveillance portal's is the surveillance report). */
  protected reportUrl(s: Row): string {
    return reportPageHref(this.surveillance ? 'surveillance' : 'assessment', text(s, 'ZedId'), text(s, 'Certification'));
  }

  protected mode(s: Row): string {
    const m = text(s, 'ModeOfAssessment');
    if (this.surveillance) return m;
    return m === 'Remote Assessment' ? 'Remote' : m === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
  }

  protected badPhase(phase: string): boolean {
    return ['REJECTED', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED'].includes(phase.toUpperCase());
  }

  protected assessors(s: Row): { name: string; id: string }[] {
    return (['DesktopAssessor', 'SiteAssessor', 'CoAssessor'] as const)
      .map((p) => ({ name: text(s, p + 'Name'), id: text(s, p + 'Id') }))
      .filter((p) => p.name || p.id);
  }

  /** The surveillance due date within 90 days: "In N days" (or overdue). */
  protected dueFlag(s: Row): { label: string; cls: string } | null {
    const d = daysUntil(s['FirstSurveDueDate']);
    if (d === null || d > 90) return null;
    if (d < 0) return { label: `Overdue ${-d} ${d === -1 ? 'day' : 'days'}`, cls: 'is-bad' };
    return { label: d === 0 ? 'Due today' : `In ${d} ${d === 1 ? 'day' : 'days'}`, cls: 'is-warn' };
  }

  /** The row's actions, as its old buttons per page and role. */
  menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    const profile: RowMenuItem = { key: 'profile', label: 'View MSME profile', icon: 'people' };
    const details: RowMenuItem = { key: 'details', label: 'Assessment details', icon: 'eye' };
    if (this.consultancy) {
      if (this.isAssessor()) return [];
      if (this.legacy.profile(text(s, 'ZedId'))) items.push(profile);
      items.push({ key: 'milestone', label: 'View details', icon: 'eye' });
      for (const m of this.milestones(s)) items.push({ key: 'report' + m.n, label: m.label, icon: 'download' });
      return items;
    }
    if (!this.completed()) {
      items.push(profile);
      if (this.isMasterAdmin()) items.push(details);
      return items;
    }
    if (this.isMasterAdmin()) {
      items.push(details, profile);
      if (!this.surveillance) items.push({ key: 'pledge', label: 'Pledge certificate', icon: 'download' });
      items.push({ key: 'certificate', label: 'Download certificate', icon: 'download' }, { key: 'report', label: 'View report', icon: 'history' });
    } else if (this.isAgency()) {
      const cs = num(s, 'CertificationStatus');
      // Surveillance (that portal's Completed.cshtml): SaDetails from status 9; main from 15.
      if (cs < 9 || cs >= (this.surveillance ? 9 : 15)) items.push(details);
      items.push(profile);
    }
    return items;
  }

  /** Where a menu item goes (the old buttons' links). */
  href(s: Row, key: string): string {
    const zedId = text(s, 'ZedId');
    const cert = text(s, 'Certification');
    const cs = num(s, 'CertificationStatus');
    switch (key) {
      case 'profile': return '/' + this.legacy.profile(zedId);
      case 'milestone': return `${this.milestoneDetailsRoute}/${encodeURIComponent(zedId)}/${encodeURIComponent(cert)}`;
      case 'pledge': return this.pledgeUrl(s);
      case 'certificate': return this.certificateUrl(s);
      case 'report': return this.reportUrl(s);
      case 'details': {
        let page: string;
        if (!this.completed()) {
          // The rejected copy of the record (RejectedZedId), Bronze at the desktop, the others on site.
          return `/staff/assessment/${cert === 'Bronze' ? 'da-details' : 'sa-details'}/${encodeURIComponent(text(s, 'RejectedZedId') || zedId)}/${encodeURIComponent(cert)}`;
        }
        if (this.isMasterAdmin()) page = cs >= 9 ? 'sa-details' : 'da-details';
        else page = cs < 9 ? 'da-details' : 'sa-details';
        return `/staff/assessment/${page}/${encodeURIComponent(zedId)}/${encodeURIComponent(cert)}`;
      }
      default: {
        const m = /^report(\d)$/.exec(key);
        return m ? this.milestones(s)[Number(m[1]) - 1]?.href ?? '' : '';
      }
    }
  }

  protected act(s: Row, key: string): void {
    const href = this.href(s, key);
    if (!href) return;
    // Certificates and reports open in a new tab, as the old buttons did; the pages of this portal in place.
    if (['pledge', 'certificate', 'report'].includes(key) || key.startsWith('report')) window.open(href, '_blank', 'noopener');
    else void this.router.navigateByUrl(href);
  }

  /** Master admin, Rejected: the unit's row on the Allot list (re-allotted there with the same checks), if it is on it. */
  protected reallotRow(s: Row): Row | null {
    if (!this.isMasterAdmin() || this.consultancy) return null;
    return this.allotRows().get(`${text(s, 'ZedId').split('_')[0]}|${text(s, 'Certification')}`.toUpperCase()) ?? null;
  }

  private async loadAllotRows(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.allotList({}));
      this.allotRows.set(new Map((res.rows ?? []).map((r) => [`${text(r, 'ZedId')}|${text(r, 'Certification')}`.toUpperCase(), r])));
    } catch {
      // Without the Allot list no Re-allot is offered here; the Allot page still has it.
      this.allotRows.set(new Map());
    }
  }

  protected reallotted(): void {
    void this.attention.refresh().catch(() => undefined);
    void this.loadAllotRows();
  }

  private filter(pageNo: number, pageSize: number): ResultsFilter & { gender?: string } {
    const filter: ResultsFilter & { gender?: string } = {
      state: this.state,
      certification: this.level,
      size: this.size,
      searchBy: this.searchText.trim() ? this.searchBy : '',
      search: this.searchText.trim(),
      pageNo,
      pageSize,
    };
    // Sent as a query parameter like the others (empty values are left out).
    if (this.surveillance && this.completed()) filter.gender = this.gender;
    return filter;
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.results(this.completed() ? 'completed' : 'rejected', this.filter(this.pager.pageNo(), this.pager.pageSize())));
      if (request !== this.request) return;
      this.rows.set(res.rows);
      this.pager.total.set(res.totalCount);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  /** Export (approved): every row the list's API returns for the current filter, read 200 at a time (at most 10,000). */
  protected async exportRows(): Promise<void> {
    this.exporting.set(true);
    try {
      const all: Row[] = [];
      let total = Infinity;
      for (let page = 1; all.length < total && all.length < EXPORT_LIMIT; page++) {
        const res = await firstValueFrom(this.api.results('completed', this.filter(page, 200)));
        total = res.totalCount;
        if (!res.rows.length) break;
        all.push(...res.rows);
      }
      const rows = all.slice(0, EXPORT_LIMIT);
      await this.exporter.xlsx(this.heading().toLowerCase().replace(/\s+/g, '-'), [this.sheet(rows)]);
      this.toast.success('Export ready', total > rows.length ? `The first ${rows.length} of ${total} rows.` : `${rows.length} rows.`);
    } catch (err) {
      this.toast.error('The export failed', apiErrorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }

  private sheet(rows: Row[]) {
    const t = (s: Row, c: string) => text(s, c);
    if (this.consultancy) {
      return {
        name: 'Completed',
        columns: ['ZED ID', 'Unit', 'District / State', 'Level', 'Milestone', 'CO', 'CO ID', 'Lead consultant', 'CO consultant', 'Allotted on', 'Completed on'],
        rows: rows.map((s) => [t(s, 'ZedId'), t(s, 'PUnitName'), place(s), t(s, 'Certification'), t(s, 'NcCount'), t(s, 'AgencyName'), t(s, 'CertificationBodyUserId'),
          t(s, 'SiteAssessorName'), t(s, 'CoAssessorName'), t(s, 'DocVerifiAllot'), t(s, 'CertificationStatusDate')]),
      };
    }
    const main = !this.surveillance;
    return {
      name: 'Completed',
      columns: ['ZED ID', 'Unit', 'District / State', 'Level', main ? 'Phase' : 'Surveillance No', 'Mode', 'Agency', 'Agency ID', 'Desktop assessor',
        'Site assessor', 'Co-assessor', 'Allotted on', 'Assessment date', 'Completed on', ...(main ? ['Surveillance due', 'Duplicates'] : []), 'Reason for rejection'],
      rows: rows.map((s) => [t(s, 'ZedId'), t(s, 'PUnitName'), place(s), t(s, 'Certification'), main ? t(s, 'CertificationPhase') : t(s, 'SurveillanceNo'), this.mode(s),
        t(s, 'AgencyName'), t(s, 'CertificationBodyUserId'), t(s, 'DesktopAssessorName'), t(s, 'SiteAssessorName'), t(s, 'CoAssessorName'), t(s, 'DocVerifiAllot'),
        t(s, 'SaAssessmentDate'), t(s, 'CertificationStatusDate'), ...(main ? [t(s, 'FirstSurveDueDate'), t(s, 'SameUdyamAddress')] : []), t(s, 'ReasonForRejection')]),
    };
  }
}
