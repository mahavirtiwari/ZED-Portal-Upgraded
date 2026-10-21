import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

/** FinancialAssistance.VerificationStatus. */
export const FaStatus = { New: 1, InProgress: 2, Qc: 3, Approved: 4, Rejected: 5, Reimbursed: 6 } as const;

/** A row of SP_FINANCIAL_ASSISTANCE_GET_LIST (procedure column names). */
export interface FaSubmission {
  Id: number;
  ZedId: string;
  EnterpriseName: string | null;
  UnitAddress: string | null;
  CertificationType: string;
  RegisteredDate: string | null;
  CertificationBodyUserId: string | null;
  CertificationBodyName: string | null;
  FinancialAssessorId: string | null;
  FaAssessorName: string | null;
  FinAssessorName: string | null;
  ReasonForRejection: string | null;
  VerificationDate: string | null;
  CategoryOfCertificate: string | null;
  NameOfCertficate: string | null;
  CertificationAgency: string | null;
}

export interface FaCounts {
  New: number;
  InProgress: number;
  Qc: number;
  Approved: number;
  Rejected: number;
}

export interface FaSubmissions {
  rows: FaSubmission[];
  counts: FaCounts | null;
}

export interface UserOption {
  userId: string;
  userName: string;
}

export interface FaScreenshot {
  id: number;
  fileName: string;
  url: string;
}

export interface FaDocument {
  id: number;
  photoType: string | null;
  name: string | null;
  timeStamp: string | null;
  isPdf: boolean;
  url: string;
  /** The assigned assessor has opened it (required before validating). */
  opened: boolean;
  isVerified: string | null;
  sourceOfValidation: string | null;
  assessorRemarks: string | null;
  screenshots: FaScreenshot[];
}

export type FaDetails = Record<string, string | number | null>;

export interface FaApplication {
  certification: string;
  details: FaDetails;
  documents: FaDocument[];
  canValidate: boolean;
  canDecide: boolean;
  canEditAccount: boolean;
}

export interface FaValidation {
  isVerified: 'Yes' | 'No';
  sourceOfValidation: string;
  remarks: string;
  file: File | null;
}

export interface FaAccount {
  accountNo: string;
  ifscCode: string;
  branchAddress: string;
  bankName: string;
}

const BASE = '/api/staff/schemes/fa';

/** Client for api/staff/schemes/fa (Zed.Main.Api FinancialAssistanceController and FaVerificationController). */
@Injectable({ providedIn: 'root' })
export class FaApi {
  private readonly http = inject(HttpClient);

  submissions(status: number): Observable<FaSubmissions> {
    return this.http.get<FaSubmissions>(`${BASE}/submissions`, { params: new HttpParams().set('status', status) });
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

  details(zedId: string): Observable<FaApplication[]> {
    return this.http.get<FaApplication[]>(`${BASE}/${encodeURIComponent(zedId)}`);
  }

  validate(zedId: string, certification: string, documentId: number, v: FaValidation): Observable<MessageResponse> {
    const form = new FormData();
    form.append('isVerified', v.isVerified);
    if (v.sourceOfValidation) form.append('sourceOfValidation', v.sourceOfValidation);
    if (v.remarks) form.append('remarks', v.remarks);
    if (v.file) form.append('file', v.file, v.file.name);
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/documents/${documentId}/validation`, form);
  }

  decide(zedId: string, certification: string, decision: 'approve' | 'reject', comments: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/decision`, { decision, comments });
  }

  updateAccount(zedId: string, certification: string, account: FaAccount): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/${encodeURIComponent(zedId)}/${certification}/account`, account);
  }
}
