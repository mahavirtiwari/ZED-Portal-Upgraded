import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { MonitoringApi, MonitoringCounts, Row } from './monitoring.api';
import { PagedView, PagerComponent } from '../pager';
import { HANDHOLDING_LEVEL_CODES, levelCodes, levelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';
import { daysUntil, shortDate } from '../assessment/allot';
import { LevelMedal } from '../assessment/level-medal';
import { DashIcon } from '../../msme/dashboard/dash-icon';

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
 */
@Component({
  selector: 'zed-staff-monitoring',
  imports: [FormsModule, PagerComponent, PageHead, ListCounts, RowMenu, LevelMedal, DashIcon],
  host: { class: 'list-v2 d-block' },
  templateUrl: './monitoring.html',
  styles: `
    .mo-hb { display: inline-flex; align-items: center; gap: 8px; }
    .mo-stages ::ng-deep .lc-btn { padding-right: 36px; }
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
  `,
})
export class MonitoringPage {
  private readonly api = inject(MonitoringApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly main = this.system === 'main';
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly title = this.consultancy ? 'Consultancy Monitoring' : this.surveillance ? 'Surveillance Monitoring' : 'Assessment Monitoring';
  protected readonly crumbs = staffCrumbs({ label: this.title });
  /** 2026-11-18: staff-10 has no subtitle (Consultancy keeps its line). */
  protected readonly subtitle = this.consultancy ? 'Follow the handholding units by milestone stage.' : null;

  // V4: ZED-X is assessed on the main portal only.
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? [...HANDHOLDING_LEVEL_CODES] : levelCodes()));
  protected readonly levelName = levelName;
  protected readonly tabs: readonly { status: number; label: string; count: keyof MonitoringCounts }[] = this.consultancy
    ? [
        { status: 2, label: 'Scheduled, not started', count: 'NotStarted' },
        { status: 3, label: 'Consultancy in progress', count: 'InProgress' },
        { status: 5, label: 'Quality check', count: 'Qc' },
      ]
    : [
        { status: 2, label: 'Scheduled, not started', count: 'NotStarted' },
        { status: 3, label: this.surveillance ? 'In progress' : 'Assessment in progress', count: 'InProgress' },
        { status: 5, label: 'Quality check', count: 'Qc' },
        { status: 4, label: 'Non-conformance', count: 'Nc' },
        { status: 7, label: 'Rejected', count: 'Rj' },
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
  /** The stage tiles (clickable: they choose the stage). */
  protected readonly stageCounts = computed<ListCount[]>(() => {
    const c = this.counts();
    const tone: Partial<Record<keyof MonitoringCounts, ListCount['tone']>> = { Nc: 'warn', Rj: 'bad' };
    return this.tabs.map((t) => ({ key: String(t.status), label: t.label, value: c[t.count] ?? 0, tone: tone[t.count] }));
  });
  /** Agencies and modes of the loaded list, for the filters. */
  protected readonly agencies = computed(() => distinct(this.units().map((u) => [text(u, 'CertificationBodyUserId'), text(u, 'AgencyName') || text(u, 'CertificationBodyUserId')])));
  protected readonly modes = computed(() => distinct(this.units().map((u) => [text(u, 'ModeOfAssessment'), text(u, 'ModeOfAssessment')])));
  protected readonly shown = computed(() => {
    const q = this.search().trim().toLowerCase();
    const agency = this.agency();
    const mode = this.modeFilter();
    const list = this.units().filter((u) =>
      (!agency || text(u, 'CertificationBodyUserId') === agency) && (!mode || text(u, 'ModeOfAssessment') === mode) &&
      (!q || Object.values(u).some((v) => v !== null && v !== undefined && String(v).toLowerCase().includes(q))));
    const dir = this.dueSort();
    if (!dir) return list;
    return list.sort((a, b) => {
      const x = this.dueDays(a), y = this.dueDays(b);
      return x === y ? 0 : x === null ? 1 : y === null ? -1 : (x - y) * dir;
    });
  });
  protected readonly view = new PagedView(() => this.shown(), 10);
  // The server says so with each list; until the first list, the role decides, as the old page's header did
  // (MasterAdmin: "Assessment Dates / NC Closure Date").
  protected readonly canManage = signal(inject(AuthService).currentUser()?.roleId === 7);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly action = signal<Action | null>(null);
  protected readonly actionError = signal('');
  private request = 0;

  constructor() {
    // The header bell opens a stage: ?status=4 (NC closures overdue) or ?status=5 (quality check).
    const asked = Number(inject(ActivatedRoute).snapshot.queryParamMap.get('status'));
    if (this.tabs.some((t) => t.status === asked)) this.status.set(asked);
    void this.load();
  }

  protected setCertification(value: string): void {
    this.certification.set(value);
    void this.load();
  }

  protected setStatus(value: number): void {
    this.status.set(value);
    this.ncClosingDate.set('');
    void this.load();
  }

  protected pickStage(key: string | undefined): void {
    const status = Number(key);
    if (this.tabs.some((t) => t.status === status)) this.setStatus(status);
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
        }),
      );
      if (request !== this.request) return;
      this.units.set(data.units ?? []);
      this.counts.set(data.counts ?? NO_COUNTS);
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

  protected t(r: Row, field: string): string {
    return text(r, field);
  }

  protected highlighted(r: Row): boolean {
    const cs = this.num(r, 'CertificationStatus');
    return this.num(r, 'NcStatus') === 2 && (cs === 4 || cs === 14);
  }

  protected mode(r: Row): string {
    const m = text(r, 'ModeOfAssessment');
    if (this.surveillance) return m;
    return m === 'Remote Assessment' ? 'Remote' : m === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
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
    const status = this.status();
    if ((status === 4 || (this.surveillance && status === 7)) && r['NcFinalClosureDt']) return daysUntil(r['NcFinalClosureDt']);
    if (status === 2 && !this.consultancy && r['SaAssessmentDate']) return daysUntil(r['SaAssessmentDate']);
    return null;
  }

  protected due(r: Row): { label: string; cls: string } | null {
    const d = this.dueDays(r);
    if (d === null) return null;
    if (d < 0) return { label: `Overdue ${-d} ${d === -1 ? 'day' : 'days'}`, cls: 'is-bad' };
    if (d === 0) return { label: 'Due today', cls: 'is-warn' };
    return { label: `${d} ${d === 1 ? 'day' : 'days'} left`, cls: d <= 5 ? 'is-warn' : '' };
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
      { key: 'details', label: this.consultancy ? 'View details' : 'Assessment details', icon: 'eye' },
      { key: 'profile', label: 'View MSME profile', icon: 'people' },
    ];
    if (this.canManage() && !this.consultancy) {
      const status = this.status();
      if (status === 4 || (this.surveillance && status === 7)) items.push({ key: 'extend', label: 'Extend NC final closure date', icon: 'history' });
      if (status === 4) items.push({ key: 'stepBack', label: `Step back to NC${this.num(r, 'NcCount') - 1}`, icon: 'refresh', danger: true });
      if (this.canSendBack(r)) items.push({ key: 'sendBack', label: 'Send back to agency', icon: 'refresh', danger: true });
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
      this.actionError.set('Please select the number of days (1 to 30).');
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
