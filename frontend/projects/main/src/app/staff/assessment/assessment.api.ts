import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { ReviewActions } from '../monitoring/review.api';

/** Rows keep the procedures' column names (ZedId, PUnitName, CertificationStatus, ...). */
export type Row = Record<string, unknown>;

export interface Person {
  userId: string;
  userName: string;
}

export interface ListResponse {
  rows: Row[];
}

export interface DaAllotmentResponse {
  rows: Row[];
  /** The agency's Silver/Gold desktop assessors. */
  assessors: Person[];
  /** The agency's Bronze assessors with fewer than 10 allotments today. */
  bronzeAssessors: Person[];
}

export interface PageResponse {
  rows: Row[];
  totalCount: number;
  pageNo: number;
  pageSize: number;
}

export interface ListFilter {
  state?: string;
  certification?: string;
  size?: string;
  gender?: string;
  allotmentType?: string;
}

export interface ResultsFilter {
  state?: string;
  certification?: string;
  size?: string;
  searchBy?: string;
  search?: string;
  pageNo: number;
  pageSize: number;
}

export interface NcRound {
  ncCount: number;
  products: Row[];
  oldProducts: Row[];
  sections: Row[];
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  evidences: Row[];
  photos: Row[];
  assessorRemarks: string | null;
}

export interface DaPermissions {
  /** The signed-in user is the record's accepted desktop assessor and the verification is open. */
  canAssess: boolean;
  canFinalSubmit: boolean;
  /** Master admin may withdraw an exemption (Yes → No). */
  canWithdrawExemption: boolean;
  /** Agency / master-admin review actions open to the user (edit remarks, final submit, send back, reject). */
  review: ReviewActions;
}

export interface DaDetails {
  zedId: string;
  certification: string;
  role: string;
  msme: Row;
  products: Row[];
  rawMaterials: Row[];
  sections: Row[];
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  /** Each with FileUrl (MSME upload) and Screenshots (assessor uploads). */
  evidences: Row[];
  /** Selfie and site exterior photos, each with Url. */
  photos: Row[];
  location: Row | null;
  esgCheckList: Row[];
  ncRounds: NcRound[];
  permissions: DaPermissions;
}

export interface FinalSubmitCheck {
  allowed: boolean;
  message: string | null;
  raisesNc: boolean;
}

export type OpenedType = 'Evidence' | 'SiteExteriorPhoto' | 'ProductPhoto' | 'ProductDescriptionPhoto';

/** Levels a desktop assessment is opened with (MsmeCertifications.Certification). */
export const LEVELS = ['Bronze', 'Silver', 'Gold'] as const;

export function canonicalLevel(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  return LEVELS.find((l) => l.toLowerCase() === v) ?? null;
}

/** ZED IDs, including rejected copies (ZEDMSME000123_D_45). */
export function isZedId(value: string | null | undefined): boolean {
  return !!value && /^[A-Za-z0-9_]{1,50}$/.test(value);
}

function params(values: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(values)) {
    if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  }
  return p;
}

/** Client for api/staff/assessment (Zed.Main.Api Features/Staff/Assessment). */
@Injectable({ providedIn: 'root' })
export class AssessmentApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/assessment';

  // Master admin
  allotList(filter: ListFilter): Observable<ListResponse> {
    return this.http.get<ListResponse>(`${this.base}/allot`, { params: params(filter) });
  }
  agencies(zedId: string, certification: string): Observable<Person[]> {
    return this.http.get<Person[]>(`${this.base}/allot/agencies`, { params: params({ zedId, certification }) });
  }
  allotToAgency(zedId: string, certification: string, agencyUserId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/allot`, { zedId, certification, agencyUserId });
  }

  // Agency
  daAllotment(): Observable<DaAllotmentResponse> {
    return this.http.get<DaAllotmentResponse>(`${this.base}/da-allotment`);
  }
  allotToAssessor(zedId: string, certification: string, desktopAssessorId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/da-allotment/allot`, { zedId, certification, desktopAssessorId });
  }
  agencyReject(zedId: string, certification: string, reasonForRejection: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/da-allotment/reject`, { zedId, certification, reasonForRejection });
  }

  // Desktop assessor
  daVerification(): Observable<ListResponse> {
    return this.http.get<ListResponse>(`${this.base}/da-verification`);
  }
  nonConformances(filter: ListFilter): Observable<ListResponse> {
    return this.http.get<ListResponse>(`${this.base}/non-conformances`, { params: params(filter) });
  }
  assessorAccept(zedId: string, certification: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/da-verification/accept`, { zedId, certification });
  }
  assessorReject(zedId: string, certification: string, reasonForRejection: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/da-verification/reject`, { zedId, certification, reasonForRejection });
  }

  // Completed / rejected
  results(kind: 'completed' | 'rejected', filter: ResultsFilter): Observable<PageResponse> {
    return this.http.get<PageResponse>(`${this.base}/${kind}`, { params: params(filter) });
  }

  // Review page
  private da(zedId: string, certification: string): string {
    return `${this.base}/da/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`;
  }
  details(zedId: string, certification: string): Observable<DaDetails> {
    return this.http.get<DaDetails>(this.da(zedId, certification));
  }
  conformance(zedId: string, certification: string, id: unknown, conformance: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/requirements/${encodeURIComponent(String(id))}/conformance`, { conformance, remarks });
  }
  validateProduct(zedId: string, certification: string, id: unknown, isVerified: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/products/${encodeURIComponent(String(id))}/validate`, { isVerified, remarks });
  }
  validateSiteExterior(zedId: string, certification: string, isVerified: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/site-exterior/validate`, { isVerified, remarks });
  }
  validateEvidence(
    zedId: string,
    certification: string,
    id: unknown,
    isVerified: string,
    sourceOfValidation: string,
    remarks: string,
    files: File[],
  ): Observable<MessageResponse> {
    const form = new FormData();
    form.append('IsVerified', isVerified);
    if (isVerified === 'Yes') form.append('SourceOfValidation', sourceOfValidation);
    form.append('Remarks', remarks);
    if (isVerified === 'Yes') for (const f of files) form.append('Files', f, f.name);
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/evidences/${encodeURIComponent(String(id))}/validate`, form);
  }
  exemption(zedId: string, certification: string, id: unknown, isAssessmentExcempted: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/sections/${encodeURIComponent(String(id))}/exemption`, { isAssessmentExcempted });
  }
  opened(zedId: string, certification: string, type: OpenedType, id: unknown): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/opened`, { type, id: Number(id) });
  }
  checkFinalSubmit(zedId: string, certification: string): Observable<FinalSubmitCheck> {
    return this.http.post<FinalSubmitCheck>(`${this.da(zedId, certification)}/final-submit/check`, {});
  }
  finalSubmit(zedId: string, certification: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/final-submit`, { remarks });
  }
}
