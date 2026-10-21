import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** Rows keep the procedure's column names (ZedId, PUnitName, SiteAssessorId, ...). */
export type Row = Record<string, string | number | boolean | null>;

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
}

/** The only mode the old allotment pop-up offered. */
export const ONSITE = 'Onsite Assessment';

/** Client for api/staff/site-assessment (Zed.Main.Api SiteAssessmentController). */
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
}

/** Today in the browser's time zone as yyyy-MM-dd (min of the date picker; the old picker used minDate: today). */
export function todayIso(now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}
