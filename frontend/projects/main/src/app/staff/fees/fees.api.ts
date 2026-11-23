import { HttpClient, HttpParams } from '@angular/common/http';
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

/**
 * A fee set (migration 0112): every fee of the portal with the same date of effect, as Expenditure rates keeps its rate sets.
 * key is 'initial' (the set the portal started with) or the date of effect; it goes back to the API as ?set=.
 */
export interface FeeSet {
  key: string;
  /** yyyy-MM-dd; null: since the start. */
  from: string | null;
  /** yyyy-MM-dd, the last day; null: no later set yet. */
  to: string | null;
  status: 'past' | 'current' | 'future';
  rows: number;
}

export interface FeesResponse {
  enterpriseType: string;
  levels: LevelFee[];
  rows: FeeRow[];
  /** "Certification", or "MileStone" on Consultancy (levels[].certification is then the milestone). */
  groupBy?: string;
  schedule?: PaymentSchedule | null;
  /** The fee set shown. */
  set?: FeeSet | null;
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

/** A subsidy category switched off on the three portals (Master → Payments, Disable; migration 0070). */
export interface OffCategory {
  category: number;
  reason: string | null;
  by: string | null;
  on: string | null;
}

/** Client for api/staff/fees (Zed.Main.Api AssessmentFeesController). Admin only; amounts are computed on the server. */
@Injectable({ providedIn: 'root' })
export class FeesApi {
  private readonly http = inject(HttpClient);

  /** ?set= for a chosen fee set; none: the set in force today. */
  private static params(set?: string | null): { params?: HttpParams } {
    return set ? { params: new HttpParams().set('set', set) } : {};
  }

  fees(type: string, set?: string | null): Observable<FeesResponse> {
    return this.http.get<FeesResponse>(`/api/staff/fees/${encodeURIComponent(type)}`, FeesApi.params(set));
  }

  preview(type: string, levels: LevelRequest[], set?: string | null): Observable<FeesResponse> {
    return this.http.post<FeesResponse>(`/api/staff/fees/${encodeURIComponent(type)}/preview`, { levels }, FeesApi.params(set));
  }

  save(type: string, levels: LevelRequest[], set?: string | null): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/fees/${encodeURIComponent(type)}`, { levels }, FeesApi.params(set));
  }

  add(type: string, req: AddFeesRequest, set?: string | null): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`/api/staff/fees/${encodeURIComponent(type)}/add`, req, FeesApi.params(set));
  }

  saveSubsidy(type: string, req: SubsidyRequest, set?: string | null): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/fees/${encodeURIComponent(type)}/subsidy`, req, FeesApi.params(set));
  }

  /** The fee sets of the portal, oldest first. */
  sets(): Observable<{ sets: FeeSet[] }> {
    return this.http.get<{ sets: FeeSet[] }>('/api/staff/fees/sets');
  }

  /** A new fee set from a date (yyyy-MM-dd): a copy of the fees in force that day. */
  addSet(from: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/fees/sets', { from });
  }

  /** Deletes a fee set that has not started yet. */
  deleteSet(key: string): Observable<MessageResponse> {
    return this.http.delete<MessageResponse>(`/api/staff/fees/sets/${encodeURIComponent(key)}`);
  }

  /** The switched-off subsidy categories; ready is false before migration 0070. */
  subsidySwitches(): Observable<{ ready: boolean; off: OffCategory[] }> {
    return this.http.get<{ ready: boolean; off: OffCategory[] }>('/api/staff/fees/subsidy-switches');
  }

  /** Switches a subsidy category off (a reason is required) or on again, on the three portals. */
  switchSubsidy(category: number, off: boolean, reason: string | null): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/fees/subsidy-switches/${category}`, { off, reason });
  }

  /** Consultancy: milestone by milestone, or all three at milestone 1 from a date (Micro, Small and Medium alike). */
  saveSchedule(payAllAtMilestone1: boolean, from: string | null, set?: string | null): Observable<MessageResponse> {
    return this.http.put<MessageResponse>('/api/staff/fees/schedule', { payAllAtMilestone1, from }, FeesApi.params(set));
  }
}
