import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';
import { withApiBase } from '../../../api-base';

/** List tabs of SP_FINANCIAL_ASSISTANCE_GET_LIST on ZED_CONSULTANT (FinancialAssistance.TechUpgradeStatus). */
export const TuTab = { Allotment: 2, InProgress: 5, Qc: 6, Approved: 8, Rejected: 9 } as const;

/**
 * Where the master admin and the CO land (the old page's GetSections(99)): the procedure answers with the tab counts and,
 * as on the old page, no rows. The MSME-DFO officer lands on TU ALLOTMENT and has no tabs.
 */
export const TU_LANDING = 99;

/** A row of the TU list (procedure column names). */
export interface TuSubmission {
  Id: number;
  ZedId: string;
  PUnitName: string | null;
  UnitAddress: string | null;
  CertificationType: string;
  LastestCertification: string | null;
  CertificationBodyUserId: string | null;
  CertificationBodyName: string | null;
  FinancialAssessorId: string | null;
  FaAssessorName: string | null;
  FinAssessorName: string | null;
  ReasonForRejection: string | null;
  ReasonForRejectionAgency: string | null;
  VerificationDate: string | null;
  TechUpgradeStatus: number | null;
  /** Reddens the action cell, as on the old page (the TU procedure does not return it at present). */
  TimeDuration?: string | null;
}

export interface TuCounts {
  New: number;
  InProgress: number;
  Qc: number;
  Approved: number;
  Rejected: number;
}

export interface TuSubmissions {
  rows: TuSubmission[];
  counts: TuCounts | null;
}

export interface UserOption {
  userId: string;
  userName: string;
}

export interface TuScreenshot {
  id: number;
  fileName: string;
  url: string;
}

export interface TuDocument {
  id: number;
  photoType: string | null;
  technologyCode: string | null;
  timeStamp: string | null;
  isPdf: boolean;
  url: string;
  opened: boolean;
  isVerified: string | null;
  sourceOfValidation: string | null;
  assessorRemarks: string | null;
  /** A "Yes" needs a screenshot of the check (all types except invoice and CA certificate). */
  needsScreenshot: boolean;
  screenshots: TuScreenshot[];
}

export type TuValues = Record<string, string | number | boolean | null>;

export interface TuTechnology {
  id: number;
  isEligible: boolean;
  details: TuValues;
}

export interface TuMeeting {
  comments: string | null;
  participants: { name: string | null; designation: string | null }[];
  photos: { id: number; name: string | null; timeStamp: string | null; url: string }[];
}

/** A day of the MSME-DFO's attendance from the app; the selfies are served by the API. */
export interface TuAttendance {
  date: string | null;
  loginTime: string | null;
  logoutTime: string | null;
  hours: number | null;
  minutes: number | null;
  loginPhotoUrl: string | null;
  logoutPhotoUrl: string | null;
}

export interface TuApplication {
  certification: string;
  stage: string;
  details: TuValues;
  technologies: TuTechnology[];
  documents: TuDocument[];
  meeting: TuMeeting | null;
  recommended: { code: string | null; name: string | null; description: string | null }[];
  canValidate: boolean;
  canDecide: boolean;
  canApprove: boolean;
  canEditAmounts: boolean;
  canEditAccount: boolean;
  hasReport: boolean;
  attendance: TuAttendance[];
  /** The unit's overview and location (the "Overview" tab), the same on every application of the unit. */
  overview: TuValues | null;
  location: TuValues | null;
}

export interface TuValidation {
  isVerified: 'Yes' | 'No';
  sourceOfValidation: string;
  remarks: string;
  file: File | null;
}

export interface TuAccount {
  accountNo: string;
  ifscCode: string;
  branchAddress: string;
  bankName: string;
}

export interface RecommendationPage {
  zedId: string;
  certification: string;
  recommended: boolean;
  canRecommend: boolean;
  message: string | null;
  maxSelection: number;
  technologies: { code: string; name: string; description: string | null; selected: boolean }[];
}

const BASE = withApiBase('/api/staff/consultancy/tu');
const TECH = withApiBase('/api/staff/consultancy/technology');

/** Client for the consultancy host's TuSubmissionsController, TuVerificationController and TechnologyRecommendationController. */
@Injectable({ providedIn: 'root' })
export class TuApi {
  private readonly http = inject(HttpClient);

  submissions(status: number): Observable<TuSubmissions> {
    return this.http.get<TuSubmissions>(`${BASE}/submissions`, { params: new HttpParams().set('status', status) });
  }

  agencies(zedId: string): Observable<UserOption[]> {
    return this.http.get<UserOption[]>(`${BASE}/agencies`, { params: new HttpParams().set('zedId', zedId) });
  }

  allot(zedId: string, certification: string, agencyUserId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/allot`, { zedId, certification, agencyUserId });
  }

  assessors(): Observable<UserOption[]> {
    return this.http.get<UserOption[]>(`${BASE}/assessors`);
  }

  accept(zedId: string, certification: string, assessorUserId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/accept`, { zedId, certification, assessorUserId });
  }

  reject(zedId: string, certification: string, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/reject`, { zedId, certification, reason });
  }

  details(zedId: string): Observable<TuApplication[]> {
    return this.http.get<TuApplication[]>(`${BASE}/${encodeURIComponent(zedId)}`);
  }

  validate(zedId: string, certification: string, documentId: number, v: TuValidation): Observable<MessageResponse> {
    const form = new FormData();
    form.append('isVerified', v.isVerified);
    if (v.sourceOfValidation) form.append('sourceOfValidation', v.sourceOfValidation);
    if (v.remarks) form.append('remarks', v.remarks);
    if (v.file) form.append('file', v.file, v.file.name);
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/documents/${documentId}/validation`, form);
  }

  updateAmount(zedId: string, certification: string, technologyId: number, amountPaid: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/technologies/${technologyId}/amount`, { amountPaid });
  }

  decide(zedId: string, certification: string, decision: 'approve' | 'reject', comments: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/decision`, { decision, comments });
  }

  updateAccount(zedId: string, certification: string, account: TuAccount): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/account`, account);
  }

  reportUrl(zedId: string, certification: string): string {
    return `${BASE}/${encodeURIComponent(zedId)}/${certification}/report`;
  }

  recommendation(zedId: string, level: string): Observable<RecommendationPage> {
    return this.http.get<RecommendationPage>(`${TECH}/${encodeURIComponent(zedId)}/${encodeURIComponent(level)}`);
  }

  recommend(zedId: string, level: string, codes: string[]): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${TECH}/${encodeURIComponent(zedId)}/${encodeURIComponent(level)}`, { codes, confirmed: true });
  }
}
