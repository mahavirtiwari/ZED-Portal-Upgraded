import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
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
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="title()"
                   [subtitle]="'The units with an open non-conformance round: review each one once the MSME has answered.' | t: 'staff.nonConformances.sub'">
      <button type="button" class="btn btn-ph" (click)="load()">{{ 'Refresh' | t: 'staff.nonConformances.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" [label]="'NC rounds' | t: 'staff.nonConformances.countsLabel'" (pick)="pickStage($event.key)" />

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="zed-card nc-filters">
      <input type="search" id="ncSearch" class="form-control nc-q" maxlength="50" [placeholder]="'Search ZED ID, unit, SPOC or agency' | t: 'staff.nonConformances.search.placeholder'"
             [attr.aria-label]="'Search ZED ID, unit, SPOC or agency' | t: 'staff.nonConformances.search.placeholder'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <select class="form-select" id="ncState" [attr.aria-label]="'State' | t: 'staff.nonConformances.filter.state'" [(ngModel)]="filter.state" (ngModelChange)="load()">
        <option value="">{{ 'All states' | t: 'staff.nonConformances.filter.allStates' }}</option>
        @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
      </select>
      <select class="form-select" id="ncLevel" [attr.aria-label]="'Certification level' | t: 'staff.nonConformances.filter.level'" [(ngModel)]="filter.certification" (ngModelChange)="load()">
        <option value="">{{ 'All levels' | t: 'staff.nonConformances.filter.allLevels' }}</option>
        @for (l of levels(); track l.value) { <option [value]="l.value">{{ l.label }}</option> }
      </select>
      <select class="form-select" id="ncSize" [attr.aria-label]="'MSME size' | t: 'staff.nonConformances.filter.size'" [(ngModel)]="filter.size" (ngModelChange)="load()">
        <option value="">{{ 'All sizes' | t: 'staff.nonConformances.filter.allSizes' }}</option>
        <option value="Micro">{{ 'Micro' | t: 'staff.nonConformances.filter.sizeMicro' }}</option>
        <option value="Small">{{ 'Small' | t: 'staff.nonConformances.filter.sizeSmall' }}</option>
        <option value="Medium">{{ 'Medium' | t: 'staff.nonConformances.filter.sizeMedium' }}</option>
      </select>
      <select class="form-select" id="ncGender" [attr.aria-label]="'Gender' | t: 'staff.nonConformances.filter.gender'" [(ngModel)]="filter.gender" (ngModelChange)="load()">
        <option value="">{{ 'All genders' | t: 'staff.nonConformances.filter.allGenders' }}</option>
        <option value="male">{{ 'Male' | t: 'staff.nonConformances.filter.genderMale' }}</option>
        <option value="female">{{ 'Female' | t: 'staff.nonConformances.filter.genderFemale' }}</option>
        <option value="Others">{{ 'Others' | t: 'staff.nonConformances.filter.genderOthers' }}</option>
      </select>
      <zed-chip-filter class="nc-modes" [label]="'Mode' | t: 'staff.nonConformances.filter.mode'" [chips]="modeChips()" [value]="mode()" (valueChange)="mode.set($event)" />
    </div>

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th style="width: 56px">{{ 'S.No.' | t: 'staff.nonConformances.column.sno' }}</th>
            <th>{{ 'Unit' | t: 'staff.nonConformances.column.unit' }}</th>
            <th>{{ 'Level' | t: 'staff.nonConformances.column.level' }}</th>
            <th>{{ 'Unit SPOC' | t: 'staff.nonConformances.column.spoc' }}</th>
            <th>{{ 'Agency' | t: 'staff.nonConformances.column.agency' }}</th>
            <th>{{ 'Mode' | t: 'staff.nonConformances.column.mode' }}</th>
            <th>{{ 'Status' | t: 'staff.nonConformances.column.status' }}</th>
            <th class="text-end">{{ 'Actions' | t: 'staff.nonConformances.column.actions' }}</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track col(s, 'ZedId') + col(s, 'Certification')) {
            <tr [class.table-danger]="answered(s)" [class.is-answered]="answered(s)">
              <td>{{ col(s, 'RowNumber') }}</td>
              <td class="unit unit-cell">
                <b>{{ col(s, 'PUnitName') }}</b>
                <span class="dash-text-clr nc-id">{{ col(s, 'ZedId') }}</span>
                <small class="nc-addr" [title]="col(s, 'UnitAddress')">{{ col(s, 'UnitAddress') }}</small>
              </td>
              <td><span [class]="'lv-tag lv-' + col(s, 'Certification').toLowerCase()">{{ col(s, 'Certification') }}</span></td>
              <!-- 2026-11-18 (the user): the SPOC's mobile and e-mail in full (never masked). -->
              <td><b>{{ col(s, 'UnitSpocName') }}</b><span class="sub">{{ col(s, 'UnitSpocMobileNo') }}</span><span class="sub mail-cut" [title]="col(s, 'UnitSpocEmailId')">{{ col(s, 'UnitSpocEmailId') }}</span></td>
              <td>{{ col(s, 'AgencyName') }}<span class="sub">{{ col(s, 'CertificationBodyUserId') }}</span></td>
              <td>@if (modeOf(s); as m) { <span class="chip is-info">{{ modeLabel(m) }}</span> }</td>
              <td>
                @if (answered(s)) { <span class="chip is-warn">{{ 'Answered: to review' | t: 'staff.nonConformances.row.answeredText' }}</span> } @else { <span class="chip">{{ 'Waiting for the MSME' | t: 'staff.nonConformances.row.waitingText' }}</span> }
              </td>
              <td class="text-end text-nowrap">
                @if (f(s, 'DesktopAccepted')) {
                  <a [routerLink]="['/staff/assessment', col(s, 'Certification') === 'Bronze' ? 'da-details' : 'sa-details', col(s, 'ZedId'), col(s, 'Certification')]"
                     class="btn btn-primary nc-act">{{ 'Assess' | t: 'staff.nonConformances.row.assessButton' }}</a>
                }
                <zed-row-menu [items]="menu()" [label]="'More actions for {id}' | t: 'staff.nonConformances.row.menuAria' : { id: col(s, 'ZedId') }" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr><td colspan="8" style="padding: 0"><div class="no-data">{{ loading() ? ('Loading…' | t: 'staff.nonConformances.loading') : ('No unit to show. Units with an open non-conformance round are listed here.' | t: 'staff.nonConformances.empty') }}</div></td></tr>
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
  protected readonly col = text;
  protected readonly f = flag;
  protected readonly n = num;
  protected readonly title = computed(() => t('staff.nonConformances.title', 'Non-conformances'));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));
  protected readonly menu = computed<RowMenuItem[]>(() => [{ key: 'profile', label: t('staff.nonConformances.menu.profile', 'View MSME profile'), icon: 'people' }]);

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

  /** The shown word of a mode (the code value stays Desktop / Remote / Onsite). */
  protected modeLabel(m: Mode): string {
    switch (m) {
      case 'Remote': return t('staff.nonConformances.mode.remoteLabel', 'Remote');
      case 'Onsite': return t('staff.nonConformances.mode.onsiteLabel', 'Onsite');
      default: return t('staff.nonConformances.mode.desktopLabel', 'Desktop');
    }
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.rows();
    const answered = rows.filter((r) => this.answered(r)).length;
    return [
      { key: 'all', label: t('staff.nonConformances.count.open', 'Open NC rounds'), value: rows.length },
      { key: 'answered', label: t('staff.nonConformances.count.answered', 'Answered: to review'), value: answered, tone: 'warn' },
      { key: 'waiting', label: t('staff.nonConformances.count.waiting', 'Waiting for the MSME'), value: rows.length - answered },
    ];
  });

  protected readonly modeChips = computed<FilterChip[]>(() => {
    const rows = this.rows();
    return [
      { key: '', label: t('staff.nonConformances.chip.all', 'All'), count: rows.length },
      ...(['Desktop', 'Remote', 'Onsite'] as Mode[]).map((m) => ({ key: m, label: this.modeLabel(m), count: rows.filter((r) => this.modeOf(r) === m).length })),
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
