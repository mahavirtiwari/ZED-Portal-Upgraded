import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable, finalize, shareReplay } from 'rxjs';
import { ReviewActions } from '../monitoring/review.api';
import type { Checkpoint, CheckpointSaveRequest } from './checkpoint-dialog';
import { canonicalLevelCode } from '../../msme/shared/levels';

/** Rows keep the procedures' column names (ZedId, PUnitName, CertificationStatus, ...). */
export type Row = Record<string, unknown>;

export interface Person {
  userId: string;
  userName: string;
  /** V4: Manufacturing, Services or Both; null when not set (no limit). */
  sectorActivity?: string | null;
  /** 2026-11-14: the levels and modes the assessor may do (absent = not limited, e.g. surveillance). */
  assessments?: { level: string; modes: string[] }[] | null;
  /** 2026-11-18 (expenditure monitoring, allot/agencies): the agency's PO for the level is used up, so allotment stopped. */
  poStopped?: boolean;
  /** Why (shown on the agency). */
  poMessage?: string | null;
  /** The PO's cases left; null without a PO (no limit). */
  poLeft?: number | null;
}

/** Whether a person with this sector type may assess a unit of this category (as the server checks). */
export function serves(person: { sectorActivity?: string | null }, unitCategory: unknown): boolean {
  const a = person.sectorActivity;
  return !unitCategory || !a || a === 'Both' || a === unitCategory;
}

export interface ListResponse {
  rows: Row[];
}

export interface DaAllotmentResponse {
  rows: Row[];
  /** The agency's Silver/Gold desktop assessors (Surveillance: its assessors allowed for Bronze surveillance). */
  assessors: Person[];
  /** The agency's Bronze assessors with fewer than 10 allotments today (Surveillance: same as `assessors`). */
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

/** 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the count cards of Completed (staff-11) and Rejected (staff-12). */
export interface ResultCounts {
  total: number;
  certifiedThisMonth: number;
  surveillanceDue90: number;
  duplicates: number;
  /** Rejected on main: back on the Allot list / allotted again; null elsewhere. */
  waitingReallot: number | null;
  reallotted: number | null;
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
  /** The checkpoints of every requirement row (initial and NC rounds), with their answers (migration 0039). */
  checkpoints?: Checkpoint[];
  /** Surveillance host only: Bronze surveillance app answers and the original ZED assessment's location. */
  surveillance?: SurveillanceDetails | null;
  /**
   * 2026-11-18: only for the agency of a unit waiting in its DA allotment list (not yet accepted): the page is a read-only
   * preview of what the applicant submitted, with the allotment banner (Accept / Re-allot, Reject).
   */
  allotment?: AgencyAllotment | null;
}

/** The agency's allotment of a unit it has not accepted yet (DesktopAssessmentController.AgencyAllotment). */
export interface AgencyAllotment {
  /** desktop: the DA allotment list (desktop assessor); site: the SA allotment list (site assessor). */
  kind: 'desktop' | 'site';
  /** Nothing assessed yet: the page hides the assessors' verdicts (always for desktop; for site, when there was no desktop step). */
  preview: boolean;
  /** pending: no assessor yet; allotted: given to an assessor (desktop: not accepted yet; site: not started); rejected: the desktop assessor rejected it. */
  stage: 'pending' | 'allotted' | 'rejected';
  /** "17 Nov 2026", when known. */
  allottedOn: string | null;
  assessorId: string | null;
  assessorName: string | null;
  assessorReason: string | null;
  canAllot: boolean;
  canReject: boolean;
  /** The applicant's contact, in full. */
  spocName: string | null;
  mobile: string | null;
  email: string | null;
  pan: string | null;
}

export interface SurveillanceDetails {
  /** ZedLatitude, ZedLongitude. */
  zedLocation: Row | null;
  /** FinancialAssistanceAvailed, AnyDocuments, DocumentTypes. */
  financialSupport: Row | null;
  /** SuitableForSilverUpgrade, HandholdingSupport. */
  additionalSupport: Row | null;
}

export interface FinalSubmitCheck {
  allowed: boolean;
  message: string | null;
  raisesNc: boolean;
  /** 2026-11-17 (approved): the Admin's assessor final submit checklist the pop-up asks (Admin → Submission checklists). */
  checklist?: { id: string; text: string }[];
}

export type OpenedType = 'Evidence' | 'SiteExteriorPhoto' | 'ProductPhoto' | 'ProductDescriptionPhoto';

/**
 * The level a desktop assessment is opened with (MsmeCertifications.Certification): every level of Administration →
 * Certification Levels (2026-11-08: the Admin's too), as stored.
 */
export function canonicalLevel(value: string | null | undefined): string | null {
  return canonicalLevelCode(value);
}

/**
 * 2026-11-19 (rejection reasons, approved): a reason an agency picks when it rejects a unit allotted to it (Admin → Rejection
 * Reasons, active ones in order). autoReallot: the unit goes to another agency by round robin; else back to the Master Admin.
 */
export interface RejectionReason {
  id: string;
  text: string;
  autoReallot: boolean;
}

/** What the agency sends with a rejection (desktop and site allotment): the reason picked and its optional remarks. */
export interface AgencyRejection {
  reasonId: string;
  remarks: string | null;
}

/** The server's answer to a rejection: its message says whether the unit went to another agency. */
export interface RejectResponse extends MessageResponse {
  reallotted: boolean;
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
  /** The active rejection reasons (desktop and site allotment). */
  rejectionReasons(): Observable<RejectionReason[]> {
    return this.http.get<RejectionReason[]>(`${this.base}/rejection-reasons`);
  }
  agencyReject(zedId: string, certification: string, rejection: AgencyRejection): Observable<RejectResponse> {
    return this.http.post<RejectResponse>(`${this.base}/da-allotment/reject`, { zedId, certification, ...rejection });
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

  /** The count cards for the filter (its page is ignored). */
  resultCounts(kind: 'completed' | 'rejected', filter: ResultsFilter): Observable<ResultCounts> {
    return this.http.get<ResultCounts>(`${this.base}/${kind}/counts`, { params: params({ ...filter, pageNo: undefined, pageSize: undefined }) });
  }

  // Review page
  private da(zedId: string, certification: string): string {
    return `${this.base}/da/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`;
  }
  /** The details being read now, by address (see {@link details}). */
  private readonly reading = new Map<string, Observable<DaDetails>>();

  /**
   * The assessment details. 2026-11-21 (Assessor UI audit: the details were asked twice on every load): a second ask while the same
   * details are on their way shares that request; a later ask (after a save, Refresh) reads them again.
   */
  details(zedId: string, certification: string): Observable<DaDetails> {
    const url = this.da(zedId, certification);
    const going = this.reading.get(url);
    if (going) return going;
    const call: Observable<DaDetails> = this.http.get<DaDetails>(url).pipe(
      finalize(() => {
        if (this.reading.get(url) === call) this.reading.delete(url);
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );
    this.reading.set(url, call);
    return call;
  }
  conformance(zedId: string, certification: string, id: unknown, conformance: string, remarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/requirements/${encodeURIComponent(String(id))}/conformance`, { conformance, remarks });
  }
  /** Yes / Partial / No for each checkpoint of a requirement; its conformance follows. */
  checkpoints(zedId: string, certification: string, id: unknown, body: CheckpointSaveRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/requirements/${encodeURIComponent(String(id))}/checkpoints`, body);
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
  finalSubmit(zedId: string, certification: string, remarks: string, checklist: string[] = []): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.da(zedId, certification)}/final-submit`, { remarks, checklist });
  }
}
