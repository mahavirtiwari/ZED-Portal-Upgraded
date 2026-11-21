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
import { TextPipe, t } from '../../content/page-text';

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
  /** What happened, as the code knows it (the STATUS_META key, or Registered / Payment / Accepted); label is the wording shown. */
  kind: string;
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
// 2026-11-19 ("All page wording"): label() gives the wording the Admin can change (Texts → Page wording, staff.history.event.*).
interface Meta { kind: string; label: () => string; icon: string; alert?: boolean; actor?: HistoryActor }

const STATUS_META: Record<string, Meta> = {
  ApplicationReceived: { kind: 'ApplicationReceived', label: () => t('staff.history.event.applicationReceived', 'Application Received'), icon: '\u{1F4C4}', actor: 'MSME' },
  BasicInfoStatus: { kind: 'BasicInfoStatus', label: () => t('staff.history.event.basicInfo', 'Basic Info & Documents Submitted'), icon: '✎', actor: 'MSME' },
  AgencyAlloted: { kind: 'AgencyAlloted', label: () => t('staff.history.event.agencyAllotted', 'Assessment Agency Allotted'), icon: '☷', actor: 'ZED' },
  DocVerifiAllot: { kind: 'DocVerifiAllot', label: () => t('staff.history.event.assessorAllotted', 'Desktop Assessor Allotted'), icon: '+', actor: 'Agency' },
  NcRaised: { kind: 'NcRaised', label: () => t('staff.history.event.ncRaised', 'Non-Conformance Raised'), icon: '!', alert: true, actor: 'Assessor' },
  NcClosed: { kind: 'NcClosed', label: () => t('staff.history.event.ncClosed', 'Desktop Assessment Completed By Assessor'), icon: '✓', actor: 'Assessor' },
  Completed: { kind: 'Completed', label: () => t('staff.history.event.completed', 'Assessment Completed'), icon: '⚑' },
  GetCertified: { kind: 'GetCertified', label: () => t('staff.history.event.certified', 'Certified'), icon: '★', actor: 'ZED' },
  DirectQC: { kind: 'DirectQC', label: () => t('staff.history.event.directQc', 'Sent to Agency for QC'), icon: '?' },
};

const REGISTERED: Meta = { kind: 'Registered', label: () => t('staff.history.event.registered', 'Registered on ZED Portal'), icon: '↑', actor: 'MSME' };
const PAYMENT: Meta = { kind: 'Payment', label: () => t('staff.history.event.payment', 'Payment'), icon: '₹', actor: 'MSME' };
const ACCEPTED: Meta = { kind: 'Accepted', label: () => t('staff.history.event.accepted', 'Accepted by Assessor'), icon: '✓', actor: 'Assessor' };
const UNKNOWN: Meta = { kind: '', label: () => '', icon: '•' };

function meta(row: HistoryRow): Meta {
  const m = row.StatusType ? STATUS_META[row.StatusType] : undefined;
  if (m) return m;
  const d = (row.Description ?? '').toLowerCase();
  if (d.startsWith('registered') || (d.includes('registered') && d.includes('udyam'))) return REGISTERED;
  if (d.includes('payment')) return PAYMENT;
  if (d.includes('accepted by assessor')) return ACCEPTED;
  return UNKNOWN;
}

/**
 * 2026-11-21 (UI audit W7): who acted, from the line itself, for the lines whose status names no actor (16 of 31 events of a
 * unit fell under "Other"): the site assessors' allotment (by the agency), the ZED team's and the system's actions (send
 * back, resets, payment status updates, quality observations, automatic rejections, certificate generation), the agency's
 * send back, and the assessor's rejections, NC closures, schedules and section allocation. Checked in this order.
 */
const ACTOR_PATTERNS: [RegExp, HistoryActor][] = [
  [/^(quality observation|staffaction)$/i, 'ZED'],
  [/\bsa for\b.*\bal+ot+ed\b|\bsite assessor allot/i, 'Agency'],
  [/\bmaster ?admin\b|\bqci\b|manual update|neft admin|certificate & report generated|\breset\b|auto rejected|closed automatically|system job|unit rejected|moved to rejection|recertification/i, 'ZED'],
  [/^agency send back|\bco send back\b/i, 'Agency'],
  [/assessor rejected|sections allocation|nc\(s\) closed|^scheduled on|accepted by assessor/i, 'Assessor'],
  [/^submitted|^registered/i, 'MSME'],
];

/** The actor of a line whose status names none (null when the line does not say). */
export function actorOf(row: Pick<HistoryRow, 'Description' | 'StatusType'>): HistoryActor | null {
  const status = (row.StatusType ?? '').trim();
  const d = (row.Description ?? '').trim();
  for (const [re, actor] of ACTOR_PATTERNS) if ((status && re.test(status)) || re.test(d)) return actor;
  return null;
}

/**
 * 2026-11-21 (UI audit W7): the legacy procedures write "Alotted" (and "Alotted to" with no space before the user ID) into the
 * stored history; shown as "Allotted to …". V4 itself does not write these lines.
 */
export function cleanDescription(text: string | null): string | null {
  if (!text) return text;
  return text.replace(/\bAl+ot+ed\b/gi, (w) => (w[0] === 'a' ? 'allotted' : 'Allotted')).replace(/\b(Allotted to)(?=[A-Z0-9])/g, '$1 ');
}

/** An actor (MSME, Agency, Assessor, ZED, Other) as shown; the code value stays for the filter and data-actor. */
export function actorText(actor: string | null | undefined): string {
  switch (actor) {
    case 'MSME': return t('staff.history.actor.msme', 'MSME');
    case 'Agency': return t('staff.history.actor.agency', 'Agency');
    case 'Assessor': return t('staff.history.actor.assessor', 'Assessor');
    case 'ZED': return t('staff.history.actor.zed', 'ZED');
    case 'Other': return t('staff.history.actor.other', 'Other');
    default: return actor ?? '';
  }
}

export const HISTORY_ACTORS: HistoryActor[] = ['MSME', 'Agency', 'Assessor', 'ZED'];
/** The chip of the events no portal is named for. */
export const OTHER = 'Other';

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
      const title = !cert ? t('staff.history.group.registration', 'Registration')
        : phase === 'Surveillance' ? t('staff.history.group.surveillance', '{level} Surveillance', { level: cert })
        : t('staff.history.group.certification', '{level} Certification', { level: cert });
      g = { cert, title, start: r.CreatedDate, end: r.CreatedDate, events: [] };
      byKey.set(key, g);
      groups.push(g);
    }
    g.end = r.CreatedDate;
    g.events.push({ ...r, Description: cleanDescription(r.Description), kind: m.kind, label: m.label(), icon: m.icon, alert: !!m.alert,
      done: r.StatusType === 'GetCertified' || r.StatusType === 'Completed', actor: m.actor ?? actorOf(r) });
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
  const registered = first((e) => e.kind === 'Registered');
  if (registered) out.push({ label: t('staff.history.keyDate.registered', 'Registered'), date: registered });
  const levels = [...new Set(events.map((e) => e.CertificationType).filter((c): c is string => !!c))];
  for (const level of levels) {
    const applied = first((e) => e.CertificationType === level && e.StatusType === 'ApplicationReceived');
    if (applied) out.push({ label: t('staff.history.keyDate.applied', '{level} applied', { level }), date: applied });
    const certified = first((e) => e.CertificationType === level && e.StatusType === 'GetCertified');
    if (certified) out.push({ label: t('staff.history.keyDate.certified', '{level} certified', { level }), date: certified });
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
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): the chips add up: the events no portal is named for
 * (e.g. the handholding lines) get their own "Other" chip and rail bar, so All = the sum of the others; "Recent:" only when
 * there is a recent ZED ID to show; no "By" label; "By portal" in the rail; "✓ … certified" in the unit's header.</p>
 */
@Component({
  selector: 'zed-staff-zed-history',
  imports: [FormsModule, DatePipe, RouterLink, DashboardPortalSwitchComponent, PageHead, ChipFilter, TextPipe],
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
  private readonly customer = [10, 11, 17].includes(this.roleId);
  protected readonly heading = computed(() => (this.customer ? t('staff.history.customerTitle', 'Customer History') : t('staff.history.title', 'ZED ID History')));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.heading() }));
  protected readonly actorText = actorText;
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
  /** Events whose line names no portal (the "Other" chip; shown only when there are some). */
  protected readonly others = computed(() => this.events().filter((e) => !e.actor).length);
  protected readonly maxCount = computed(() => Math.max(1, this.others(), ...HISTORY_ACTORS.map((a) => this.counts()[a])));
  protected readonly chips = computed<FilterChip[]>(() => [
    { key: '', label: t('staff.history.chip.all', 'All'), count: this.events().length },
    ...HISTORY_ACTORS.map((a) => ({ key: a, label: actorText(a), count: this.counts()[a] })),
    ...(this.others() ? [{ key: OTHER, label: actorText(OTHER), count: this.others() }] : []),
  ]);
  /** The recent ZED IDs other than the one shown ("Recent:" is hidden when there is none). */
  protected readonly recentShown = computed(() => this.recent().filter((r) => r !== this.searched()));
  /** The timeline as shown: the actor chosen, newest (or oldest) first, still grouped by level and phase. */
  protected readonly shownGroups = computed(() => {
    const a = this.actor();
    const groups = this.groups()
      .map((g) => ({ ...g, events: a ? g.events.filter((e) => (a === OTHER ? !e.actor : e.actor === a)) : g.events }))
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

  /** "4 events" beside a group. */
  protected eventsText(n: number): string {
    return n === 1 ? t('staff.history.group.event', '{count} event(s)', { count: n }) : t('staff.history.group.events', '{count} event(s)', { count: n });
  }

  /** The empty timeline of an actor chip. */
  protected noneText(): string {
    const a = this.actor();
    return t('staff.history.filteredEmpty', 'No {actor} events in this history.', { actor: a === OTHER ? t('staff.history.actor.otherLower', 'other') : actorText(a) });
  }

  protected pick(id: string): void {
    this.zedId = id;
    void this.search();
  }

  protected async search(): Promise<void> {
    const id = this.zedId.trim().toUpperCase();
    this.error.set('');
    if (!/^[A-Za-z0-9]{3,30}$/.test(id)) {
      this.error.set(t('staff.history.zedIdError', 'Please enter a valid ZED ID.'));
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
        columns: [
          t('staff.history.export.column.date', 'Date'), t('staff.history.export.column.by', 'By'), t('staff.history.export.column.event', 'Event'),
          t('staff.history.export.column.description', 'Description'), t('staff.history.export.column.level', 'Level'),
          t('staff.history.export.column.phase', 'Phase'), t('staff.history.export.column.portal', 'Portal'),
        ],
        rows: this.events().map((e) => [e.CreatedDate, e.actor ? actorText(e.actor) : '', e.label, e.Description, e.CertificationType,
          e.Source_DB === 'SURVEILLANCE' ? t('staff.history.export.phase.surveillance', 'Surveillance')
            : e.CertificationType ? t('staff.history.export.phase.certification', 'Certification') : t('staff.history.export.phase.registration', 'Registration'),
          e.Source_DB]),
      }]);
    } catch (err) {
      this.toast.error(t('staff.history.toast.exportFailed', 'Export failed'), apiErrorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }
}
