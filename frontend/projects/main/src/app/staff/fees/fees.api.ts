import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

export const ENTERPRISE_TYPES = ['Micro', 'Small', 'Medium', 'Rejected'] as const;
export type EnterpriseType = (typeof ENTERPRISE_TYPES)[number];

export interface FeeRow {
  id: number;
  enterpriseTypee: string;
  certification: string;
  specialCategory: number | null;
  isActive: boolean | null;
  subsidyPercentage: number | null;
  assessmentFee: number | null;
  gst: number | null;
  total: number | null;
  coupon: number | null;
  assessmentFeeAfterCoupon: number | null;
  gstAfterCoupon: number | null;
  totalAfterCoupon: number | null;
  subsidyPer: number | null;
  gstAfterSubsidy: number | null;
  applicantContributionAfterSubsidy: number | null;
  tds15: number | null;
  tds75: number | null;
  netPaybleTds15: number | null;
  netPaybleTds75: number | null;
  isCouponRow: boolean;
  /** Consultancy: the handholding milestone of the row. */
  mileStone?: string | null;
}

export interface LevelFee {
  certification: string;
  assessmentFee: number | null;
  coupon: number | null;
  hasCouponRows: boolean;
}

export interface FeesResponse {
  enterpriseType: string;
  levels: LevelFee[];
  rows: FeeRow[];
  /** "Certification", or "MileStone" on Consultancy (levels[].certification is then the milestone). */
  groupBy?: string;
}

export interface LevelRequest {
  certification: string;
  assessmentFee: number | null;
  coupon: number | null;
}

/** Client for api/staff/fees (Zed.Main.Api AssessmentFeesController). Admin only; amounts are computed on the server. */
@Injectable({ providedIn: 'root' })
export class FeesApi {
  private readonly http = inject(HttpClient);

  fees(type: string): Observable<FeesResponse> {
    return this.http.get<FeesResponse>(`/api/staff/fees/${encodeURIComponent(type)}`);
  }

  preview(type: string, levels: LevelRequest[]): Observable<FeesResponse> {
    return this.http.post<FeesResponse>(`/api/staff/fees/${encodeURIComponent(type)}/preview`, { levels });
  }

  save(type: string, levels: LevelRequest[]): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/fees/${encodeURIComponent(type)}`, { levels });
  }
}
