import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { Row, SITE_SYSTEM, SiteAssessmentApi, dateSpan, milestoneReviewLink } from './site-assessment.api';
import { FormsModule } from '@angular/forms';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { TextPipe, t } from '../../content/page-text';
import { RemoteAllotments } from '../remote-allotments';

/**
 * "Remote/Onsite Assessment" list of an assessor with the site verification sub-role. Port of
 * Views/Assessment/RemoteAssessments.cshtml (Assessment/GetList allotmentType RA). Its Accept/Reject
 * pop-ups had no button opening them and are not ported. VIEW DETAILS opens the SA details page
 * (staff/assessment/sa-details/...); ASSESS opens the remote assessment screen (staff/remote/...).
 * <p>
 * Surveillance build: units allotted as "Onsite Assessment" are held on the agency's meeting link, so their ASSESS
 * opens the remote screen (mode shown as Remote, "Surveillance Date"), as on the old surveillance list.
 * Consultancy build: "Milestone n" lists (route parameter `milestone`, 1-3; old RemoteAssessments/{n}) of the
 * consultant's units with the BDS/HAP dates; View Profile opens the unit's profile and VIEW DETAILS the milestone review page.
 * </p>
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, the mode as
 * chips, one search box, the SPOC's mobile and e-mail (in full since 2026-11-18, the user), at most two buttons on a row (the milestone lists: View details
 * and the profile in the row menu).</p>
 */
@Component({
  selector: 'zed-staff-remote-assessments',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="title()" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph" (click)="load()">{{ 'Refresh' | t: 'staff.remoteAssessments.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="consultancy ? milestoneCounts() : counts()" [selected]="stage() ?? 'all'" [label]="'Units by status' | t: 'staff.remoteAssessments.counts.aria'" (pick)="pickStage($event.key)" />

    <div class="zed-card ra-filters">
      <input type="search" id="remote-search" class="form-control ra-q" maxlength="50" [placeholder]="'Search ZED ID, unit, SPOC or agency' | t: 'staff.remoteAssessments.search.placeholder'"
             [attr.aria-label]="'Search ZED ID, unit, SPOC or agency' | t: 'staff.remoteAssessments.search.placeholder'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      @if (!consultancy) {
        <zed-chip-filter [label]="'Mode' | t: 'staff.remoteAssessments.mode.label'" [chips]="modeChips()" [value]="modeFilter()" (valueChange)="modeFilter.set($event)" />
      }
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="list-card">
    @if (consultancy) {
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>{{ 'Unit' | t: 'staff.remoteAssessments.column.unit' }}</th>
              <th>{{ 'Desired level' | t: 'staff.remoteAssessments.column.desiredLevel' }}</th>
              <th>{{ 'Unit SPOC' | t: 'staff.remoteAssessments.column.spoc' }}</th>
              <th>{{ 'Consultant organisation' | t: 'staff.remoteAssessments.column.co' }}</th>
              <th>{{ 'Site visit dates' | t: 'staff.remoteAssessments.column.siteVisitDates' }}</th>
              <th>{{ 'Status' | t: 'staff.remoteAssessments.column.status' }}</th>
              <th class="text-end">{{ 'Actions' | t: 'staff.remoteAssessments.column.actions' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
              <tr>
                <td class="unit unit-cell">
                  <b>{{ s['EnterpriseName'] }}</b>
                  <span class="dash-text-clr ra-id">{{ s['ZedId'] }}</span>
                  <small class="ra-addr" [title]="str(s['UnitAddress'])">{{ s['UnitAddress'] }}</small>
                </td>
                <td><span [class]="'lv-tag lv-' + lc(s['Certification'])">{{ s['Certification'] }}</span></td>
                <!-- 2026-11-18 (the user): the SPOC's mobile and e-mail in full (never masked). -->
                <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ str(s['UnitSpocMobileNo']) }}</span><span class="sub mail-cut" [title]="str(s['UnitSpocEmailId'])">{{ str(s['UnitSpocEmailId']) }}</span></td>
                <td>{{ s['AgencyName'] }}<span class="sub">{{ s['CertificationBodyUserId'] }}</span></td>
                <!-- 2026-11-22 (Consultant audit): the visit's first to last day (it showed the last day only), BDS and HAP alike. -->
                @if (milestone === 1) {
                  <td class="ra-dates"><div>{{ 'BDS: {date}' | t: 'staff.remoteAssessments.row.bds.label' : { date: span(s['BdsFromDate'], s['BdsToDate']) } }}</div><div>{{ 'HAP: {date}' | t: 'staff.remoteAssessments.row.hap.label' : { date: span(s['HapFromDate'], s['HapToDate']) } }}</div></td>
                } @else {
                  <td class="ra-dates">{{ span(s['BdsFromDate'], s['BdsToDate']) }}</td>
                }
                <td><span [class]="'chip ' + milestoneState(s).tone">{{ milestoneState(s).label }}</span></td>
                <td class="text-end text-nowrap">
                  <a class="btn btn-primary ra-act details" [routerLink]="reviewLink(s)">{{ 'View details' | t: 'staff.remoteAssessments.viewDetailsButton' }}</a>
                  <zed-row-menu [items]="profileMenu()" [label]="'More actions for {zedId}' | t: 'staff.remoteAssessments.row.menuAria' : { zedId: s['ZedId'] }" (picked)="openProfile(s)" />
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" style="padding: 0px"><div class="no-data">{{ loading() ? ('Loading…' | t: 'staff.remoteAssessments.loading.text') : ('No assessment to show. Remote and onsite assessments allotted to you are listed here.' | t: 'staff.remoteAssessments.empty') }}</div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    } @else {
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr>
              <th>{{ 'Unit' | t: 'staff.remoteAssessments.column.unit' }}</th>
              <th>{{ 'Level' | t: 'staff.remoteAssessments.column.level' }}</th>
              <th>{{ 'Unit SPOC' | t: 'staff.remoteAssessments.column.spoc' }}</th>
              <th>{{ 'Agency' | t: 'staff.remoteAssessments.column.agency' }}</th>
              <th>{{ 'Mode' | t: 'staff.remoteAssessments.column.mode' }}</th>
              <th>{{ surveillance ? ('Surveillance date' | t: 'staff.remoteAssessments.column.surveillanceDate') : ('Assessment date' | t: 'staff.remoteAssessments.column.assessmentDate') }}</th>
              <th>{{ 'Status' | t: 'staff.remoteAssessments.column.status' }}</th>
              <th class="text-end">{{ 'Actions' | t: 'staff.remoteAssessments.column.actions' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
              <tr>
                <td class="unit unit-cell">
                  <b>{{ surveillance ? s['PUnitName'] : s['EnterpriseName'] }}</b>
                  <span class="dash-text-clr ra-id">{{ s['ZedId'] }}</span>
                  <small class="ra-addr" [title]="str(s['UnitAddress'])">{{ s['UnitAddress'] }}</small>
                </td>
                <td><span [class]="'lv-tag lv-' + lc(s['Certification'])">{{ s['Certification'] }}</span></td>
                <!-- 2026-11-18 (the user): the SPOC's mobile and e-mail in full (never masked). -->
                <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ str(s['UnitSpocMobileNo']) }}</span><span class="sub mail-cut" [title]="str(s['UnitSpocEmailId'])">{{ str(s['UnitSpocEmailId']) }}</span></td>
                <td>{{ s['AgencyName'] }}<span class="sub">{{ s['CertificationBodyUserId'] }}</span></td>
                <td><span class="chip is-info">{{ modeName(mode(s)) }}</span></td>
                <td class="text-nowrap">{{ s['AssessmentDate'] }}</td>
                <td><span [class]="'chip ' + stateOf(s).tone">{{ stateOf(s).label }}</span></td>
                <td class="text-end text-nowrap">
                  <div class="ra-btns">
                    @if (surveillance && s['OnsiteVisit']) {
                      <!-- 2026-11-14 (Onsite surveillance): assessed in the assessor app; reviewed here after its closing meeting. -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">{{ 'Review & submit' | t: 'staff.remoteAssessments.reviewButton' }}</a>
                      } @else if (+(s['CertificationStatus'] ?? 0) === 14) {
                        <a class="btn btn-primary assess review-nc" [routerLink]="remoteLink(s)">{{ 'Review NC' | t: 'staff.remoteAssessments.reviewNcButton' }}</a>
                      }
                    } @else if (surveillance) {
                      <!-- That portal's list: ASSESS only on Onsite rows (held on the meeting link); no VIEW DETAILS. -->
                      @if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">{{ 'Assess' | t: 'staff.remoteAssessments.assessButton' }}</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                      <a class="btn btn-outline-primary" [routerLink]="['/staff/assessment/sa-details', s['ZedId'], s['Certification']]">{{ 'View details' | t: 'staff.remoteAssessments.viewDetailsButton' }}</a>
                      <!-- V4: after the SA app's closing meeting the lead assessor reviews and final-submits here (old SaDetails page). -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">{{ 'Review & submit' | t: 'staff.remoteAssessments.reviewButton' }}</a>
                      } @else if (+(s['CertificationStatus'] ?? 0) === 14) {
                        <!-- An NC round: the MSME's answers are reviewed and final-submitted on the same page (NC tab). -->
                        <a class="btn btn-primary assess review-nc" [routerLink]="remoteLink(s)">{{ 'Review NC' | t: 'staff.remoteAssessments.reviewNcButton' }}</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Remote Assessment') {
                      <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">{{ 'Assess' | t: 'staff.remoteAssessments.assessButton' }}</a>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" style="padding: 0px"><div class="no-data">{{ loading() ? ('Loading…' | t: 'staff.remoteAssessments.loading.text') : ('No assessment to show. Remote and onsite assessments allotted to you are listed here.' | t: 'staff.remoteAssessments.empty') }}</div></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    }
    </div>

  `,
  styles: `
    .ra-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 14px; margin-bottom: 14px; }
    .ra-q { flex: 1 1 260px; max-width: 420px; }
    .unit { min-width: 220px; }
    .ra-id { display: block; font-size: 12.5px; font-weight: 700; }
    .ra-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .ra-btns { display: inline-flex; gap: 6px; }
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the buttons keep the skin's 700 weight. */
    .ra-act { margin-right: 6px; }
    .ra-dates { font-size: 13.5px; color: #17373b; }
  `,
})
export class RemoteAssessmentsPage {
  private readonly api = inject(SiteAssessmentApi);
  /** 2026-11-21 (Assessor UI audit): the menu's check of the same list; this page's reading refreshes it (one request). */
  private readonly remoteAllotments = inject(RemoteAllotments);
  private readonly router = inject(Router);
  protected readonly str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  protected readonly span = dateSpan;
  protected readonly profileMenu = computed<RowMenuItem[]>(() => [{ key: 'profile', label: t('staff.remoteAssessments.menu.profile.label', 'View MSME profile'), icon: 'people' }]);
  private readonly legacyUrl = signal('');
  private readonly system = inject(SITE_SYSTEM);

  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  private readonly route = inject(ActivatedRoute);
  /**
   * Consultancy: milestone of the list (1-3, route parameter; 1 when missing or invalid). 2026-11-22 (Consultant audit: going
   * from Milestone 1 to Milestone 2 in the menu changed the address but kept Milestone 1's list, Angular reusing the page):
   * it follows the route parameter.
   */
  private readonly milestoneNumber = signal(RemoteAssessmentsPage.milestoneOf(this.route.snapshot.paramMap.get('milestone')));
  protected get milestone(): number {
    return this.milestoneNumber();
  }
  protected readonly subtitle = computed(() => this.consultancy
    ? t('staff.remoteAssessments.milestone.sub', 'Units allotted to you for milestone {number}, with the site visit dates.', { number: this.milestone })
    : this.surveillance ? t('staff.remoteAssessments.surveillance.sub', 'Surveillance assessments allotted to you; assess them on the meeting link.')
    : t('staff.remoteAssessments.sub', 'Site assessments allotted to you: assess the remote ones here, open the onsite ones for their details.'));

  protected readonly rows = signal<Row[]>([]);
  protected readonly title = computed(() => this.consultancy
    ? t('staff.remoteAssessments.milestone.title', 'Milestone {number}', { number: this.milestone })
    : this.surveillance ? t('staff.remoteAssessments.surveillance.title', 'Surveillance assessments (site)') : t('staff.remoteAssessments.title', 'Remote and onsite assessments'));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));
  /** The tile chosen (its key; null: every unit) and the mode chip ('' all). */
  protected readonly stage = signal<string | null>(null);
  protected readonly modeFilter = signal('');

  protected lc(v: unknown): string {
    return String(v ?? '').toLowerCase();
  }

  /** Where a site assessment stands for the assessor (the chip of its row). */
  protected stateOf(s: Row): { label: string; tone: string } {
    const st = +(s['CertificationStatus'] ?? 0);
    if (st === 13) return { label: t('staff.remoteAssessments.state.meetingsDone.chip', 'Meetings done: review'), tone: 'is-warn' };
    if (st === 14) return { label: t('staff.remoteAssessments.state.ncAnswered.chip', 'NC answered: review'), tone: 'is-bad' };
    return { label: this.mode(s) === 'Remote' ? t('staff.remoteAssessments.state.toAssess.chip', 'To assess')
      : t('staff.remoteAssessments.state.scheduled.chip', 'Scheduled'), tone: 'is-info' };
  }

  /** Consultancy: where a milestone stands for the consultant (review after the meetings, the site visit to come, in progress). */
  protected milestoneState(s: Row): { key: string; label: string; tone: string } {
    const key = this.milestoneKey(s);
    return { key, label: this.milestoneLabel(key), tone: key === 'To review' ? 'is-warn' : key === 'Site visit due' ? 'is-info' : '' };
  }

  /** The milestone state's code (also the tile's key). */
  private milestoneKey(s: Row): string {
    const st = +(s['CertificationStatus'] ?? 0);
    if (st === 13 || st === 14) return 'To review';
    const visit = Date.parse(String(s['BdsToDate'] ?? ''));
    if (!isNaN(visit) && visit >= new Date().setHours(0, 0, 0, 0)) return 'Site visit due';
    return 'In progress';
  }

  private milestoneLabel(key: string): string {
    return key === 'To review' ? t('staff.remoteAssessments.milestoneState.toReview.chip', 'To review')
      : key === 'Site visit due' ? t('staff.remoteAssessments.milestoneState.visitDue.chip', 'Site visit due')
      : t('staff.remoteAssessments.milestoneState.inProgress.chip', 'In progress');
  }

  protected readonly milestoneCounts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const by = (key: string) => rows.filter((r) => this.milestoneKey(r) === key).length;
    return [
      { key: 'all', label: t('staff.remoteAssessments.count.allotted.label', 'Allotted to me'), value: rows.length },
      { key: 'Site visit due', label: t('staff.remoteAssessments.count.visitDue.label', 'Site visit due'), value: by('Site visit due') },
      { key: 'To review', label: t('staff.remoteAssessments.count.toReview.label', 'To review'), value: by('To review'), tone: 'warn' },
      { key: 'In progress', label: t('staff.remoteAssessments.count.inProgress.label', 'In progress'), value: by('In progress') },
    ];
  });

  /** The tile of a row: its milestone state (consultancy), else to review (status 13 / 14) or waiting for the assessment. */
  private stageOf(r: Row): string {
    if (this.consultancy) return this.milestoneKey(r);
    const st = +(r['CertificationStatus'] ?? 0);
    return st === 13 || st === 14 ? 'review' : 'open';
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const st = (r: Row) => +(r['CertificationStatus'] ?? 0);
    const review = rows.filter((r) => st(r) === 13 || st(r) === 14).length;
    return [
      { key: 'all', label: t('staff.remoteAssessments.count.allotted.label', 'Allotted to me'), value: rows.length },
      { key: 'open', label: this.surveillance ? t('staff.remoteAssessments.count.toAssess.label', 'To assess')
        : t('staff.remoteAssessments.count.toAssessOrScheduled.label', 'To assess or scheduled'), value: rows.length - review, tone: 'info' },
      { key: 'review', label: t('staff.remoteAssessments.count.toReview.label', 'To review'), value: review, tone: 'warn' },
    ];
  });

  /** The units by mode (Remote / Onsite / Desktop), as chips. */
  protected readonly modeChips = computed<FilterChip[]>(() => {
    const rows = this.rows();
    return [{ key: '', label: t('staff.remoteAssessments.mode.all.chip', 'All'), count: rows.length },
      ...['Remote', 'Onsite', 'Desktop'].map((m) => ({ key: m, label: this.modeName(m), count: rows.filter((r) => this.mode(r) === m).length }))
        .filter((c) => c.count > 0 || c.key !== 'Desktop')];
  });

  private readonly shown = computed(() => {
    const stage = this.stage();
    const m = this.consultancy ? '' : this.modeFilter();
    return this.rows().filter((r) => (!stage || this.stageOf(r) === stage) && (!m || this.mode(r) === m));
  });
  /** The search box above the list (any column). Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));

  /** A tile filters the list; "Allotted to me" (or the chosen tile again) shows every unit. */
  protected pickStage(key: string | undefined): void {
    this.stage.set(!key || key === 'all' || key === this.stage() ? null : key);
  }

  protected openProfile(s: Row): void {
    void this.router.navigate(['/staff/msme-profile', this.str(s['ZedId'])]);
  }
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe((p) => {
      const n = RemoteAssessmentsPage.milestoneOf(p.get('milestone'));
      if (!this.consultancy || n === this.milestoneNumber()) return;
      this.milestoneNumber.set(n);
      this.stage.set(null);
      this.search.set('');
      this.rows.set([]);
      void this.load();
    });
  }

  static milestoneOf(value: string | null): number {
    const n = Number(value);
    return n === 2 || n === 3 ? n : 1;
  }

  protected async load(): Promise<void> {
    const asked = this.milestone;
    this.loading.set(true);
    this.error.set('');
    try {
      const call = this.consultancy ? this.api.milestone(asked) : (this.remoteAllotments.list() as Observable<Row[]>);
      const rows = (await firstValueFrom(call)) ?? [];
      // A list of the milestone left meanwhile (another menu entry) is dropped.
      if (asked === this.milestone) this.rows.set(rows);
    } catch (err) {
      if (asked === this.milestone) this.error.set(apiErrorMessage(err));
    } finally {
      if (asked === this.milestone) this.loading.set(false);
    }
  }

  protected mode(s: Row): string {
    if (this.surveillance) return s['OnsiteVisit'] ? 'Onsite' : s['ModeOfAssessment'] ? 'Remote' : 'Desktop';
    return s['ModeOfAssessment'] === 'Remote Assessment' ? 'Remote' : s['ModeOfAssessment'] === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
  }

  /** The wording of a mode code (mode()). */
  protected modeName(m: string): string {
    return m === 'Remote' ? t('staff.remoteAssessments.mode.remote.chip', 'Remote')
      : m === 'Onsite' ? t('staff.remoteAssessments.mode.onsite.chip', 'Onsite')
      : m === 'Desktop' ? t('staff.remoteAssessments.mode.desktop.chip', 'Desktop') : m;
  }

  protected remoteLink(s: Row): string[] {
    return ['/staff/remote', String(s['ZedId'] ?? ''), String(s['Certification'] ?? '')];
  }

  protected reviewLink(s: Row): string {
    return milestoneReviewLink(String(s['ZedId'] ?? ''), String(s['Certification'] ?? ''), this.milestone);
  }
}
