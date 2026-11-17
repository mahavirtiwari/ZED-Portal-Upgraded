import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashboardPortalSwitchComponent } from '../dashboard-portal-switch';
import { PageHead } from '../../msme/shared/page-head';
import { PORTAL_SYSTEM } from '../../portal-system';
import { ChipFilter, FilterChip } from '../chip-filter';
import { staffCrumbs } from '../staff-crumbs';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import type { StaffMsmeProfile } from '../msme-profile/msme-profile';

export interface HistoryRow {
  Source_DB: string | null;
  ZedId: string | null;
  Description: string | null;
  CreatedDate: string | null;
  CertificationType: string | null;
  StatusType: string | null;
  MiletoneNo: string | null;
}

/** Who did it (2026-11-17, design 13): the unit, its assessment agency, the assessor, or the ZED team / system; null when the line does not say. */
export type HistoryActor = 'MSME' | 'Agency' | 'Assessor' | 'ZED';

export interface TimelineEvent extends HistoryRow {
  label: string;
  icon: string;
  alert: boolean;
  done: boolean;
  actor: HistoryActor | null;
}

export interface TimelineGroup {
  cert: string;
  title: string;
  start: string | null;
  end: string | null;
  events: TimelineEvent[];
}

/** StatusType -> label and icon, as on the old page (icons replaced by text symbols: no font-awesome here). */
/**
 * 2026-11-17 (design 13): the actor of each status, only where the status itself says who acts: the unit applies and submits
 * its documents; the ZED team allots the agency and certifies; the agency allots its desktop assessor; the assessor raises
 * NCs and completes the desktop assessment. "Assessment Completed" and "Sent to Agency for QC" name no actor: untagged.
 */
const STATUS_META: Record<string, { label: string; icon: string; alert?: boolean; actor?: HistoryActor }> = {
  ApplicationReceived: { label: 'Application Received', icon: '\u{1F4C4}', actor: 'MSME' },
  BasicInfoStatus: { label: 'Basic Info & Documents Submitted', icon: '✎', actor: 'MSME' },
  AgencyAlloted: { label: 'Assessment Agency Allotted', icon: '☷', actor: 'ZED' },
  DocVerifiAllot: { label: 'Desktop Assessor Allotted', icon: '+', actor: 'Agency' },
  NcRaised: { label: 'Non-Conformance Raised', icon: '!', alert: true, actor: 'Assessor' },
  NcClosed: { label: 'Desktop Assessment Completed By Assessor', icon: '✓', actor: 'Assessor' },
  Completed: { label: 'Assessment Completed', icon: '⚑' },
  GetCertified: { label: 'Certified', icon: '★', actor: 'ZED' },
  DirectQC: { label: 'Sent to Agency for QC', icon: '?' },
};

function meta(row: HistoryRow): { label: string; icon: string; alert?: boolean; actor?: HistoryActor } {
  const m = row.StatusType ? STATUS_META[row.StatusType] : undefined;
  if (m) return m;
  const d = (row.Description ?? '').toLowerCase();
  if (d.startsWith('registered') || (d.includes('registered') && d.includes('udyam'))) return { label: 'Registered on ZED Portal', icon: '↑', actor: 'MSME' };
  if (d.includes('payment')) return { label: 'Payment', icon: '₹', actor: 'MSME' };
  if (d.includes('accepted by assessor')) return { label: 'Accepted by Assessor', icon: '✓', actor: 'Assessor' };
  return { label: '', icon: '•' };
}

export const HISTORY_ACTORS: HistoryActor[] = ['MSME', 'Agency', 'Assessor', 'ZED'];

/** The searched ZED IDs kept in this browser (newest first). */
export const RECENT_KEY = 'zed.staff.history.recent';
const RECENT_MAX = 5;

function readRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && /^[A-Z0-9]{3,30}$/.test(x)).slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function writeRecent(list: string[]): void {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list));
  } catch {
    // Storage blocked: the recent searches only last this visit.
  }
}

/** Sorts by date and groups events by certification level and phase (same rules as the old page). */
export function buildTimeline(rows: HistoryRow[]): TimelineGroup[] {
  const sorted = [...rows].sort((a, b) => new Date(a.CreatedDate ?? 0).getTime() - new Date(b.CreatedDate ?? 0).getTime());
  const groups: TimelineGroup[] = [];
  const byKey = new Map<string, TimelineGroup>();
  for (const r of sorted) {
    const m = meta(r);
    const phase = r.Source_DB === 'SURVEILLANCE' ? 'Surveillance' : 'Certification';
    const cert = r.CertificationType ?? '';
    const key = `${cert}|${phase}`;
    let g = byKey.get(key);
    if (!g) {
      g = { cert, title: cert ? `${cert} ${phase}` : 'Registration', start: r.CreatedDate, end: r.CreatedDate, events: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.end = r.CreatedDate;
    g.events.push({ ...r, label: m.label, icon: m.icon, alert: !!m.alert, done: r.StatusType === 'GetCertified' || r.StatusType === 'Completed', actor: m.actor ?? null });
  }
  return groups;
}

/** One key date of the summary rail. */
export interface KeyDate {
  label: string;
  date: string | null;
}

/** The key dates the history has: registration, then per level its application and its certification. */
export function keyDates(events: TimelineEvent[]): KeyDate[] {
  const first = (test: (e: TimelineEvent) => boolean) => events.find(test)?.CreatedDate ?? null;
  const out: KeyDate[] = [];
  const registered = first((e) => e.label === 'Registered on ZED Portal');
  if (registered) out.push({ label: 'Registered', date: registered });
  const levels = [...new Set(events.map((e) => e.CertificationType).filter((c): c is string => !!c))];
  for (const level of levels) {
    const applied = first((e) => e.CertificationType === level && e.StatusType === 'ApplicationReceived');
    if (applied) out.push({ label: `${level} applied`, date: applied });
    const certified = first((e) => e.CertificationType === level && e.StatusType === 'GetCertified');
    if (certified) out.push({ label: `${level} certified`, date: certified });
  }
  return out;
}

/**
 * Certification history of a ZED ID across certification, handholding and surveillance (MasterAdmin; on every portal also
 * the dashboard logins, as "Customer History"). Port of Views/Msme/History.cshtml. The old page had no search box and
 * posted an empty ZED ID; here the ZED ID is entered (or given as ?zedId=).
 * 2026-11-17 (the user's staff design 13): a result page: the unit's header (from its profile, when the login may read it)
 * with its MSME profile / assessment details links and the Export, each event tagged with who did it (MSME, Agency,
 * Assessor, ZED; untagged when the line does not say) with filter chips, newest first, the key dates and the counts by
 * actor beside it, and the last searched ZED IDs beside the box (this browser only).
 */
@Component({
  selector: 'zed-staff-zed-history',
  imports: [FormsModule, DatePipe, RouterLink, DashboardPortalSwitchComponent, PageHead, ChipFilter],
  templateUrl: './zed-history.html',
  styleUrl: './zed-history.css',
})
export class ZedHistoryPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  private readonly exporter = inject(TableExport);
  private readonly toast = inject(ToastService);
  private readonly roleId = inject(AuthService).currentUser()?.roleId ?? 0;
  /** The dashboard logins (SuperAdmin, CitizenFeedback, QC) know it as Customer History. */
  protected readonly heading = [10, 11, 17].includes(this.roleId) ? 'Customer History' : 'ZED ID History';
  protected readonly crumbs = staffCrumbs({ label: this.heading });
  protected readonly actors = HISTORY_ACTORS;

  protected zedId = '';
  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly searched = signal('');
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  protected readonly recent = signal<string[]>(readRecent());
  /** The unit's profile for the header (null when the login may not read it or it is not loaded). */
  protected readonly profile = signal<StaffMsmeProfile | null>(null);
  protected readonly actor = signal('');
  protected readonly newestFirst = signal(true);
  protected readonly exporting = signal(false);

  protected readonly groups = computed(() => buildTimeline(this.rows()));
  protected readonly events = computed(() => this.groups().flatMap((g) => g.events).sort(
    (a, b) => new Date(a.CreatedDate ?? 0).getTime() - new Date(b.CreatedDate ?? 0).getTime()));
  protected readonly latest = computed(() => this.events().at(-1) ?? null);
  protected readonly dates = computed(() => keyDates(this.events()));
  protected readonly counts = computed(() => {
    const out: Record<string, number> = {};
    for (const a of HISTORY_ACTORS) out[a] = this.events().filter((e) => e.actor === a).length;
    return out;
  });
  protected readonly maxCount = computed(() => Math.max(1, ...HISTORY_ACTORS.map((a) => this.counts()[a])));
  protected readonly chips = computed<FilterChip[]>(() => [
    { key: '', label: 'All', count: this.events().length },
    ...HISTORY_ACTORS.map((a) => ({ key: a, label: a, count: this.counts()[a] })),
  ]);
  /** The timeline as shown: the actor chosen, newest (or oldest) first, still grouped by level and phase. */
  protected readonly shownGroups = computed(() => {
    const a = this.actor();
    const groups = this.groups()
      .map((g) => ({ ...g, events: a ? g.events.filter((e) => e.actor === a) : g.events }))
      .filter((g) => g.events.length);
    return this.newestFirst() ? groups.reverse().map((g) => ({ ...g, events: [...g.events].reverse() })) : groups;
  });
  /** The level of the latest event, and whether the history shows it certified. */
  protected readonly level = computed(() => {
    const level = [...this.events()].reverse().find((e) => e.CertificationType)?.CertificationType ?? null;
    return level ? { level, certified: this.events().some((e) => e.CertificationType === level && e.StatusType === 'GetCertified') } : null;
  });
  protected readonly unitName = computed(() => {
    const p = this.profile();
    return p ? String(p.unit['PUnitName'] ?? '') || String(p.enterprise['EnterpriseName'] ?? '') : '';
  });
  protected readonly unitLine = computed(() => {
    const p = this.profile();
    if (!p) return '';
    const v = (row: Record<string, unknown>, f: string) => String(row[f] ?? '').trim();
    return [v(p.enterprise, 'UdyogAadharNo'), [v(p.unit, 'PDistrictName'), v(p.unit, 'PStateName')].filter(Boolean).join(', '), v(p.enterprise, 'EnterpriseTypee')]
      .filter(Boolean).join(' · ');
  });
  /** Assessment details of the latest level (the assessment pages are not on the consultancy portal). */
  protected readonly assessmentLink = computed(() => {
    const l = this.level();
    return l && PORTAL_SYSTEM !== 'consultancy' ? ['/staff/assessment/da-details', this.searched(), l.level] : null;
  });

  constructor() {
    const initial = inject(ActivatedRoute).snapshot.queryParamMap.get('zedId');
    if (initial) {
      this.zedId = initial;
      void this.search();
    }
  }

  protected pick(id: string): void {
    this.zedId = id;
    void this.search();
  }

  protected async search(): Promise<void> {
    const id = this.zedId.trim().toUpperCase();
    this.error.set('');
    if (!/^[A-Za-z0-9]{3,30}$/.test(id)) {
      this.error.set('Please enter a valid ZED ID.');
      return;
    }
    this.loading.set(true);
    this.actor.set('');
    this.profile.set(null);
    try {
      this.rows.set(await firstValueFrom(this.http.get<HistoryRow[]>(`/api/staff/history/${encodeURIComponent(id)}`)));
      this.searched.set(id);
      this.remember(id);
      void this.router.navigate([], { queryParams: { zedId: id }, replaceUrl: true });
      if (this.rows().length) void this.loadProfile(id);
    } catch (err) {
      this.rows.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
      this.loaded.set(true);
    }
  }

  /** The header's name, Udyam number and place (optional: without them the header shows the ZED ID only). */
  private async loadProfile(id: string): Promise<void> {
    try {
      const p = await firstValueFrom(this.http.get<StaffMsmeProfile>(`/api/staff/msme-profile/${encodeURIComponent(id)}`));
      if (this.searched() === id) this.profile.set(p);
    } catch {
      this.profile.set(null);
    }
  }

  private remember(id: string): void {
    const list = [id, ...this.recent().filter((x) => x !== id)].slice(0, RECENT_MAX);
    this.recent.set(list);
    writeRecent(list);
  }

  protected async export(): Promise<void> {
    this.exporting.set(true);
    try {
      await this.exporter.xlsx(`zed-id-history-${this.searched()}`, [{
        name: 'History',
        columns: ['Date', 'By', 'Event', 'Description', 'Level', 'Phase', 'Portal'],
        rows: this.events().map((e) => [e.CreatedDate, e.actor ?? '', e.label, e.Description, e.CertificationType,
          e.Source_DB === 'SURVEILLANCE' ? 'Surveillance' : e.CertificationType ? 'Certification' : 'Registration', e.Source_DB]),
      }]);
    } catch (err) {
      this.toast.error('Export failed', apiErrorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }
}
