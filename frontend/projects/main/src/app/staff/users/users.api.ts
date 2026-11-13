import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { allLevels, levelName } from '../../msme/shared/levels';

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
  /** Main (2026-11-08): the other levels it may be allotted, and why a level was disabled. */
  AllowSilverAssessments?: boolean;
  AllowGoldAssessments?: boolean;
  AllowZedxAssessments?: boolean;
  LevelReasons?: Partial<Record<AgencyLevel, string | null>>;
  /** Main (V4): Manufacturing, Services or Both; null when not set yet. */
  SectorActivity?: SectorActivity | null;
  /** 2026-11-08: the levels the Admin added, Allow{Code}Assessments (NULL / missing = allowed). */
  [column: string]: unknown;
}

/**
 * The certification levels an agency may be allotted (Agencies -> Agency level allocation, 2026-11-08): Bronze, Silver,
 * Gold, ZEDX and the levels the Admin adds (Administration → Certification Levels).
 */
export type AgencyLevel = string;

export interface AgencyLevelInfo {
  code: AgencyLevel;
  name: string;
  /** The row's column: Users.Allow{Code}Assessments (ZED-X's hand-made AllowZedxAssessments). */
  field: string;
}

/** The column of a level on the agency rows (Users.Allow{Code}Assessments; NULL = allowed). */
export function agencyLevelField(code: string): string {
  return code.toUpperCase() === 'ZEDX' ? 'AllowZedxAssessments' : `Allow${code}Assessments`;
}

/** The built-in levels (before the levels arrive). */
export const AGENCY_LEVELS: AgencyLevelInfo[] = [
  { code: 'Bronze', name: 'Bronze', field: 'AllowBronzeAssessments' },
  { code: 'Silver', name: 'Silver', field: 'AllowSilverAssessments' },
  { code: 'Gold', name: 'Gold', field: 'AllowGoldAssessments' },
  { code: 'ZEDX', name: 'ZED-X', field: 'AllowZedxAssessments' },
];

/**
 * Every level an agency may be allotted, in the Admin's order (api/public/levels/all, disabled levels too), and any level
 * the server's rows carry a reason for.
 */
export function agencyLevels(rows: readonly AgencyRow[] = []): AgencyLevelInfo[] {
  const list: AgencyLevelInfo[] = allLevels().map((l) => ({ code: l.code, name: levelName(l.code) || l.name, field: agencyLevelField(l.code) }));
  const known = new Set(list.map((l) => l.code.toLowerCase()));
  for (const r of rows) {
    for (const code of Object.keys(r.LevelReasons ?? {})) {
      if (known.has(code.toLowerCase())) continue;
      known.add(code.toLowerCase());
      list.push({ code, name: levelName(code), field: agencyLevelField(code) });
    }
  }
  return list;
}

/** A row's value by column, any case (SQL column names are case-insensitive). */
export function rowValue(row: Record<string, unknown>, column: string): unknown {
  if (column in row) return row[column];
  const key = Object.keys(row).find((k) => k.toLowerCase() === column.toLowerCase());
  return key ? row[key] : undefined;
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
  /** The Master Admin's own category when its login is limited to one (migration 0057): the agency must match it. */
  scopeSector?: SectorActivity | null;
}

export interface District {
  districtCode: string;
  districtName: string;
}

/** Which MSMEs an agency / assessor may assess (V4, Main). */
export type SectorActivity = 'Manufacturing' | 'Services' | 'Both';
export const SECTOR_ACTIVITIES: { value: SectorActivity; label: string }[] = [
  { value: 'Manufacturing', label: 'Manufacturing' },
  { value: 'Services', label: 'Services' },
  { value: 'Both', label: 'Both' },
];

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
  /** Main only (V4): required. */
  sectorActivity?: SectorActivity | '';
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
  sectorActivity?: SectorActivity | null;
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
  SectorActivity?: SectorActivity | null;
  AgencyUserId: string | null;
  AgencyUserName: string | null;
  /** Blocked: the reason and date of its latest block (2026-11-08). */
  BlockReason?: string | null;
  BlockedOn?: string | null;
}

/** One block or unblock of a login (2026-11-08). */
export interface BlockHistoryEntry {
  action: 'Blocked' | 'Unblocked';
  reason: string | null;
  actionBy: string | null;
  actionByRole: number | null;
  actionDate: string | null;
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
  SectorActivity?: SectorActivity | null;
  IsCertAttached: number;
  IdProofNumber: string | null;
  PhotoPath: string | null;
  /** Consultancy: "Consultant" or "Technical Expert" (RoleId 3 / 33). */
  UserType?: string | null;
}

/** How the Add form verifies a certified professional (Admin → Settings → Professional Verification, per portal). */
export type VerificationMode = 'Off' | 'TrainingPortal' | 'Api';

export interface AssessorOptions {
  states: string[];
  sectors: Sector[];
  areasOfKnowledge: string[];
  /** Off (the default): the agency types the details; TrainingPortal: certificate + e-mail; Api: certificate + PAN. */
  verification?: { mode: VerificationMode; needsPan: boolean };
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
  sectorActivity?: SectorActivity | null;
  /** The agency's own (an assessor cannot cover more). */
  agencySectorActivity?: SectorActivity | null;
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
  sectorActivity?: SectorActivity | '';
  /** The professional's PAN (verification off or by API). */
  pan?: string;
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
  sectorActivity?: SectorActivity | '';
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
    return this.levelAssessments(userId, 'Bronze', allow, reason);
  }

  /** Enables or disables one level's allotment for an agency (a reason when disabling). */
  levelAssessments(userId: string, level: AgencyLevel, allow: boolean, reason: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/agencies/${encodeURIComponent(userId)}/level-assessments`, { level, allow, reason });
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

  /** The signed-in agency's sector type (Main; message "" when not set). */
  agencySectorActivity(): Observable<MessageResponse> {
    return this.http.get<MessageResponse>(`${this.base}/assessors/agency-sector-activity`);
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

  /** Verification by another portal's API: certificate number and PAN. */
  lookupProfessionalByPan(assessorType: string, certificateNo: string, pan: string): Observable<Professional> {
    return this.http.post<Professional>(`${this.base}/assessors/lookup`, { assessorType, certificateNo, pan });
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

  /** Every block and unblock of an assessor / consultant, latest first. */
  assessorHistory(userId: string): Observable<BlockHistoryEntry[]> {
    return this.http.get<BlockHistoryEntry[]>(`${this.base}/assessors/${encodeURIComponent(userId)}/history`);
  }

  /** Its assessments not certified yet (null when not known). */
  assessorOpenAssessments(userId: string): Observable<{ count: number | null }> {
    return this.http.get<{ count: number | null }>(`${this.base}/assessors/${encodeURIComponent(userId)}/open-assessments`);
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

  /** Every block and unblock of a Surveillance login, latest first (2026-11-08). */
  history(kind: 'agencies' | 'assessors', userId: string): Observable<BlockHistoryEntry[]> {
    return this.http.get<BlockHistoryEntry[]>(`${this.base}/${kind}/${encodeURIComponent(userId)}/history`);
  }

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
