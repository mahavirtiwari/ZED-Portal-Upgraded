import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** 'Desktop' (desktop verification agency) or 'Onsite' (onsite verification agency); chosen at creation, never changed. */
export type IncentiveAgencyType = 'Desktop' | 'Onsite';

/** One state an incentive agency serves and its districts (LGD codes; none = the whole state). */
export interface OnsiteArea {
  state: string;
  districts: string[];
}

export interface OnsiteAgencyRow {
  userId: string;
  userName: string;
  spocName: string | null;
  email: string | null;
  mobileNo: string | null;
  isActive: boolean;
  states: OnsiteArea[];
  schemes: string[];
  assessors: number;
  type: IncentiveAgencyType;
}

export interface OnsiteSchemeOption {
  code: string;
  name: string;
  active: boolean;
}

export interface OnsiteOptions {
  states: string[];
  /** The schemes an onsite agency may serve (Desktop + Onsite schemes). */
  schemes: OnsiteSchemeOption[];
  /** The schemes a desktop agency may serve (every scheme). */
  desktopSchemes: OnsiteSchemeOption[];
}

export interface OnsiteDistrict {
  code: string;
  name: string;
}

export interface OnsiteAgencyDetails {
  userId: string;
  userName: string;
  spocName: string | null;
  email: string | null;
  mobileNo: string | null;
  address: string | null;
  pinCode: string | null;
  gstNumber: string | null;
  isActive: boolean;
  reasonForRejection: string | null;
  states: OnsiteArea[];
  schemes: string[];
  type: IncentiveAgencyType;
}

export interface OnsiteAgencyRequest {
  userName: string;
  spocName: string;
  emailId: string;
  mobileNo: string;
  address: string;
  pinCode: string;
  gstNumber: string | null;
  states: OnsiteArea[];
  schemes: string[];
  /** Required for a new agency; an agency's type never changes. */
  type: IncentiveAgencyType;
}

export const INCENTIVE_AGENCIES_API = '/api/staff/scheme-agencies';

/**
 * 2026-11-20 (the product owner): the Master Admin's Incentive Verification Agencies, desktop and onsite (Features/Incentives/Agencies,
 * IncentiveAgenciesController). The agencies' own lists use SchemeVerificationApi (role 'agency' / 'onsite').
 */
@Injectable({ providedIn: 'root' })
export class SchemeOnsiteApi {
  private readonly http = inject(HttpClient);

  list(): Observable<OnsiteAgencyRow[]> {
    return this.http.get<OnsiteAgencyRow[]>(INCENTIVE_AGENCIES_API);
  }

  options(): Observable<OnsiteOptions> {
    return this.http.get<OnsiteOptions>(`${INCENTIVE_AGENCIES_API}/options`);
  }

  districts(state: string): Observable<OnsiteDistrict[]> {
    return this.http.get<OnsiteDistrict[]>(`${INCENTIVE_AGENCIES_API}/districts`, { params: { state } });
  }

  get(userId: string): Observable<OnsiteAgencyDetails> {
    return this.http.get<OnsiteAgencyDetails>(`${INCENTIVE_AGENCIES_API}/${encodeURIComponent(userId)}`);
  }

  create(body: OnsiteAgencyRequest): Observable<MessageResponse & { userId: string | null }> {
    return this.http.post<MessageResponse & { userId: string | null }>(INCENTIVE_AGENCIES_API, body);
  }

  update(userId: string, body: OnsiteAgencyRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${INCENTIVE_AGENCIES_API}/${encodeURIComponent(userId)}`, body);
  }

  setActive(userId: string, active: boolean, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${INCENTIVE_AGENCIES_API}/${encodeURIComponent(userId)}/${active ? 'activate' : 'deactivate'}`, { reason });
  }

  passwordReset(userId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${INCENTIVE_AGENCIES_API}/${encodeURIComponent(userId)}/password-reset`, {});
  }
}
