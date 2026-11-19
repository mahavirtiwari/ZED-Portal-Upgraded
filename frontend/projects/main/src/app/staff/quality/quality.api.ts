import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { t } from '../../content/page-text';

/** 2026-11-16 (approved): the ZED team's quality observations (api/staff/quality-observations, QualityObservationsController). */

export type QoStatus = 'Open' | 'Responded' | 'Closed';

export interface QoStep {
  kind: 'Raised' | 'Responded' | 'Closed' | 'Reopened';
  text: string | null;
  at: string | null;
  by: string | null;
  byName: string | null;
}

export interface QoObservation {
  id: number;
  zedId: string;
  certification: string;
  status: QoStatus;
  text: string | null;
  raisedOn: string | null;
  raisedBy: string | null;
  raisedByName: string | null;
  round: number;
  stage: string | null;
  refType: string | null;
  refId: string | null;
  refLabel: string | null;
  category: string | null;
  severity: 'Minor' | 'Major' | 'Critical' | null;
  about: 'Desktop' | 'Lead' | 'Co' | 'Agency' | null;
  aboutUserId: string | null;
  aboutName: string | null;
  agencyId: string | null;
  agencyName: string | null;
  history: QoStep[];
  replyHours: number | null;
  closeHours: number | null;
  reopens: number;
}

export interface QoUnitView {
  canRaise: boolean;
  canRespond: boolean;
  canClose: boolean;
  items: QoObservation[];
  /** 2026-11-17: the Admin's reasons in use (Admin → Observation reasons), each with the severity it carries (master admin only). */
  reasons: QoReason[];
}

export type QoSeverity = 'Minor' | 'Major' | 'Critical';

export interface QoReason {
  id: string;
  text: string;
  severity: QoSeverity;
}

/** Something on the page an observation can be about. */
export interface QoTarget {
  type: 'Overall' | 'Requirement' | 'Product' | 'Photo' | 'Meeting' | 'Attendance';
  id: string | null;
  label: string;
}

export interface QoRaise {
  refType: string;
  refId: string | null;
  refLabel: string | null;
  /** The reason's key; the severity is the reason's. */
  category: string;
  about: string;
  text: string;
}

export interface QoStanding {
  kind: 'Agency' | 'Assessor';
  userId: string;
  name: string | null;
  agencyId: string | null;
  assessments: number;
  total: number;
  open: number;
  responded: number;
  closed: number;
  minor: number;
  major: number;
  critical: number;
  reopens: number;
  avgReplyHours: number | null;
  avgCloseHours: number | null;
  score: number;
  rank: number;
}

export interface QoDashboard {
  agencies: QoStanding[];
  assessors: QoStanding[];
  total: number;
  open: number;
  responded: number;
  closed: number;
  avgReplyHours: number | null;
  avgCloseHours: number | null;
  categories: { category: string; total: number; major: number }[];
}

/**
 * 2026-11-18 (the user): the lists' and the dashboard's filter: a preset period (days) or a custom range (from / to as
 * yyyy-MM-dd, on the date the observation was raised), and the certification level (empty = every level).
 */
export interface QoFilter {
  days?: number | null;
  from?: string | null;
  to?: string | null;
  level?: string | null;
}

const API = '/api/staff/quality-observations';

function withQuery(url: string, f: QoFilter, status: QoStatus | '' = ''): string {
  const q = new URLSearchParams();
  if (status) q.set('status', status);
  if (f.days) q.set('days', String(f.days));
  if (f.from) q.set('from', f.from);
  if (f.to) q.set('to', f.to);
  if (f.level) q.set('level', f.level);
  const qs = q.toString();
  return qs ? `${url}?${qs}` : url;
}

@Injectable({ providedIn: 'root' })
export class QualityApi {
  private readonly http = inject(HttpClient);

  unit(zedId: string, certification: string): Observable<QoUnitView> {
    return this.http.get<QoUnitView>(`${API}/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`);
  }

  raise(zedId: string, certification: string, body: QoRaise): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API}/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`, body);
  }

  respond(id: number, text: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API}/items/${id}/respond`, { text });
  }

  close(id: number, text: string | null): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API}/items/${id}/close`, { text });
  }

  reopen(id: number, text: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${API}/items/${id}/reopen`, { text });
  }

  list(status: QoStatus | '' = '', filter: QoFilter = {}): Observable<{ items: QoObservation[]; canClose: boolean }> {
    return this.http.get<{ items: QoObservation[]; canClose: boolean }>(withQuery(API, filter, status));
  }

  dashboard(filter: QoFilter = {}): Observable<QoDashboard> {
    return this.http.get<QoDashboard>(withQuery(`${API}/dashboard`, filter));
  }
}

// ------------------------------------------------------------------ 2026-11-17 (approved): submission checklists

/** An item the pop-up asks (api/staff/submission-checklists/items/{code}, or the final-submit check's "checklist"). */
export interface ChecklistItem {
  id: string;
  text: string;
}

export type ChecklistCode = 'agency-qc' | 'assessor-submit' | 'co-qc' | 'consultant-submit';

/** The ticks recorded with one submission. */
export interface ChecklistRecord {
  id: number;
  checklist: ChecklistCode | string;
  title: string;
  stage: string | null;
  round: number | null;
  role: string | null;
  byName: string | null;
  at: string | null;
  items: string[];
}

const CHECKLIST_API = '/api/staff/submission-checklists';

@Injectable({ providedIn: 'root' })
export class SubmissionChecklistApi {
  private readonly http = inject(HttpClient);

  items(code: ChecklistCode, stage?: string): Observable<{ title: string; items: ChecklistItem[] }> {
    const q = stage ? `?stage=${encodeURIComponent(stage)}` : '';
    return this.http.get<{ title: string; items: ChecklistItem[] }>(`${CHECKLIST_API}/items/${code}${q}`);
  }

  records(zedId: string, certification: string): Observable<ChecklistRecord[]> {
    return this.http.get<ChecklistRecord[]>(`${CHECKLIST_API}/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`);
  }
}

/**
 * Whose work an observation is about, as shown (handholding, on the consultancy portal: consultants and the Consultant
 * Organisation). Read it when showing (not into a class field), so the Admin's wording shows.
 */
export function aboutLabels(system: string): Record<string, string> {
  return system === 'consultancy'
    ? {
        Desktop: t('staff.quality.about.consultancy.desktop.label', 'Consultant'), Lead: t('staff.quality.about.consultancy.lead.label', 'Lead consultant'),
        Co: t('staff.quality.about.consultancy.co.label', 'Co-consultant'), Agency: t('staff.quality.about.consultancy.agency.label', 'The consultant organisation'),
      }
    : {
        Desktop: t('staff.quality.about.desktop.label', 'Desktop assessor'), Lead: t('staff.quality.about.lead.label', 'Lead assessor'),
        Co: t('staff.quality.about.co.label', 'Co-assessor'), Agency: t('staff.quality.about.agency.label', 'The agency'),
      };
}

/** A severity as shown (the code value stays for logic and styles). */
export function severityLabel(s: QoSeverity | string | null | undefined): string {
  switch (s) {
    case 'Minor': return t('staff.quality.severity.minor.label', 'Minor');
    case 'Major': return t('staff.quality.severity.major.label', 'Major');
    case 'Critical': return t('staff.quality.severity.critical.label', 'Critical');
    default: return s ?? '';
  }
}

/** An observation's status as shown ("Responded" shows as Replied). */
export function statusLabel(s: QoStatus | string | null | undefined): string {
  switch (s) {
    case 'Open': return t('staff.quality.status.open.label', 'Open');
    case 'Responded': return t('staff.quality.status.replied.label', 'Replied');
    case 'Closed': return t('staff.quality.status.closed.label', 'Closed');
    default: return s ?? '';
  }
}

/** A step of an observation's time history as shown. */
export function stepLabel(kind: QoStep['kind'] | string): string {
  switch (kind) {
    case 'Raised': return t('staff.quality.step.raised.label', 'Raised');
    case 'Responded': return t('staff.quality.step.responded.label', 'Responded');
    case 'Closed': return t('staff.quality.step.closed.label', 'Closed');
    case 'Reopened': return t('staff.quality.step.reopened.label', 'Reopened');
    default: return kind;
  }
}
