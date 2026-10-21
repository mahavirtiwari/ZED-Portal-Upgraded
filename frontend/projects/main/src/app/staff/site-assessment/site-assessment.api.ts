import { HttpClient } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';
import { PORTAL_SYSTEM, PortalSystem } from '../../portal-system';

/** The system this build serves (a token so the specs can render the Consultancy and Surveillance variants). */
export const SITE_SYSTEM = new InjectionToken<PortalSystem>('SITE_SYSTEM', { providedIn: 'root', factory: () => PORTAL_SYSTEM });

/** Rows keep the procedure's column names (ZedId, PUnitName, SiteAssessorId, ...). */
export type Row = Record<string, string | number | boolean | string[] | null>;

export interface Assessor {
  userId: string;
  userName: string;
}

export interface AllotmentsResponse {
  units: Row[];
  assessors: Assessor[];
}

export interface AllotRequest {
  zedId: string;
  certification: string;
  siteAssessorId: string;
  coAssessorId: string | null;
  /** yyyy-MM-dd */
  assessmentDate: string;
  modeOfAssessment: string;
  /** Surveillance only: the external video meeting (http/https). */
  meetingLink?: string | null;
}

/** Consultancy: the CO's units, consultants and technical experts. */
export interface CoAllotmentsResponse {
  units: Row[];
  consultants: Assessor[];
  technicalExperts: Assessor[];
}

export interface CoAllotRequest {
  zedId: string;
  certification: string;
  leadConsultantId: string;
  coConsultantIds: string[];
  technicalExpertIds: string[];
  /** yyyy-MM-dd */
  bdsFromDate: string;
  bdsToDate: string;
  /** Milestone 1 only. */
  hapFromDate: string | null;
  hapToDate: string | null;
}

/** The only mode the old allotment pop-up offered. */
export const ONSITE = 'Onsite Assessment';

/**
 * Consultancy milestone review page of package C2 (staff/consultancy/milestones/...). The consultants' lists link
 * there; keep in step with the route the coordinator registers.
 */
export function milestoneReviewLink(zedId: string, certification: string, _milestone?: number | string): string {
  // The review page always shows the unit's current milestone (staff/consultancy/milestones/milestones.routes.ts).
  return `/staff/consultancy/milestones/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`;
}

/** Client for api/staff/site-assessment (SiteAssessmentController; ConsultancyAllotmentController under /consultancy). */
@Injectable({ providedIn: 'root' })
export class SiteAssessmentApi {
  private readonly http = inject(HttpClient);

  allotments(): Observable<AllotmentsResponse> {
    return this.http.get<AllotmentsResponse>('/api/staff/site-assessment/allotments');
  }

  allot(req: AllotRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/site-assessment/allotments', req);
  }

  remoteAssessments(): Observable<Row[]> {
    return this.http.get<Row[]>('/api/staff/site-assessment/remote-assessments');
  }

  coAllotments(): Observable<CoAllotmentsResponse> {
    return this.http.get<CoAllotmentsResponse>('/api/staff/site-assessment/consultancy/allotments');
  }

  coAllot(req: CoAllotRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/site-assessment/consultancy/allotments', req);
  }

  coReject(zedId: string, certification: string, reasonForRejection: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/site-assessment/consultancy/allotments/reject', { zedId, certification, reasonForRejection });
  }

  milestone(milestone: number): Observable<Row[]> {
    return this.http.get<Row[]>(`/api/staff/site-assessment/consultancy/milestones/${milestone}`);
  }
}

/** Today in the browser's time zone as yyyy-MM-dd (min of the date picker; the old picker used minDate: today). */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/** http/https address check done before sending (the API checks again). */
export function isWebLink(value: string): boolean {
  const v = value.trim();
  if (!v || /\s/.test(v)) return false;
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && !!u.hostname;
  } catch {
    return false;
  }
}
