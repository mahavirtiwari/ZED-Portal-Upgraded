import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

/** Row of SP_GET_USERS_BY_ROLE (RoleId 2) as returned by api/staff/users/agencies (legacy column names). */
export interface AgencyRow {
  Id: number;
  UserId: string;
  UserName: string;
  Address: string | null;
  Pincode: string | null;
  SpocName: string | null;
  MobileNo: string | null;
  Email: string | null;
  IsActive: boolean;
  IdStatus: string | null;
  DesktopVerfi: string | null;
  SiteVerifi: string | null;
  FinanceVerfi: string | null;
  NoOfUsers: number | null;
  NoOfBronzeAssessors: number | null;
  AllowBronzeAssessments: boolean;
}

export interface Sector {
  sectorCode: string;
  sectorName: string;
}

export interface OrgPartner {
  userId: string;
  name: string;
}

export interface AgencyOptions {
  states: string[];
  sectors: Sector[];
  orgPartners: OrgPartner[];
}

export interface AgencyRequest {
  userName: string;
  spocName: string;
  emailId: string;
  mobileNo: string;
  address: string;
  pinCode: string;
  gstNumber: string;
  states: string[];
  nicSectors: string[];
  orgPartnerId: string;
  desktopVerification: boolean;
  siteVerification: boolean;
  financialVerification: boolean;
  reasonForRejection: string;
}

export interface AgencyDetails {
  userId: string;
  userName: string;
  spocName: string | null;
  emailId: string | null;
  mobileNo: string | null;
  address: string | null;
  pinCode: string | null;
  gstNumber: string | null;
  states: string[];
  nicSectors: string[];
  orgPartnerId: string | null;
  orgPartnerName: string | null;
  desktopVerification: boolean;
  siteVerification: boolean;
  financialVerification: boolean;
  reasonForRejection: string | null;
  isActive: boolean;
}

export interface CreatedUserResponse {
  message: string;
  userId: string | null;
}

/** Row of SP_GET_ASSESSORS (MasterAdmin list). */
export interface AssessorRow {
  RowNumber: number | null;
  Id: number;
  UserId: string;
  UserName: string;
  MobileNo: string | null;
  Email: string | null;
  Address: string | null;
  IdStatus: string | null;
  IsActive: boolean;
  AssessorType: string | null;
  AgencyUserId: string | null;
  AgencyUserName: string | null;
}

/** Row of SP_GET_USERS_BY_ROLE (RoleId 3): the signed-in agency's assessors. ID proof numbers are masked. */
export interface OwnAssessorRow {
  Id: number;
  UserId: string;
  UserName: string;
  Address: string | null;
  MobileNo: string | null;
  Email: string | null;
  IdStatus: string | null;
  IsActive: boolean;
  AssessorType: string | null;
  IsCertAttached: number;
  IdProofNumber: string | null;
  PhotoPath: string | null;
}

export interface AssessorOptions {
  states: string[];
  sectors: Sector[];
  areasOfKnowledge: string[];
}

export interface AssessorDetails {
  userId: string;
  userName: string;
  emailId: string | null;
  mobileNo: string | null;
  address: string | null;
  pinCode: string | null;
  assessorType: string | null;
  certificateNo: string | null;
  idProofType: string | null;
  idProofNumberMasked: string | null;
  states: string[];
  nicSectors: string[];
  areasOfKnowledge: string[];
  reasonForRejection: string | null;
  isActive: boolean;
  agencyUserId: string | null;
  canEdit: boolean;
}

export interface Professional {
  name: string;
  email: string;
  mobileNo: string;
  address: string | null;
  pinCode: string | null;
  selfieUrl: string | null;
}

export interface AssessorCreateRequest {
  assessorType: string;
  certificateNo: string;
  professionalEmail: string;
  address: string;
  pinCode: string;
  idProofType: string;
  idProofNumber: string;
  states: string[];
  nicSectors: string[];
  areasOfKnowledge: string[];
}

export interface AssessorUpdateRequest {
  address: string;
  pinCode: string;
  idProofType: string;
  idProofNumber: string;
  states: string[];
  nicSectors: string[];
  areasOfKnowledge: string[];
  reasonForRejection: string;
}

export type ManagedKind = 'agencies' | 'assessors';

/** Client for api/staff/users (Zed.Main.Api StaffAgenciesController / StaffAssessorsController). */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/users';

  agencies(): Observable<AgencyRow[]> {
    return this.http.get<AgencyRow[]>(`${this.base}/agencies`);
  }

  agencyOptions(): Observable<AgencyOptions> {
    return this.http.get<AgencyOptions>(`${this.base}/agencies/options`);
  }

  agency(userId: string): Observable<AgencyDetails> {
    return this.http.get<AgencyDetails>(`${this.base}/agencies/${encodeURIComponent(userId)}`);
  }

  createAgency(req: AgencyRequest): Observable<CreatedUserResponse> {
    return this.http.post<CreatedUserResponse>(`${this.base}/agencies`, req);
  }

  updateAgency(userId: string, req: AgencyRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/agencies/${encodeURIComponent(userId)}`, req);
  }

  bronzeAssessments(userId: string, allow: boolean, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/agencies/${encodeURIComponent(userId)}/bronze-assessments`, { allow, reason });
  }

  allAssessors(agencyId: string, type: string): Observable<AssessorRow[]> {
    let params = new HttpParams();
    if (agencyId) params = params.set('agencyId', agencyId);
    if (type) params = params.set('type', type);
    return this.http.get<AssessorRow[]>(`${this.base}/assessors`, { params });
  }

  myAssessors(): Observable<OwnAssessorRow[]> {
    return this.http.get<OwnAssessorRow[]>(`${this.base}/assessors/mine`);
  }

  assessorOptions(): Observable<AssessorOptions> {
    return this.http.get<AssessorOptions>(`${this.base}/assessors/options`);
  }

  assessor(userId: string): Observable<AssessorDetails> {
    return this.http.get<AssessorDetails>(`${this.base}/assessors/${encodeURIComponent(userId)}`);
  }

  lookupProfessional(assessorType: string, certificateNo: string, email: string): Observable<Professional> {
    return this.http.post<Professional>(`${this.base}/assessors/lookup`, { assessorType, certificateNo, email });
  }

  createAssessor(req: AssessorCreateRequest): Observable<CreatedUserResponse> {
    return this.http.post<CreatedUserResponse>(`${this.base}/assessors`, req);
  }

  updateAssessor(userId: string, req: AssessorUpdateRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/assessors/${encodeURIComponent(userId)}`, req);
  }

  block(kind: ManagedKind, userId: string, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/block`, { reason });
  }

  unblock(kind: ManagedKind, userId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/unblock`, null);
  }

  resetMobile(kind: ManagedKind, userId: string, mobileNo: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/mobile`, { mobileNo });
  }
}
