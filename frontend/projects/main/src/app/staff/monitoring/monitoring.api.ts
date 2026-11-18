import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** Rows keep the procedure's column names (ZedId, CertificationStatus, NcFinalClosureDt, ...). */
export type Row = Record<string, string | number | boolean | null>;

export interface MonitoringCounts {
  NotStarted: number;
  InProgress: number;
  Qc: number;
  Nc: number;
  Rj: number;
}

/** 2026-11-18: one stage card's cases per sub-section (desktop / site, or m1..m3 on Consultancy) and how many are delayed (TAT). */
export interface StageCount {
  status: number;
  total: number;
  delayed: number;
  tracks: Record<string, number>;
}

export interface MonitoringList {
  units: Row[];
  counts: MonitoringCounts;
  /** True for MasterAdmin: NC closure dates and the extend / step back / send back actions. */
  canManage: boolean;
  /** 2026-11-18: the stage cards' counts per sub-section, scoped as the list (absent when the API could not read them). */
  stages?: StageCount[] | null;
  /** The man-days per level the "submission pending" chip uses. */
  manDays?: Record<string, number> | null;
}

export interface MonitoringFilter {
  /** '' for every level (2026-11-17: the API then lists each level and adds the counts). */
  certification: string;
  status: number | null;
  /** yyyy-MM-dd, NC tab only. */
  ncClosingDate: string | null;
  /** 2026-11-18: yyyy-MM-dd, the range on the stage's date (allotted / assessment / submitted / NC raised / rejected on). */
  from?: string | null;
  to?: string | null;
}

/** Client for api/staff/monitoring (Zed.Main.Api MonitoringController). */
@Injectable({ providedIn: 'root' })
export class MonitoringApi {
  private readonly http = inject(HttpClient);

  list(f: MonitoringFilter): Observable<MonitoringList> {
    let params = new HttpParams();
    if (f.certification) params = params.set('certification', f.certification);
    if (f.status !== null) params = params.set('status', f.status);
    if (f.ncClosingDate) params = params.set('ncClosingDate', f.ncClosingDate);
    if (f.from) params = params.set('from', f.from);
    if (f.to) params = params.set('to', f.to);
    return this.http.get<MonitoringList>('/api/staff/monitoring', { params });
  }

  extendNcClosure(zedId: string, certification: string, noOfDays: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/monitoring/extend-nc-closure', { zedId, certification, noOfDays });
  }

  stepBackNc(zedId: string, certification: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/monitoring/step-back-nc', { zedId, certification });
  }

  sendBackToAgency(zedId: string, certification: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/monitoring/send-back-to-agency', { zedId, certification });
  }
}
