import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** SchemeApplications statuses (backend Features/Incentives/SchemeApplications.cs), in the flow's order. */
export const SCHEME_STATUSES = [
  'Submitted', 'WithAgency', 'WithAssessor', 'Verifying', 'Correction',
  // Phase 2 (Desktop + Onsite flow): waiting for an onsite agency, with it, with its assessor, the visit started in the app.
  'OnsiteAllot', 'OnsiteWithAgency', 'OnsiteWithAssessor', 'OnsiteVisit',
  'Qc', 'Approved', 'Paid', 'Rejected', 'OnHold',
] as const;
export type SchemeStatus = (typeof SCHEME_STATUSES)[number];

/** Who sees which list: the Master Admin all, the agency its own, the assessor its own, the onsite agency its own (phase 2). */
export type SchemeRole = 'admin' | 'agency' | 'assessor' | 'onsite';

export const SCHEME_API: Record<SchemeRole, string> = {
  admin: '/api/staff/scheme-applications',
  agency: '/api/staff/scheme-verification/agency',
  assessor: '/api/staff/scheme-verification/assessor',
  onsite: '/api/staff/scheme-onsite/agency',
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
  /** Phase 2: the unit's plant district and the onsite stage (agency, assessor, the date of verification). */
  district?: string | null;
  onsiteAgency?: string | null;
  onsiteAgencyName?: string | null;
  onsiteAssessor?: string | null;
  onsiteAssessorName?: string | null;
  onsiteAllotmentType?: string | null;
  visitStartedOn?: string | null;
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
  /** Phase 2: the Master Admin allots an onsite agency; the onsite agency accepts / rejects, names (another) assessor, does the QC. */
  onsiteAllot?: boolean;
  onsiteRespond?: boolean;
  onsiteAssessor?: boolean;
  onsiteQc?: boolean;
}

/** A photo of the onsite visit: the selfie, the site photo or an item's photo (with the item's title). */
export interface SchemeOnsitePhoto {
  photoId: string;
  kind: 'selfie' | 'site' | 'item';
  title: string | null;
  url: string;
  timeStamp: string | null;
  latitude: string | null;
  longitude: string | null;
  on: string | null;
}

/** An answer the onsite assessor checks at the visit, with the check once made. */
export interface SchemeOnsiteCheck {
  path: string;
  label: string;
  value: string | null;
  status: 'Yes' | 'No' | null;
  remarks: string | null;
  by: string | null;
  on: string | null;
}

/** Phase 2: the onsite stage of a Desktop + Onsite application (the Master Admin's and the onsite agency's detail). */
export interface SchemeOnsiteReport {
  agency: SchemePerson | null;
  assessor: SchemePerson | null;
  allotmentType: string | null;
  allotmentDate: string | null;
  rejectedAgencies: string | null;
  /** The date of verification: when the assessor started the visit in the app. */
  visitStartedOn: string | null;
  visitSubmittedOn: string | null;
  latitude: string | null;
  longitude: string | null;
  representativeName: string | null;
  representativeMobile: string | null;
  remarks: string | null;
  verifiedClaim: number | null;
  eligible: number | null;
  photosMin: number;
  photosMax: number;
  photos: SchemeOnsitePhoto[];
  checks: SchemeOnsiteCheck[];
}

export interface SchemeDetail {
  application: SchemeApplication;
  sections: SchemeSection[];
  totals: { claimed: number; verified: number; eligible: number; sharePercent: number | null; maxAmount: number | null };
  history: { on: string | null; text: string }[];
  actions: SchemeActions;
  onsite?: SchemeOnsiteReport | null;
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

  /** Phase 2: the onsite agencies of the unit's state and district. */
  onsiteAgencies(id: number): Observable<AgencyOption[]> {
    return this.http.get<AgencyOption[]>(`${SCHEME_API.admin}/${id}/onsite-agencies`);
  }

  onsiteAllot(id: number, agencyUserId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API.admin}/${id}/onsite-allot`, { agencyUserId });
  }

  // Agency (desktop), or with role 'onsite' the onsite verification agency (phase 2: the same calls under its own API)
  assessors(id: number, role: 'agency' | 'onsite' = 'agency'): Observable<UserOption[]> {
    return this.http.get<UserOption[]>(`${SCHEME_API[role]}/${id}/assessors`);
  }

  rejectionReasons(role: 'agency' | 'onsite' = 'agency'): Observable<RejectionReasonOption[]> {
    return this.http.get<RejectionReasonOption[]>(`${SCHEME_API[role]}/rejection-reasons`);
  }

  accept(id: number, assessorUserId: string, role: 'agency' | 'onsite' = 'agency'): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API[role]}/${id}/accept`, { assessorUserId });
  }

  agencyReject(id: number, reasonId: string, remarks: string | null, role: 'agency' | 'onsite' = 'agency'): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API[role]}/${id}/reject`, { reasonId, remarks });
  }

  approve(id: number, amount: number, role: 'agency' | 'onsite' = 'agency'): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API[role]}/${id}/approve`, { amount });
  }

  back(id: number, remarks: string, role: 'agency' | 'onsite' = 'agency'): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SCHEME_API[role]}/${id}/back`, { remarks });
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
