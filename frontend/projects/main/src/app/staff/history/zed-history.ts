import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe, LowerCasePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

export interface HistoryRow {
  Source_DB: string | null;
  ZedId: string | null;
  Description: string | null;
  CreatedDate: string | null;
  CertificationType: string | null;
  StatusType: string | null;
  MiletoneNo: string | null;
}

export interface TimelineEvent extends HistoryRow {
  label: string;
  icon: string;
  alert: boolean;
  done: boolean;
}

export interface TimelineGroup {
  cert: string;
  title: string;
  start: string | null;
  end: string | null;
  events: TimelineEvent[];
}

/** StatusType -> label and icon, as on the old page (icons replaced by text symbols: no font-awesome here). */
const STATUS_META: Record<string, { label: string; icon: string; alert?: boolean }> = {
  ApplicationReceived: { label: 'Application Received', icon: '\u{1F4C4}' },
  BasicInfoStatus: { label: 'Basic Info & Documents Submitted', icon: '✎' },
  AgencyAlloted: { label: 'Assessment Agency Allotted', icon: '☷' },
  DocVerifiAllot: { label: 'Desktop Assessor Allotted', icon: '+' },
  NcRaised: { label: 'Non-Conformance Raised', icon: '!', alert: true },
  NcClosed: { label: 'Desktop Assessment Completed By Assessor', icon: '✓' },
  Completed: { label: 'Assessment Completed', icon: '⚑' },
  GetCertified: { label: 'Certified', icon: '★' },
  DirectQC: { label: 'Sent to Agency for QC', icon: '?' },
};

function meta(row: HistoryRow): { label: string; icon: string; alert?: boolean } {
  const m = row.StatusType ? STATUS_META[row.StatusType] : undefined;
  if (m) return m;
  const d = (row.Description ?? '').toLowerCase();
  if (d.startsWith('registered') || (d.includes('registered') && d.includes('udyam'))) return { label: 'Registered on ZED Portal', icon: '↑' };
  if (d.includes('payment')) return { label: 'Payment', icon: '₹' };
  if (d.includes('accepted by assessor')) return { label: 'Accepted by Assessor', icon: '✓' };
  return { label: '', icon: '•' };
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
    g.events.push({ ...r, label: m.label, icon: m.icon, alert: !!m.alert, done: r.StatusType === 'GetCertified' || r.StatusType === 'Completed' });
  }
  return groups;
}

/**
 * Certification history of a ZED ID across certification, handholding and surveillance (MasterAdmin; on every portal also
 * the dashboard logins, as "Customer History"). Port of Views/Msme/History.cshtml. The old page had no search box and
 * posted an empty ZED ID; here the ZED ID is entered (or given as ?zedId=).
 */
@Component({
  selector: 'zed-staff-zed-history',
  imports: [FormsModule, DatePipe, LowerCasePipe],
  templateUrl: './zed-history.html',
  styleUrl: './zed-history.css',
})
export class ZedHistoryPage {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);
  /** The dashboard logins (SuperAdmin, CitizenFeedback, QC) know it as Customer History. */
  protected readonly heading = [10, 11, 17].includes(inject(AuthService).currentUser()?.roleId ?? 0) ? 'Customer History' : 'Certification History';

  protected zedId = '';
  protected readonly rows = signal<HistoryRow[]>([]);
  protected readonly searched = signal('');
  protected readonly loading = signal(false);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');

  protected readonly groups = computed(() => buildTimeline(this.rows()));
  protected readonly events = computed(() => this.groups().flatMap((g) => g.events).sort(
    (a, b) => new Date(a.CreatedDate ?? 0).getTime() - new Date(b.CreatedDate ?? 0).getTime()));
  protected readonly latest = computed(() => this.events().at(-1) ?? null);

  constructor() {
    const initial = inject(ActivatedRoute).snapshot.queryParamMap.get('zedId');
    if (initial) {
      this.zedId = initial;
      void this.search();
    }
  }

  protected async search(): Promise<void> {
    const id = this.zedId.trim().toUpperCase();
    this.error.set('');
    if (!/^[A-Za-z0-9]{3,30}$/.test(id)) {
      this.error.set('Please enter a valid ZED ID.');
      return;
    }
    this.loading.set(true);
    try {
      this.rows.set(await firstValueFrom(this.http.get<HistoryRow[]>(`/api/staff/history/${encodeURIComponent(id)}`)));
      this.searched.set(id);
      void this.router.navigate([], { queryParams: { zedId: id }, replaceUrl: true });
    } catch (err) {
      this.rows.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
      this.loaded.set(true);
    }
  }
}
