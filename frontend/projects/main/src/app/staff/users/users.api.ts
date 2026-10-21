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

export interface CodeName {
  code: string;
  name: string;
}

export interface AgencyOptions {
  states: string[];
  sectors: Sector[];
  orgPartners: OrgPartner[];
  /** Consultancy: states a Consultant Organisation can prefer for Technology Upgradation (LGD code). */
  tuStates?: CodeName[] | null;
}

export interface District {
  districtCode: string;
  districtName: string;
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
  /** Consultancy only (Technology Upgradation preference of a CO with financial verification). */
  tuPreferredState?: string;
  tuPreferredDistricts?: string[];
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
  tuPreferredState?: string | null;
  tuPreferredDistricts?: string[] | null;
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
  /** Consultancy: "Consultant" or "Technical Expert" (RoleId 3 / 33). */
  UserType?: string | null;
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
  /** Consultancy: Consultant | TechnicalExpert. */
  userType?: string | null;
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
  /** Consultancy technical experts (assessorType "TechnicalExpert"): typed name, e-mail and mobile. */
  userName?: string;
  emailId?: string;
  mobileNo?: string;
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

/** Asked before an administrator sends a password reset link. */
export const RESET_CONFIRM =
  'Send this user a link to set a new password? It goes to the user’s registered e-mail address; you do not see or set the password.';

/** Client for api/staff/users (Zed.Main.Api StaffAgenciesController / StaffAssessorsController). */
@Injectable({ providedIn: 'root' })
export class UsersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/users';

  agencies(): Observable<AgencyRow[]> {
    return this.http.get<AgencyRow[]>(`${this.base}/agencies`);
  }

  /** Consultancy: districts of a Technology Upgradation state. */
  districts(state: string): Observable<District[]> {
    return this.http.get<District[]>(`${this.base}/agencies/districts`, { params: new HttpParams().set('state', state) });
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

  /** E-mails the user a link to set a new password (the caller never sees or sets it). */
  passwordReset(kind: ManagedKind, userId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/password-reset`, null);
  }
}

/** Surveillance: agency row of api/staff/surveillance-users/agencies. */
export interface SurveillanceAgency {
  userId: string;
  userName: string | null;
  spocName: string | null;
  email: string | null;
  mobileNo: string | null;
  isActive: boolean | null;
  reasonForRejection: string | null;
  desktopVerification: boolean | null;
  siteVerification: boolean | null;
  allowBronzeSurveillance: boolean | null;
  reasonForRejectionForBS: string | null;
  tuPreferredState: string | null;
  noOfUsers: number;
}

export interface SurveillanceAssessor {
  userId: string;
  userName: string | null;
  email: string | null;
  mobileNo: string | null;
  isActive: boolean | null;
  reasonForRejection: string | null;
  desktopVerification: boolean | null;
  siteVerification: boolean | null;
  allowBronzeSurveillance: boolean | null;
  agencyUserId: string | null;
  agencyUserName: string | null;
}

export interface BronzeSurveillanceRequest {
  allow: boolean;
  reason?: string;
  preferredState?: string;
  districts?: string[];
}

/** Client for api/staff/surveillance-users (Surveillance host: accounts are mastered in main, nothing is created here). */
@Injectable({ providedIn: 'root' })
export class SurveillanceUsersApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/surveillance-users';

  states(): Observable<CodeName[]> {
    return this.http.get<CodeName[]>(`${this.base}/states`);
  }

  districts(state: string): Observable<District[]> {
    return this.http.get<District[]>(`${this.base}/districts`, { params: new HttpParams().set('state', state) });
  }

  agencies(): Observable<SurveillanceAgency[]> {
    return this.http.get<SurveillanceAgency[]>(`${this.base}/agencies`);
  }

  agency(userId: string): Observable<{ agency: SurveillanceAgency; districts: string[] }> {
    return this.http.get<{ agency: SurveillanceAgency; districts: string[] }>(`${this.base}/agencies/${encodeURIComponent(userId)}`);
  }

  setAgencyBronze(userId: string, req: BronzeSurveillanceRequest): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/agencies/${encodeURIComponent(userId)}/bronze-surveillance`, req);
  }

  assessors(agencyId = ''): Observable<SurveillanceAssessor[]> {
    const params = agencyId ? new HttpParams().set('agencyId', agencyId) : undefined;
    return this.http.get<SurveillanceAssessor[]>(`${this.base}/assessors`, { params });
  }

  setAssessorBronze(userId: string, allow: boolean): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${this.base}/assessors/${encodeURIComponent(userId)}/bronze-surveillance`, { allow });
  }

  block(kind: ManagedKind, userId: string, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/block`, { reason });
  }

  unblock(kind: ManagedKind, userId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/unblock`, null);
  }

  /** E-mails the user a link to set a new password; refused for accounts whose password the main portal holds. */
  passwordReset(kind: ManagedKind, userId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/${kind}/${encodeURIComponent(userId)}/password-reset`, null);
  }
}
