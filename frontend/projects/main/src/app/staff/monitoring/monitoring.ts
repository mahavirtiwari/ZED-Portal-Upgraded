import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { MonitoringApi, MonitoringCounts, Row, StageCount } from './monitoring.api';
import { ChipFilter, FilterChip } from '../chip-filter';
import { TableExport } from '../table-export';
import {
  PENDING, STEP_ORDER, dateLabel, delayChips, delayClass, stepChips, stepLabels, stepState, tatDaysLeft, trackOf, trackTabs,
} from './monitoring-tat';
import { PagedView, PagerComponent } from '../pager';
import { HANDHOLDING_LEVEL_CODES, levelCodes, levelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { StaffRole } from '../staff-menu';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';
import { daysUntil, shortDate } from '../assessment/allot';
import { LevelMedal } from '../assessment/level-medal';
import { DashIcon } from '../../msme/dashboard/dash-icon';
import { TextPipe, t } from '../../content/page-text';
import { cleanAddress } from '../address';

type Action = { kind: 'extend'; unit: Row; days: number } | { kind: 'stepBack'; unit: Row } | { kind: 'sendBack'; unit: Row };

const NO_COUNTS: MonitoringCounts = { NotStarted: 0, InProgress: 0, Qc: 0, Nc: 0, Rj: 0 };

/** Stages the page opens on: in progress, or the one the header bell asks for (?status=4 or 5). */
const DEFAULT_STATUS = 3;

/**
 * "Assessment Monitoring" for MasterAdmin and agencies. Port of Views/Monitoring/Index.cshtml
 * (Monitoring/GetList; for MasterAdmin also ExtendNcClosureDate, StepBackToAssessor and
 * SendBackToAgencyForReAllot). Paging and the search work on the loaded list, as before.
 * "Assessment Details" opens the new DA / SA review page (as before: SA once the status is above 7);
 * "View Profile" opens the staff MSME profile page.
 * <p>Consultancy ("Consultancy Monitoring"): Silver/Gold, tabs not started / in progress / quality check, milestone,
 * consultants and experts, BDS/HAP or progress-review dates; no NC closure filter and no master-admin actions (no NC
 * round; the step-back and send-back procedures are missing there). Surveillance ("Surveillance Monitoring"):
 * Surveillance No and surveillance dates; no duplicates column; "Extend NC Final Closure Date" also on the REJECTED tab,
 * as that portal's page offered it; no send back to the agency (procedure missing).</p>
 * <p>2026-11-17 (approved staff-10): the stages are clickable tiles with their counts; the level is optional (the API then
 * lists every level); agency and mode filters on the loaded list; a Due column (days left or overdue to the NC final closure
 * date, or to the scheduled assessment date of a unit not started), sortable; the row's actions in its menu.</p>
 * <p>2026-11-18 (approved monitoring design, the user's decisions "TAT and monitoring"): the stage cards add "Desktop N · Site N"
 * (Consultancy: per milestone) and the delayed cases; under the stage two sub-tabs Desktop assessment / Site assessment (Consultancy:
 * all milestones or one) with their counts; a date range whose meaning follows the stage (allotted / assessment / submitted /
 * NC raised / rejected on, filtered by the API); Clear All. In progress → Site assessment: the app's steps as chips (parameters
 * distributed, opening meeting conducted, submitted through the app) and "Submission pending through mobile app" (the level's
 * man-days), the row showing its steps. Quality check: delay chips from the Admin's TAT (Administration → TAT), rows highlighted
 * by delay and listed most delayed first; the Due column shows the TAT wherever a rule applies. Excel export of the filtered list.</p>
 */
@Component({
  selector: 'zed-staff-monitoring',
  imports: [FormsModule, PagerComponent, PageHead, ListCounts, RowMenu, LevelMedal, DashIcon, ChipFilter, TextPipe],
  host: { class: 'list-v2 d-block' },
  templateUrl: './monitoring.html',
  styles: `
    .mo-hb { display: inline-flex; align-items: center; gap: 8px; }
    /* 2026-11-21 (UI audit L2): room for the chevron also on the chosen tile, and the tracks on their own line. */
    .mo-stages ::ng-deep .lc-btn, .mo-stages ::ng-deep .lc-btn.on { padding-right: 36px !important; }
    .mo-stages ::ng-deep .lc-sub { display: block; margin: 2px 0 0; }
    .mo-stages ::ng-deep .lc-btn:not(:last-child)::after { content: ''; position: absolute; right: 18px; top: 50%; width: 8px; height: 8px; margin-top: -4px;
      border: solid #9aadaf; border-width: 1.6px 1.6px 0 0; transform: rotate(45deg); }
    .mo-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; padding: 12px 14px; margin-bottom: 14px; }
    .mo-filters > * { flex: 0 1 170px; min-width: 0; }
    .mo-filters .mo-q { flex: 0 1 320px; position: relative; }
    .mo-q svg { position: absolute; left: 12px; top: 50%; width: 16px; transform: translateY(-50%); fill: none; stroke: #6f8487; stroke-width: 2; }
    .mo-q input { padding-left: 36px; background-image: none !important; }
    .mo-filters .mo-ag { flex-basis: 230px; }
    .mo-filters .mo-md { flex-basis: 160px; }
    .mo-nc { display: flex; gap: 6px; flex: 0 1 260px; }
    .mo-filters .mo-sort { flex: 0 0 auto; margin-left: auto; font-size: 13px; font-weight: 500; color: #24666b; }
    .mo-id { display: block; font-size: 11.5px; font-weight: 700; color: #24666b; }
    .mo-name b { font-size: 13.5px; font-weight: 700; color: #17373b; }
    .mo-dupn { color: #6f8487; }
    .unit-cell { min-width: 190px; }
    .stack > div + div { margin-top: 6px; }
    .stack b { display: block; }
    tr.mo-nc-open > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    .mo-dupn.mo-dup { color: #c8473c; }
    .mo-due-h { border: 0; background: none; padding: 0; font: inherit; color: inherit; text-transform: inherit; letter-spacing: inherit; }
    .mo-due-h:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .mo-pop .modal-content { border: 0; border-radius: 14px; }
    .mo-pop .modal-title { font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .mo-empty { padding: 28px 12px; text-align: center; color: #5f6f70; }
    .mo-sec { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; padding: 4px 16px 14px; margin-bottom: 14px; }
    .mo-tabs { display: flex; flex-wrap: wrap; gap: 4px; border-bottom: 1px solid #dde7e8; margin-bottom: 12px; }
    .mo-tab { border: 0; background: none; padding: 12px 18px 10px; font-weight: 600; font-size: 14px; color: #5f6f70; border-bottom: 3px solid transparent; }
    .mo-tab.on { color: var(--zt-ink, #173f44); border-bottom-color: var(--zt-dark, #24666b); font-weight: 700; }
    .mo-tab .cf-n { display: inline-block; min-width: 22px; margin-left: 8px; padding: 1px 7px; border-radius: 10px; background: #ecf0f0; font-size: 11px; color: #3d5559; }
    .mo-tab.on .cf-n { background: var(--zt-dark, #24666b); color: #fff; }
    .mo-chips { margin-bottom: 10px; }
    .mo-sec .mo-filters { padding: 0; margin: 0; }
    .mo-range { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; flex: 0 1 auto !important; }
    .mo-range label { font-size: 12.5px; font-weight: 600; color: #6f8487; margin: 0; }
    .mo-range input { width: 150px; }
    .mo-clear { border: 0; background: none; font-weight: 700; font-size: 13px; color: var(--zt-dark, #24666b); margin-left: auto; }
    .mo-steps { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; font-size: 12px; font-weight: 600; color: #8a9899; }
    .mo-steps > span::before { content: ''; display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #c3cdce; margin-right: 5px; }
    .mo-steps .done { color: #1e7a3c; }
    .mo-steps .done::before { background: #2f9e58; }
    .mo-steps .current { color: #9a5f06; }
    .mo-steps .current::before { background: #e0912b; }
    .mo-steps i { width: 14px; height: 1px; background: #c3cdce; }
    .mo-pend { display: inline-block; margin-top: 4px; font-size: 11.5px; font-weight: 700; color: #c8473c; }
    .mo-rule { display: block; font-size: 11px; color: #6f8487; margin-top: 2px; }
    tr.mo-d1 > td:first-child { box-shadow: inset 3px 0 0 #e0b02b; }
    tr.mo-d2 > td:first-child { box-shadow: inset 3px 0 0 #e0782b; }
    tr.mo-d3 > td:first-child, tr.mo-d4 > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    tr.mo-d4 > td { background: #fdf3f1; }
    /* 2026-11-21 (UI audit L3): the actions (⋮) stay on the right while the table scrolls sideways (tablets and phones). */
    .mo-act { position: sticky; right: 0; z-index: 2; }
    td.mo-act { background: #fff; }
    tr.mo-d4 > td.mo-act { background: #fdf3f1; }
    @media (max-width: 991.98px) { .mo-act { box-shadow: -8px 0 8px -8px rgba(16, 61, 64, 0.35); } }
  `,
})
export class MonitoringPage {
  private readonly api = inject(MonitoringApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly exporter = inject(TableExport);
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly main = this.system === 'main';
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly title = computed(() => this.consultancy ? t('staff.monitoring.consultancy.title', 'Consultancy Monitoring')
    : this.surveillance ? t('staff.monitoring.surveillance.title', 'Surveillance Monitoring') : t('staff.monitoring.title', 'Assessment Monitoring'));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));
  /** 2026-11-18: staff-10 has no subtitle (Consultancy keeps its line). */
  protected readonly subtitle = computed(() => this.consultancy ? t('staff.monitoring.consultancy.sub', 'Follow the handholding units by milestone stage.') : null);

  // V4: ZED-X is assessed on the main portal only.
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? [...HANDHOLDING_LEVEL_CODES] : levelCodes()));
  protected readonly levelName = levelName;
  protected readonly tabs: readonly { status: number; count: keyof MonitoringCounts }[] = this.consultancy
    ? [
        { status: 2, count: 'NotStarted' },
        { status: 3, count: 'InProgress' },
        { status: 5, count: 'Qc' },
      ]
    : [
        { status: 2, count: 'NotStarted' },
        { status: 3, count: 'InProgress' },
        { status: 5, count: 'Qc' },
        { status: 4, count: 'Nc' },
        { status: 7, count: 'Rj' },
      ];
  /** "No. of Days to Extend": 0 to 30, 0 chosen first, as the old pop-up. */
  protected readonly extendDays = Array.from({ length: 31 }, (_, i) => i);

  /** '' = every level. */
  protected readonly certification = signal('');
  protected readonly status = signal<number | null>(DEFAULT_STATUS);
  protected readonly ncClosingDate = signal('');
  protected readonly units = signal<Row[]>([]);
  protected readonly search = signal('');
  protected readonly agency = signal('');
  protected readonly modeFilter = signal('');
  /** Due column: soonest first (1), latest first (-1), or the list's order (0). */
  protected readonly dueSort = signal<1 | -1 | 0>(1);
  protected readonly counts = signal<MonitoringCounts>(NO_COUNTS);
  /** 2026-11-18: the stage cards' counts per sub-section (null: the procedure's counts only). */
  protected readonly stages = signal<StageCount[] | null>(null);
  /** The sub-section chosen ('' = the first with cases), the date range, the step and delay chips. */
  protected readonly trackPick = signal('');
  protected readonly from = signal('');
  protected readonly to = signal('');
  protected readonly step = signal('');
  protected readonly delay = signal('');
  protected readonly trackTabs = computed(() => trackTabs(this.system));
  protected readonly stepNames = computed(() => stepLabels(this.system));
  protected readonly stepOrder = STEP_ORDER;
  protected readonly stepState = stepState;
  protected readonly delayClass = delayClass;
  protected readonly dateLabel = computed(() => dateLabel(this.status()));
  /** The stage tiles (clickable: they choose the stage), with their sub-sections and delayed cases. */
  protected readonly stageCounts = computed<ListCount[]>(() => {
    const c = this.counts();
    const stages = this.stages();
    const tone: Partial<Record<keyof MonitoringCounts, ListCount['tone']>> = { Nc: 'warn', Rj: 'bad' };
    return this.tabs.map((tab) => {
      const s = stages?.find((x) => x.status === tab.status);
      let sub: string | null = null;
      if (s) {
        const delayed = tab.status === 5 && s.delayed ? s.delayed : 0;
        const m = { m1: s.tracks['m1'] ?? 0, m2: s.tracks['m2'] ?? 0, m3: s.tracks['m3'] ?? 0, delayed };
        const d = { desktop: s.tracks['desktop'] ?? 0, site: s.tracks['site'] ?? 0, delayed };
        sub = this.consultancy
          ? delayed ? t('staff.monitoring.stage.milestonesDelayed.sub', 'M1 {m1} · M2 {m2} · M3 {m3} · {delayed} delayed', m)
            : t('staff.monitoring.stage.milestones.sub', 'M1 {m1} · M2 {m2} · M3 {m3}', m)
          : delayed ? t('staff.monitoring.stage.tracksDelayed.sub', 'Desktop {desktop} · Site {site} · {delayed} delayed', d)
            : t('staff.monitoring.stage.tracks.sub', 'Desktop {desktop} · Site {site}', d);
      }
      return { key: String(tab.status), label: this.stageLabel(tab.status), value: s ? s.total : (c[tab.count] ?? 0), tone: tone[tab.count], sub };
    });
  });
  /** Agencies and modes of the loaded list, for the filters. */
  protected readonly agencies = computed(() => distinct(this.units().map((u) => [text(u, 'CertificationBodyUserId'), text(u, 'AgencyName') || text(u, 'CertificationBodyUserId')])));
  protected readonly modes = computed(() => distinct(this.units().map((u) => [text(u, 'ModeOfAssessment'), text(u, 'ModeOfAssessment')])));
  /** The list searched and limited to the agency (before the sub-section). */
  private readonly base = computed(() => {
    const q = this.search().trim().toLowerCase();
    const agency = this.agency();
    return this.units().filter((u) =>
      (!agency || text(u, 'CertificationBodyUserId') === agency) &&
      (!q || Object.values(u).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))));
  });
  /** The sub-tabs with their counts. */
  protected readonly tracks = computed(() => {
    const rows = this.base();
    return this.trackTabs().map((tab) => ({ ...tab, count: tab.key === 'all' ? rows.length : rows.filter((r) => trackOf(r, this.system) === tab.key).length }));
  });
  /** The chosen sub-section, else the first with cases (Consultancy: all milestones). */
  protected readonly track = computed(() => {
    const tabs = this.tracks();
    const picked = this.trackPick();
    if (picked && tabs.some((x) => x.key === picked)) return picked;
    return this.consultancy ? 'all' : (tabs.find((x) => x.count > 0) ?? tabs[0]).key;
  });
  private readonly trackRows = computed(() => {
    const track = this.track();
    const mode = track === 'site' ? this.modeFilter() : '';
    return this.base().filter((r) => (track === 'all' || trackOf(r, this.system) === track) && (!mode || text(r, 'ModeOfAssessment') === mode));
  });
  /** In progress → Site assessment (Consultancy: any milestone): the app's steps and the submission pending (man-days). */
  protected readonly showSteps = computed(() => this.status() === 3 && (this.consultancy || this.track() === 'site'));
  protected readonly stepFilter = computed<FilterChip[]>(() => {
    const rows = this.trackRows();
    return [{ key: '', label: t('staff.monitoring.stepChip.all.chip', 'All'), count: rows.length },
      ...stepChips(this.system).map((c) => ({ ...c, count: rows.filter((r) => this.inStep(r, c.key)).length }))];
  });
  /** Quality check: the delay chips (TAT). */
  protected readonly showDelays = computed(() => this.status() === 5);
  protected readonly delayFilter = computed<FilterChip[]>(() => {
    const rows = this.trackRows();
    return [{ key: '', label: t('staff.monitoring.delay.all.chip', 'All'), count: rows.length }, ...delayChips().map((c) => ({ ...c, count: rows.filter((r) => r['TatBucket'] === c.key).length }))];
  });
  protected readonly filtered = computed(() => !!(this.search() || this.certification() || this.agency() || this.modeFilter() || this.from() || this.to() || this.step() || this.delay()));
  protected readonly shown = computed(() => {
    const step = this.showSteps() ? this.step() : '';
    const delay = this.showDelays() ? this.delay() : '';
    const list = this.trackRows().filter((r) => (!step || this.inStep(r, step)) && (!delay || r['TatBucket'] === delay));
    const dir = this.dueSort();
    if (!dir) return list;
    return list.sort((a, b) => {
      const x = this.dueDays(a), y = this.dueDays(b);
      return x === y ? 0 : x === null ? 1 : y === null ? -1 : (x - y) * dir;
    });
  });
  protected readonly view = new PagedView(() => this.shown(), 10);
  /** The Due / Delay column: shown when a unit of the list has a due date or a TAT (2026-11-21, audit item 7). */
  protected readonly showDue = computed(() => this.shown().some((r) => this.due(r) !== null));
  // The server says so with each list; until the first list, the role decides, as the old page's header did
  // (MasterAdmin: "Assessment Dates / NC Closure Date").
  protected readonly canManage = signal(inject(AuthService).currentUser()?.roleId === 7);
  /** 2026-11-21 (Assessment Agency UI audit, item 7): an agency (or CO) login lists only its own units. */
  protected readonly ownUnitsOnly = inject(AuthService).currentUser()?.roleId === StaffRole.Agency;
  /** The Excel workbook is being made (the Export button says so). */
  protected readonly exporting = signal(false);
  private readonly route = inject(ActivatedRoute);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly action = signal<Action | null>(null);
  protected readonly actionError = signal('');
  private request = 0;

  constructor() {
    // The header bell opens a stage: ?status=4 (NC closures overdue) or ?status=5 (quality check).
    const asked = Number(this.route.snapshot.queryParamMap.get('status'));
    if (this.tabs.some((x) => x.status === asked)) this.status.set(asked);
    void this.load();
  }

  protected setCertification(value: string): void {
    this.certification.set(value);
    void this.load();
  }

  protected setStatus(value: number): void {
    this.status.set(value);
    // 2026-11-21 (audit item 7): the address keeps the chosen stage (?status=), so a reload or a shared link opens it again.
    void this.router.navigate([], { relativeTo: this.route, queryParams: { status: value }, queryParamsHandling: 'merge', replaceUrl: true });
    this.ncClosingDate.set('');
    // The sub-section, chips and date range belong to the stage (the range's meaning follows it).
    this.trackPick.set('');
    this.step.set('');
    this.delay.set('');
    this.from.set('');
    this.to.set('');
    void this.load();
  }

  protected pickTrack(key: string): void {
    this.trackPick.set(key);
    this.step.set('');
    this.delay.set('');
  }

  protected setRange(which: 'from' | 'to', value: string): void {
    (which === 'from' ? this.from : this.to).set(value ?? '');
    const f = this.from(), to = this.to();
    if (!f || !to || f <= to) void this.load();
  }

  protected clearAll(): void {
    const reload = !!(this.certification() || this.from() || this.to());
    this.search.set('');
    this.certification.set('');
    this.agency.set('');
    this.modeFilter.set('');
    this.from.set('');
    this.to.set('');
    this.step.set('');
    this.delay.set('');
    if (reload) void this.load();
  }

  /** A row in a step chip (the pending chip: the API's SubmissionPending). */
  protected inStep(r: Row, key: string): boolean {
    return key === PENDING ? r['SubmissionPending'] === true : (r['Step'] ?? (this.consultancy ? 'distributed' : null)) === key;
  }

  protected exportList(): void {
    const columns = [
      t('staff.monitoring.export.column.zedId', 'ZED ID'), t('staff.monitoring.export.column.unit', 'Unit'), t('staff.monitoring.export.column.level', 'Level'),
      this.consultancy ? t('staff.monitoring.export.column.co', 'CO') : t('staff.monitoring.export.column.agency', 'Agency'),
      this.consultancy ? t('staff.monitoring.export.column.coId', 'CO ID') : t('staff.monitoring.export.column.agencyId', 'Agency ID'),
      t('staff.monitoring.export.column.subSection', 'Sub-section'), t('staff.monitoring.export.column.mode', 'Mode'),
      this.consultancy ? t('staff.monitoring.export.column.consultants', 'Consultants') : t('staff.monitoring.export.column.assessors', 'Assessors'),
      t('staff.monitoring.export.column.date', 'Date'), t('staff.monitoring.export.column.due', 'Due / Delay'), t('staff.monitoring.export.column.tatRule', 'TAT rule'),
      t('staff.monitoring.export.column.contact', 'Contact'), t('staff.monitoring.export.column.contactMobile', 'Contact mobile'),
      t('staff.monitoring.export.column.contactEmail', 'Contact e-mail')];
    const tabName = (r: Row) => this.trackTabs().find((x) => x.key === trackOf(r, this.system))?.label ?? '';
    const rows = this.shown().map((r) => [
      text(r, 'ZedId'), text(r, 'PUnitName'), this.levelName(text(r, 'Certification')), text(r, 'AgencyName'), text(r, 'CertificationBodyUserId'), tabName(r),
      text(r, 'ModeOfAssessment'), this.assessors(r).map((p) => [p.name, p.id].filter((x) => x).join(' ')).join(', '), shortDate(r['StageDate']) || text(r, 'SaAssessmentDate'),
      this.due(r)?.label ?? '', text(r, 'TatRule'), text(r, 'UnitSpocName'), text(r, 'UnitSpocMobileNo'), text(r, 'UnitSpocEmailId'),
    ]);
    const status = this.status();
    const stage = this.tabs.some((x) => x.status === status) ? this.stageLabel(status!) : '';
    const title = this.title();
    this.exporting.set(true);
    void this.exporter.xlsx(`${title} ${stage}`.trim(), [{ name: stage || title, columns, rows }])
      .then(() => this.toast.success(t('staff.monitoring.toast.exported', 'Export ready'),
        t('staff.monitoring.toast.exportedText', '{count} units saved to Excel.', { count: rows.length })))
      .catch((err) => this.toast.error(t('staff.monitoring.toast.exportFailed', 'Export'), apiErrorMessage(err)))
      .finally(() => this.exporting.set(false));
  }

  /** The stage's name (tiles, export). */
  protected stageLabel(status: number): string {
    switch (status) {
      case 2: return t('staff.monitoring.stage.notStarted.label', 'Scheduled, not started');
      case 3: return this.consultancy ? t('staff.monitoring.stage.consultancyInProgress.label', 'Consultancy in progress')
        : this.surveillance ? t('staff.monitoring.stage.inProgress.label', 'In progress') : t('staff.monitoring.stage.assessmentInProgress.label', 'Assessment in progress');
      case 5: return t('staff.monitoring.stage.qualityCheck.label', 'Quality check');
      case 4: return t('staff.monitoring.stage.nc.label', 'Non-conformance');
      case 7: return t('staff.monitoring.stage.rejected.label', 'Rejected');
      default: return '';
    }
  }

  protected pickStage(key: string | undefined): void {
    const status = Number(key);
    if (this.tabs.some((x) => x.status === status)) this.setStatus(status);
  }

  protected toggleDueSort(): void {
    this.dueSort.set(this.dueSort() === 1 ? -1 : this.dueSort() === -1 ? 0 : 1);
  }

  protected async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(
        this.api.list({
          certification: this.certification(),
          status: this.status(),
          ncClosingDate: !this.consultancy && this.status() === 4 ? this.ncClosingDate() || null : null,
          from: this.from() || null,
          to: this.to() || null,
        }),
      );
      if (request !== this.request) return;
      this.units.set(data.units ?? []);
      this.counts.set(data.counts ?? NO_COUNTS);
      this.stages.set(data.stages ?? null);
      this.canManage.set(!!data.canManage);
      if (this.agency() && !this.agencies().some((a) => a[0] === this.agency())) this.agency.set('');
      if (this.modeFilter() && !this.modes().some((m) => m[0] === this.modeFilter())) this.modeFilter.set('');
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  // ----- row helpers -----

  protected num(r: Row, field: string): number {
    return Number(r[field] ?? 0) || 0;
  }

  /** 2026-11-21 (UI audit W8): the unit's address without its empty parts ("Block:- ,"). */
  protected address(r: Row): string {
    return cleanAddress(r['UnitAddress']);
  }

  protected col(r: Row, field: string): string {
    return text(r, field);
  }

  protected highlighted(r: Row): boolean {
    const cs = this.num(r, 'CertificationStatus');
    return this.num(r, 'NcStatus') === 2 && (cs === 4 || cs === 14);
  }

  protected mode(r: Row): string {
    const m = text(r, 'ModeOfAssessment');
    if (this.surveillance) return m;
    return m === 'Remote Assessment' ? t('staff.monitoring.mode.remote.chip', 'Remote')
      : m === 'Onsite Assessment' ? t('staff.monitoring.mode.onsite.chip', 'Onsite') : t('staff.monitoring.mode.desktop.chip', 'Desktop');
  }

  protected assessors(r: Row): { name: string; id: string }[] {
    const roles = this.consultancy ? ['SiteAssessor', 'CoAssessor'] : ['DesktopAssessor', 'SiteAssessor', 'CoAssessor'];
    const list = roles.map((p) => ({ name: text(r, p + 'Name'), id: text(r, p + 'Id') }));
    if (this.consultancy) list.push({ name: text(r, 'TechExpertName'), id: text(r, 'TechExpert') });
    return list.filter((p) => p.name || p.id);
  }

  /**
   * Days to the unit's deadline from the dates the list has: the NC final closure date (NC stage; surveillance also rejected;
   * master admin only, as the API gives it), or the scheduled assessment date of a unit not started. Null otherwise.
   */
  protected dueDays(r: Row): number | null {
    // 2026-11-18: the TAT (Administration → TAT) wherever a rule applies.
    const tat = tatDaysLeft(r);
    if (tat !== null) return tat;
    const status = this.status();
    if ((status === 4 || (this.surveillance && status === 7)) && r['NcFinalClosureDt']) return daysUntil(r['NcFinalClosureDt']);
    if (status === 2 && !this.consultancy && r['SaAssessmentDate']) return daysUntil(r['SaAssessmentDate']);
    return null;
  }

  protected due(r: Row): { label: string; cls: string } | null {
    if (typeof r['TatLabel'] === 'string' && r['TatLabel']) {
      const b = r['TatBucket'];
      return { label: r['TatLabel'], cls: b === 'on-time' ? 'is-good' : b === 'lt1' || b === '1-5' ? 'is-warn' : 'is-bad' };
    }
    const d = this.dueDays(r);
    if (d === null) return null;
    if (d < 0) return { label: d === -1 ? t('staff.monitoring.due.overdueDay.chip', 'Overdue {count} day', { count: -d })
      : t('staff.monitoring.due.overdueDays.chip', 'Overdue {count} days', { count: -d }), cls: 'is-bad' };
    if (d === 0) return { label: t('staff.monitoring.due.today.chip', 'Due today'), cls: 'is-warn' };
    return { label: d === 1 ? t('staff.monitoring.due.dayLeft.chip', '{count} day left', { count: d })
      : t('staff.monitoring.due.daysLeft.chip', '{count} days left', { count: d }), cls: d <= 5 ? 'is-warn' : '' };
  }

  protected readonly shortDate = shortDate;

  /** Main only: the re-allocation procedure is missing in the consultancy and surveillance databases. */
  protected canSendBack(r: Row): boolean {
    if (!this.main) return false;
    const cs = this.num(r, 'CertificationStatus');
    // With every level listed, the row's own level decides (never Bronze), as with one level chosen.
    return ((this.status() === 2 && cs === 8) || (this.status() === 3 && cs === 9)) && text(r, 'Certification') !== 'Bronze';
  }

  protected profileLink(r: Row): string {
    return `/staff/msme-profile/${encodeURIComponent(String(r['ZedId'] ?? ''))}`;
  }

  /** The review page of the unit: the site assessment page once the site stage started (status above 7). */
  protected detailsLink(r: Row): string {
    const zedId = encodeURIComponent(String(r['ZedId'] ?? ''));
    const cert = encodeURIComponent(String(r['Certification'] ?? ''));
    // Consultancy: the milestone review page of the unit's current milestone.
    if (this.consultancy) return `/staff/consultancy/milestones/${zedId}/${cert}`;
    const page = this.num(r, 'CertificationStatus') > 7 ? 'sa-details' : 'da-details';
    return `/staff/assessment/${page}/${zedId}/${cert}`;
  }

  /** The row's actions: as its old buttons (the master admin's per stage). */
  menu(r: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { key: 'details', label: this.consultancy ? t('staff.monitoring.menu.viewDetails.label', 'View details') : t('staff.monitoring.menu.assessmentDetails.label', 'Assessment details'), icon: 'eye' },
      { key: 'profile', label: t('staff.monitoring.menu.profile.label', 'View MSME profile'), icon: 'people' },
    ];
    if (this.canManage() && !this.consultancy) {
      const status = this.status();
      if (status === 4 || (this.surveillance && status === 7)) items.push({ key: 'extend', label: t('staff.monitoring.menu.extend.label', 'Extend NC final closure date'), icon: 'history' });
      if (status === 4) items.push({ key: 'stepBack', label: t('staff.monitoring.menu.stepBack.label', 'Step back to NC{round}', { round: this.num(r, 'NcCount') - 1 }), icon: 'refresh', danger: true });
      if (this.canSendBack(r)) items.push({ key: 'sendBack', label: t('staff.monitoring.menu.sendBack.label', 'Send back to agency'), icon: 'refresh', danger: true });
    }
    return items;
  }

  protected act(r: Row, key: string): void {
    switch (key) {
      case 'details': void this.router.navigateByUrl(this.detailsLink(r)); break;
      case 'profile': void this.router.navigateByUrl(this.profileLink(r)); break;
      case 'extend': this.open({ kind: 'extend', unit: r, days: 0 }); break;
      case 'stepBack': this.open({ kind: 'stepBack', unit: r }); break;
      case 'sendBack': this.open({ kind: 'sendBack', unit: r }); break;
    }
  }

  // ----- master admin actions -----

  protected open(a: Action): void {
    this.actionError.set('');
    this.action.set(a);
  }

  protected close(): void {
    this.action.set(null);
  }

  protected async submit(a: Action): Promise<void> {
    // The API extends by 1 to 30 days; 0 (the old default) would change nothing.
    if (a.kind === 'extend' && !(Number(a.days) >= 1 && Number(a.days) <= 30)) {
      this.actionError.set(t('staff.monitoring.extend.daysError', 'Please select the number of days (1 to 30).'));
      return;
    }
    const zedId = String(a.unit['ZedId']);
    const certification = String(a.unit['Certification']);
    this.loading.set(true);
    this.actionError.set('');
    try {
      const res = await firstValueFrom(
        a.kind === 'extend'
          ? this.api.extendNcClosure(zedId, certification, Number(a.days))
          : a.kind === 'stepBack'
            ? this.api.stepBackNc(zedId, certification)
            : this.api.sendBackToAgency(zedId, certification),
      );
      this.action.set(null);
      this.toast.success(zedId, res.message);
    } catch (err) {
      this.actionError.set(apiErrorMessage(err));
      return;
    } finally {
      this.loading.set(false);
    }
    await this.load();
  }
}

function text(r: Row, field: string): string {
  const v = r[field];
  return v === null || v === undefined ? '' : String(v);
}

/** Unique [value, label] pairs by value (empty values left out), by label. */
function distinct(pairs: string[][]): [string, string][] {
  const map = new Map<string, string>();
  for (const [v, l] of pairs) if (v && !map.has(v)) map.set(v, l);
  return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1]));
}
