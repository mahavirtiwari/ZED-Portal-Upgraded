import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { STATES, flag, num, text, useLegacyPortal } from './assessment-shared';
import { AssessmentApi, ListFilter, Row } from './assessment.api';
import { levelOptions } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';

/** The mode of a row (the procedure's ModeOfAssessment; none: desktop). */
type Mode = 'Desktop' | 'Remote' | 'Onsite';

/**
 * Desktop assessor: records with an open non-conformance round (DA status 4, site assessment status 14).
 * Port of Views/Assessment/NonConfirmances.cshtml (Assessment/GetList 'NC'). Bronze records open the
 * desktop assessment page; Silver/Gold the site assessment page of the current portal. The old page also
 * showed Accept/Reject buttons here, but records in this list are always accepted already, so they are omitted.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, the mode as
 * chips, the API's filters in one bar, the SPOC's mobile and e-mail (in full since 2026-11-18, the user), Assess on the row
 * and View profile in its menu.</p>
 */
@Component({
  selector: 'zed-staff-non-conformances',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" title="Non-conformances" subtitle="The units with an open non-conformance round: review each one once the MSME has answered.">
      <button type="button" class="btn btn-ph" (click)="load()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" label="NC rounds" (pick)="pickStage($event.key)" />

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="zed-card nc-filters">
      <input type="search" id="ncSearch" class="form-control nc-q" maxlength="50" placeholder="Search ZED ID, unit, SPOC or agency"
             aria-label="Search ZED ID, unit, SPOC or agency" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <select class="form-select" id="ncState" aria-label="State" [(ngModel)]="filter.state" (ngModelChange)="load()">
        <option value="">All states</option>
        @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
      </select>
      <select class="form-select" id="ncLevel" aria-label="Certification level" [(ngModel)]="filter.certification" (ngModelChange)="load()">
        <option value="">All levels</option>
        @for (l of levels(); track l.value) { <option [value]="l.value">{{ l.label }}</option> }
      </select>
      <select class="form-select" id="ncSize" aria-label="MSME size" [(ngModel)]="filter.size" (ngModelChange)="load()">
        <option value="">All sizes</option>
        <option value="Micro">Micro</option>
        <option value="Small">Small</option>
        <option value="Medium">Medium</option>
      </select>
      <select class="form-select" id="ncGender" aria-label="Gender" [(ngModel)]="filter.gender" (ngModelChange)="load()">
        <option value="">All genders</option>
        <option value="male">Male</option>
        <option value="female">Female</option>
        <option value="Others">Others</option>
      </select>
      <zed-chip-filter class="nc-modes" label="Mode" [chips]="modeChips()" [value]="mode()" (valueChange)="mode.set($event)" />
    </div>

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th style="width: 56px">S.No.</th>
            <th>Unit</th>
            <th>Level</th>
            <th>Unit SPOC</th>
            <th>Agency</th>
            <th>Mode</th>
            <th>Status</th>
            <th class="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track t(s, 'ZedId') + t(s, 'Certification')) {
            <tr [class.table-danger]="answered(s)" [class.is-answered]="answered(s)">
              <td>{{ t(s, 'RowNumber') }}</td>
              <td class="unit unit-cell">
                <b>{{ t(s, 'PUnitName') }}</b>
                <span class="dash-text-clr nc-id">{{ t(s, 'ZedId') }}</span>
                <small class="nc-addr" [title]="t(s, 'UnitAddress')">{{ t(s, 'UnitAddress') }}</small>
              </td>
              <td><span [class]="'lv-tag lv-' + t(s, 'Certification').toLowerCase()">{{ t(s, 'Certification') }}</span></td>
              <!-- 2026-11-18 (the user): the SPOC's mobile and e-mail in full (never masked). -->
              <td><b>{{ t(s, 'UnitSpocName') }}</b><span class="sub">{{ t(s, 'UnitSpocMobileNo') }}</span><span class="sub mail-cut" [title]="t(s, 'UnitSpocEmailId')">{{ t(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ t(s, 'AgencyName') }}<span class="sub">{{ t(s, 'CertificationBodyUserId') }}</span></td>
              <td>@if (modeOf(s); as m) { <span class="chip is-info">{{ m }}</span> }</td>
              <td>
                @if (answered(s)) { <span class="chip is-warn">Answered: to review</span> } @else { <span class="chip">Waiting for the MSME</span> }
              </td>
              <td class="text-end text-nowrap">
                @if (f(s, 'DesktopAccepted')) {
                  <a [routerLink]="['/staff/assessment', t(s, 'Certification') === 'Bronze' ? 'da-details' : 'sa-details', t(s, 'ZedId'), t(s, 'Certification')]"
                     class="btn btn-primary nc-act">Assess</a>
                }
                <zed-row-menu [items]="menu" [label]="'More actions for ' + t(s, 'ZedId')" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" style="padding: 0"><div class="no-data">{{ loading() ? 'Loading…' : 'No Data' }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>
  `,
  styles: `
    .nc-filters { display: grid; grid-template-columns: minmax(200px, 2fr) repeat(4, minmax(120px, 1fr)); gap: 10px; padding: 12px 14px; margin-bottom: 14px; }
    .nc-modes { grid-column: 1 / -1; }
    .unit { min-width: 220px; }
    .nc-id { display: block; font-size: 12.5px; font-weight: 700; }
    .nc-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .nc-act { min-width: 82px; margin-right: 6px; font-weight: 600; }
    /* The MSME answered the round: a light tint and an amber mark in place of Bootstrap's red row. */
    tr.is-answered > td { background: #fffaf0 !important; }
    tr.is-answered > td:first-child { box-shadow: inset 3px 0 0 #e0a100; }
    @media (max-width: 991.98px) { .nc-filters { grid-template-columns: repeat(2, minmax(0, 1fr)); } .nc-q { grid-column: 1 / -1; } }
  `,
})
export class NonConformancesPage {
  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  /** Every level, the Admin's too (Administration → Certification Levels, 2026-11-08). */
  protected readonly levels = computed(() => levelOptions());
  protected readonly t = text;
  protected readonly f = flag;
  protected readonly n = num;
  protected readonly crumbs = staffCrumbs({ label: 'Non-conformances' });
  protected readonly menu: RowMenuItem[] = [{ key: 'profile', label: 'View MSME profile', icon: 'people' }];

  protected filter: Required<Omit<ListFilter, 'allotmentType'>> = { state: '', certification: '', size: '', gender: '' };
  protected readonly rows = signal<Row[]>([]);
  /** The tile chosen ('answered' / 'waiting'; null: every round). */
  protected readonly stage = signal<string | null>(null);
  /** The mode chip chosen ('' all). */
  protected readonly mode = signal('');
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private request = 0;

  /** The MSME has answered the open round (NcStatus 2 at DA status 4 / site status 14): waiting for the assessor's review. */
  protected answered(s: Row): boolean {
    return num(s, 'NcStatus') === 2 && (num(s, 'CertificationStatus') === 4 || num(s, 'CertificationStatus') === 14);
  }

  /** As the old page's chip: Remote / Onsite, none for Desktop; '' for another value. */
  protected modeOf(s: Row): Mode | '' {
    switch (text(s, 'ModeOfAssessment')) {
      case 'Remote Assessment': return 'Remote';
      case 'Onsite Assessment': return 'Onsite';
      case '': return 'Desktop';
      default: return '';
    }
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const answered = rows.filter((r) => this.answered(r)).length;
    return [
      { key: 'all', label: 'Open NC rounds', value: rows.length },
      { key: 'answered', label: 'Answered: to review', value: answered, tone: 'warn' },
      { key: 'waiting', label: 'Waiting for the MSME', value: rows.length - answered },
    ];
  });

  protected readonly modeChips = computed<FilterChip[]>(() => {
    const rows = this.rows();
    return [
      { key: '', label: 'All', count: rows.length },
      ...(['Desktop', 'Remote', 'Onsite'] as Mode[]).map((m) => ({ key: m, label: m, count: rows.filter((r) => this.modeOf(r) === m).length })),
    ];
  });

  private readonly shown = computed(() => {
    const stage = this.stage();
    const mode = this.mode();
    return this.rows().filter((r) => (!stage || (stage === 'answered') === this.answered(r)) && (!mode || this.modeOf(r) === mode));
  });
  /** Paged as the old list (10 per page), the search box over any shown value. */
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));

  constructor() {
    void this.load();
  }

  /** A tile filters the list; "Open NC rounds" (or the chosen tile again) shows every round. */
  protected pickStage(key: string | undefined): void {
    this.stage.set(!key || key === 'all' || key === this.stage() ? null : key);
  }

  protected act(s: Row, key: string): void {
    if (key === 'profile') void this.router.navigateByUrl('/' + this.legacy.profile(text(s, 'ZedId')));
  }

  async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.nonConformances(this.filter));
      if (request === this.request) this.rows.set(res.rows);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
