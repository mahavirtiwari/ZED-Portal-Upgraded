import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Row, SITE_SYSTEM, SiteAssessmentApi, milestoneReviewLink } from './site-assessment.api';
import { FormsModule } from '@angular/forms';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';

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
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" [title]="title" [subtitle]="subtitle">
      <button type="button" class="btn btn-ph" (click)="load()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="consultancy ? milestoneCounts() : counts()" [selected]="stage() ?? 'all'" label="Units by status" (pick)="pickStage($event.key)" />

    <div class="zed-card ra-filters">
      <input type="search" id="remote-search" class="form-control ra-q" maxlength="50" placeholder="Search ZED ID, unit, SPOC or agency"
             aria-label="Search ZED ID, unit, SPOC or agency" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      @if (!consultancy) {
        <zed-chip-filter label="Mode" [chips]="modeChips()" [value]="modeFilter()" (valueChange)="modeFilter.set($event)" />
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
              <th>Unit</th>
              <th>Desired level</th>
              <th>Unit SPOC</th>
              <th>Consultant organisation</th>
              <th>Site visit dates</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
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
                @if (milestone === 1) {
                  <td>BDS: {{ s['BdsToDate'] }}<span class="sub">HAP: {{ s['HapToDate'] }}</span></td>
                } @else {
                  <td>{{ s['BdsToDate'] }}</td>
                }
                <td><span [class]="'chip ' + milestoneState(s).tone">{{ milestoneState(s).label }}</span></td>
                <td class="text-end text-nowrap">
                  <a class="btn btn-primary ra-act details" [routerLink]="reviewLink(s)">View details</a>
                  <zed-row-menu [items]="profileMenu" [label]="'More actions for ' + s['ZedId']" (picked)="openProfile(s)" />
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="7" style="padding: 0px"><div class="no-data">{{ loading() ? 'Loading…' : 'No Data' }}</div></td>
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
              <th>Unit</th>
              <th>Level</th>
              <th>Unit SPOC</th>
              <th>Agency</th>
              <th>Mode</th>
              <th>{{ surveillance ? 'Surveillance date' : 'Assessment date' }}</th>
              <th>Status</th>
              <th class="text-end">Actions</th>
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
                <td><span class="chip is-info">{{ mode(s) }}</span></td>
                <td class="text-nowrap">{{ s['AssessmentDate'] }}</td>
                <td><span [class]="'chip ' + stateOf(s).tone">{{ stateOf(s).label }}</span></td>
                <td class="text-end text-nowrap">
                  <div class="ra-btns">
                    @if (surveillance && s['OnsiteVisit']) {
                      <!-- 2026-11-14 (Onsite surveillance): assessed in the assessor app; reviewed here after its closing meeting. -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">Review &amp; submit</a>
                      } @else if (+(s['CertificationStatus'] ?? 0) === 14) {
                        <a class="btn btn-primary assess review-nc" [routerLink]="remoteLink(s)">Review NC</a>
                      }
                    } @else if (surveillance) {
                      <!-- That portal's list: ASSESS only on Onsite rows (held on the meeting link); no VIEW DETAILS. -->
                      @if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">Assess</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                      <a class="btn btn-outline-primary" [routerLink]="['/staff/assessment/sa-details', s['ZedId'], s['Certification']]">View details</a>
                      <!-- V4: after the SA app's closing meeting the lead assessor reviews and final-submits here (old SaDetails page). -->
                      @if (+(s['CertificationStatus'] ?? 0) === 13) {
                        <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">Review &amp; submit</a>
                      } @else if (+(s['CertificationStatus'] ?? 0) === 14) {
                        <!-- An NC round: the MSME's answers are reviewed and final-submitted on the same page (NC tab). -->
                        <a class="btn btn-primary assess review-nc" [routerLink]="remoteLink(s)">Review NC</a>
                      }
                    } @else if (s['ModeOfAssessment'] === 'Remote Assessment') {
                      <a class="btn btn-primary assess" [routerLink]="remoteLink(s)">Assess</a>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr>
                <td colspan="8" style="padding: 0px"><div class="no-data">{{ loading() ? 'Loading…' : 'No Data' }}</div></td>
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
  `,
})
export class RemoteAssessmentsPage {
  private readonly api = inject(SiteAssessmentApi);
  private readonly router = inject(Router);
  protected readonly str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  protected readonly profileMenu: RowMenuItem[] = [{ key: 'profile', label: 'View MSME profile', icon: 'people' }];
  private readonly legacyUrl = signal('');
  private readonly system = inject(SITE_SYSTEM);

  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  /** Consultancy: milestone of the list (1-3, route parameter; 1 when missing or invalid). */
  protected readonly milestone = RemoteAssessmentsPage.milestoneOf(inject(ActivatedRoute).snapshot.paramMap.get('milestone'));
  protected readonly subtitle = this.consultancy
    ? `Units allotted to you for milestone ${this.milestone}, with the site visit dates.`
    : this.surveillance ? 'Surveillance assessments allotted to you; assess them on the meeting link.'
    : 'Site assessments allotted to you: assess the remote ones here, open the onsite ones for their details.';

  protected readonly rows = signal<Row[]>([]);
  protected readonly title = this.consultancy ? `Milestone ${this.milestone}` : this.surveillance ? 'Surveillance assessments (site)' : 'Remote and onsite assessments';
  protected readonly crumbs = staffCrumbs({ label: this.title });
  /** The tile chosen (its key; null: every unit) and the mode chip ('' all). */
  protected readonly stage = signal<string | null>(null);
  protected readonly modeFilter = signal('');

  protected lc(v: unknown): string {
    return String(v ?? '').toLowerCase();
  }

  /** Where a site assessment stands for the assessor (the chip of its row). */
  protected stateOf(s: Row): { label: string; tone: string } {
    const st = +(s['CertificationStatus'] ?? 0);
    if (st === 13) return { label: 'Meetings done: review', tone: 'is-warn' };
    if (st === 14) return { label: 'NC answered: review', tone: 'is-bad' };
    return { label: this.mode(s) === 'Remote' ? 'To assess' : 'Scheduled', tone: 'is-info' };
  }

  /** Consultancy: where a milestone stands for the consultant (review after the meetings, the site visit to come, in progress). */
  protected milestoneState(s: Row): { label: string; tone: string } {
    const st = +(s['CertificationStatus'] ?? 0);
    if (st === 13 || st === 14) return { label: 'To review', tone: 'is-warn' };
    const visit = Date.parse(String(s['BdsToDate'] ?? ''));
    if (!isNaN(visit) && visit >= new Date().setHours(0, 0, 0, 0)) return { label: 'Site visit due', tone: 'is-info' };
    return { label: 'In progress', tone: '' };
  }

  protected readonly milestoneCounts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const by = (label: string) => rows.filter((r) => this.milestoneState(r).label === label).length;
    return [
      { key: 'all', label: 'Allotted to me', value: rows.length },
      { key: 'Site visit due', label: 'Site visit due', value: by('Site visit due') },
      { key: 'To review', label: 'To review', value: by('To review'), tone: 'warn' },
      { key: 'In progress', label: 'In progress', value: by('In progress') },
    ];
  });

  /** The tile of a row: its milestone state (consultancy), else to review (status 13 / 14) or waiting for the assessment. */
  private stageOf(r: Row): string {
    if (this.consultancy) return this.milestoneState(r).label;
    const st = +(r['CertificationStatus'] ?? 0);
    return st === 13 || st === 14 ? 'review' : 'open';
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const st = (r: Row) => +(r['CertificationStatus'] ?? 0);
    const review = rows.filter((r) => st(r) === 13 || st(r) === 14).length;
    return [
      { key: 'all', label: 'Allotted to me', value: rows.length },
      { key: 'open', label: this.surveillance ? 'To assess' : 'To assess or scheduled', value: rows.length - review, tone: 'info' },
      { key: 'review', label: 'To review', value: review, tone: 'warn' },
    ];
  });

  /** The units by mode (Remote / Onsite / Desktop), as chips. */
  protected readonly modeChips = computed<FilterChip[]>(() => {
    const rows = this.rows();
    return [{ key: '', label: 'All', count: rows.length },
      ...['Remote', 'Onsite', 'Desktop'].map((m) => ({ key: m, label: m, count: rows.filter((r) => this.mode(r) === m).length }))
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
  }

  static milestoneOf(value: string | null): number {
    const n = Number(value);
    return n === 2 || n === 3 ? n : 1;
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const call = this.consultancy ? this.api.milestone(this.milestone) : this.api.remoteAssessments();
      this.rows.set((await firstValueFrom(call)) ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected mode(s: Row): string {
    if (this.surveillance) return s['OnsiteVisit'] ? 'Onsite' : s['ModeOfAssessment'] ? 'Remote' : 'Desktop';
    return s['ModeOfAssessment'] === 'Remote Assessment' ? 'Remote' : s['ModeOfAssessment'] === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
  }

  protected remoteLink(s: Row): string[] {
    return ['/staff/remote', String(s['ZedId'] ?? ''), String(s['Certification'] ?? '')];
  }

  protected reviewLink(s: Row): string {
    return milestoneReviewLink(String(s['ZedId'] ?? ''), String(s['Certification'] ?? ''), this.milestone);
  }
}
