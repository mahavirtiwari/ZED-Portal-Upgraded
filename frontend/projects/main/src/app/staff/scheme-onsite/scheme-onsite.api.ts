import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** One state an onsite agency serves and its districts (LGD codes; none = the whole state). */
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
}

export interface OnsiteSchemeOption {
  code: string;
  name: string;
  active: boolean;
}

export interface OnsiteOptions {
  states: string[];
  schemes: OnsiteSchemeOption[];
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
}

export const ONSITE_AGENCIES_API = '/api/staff/scheme-onsite/agencies';

/**
 * 2026-11-20 (incentive schemes, phase 2): the Master Admin's Onsite Verification Agencies (Features/Incentives/Onsite,
 * OnsiteAgenciesController). The onsite agency's own lists use SchemeVerificationApi with the role 'onsite'.
 */
@Injectable({ providedIn: 'root' })
export class SchemeOnsiteApi {
  private readonly http = inject(HttpClient);

  list(): Observable<OnsiteAgencyRow[]> {
    return this.http.get<OnsiteAgencyRow[]>(ONSITE_AGENCIES_API);
  }

  options(): Observable<OnsiteOptions> {
    return this.http.get<OnsiteOptions>(`${ONSITE_AGENCIES_API}/options`);
  }

  districts(state: string): Observable<OnsiteDistrict[]> {
    return this.http.get<OnsiteDistrict[]>(`${ONSITE_AGENCIES_API}/districts`, { params: { state } });
  }

  get(userId: string): Observable<OnsiteAgencyDetails> {
    return this.http.get<OnsiteAgencyDetails>(`${ONSITE_AGENCIES_API}/${encodeURIComponent(userId)}`);
  }

  create(body: OnsiteAgencyRequest): Observable<MessageResponse & { userId: string | null }> {
    return this.http.post<MessageResponse & { userId: string | null }>(ONSITE_AGENCIES_API, body);
  }

  update(userId: string, body: OnsiteAgencyRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${ONSITE_AGENCIES_API}/${encodeURIComponent(userId)}`, body);
  }

  setActive(userId: string, active: boolean, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${ONSITE_AGENCIES_API}/${encodeURIComponent(userId)}/${active ? 'activate' : 'deactivate'}`, { reason });
  }

  passwordReset(userId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${ONSITE_AGENCIES_API}/${encodeURIComponent(userId)}/password-reset`, {});
  }
}
