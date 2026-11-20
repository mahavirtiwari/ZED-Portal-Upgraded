import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** SchemeApplications statuses (backend Features/Incentives/SchemeApplications.cs), in the flow's order. */
export const SCHEME_STATUSES = ['Submitted', 'WithAgency', 'WithAssessor', 'Verifying', 'Correction', 'Qc', 'Approved', 'Paid', 'Rejected', 'OnHold'] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

/** Who sees which list: the Master Admin all, the agency its own, the assessor its own. */
export type SchemeRole = 'admin' | 'agency' | 'assessor';

export const SCHEME_API: Record<SchemeRole, string> = {
  admin: '/api/staff/scheme-applications',
  agency: '/api/staff/scheme-verification/agency',
  assessor: '/api/staff/scheme-verification/assessor',
};

export interface SchemeListItem {
  id: number;
  zedId: string;
  unitName: string | null;
  state: string | null;
  schemeCode: string;
  schemeName: string;
  level: string | null;
  levelName: string | null;
  status: SchemeStatus;
  claimAmount: number | null;
  eligibleAmount: number | null;
  approvedAmount: number | null;
  submittedOn: string | null;
  decidedOn: string | null;
  correctionRound: number;
  correctionDueOn: string | null;
  holdReason: string | null;
  agency: string | null;
  agencyName: string | null;
  assessor: string | null;
  assessorName: string | null;
  allotmentType: string | null;
  reasonForRejection: string | null;
  agencyRemarks: string | null;
  assessorAcceptedOn: string | null;
}

export interface SchemeOption {
  code: string;
  name: string;
}

export interface SchemeList {
  rows: SchemeListItem[];
  counts: Partial<Record<SchemeStatus, number>>;
  schemes: SchemeOption[];
  states: string[];
}

/** The list's filters ('' = no filter). */
export interface SchemeFilter {
  scheme: string;
  status: string;
  state: string;
  from: string;
  to: string;
}

export const NO_SCHEME_FILTER: SchemeFilter = { scheme: '', status: '', state: '', from: '', to: '' };

export interface SchemeCheck {
  status: 'Yes' | 'No';
  remarks: string | null;
  round: number;
  by: string | null;
  on: string | null;
}

export interface SchemeFile {
  name: string;
  url: string;
  isPdf: boolean;
}

export interface SchemeField {
  key: string;
  label: string;
  type: string;
  value: string | null;
  files: SchemeFile[];
  /** Set when the assessor checks this answer or document. */
  path: string | null;
  isClaim: boolean;
  check: SchemeCheck | null;
}

export interface SchemeItem {
  index: number;
  pick: string | null;
  pickName: string | null;
  fields: SchemeField[];
}

export interface SchemeSection {
  key: string;
  title: string;
  repeating: boolean;
  items: SchemeItem[];
}

export interface SchemePerson {
  userId: string;
  name: string | null;
}

export interface SchemeApplication {
  id: number;
  zedId: string;
  unitName: string | null;
  unitAddress: string | null;
  schemeCode: string;
  schemeName: string;
  level: string | null;
  levelName: string | null;
  certNo: string | null;
  status: SchemeStatus;
  claimAmount: number | null;
  eligibleAmount: number | null;
  approvedAmount: number | null;
  correctionRound: number;
  correctionRounds: number;
  correctionDays: number;
  correctionDueOn: string | null;
  submittedOn: string | null;
  decidedOn: string | null;
  holdReason: string | null;
  agency: SchemePerson | null;
  assessor: SchemePerson | null;
  assessorAcceptedOn: string | null;
  allotmentType: string | null;
  reasonForRejection: string | null;
  agencyRemarks: string | null;
  accountNo: string | null;
  ifscCode: string | null;
  branchAddress: string | null;
  bankName: string | null;
}

export interface SchemeActions {
  allot: boolean;
  hold: boolean;
  respond: boolean;
  qc: boolean;
  accept: boolean;
  check: boolean;
  correction: boolean;
  reject: boolean;
  recommend: boolean;
  roundsLeft: number;
  checked: number;
  checkable: number;
  notValid: number;
}

export interface SchemeDetail {
  application: SchemeApplication;
  sections: SchemeSection[];
  totals: { claimed: number; verified: number; eligible: number; sharePercent: number | null; maxAmount: number | null };
  history: { on: string | null; text: string }[];
  actions: SchemeActions;
}

export interface AgencyOption {
  userId: string;
  userName: string;
  rejectedBefore: boolean;
}

export interface UserOption {
  userId: string;
  userName: string;
}

export interface RejectionReasonOption {
  id: string;
  text: string;
  action: 'Auto' | 'MasterAdmin';
  active: boolean;
}

export interface CheckInput {
  path: string;
  status: 'Yes' | 'No';
  remarks: string | null;
}

export interface SchemeTick {
  code: string;
  name: string;
  desktop: boolean;
  onsite: boolean;
  canDesktop: boolean;
  canOnsite: boolean;
}

export interface SchemeTicks {
  userId: string;
  userName: string | null;
  schemes: SchemeTick[];
  canEdit: boolean;
}

/** The staff side of the incentive schemes (Features/Incentives/Staff). */
@Injectable({ providedIn: 'root' })
export class SchemeVerificationApi {
  private readonly http = inject(HttpClient);

  list(role: SchemeRole, f: SchemeFilter = NO_SCHEME_FILTER): Observable<SchemeList> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) params = params.set(k, v);
    return this.http.get<SchemeList>(SCHEME_API[role], { params });
  }

  detail(role: SchemeRole, id: number): Observable<SchemeDetail> {
    return this.http.get<SchemeDetail>(`${SCHEME_API[role]}/${id}`);
  }

  // Master Admin
  agencies(id: number): Observable<AgencyOption[]> {
    return this.http.get<AgencyOption[]>(`${SCHEME_API.admin}/${id}/agencies`);
  }

  allot(id: number, agencyUserId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.admin}/${id}/allot`, { agencyUserId });
  }

  resume(id: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.admin}/${id}/resume`, {});
  }

  rejectOnHold(id: number, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.admin}/${id}/reject`, { reason });
  }

  // Agency
  assessors(id: number): Observable<UserOption[]> {
    return this.http.get<UserOption[]>(`${SCHEME_API.agency}/${id}/assessors`);
  }

  rejectionReasons(): Observable<RejectionReasonOption[]> {
    return this.http.get<RejectionReasonOption[]>(`${SCHEME_API.agency}/rejection-reasons`);
  }

  accept(id: number, assessorUserId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.agency}/${id}/accept`, { assessorUserId });
  }

  agencyReject(id: number, reasonId: string, remarks: string | null): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.agency}/${id}/reject`, { reasonId, remarks });
  }

  approve(id: number, amount: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.agency}/${id}/approve`, { amount });
  }

  back(id: number, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.agency}/${id}/back`, { remarks });
  }

  // Assessor
  assessorAccept(id: number): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.assessor}/${id}/accept`, {});
  }

  assessorReturn(id: number, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.assessor}/${id}/return`, { reason });
  }

  saveChecks(id: number, checks: CheckInput[]): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${SCHEME_API.assessor}/${id}/checks`, { checks });
  }

  decide(id: number, decision: 'correction' | 'reject' | 'recommend', reason: string | null = null): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.assessor}/${id}/decision`, { decision, reason });
  }

  // Users' scheme ticks
  ticks(kind: 'agencies' | 'assessors', userId: string): Observable<SchemeTicks> {
    return this.http.get<SchemeTicks>(`/api/staff/users/${kind}/${encodeURIComponent(userId)}/schemes`);
  }

  saveTicks(kind: 'agencies' | 'assessors', userId: string, ticks: { code: string; desktop: boolean; onsite: boolean }[]): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/users/${kind}/${encodeURIComponent(userId)}/schemes`, { ticks });
  }
}
