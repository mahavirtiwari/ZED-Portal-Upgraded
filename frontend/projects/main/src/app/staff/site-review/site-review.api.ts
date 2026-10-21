import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { Row } from '../assessment/assessment.api';
import { ReviewActions } from '../monitoring/review.api';

export type { Row };

/** A photo with its authorised address (null when the stored address was not a file of this unit). */
export interface SaPhoto {
  id: number | null;
  name: string | null;
  url: string | null;
  createdDate: string | null;
  isVerified: string | null;
  assessorRemarks: string | null;
}

export interface SaMeeting {
  id: number | null;
  comments: string | null;
  photos: SaPhoto[];
  /** Name, Designation. */
  participants: Row[];
}

export interface SaProduct {
  id: number | null;
  /** 'da': declared in the desktop assessment (MsmeProducts); 'sa': added during the site assessment. */
  source: 'da' | 'sa';
  productName: string | null;
  exported: string | null;
  photoUrl: string | null;
  descriptionUrl: string | null;
  descriptionKind: 'pdf' | 'image' | null;
  isVerified: string | null;
  assessorRemarks: string | null;
  isSaVerified: string | null;
  saAssessorRemarks: string | null;
  photos: SaPhoto[];
}

export interface SaEvidencePhoto {
  sectionCode: string | null;
  requirementCode: string | null;
  requirementId: string | null;
  name: string | null;
  url: string | null;
  createdDate: string | null;
}

export interface SaNcProduct {
  id: number | null;
  productName: string | null;
  exported: string | null;
  ncCount: number;
  productParentId: string | null;
  photoUrl: string | null;
  descriptionUrl: string | null;
  descriptionKind: 'pdf' | 'image' | null;
  isSaVerified: string | null;
  saAssessorRemarks: string | null;
  msmeRemarks: string | null;
}

export interface SaNcRound {
  ncCount: number;
  products: SaNcProduct[];
  oldProducts: SaNcProduct[];
  sections: Row[];
  /** Id, SectionCode, RequirementCode, SaConformance, SaAssessorRemarks, MsmeComments. */
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  /** With FileUrl. */
  evidences: Row[];
  photos: SaPhoto[];
  commentsId: number | null;
  assessorComments: string | null;
}

export interface SaPermissions {
  review: ReviewActions;
  /** Master admin: exemption Yes → No while the site assessment is scheduled. */
  canWithdrawExemption: boolean;
  /** The user is this unit's site/co-assessor and the site assessment is open: its actions are on the current portal. */
  assessorOnCurrentPortal: boolean;
}

export interface SaDetails {
  zedId: string;
  certification: string;
  role: string;
  msme: Row;
  location: Row | null;
  daSelfies: SaPhoto[];
  daSiteExterior: SaPhoto[];
  saSelfies: SaPhoto[];
  saSiteExterior: SaPhoto[];
  products: SaProduct[];
  rawMaterials: Row[];
  sections: Row[];
  /** Each with Photos (site assessment evidence photos). */
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  /** With FileUrl. */
  evidences: Row[];
  evidencePhotos: SaEvidencePhoto[];
  siteTour: SaPhoto[];
  openMeeting: SaMeeting | null;
  closeMeeting: SaMeeting | null;
  /** With LoginPhotoUrl / LogoutPhotoUrl. */
  attendance: Row[];
  consultants: Row[];
  ncRounds: SaNcRound[];
  permissions: SaPermissions;
}

export const SITE_LEVELS = ['Silver', 'Gold'] as const;

export function siteLevel(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  return SITE_LEVELS.find((l) => l.toLowerCase() === v) ?? null;
}

/** Client for api/staff/site-review (Zed.Main.Api Features/Staff/SiteReview). */
@Injectable({ providedIn: 'root' })
export class SiteReviewApi {
  private readonly http = inject(HttpClient);

  details(zedId: string, certification: string): Observable<SaDetails> {
    return this.http.get<SaDetails>(`/api/staff/site-review/${encodeURIComponent(zedId)}/${encodeURIComponent(certification)}`);
  }

  siteVerification(): Observable<{ rows: Row[] }> {
    return this.http.get<{ rows: Row[] }>('/api/staff/site-review/site-verification');
  }
}
