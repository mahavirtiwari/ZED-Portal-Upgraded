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

export interface MonitoringList {
  units: Row[];
  counts: MonitoringCounts;
  /** True for MasterAdmin: NC closure dates and the extend / step back / send back actions. */
  canManage: boolean;
}

export interface MonitoringFilter {
  certification: string;
  status: number | null;
  /** yyyy-MM-dd, NC tab only. */
  ncClosingDate: string | null;
}

/** Client for api/staff/monitoring (Zed.Main.Api MonitoringController). */
@Injectable({ providedIn: 'root' })
export class MonitoringApi {
  private readonly http = inject(HttpClient);

  list(f: MonitoringFilter): Observable<MonitoringList> {
    let params = new HttpParams().set('certification', f.certification);
    if (f.status !== null) params = params.set('status', f.status);
    if (f.ncClosingDate) params = params.set('ncClosingDate', f.ncClosingDate);
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
