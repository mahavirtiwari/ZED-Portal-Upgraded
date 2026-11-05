import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

export const ENTERPRISE_TYPES = ['Micro', 'Small', 'Medium', 'Rejected'] as const;
export type EnterpriseType = (typeof ENTERPRISE_TYPES)[number];
/** Main also sets the Recertification fee (the full fee to re-certify a level, migration 0046). */
export const MAIN_ENTERPRISE_TYPES = [...ENTERPRISE_TYPES, 'Recertification'] as const;
/** The types charged the full fee: no subsidy, no joining reward. */
export const isFullFee = (type: string) => type === 'Rejected' || type === 'Recertification';

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
  /** Consultancy: a "pay all at milestone 1" row (milestone 1: the three added up; 2 and 3: nothing to pay). */
  payAllAtMilestone1?: boolean | null;
  /** Consultancy, on its milestone-1 pay-all rows: units starting from this day (yyyy-MM-dd) pay that way. */
  payAllFrom?: string | null;
}

export interface LevelFee {
  certification: string;
  assessmentFee: number | null;
  coupon: number | null;
  hasCouponRows: boolean;
  /** Consultancy: the handholding level (Silver, Gold) of the milestone in certification. */
  level?: string | null;
}

/** Consultancy: how units pay the three handholding milestones. */
export interface PaymentSchedule {
  payAllAtMilestone1: boolean;
  /** yyyy-MM-dd */
  from: string | null;
  prepared: boolean;
}

export interface FeesResponse {
  enterpriseType: string;
  levels: LevelFee[];
  rows: FeeRow[];
  /** "Certification", or "MileStone" on Consultancy (levels[].certification is then the milestone). */
  groupBy?: string;
  schedule?: PaymentSchedule | null;
}

export interface LevelRequest {
  certification: string;
  assessmentFee: number | null;
  coupon: number | null;
  /** Consultancy: the handholding level whose milestone fee changes. */
  level?: string | null;
}

/** V4: the subsidy share of a category (0 general: the base share; 1 / 2: the additional share on top of it). */
export interface SubsidyRequest {
  certification: string;
  category: number;
  baseShare: number | null;
  additionalShare: number | null;
  allLevels: boolean;
  /** Consultancy: the handholding level whose share changes. */
  level?: string | null;
}

/** V4: the fees of a level (Consultancy: a milestone) that has none yet. */
export interface AddFeesRequest {
  certification: string;
  assessmentFee: number | null;
  reward: number | null;
  generalShare: number | null;
  /** Per special category of the portal (1, 2): the share on top of the general one. */
  additionalShares: Record<number, number | null>;
  alsoTypes: string[];
  /** Consultancy: the handholding levels to add the milestone's fees for. */
  levels?: string[];
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

  add(type: string, req: AddFeesRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`/api/staff/fees/${encodeURIComponent(type)}/add`, req);
  }

  saveSubsidy(type: string, req: SubsidyRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/fees/${encodeURIComponent(type)}/subsidy`, req);
  }

  /** Consultancy: milestone by milestone, or all three at milestone 1 from a date (Micro, Small and Medium alike). */
  saveSchedule(payAllAtMilestone1: boolean, from: string | null): Observable<MessageResponse> {
    return this.http.put<MessageResponse>('/api/staff/fees/schedule', { payAllAtMilestone1, from });
  }
}
