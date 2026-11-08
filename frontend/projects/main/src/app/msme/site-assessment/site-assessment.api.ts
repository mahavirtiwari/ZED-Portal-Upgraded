import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { isV4Level, levelMode, splitCertification } from '../shared/levels';

/** Rows keep the procedure's column names (EnterpriseName, SaDomesticCustomers, TurnOver, ...). */
export type Row = Record<string, string | number | boolean | null>;

/** A photo or document; src is an api/msme/site-assessment/photos address, or null when it cannot be shown. */
export interface SitePhoto {
  name: string | null;
  src: string | null;
  createdDate: string | null;
  ncCount: number | null;
}

export interface SiteProduct {
  productName: string | null;
  exported: string | null;
  /** DA upload (product photo), or null. */
  productPhoto: string | null;
  productDescriptionPhoto: string | null;
  productDescriptionKind: 'pdf' | 'image' | null;
  productDescriptionOpened: boolean;
  /** Photos taken during the site assessment. */
  photos: SitePhoto[];
}

export interface SiteOption {
  optionName: string | null;
  subOptions: (string | null)[];
}

export interface SiteEvidence {
  evidenceName: string | null;
  url: string | null;
}

export interface SiteBullets {
  baselineDiagnostic: (string | null)[];
  handholdingActionPlan: (string | null)[];
  technologyIntervention: (string | null)[];
}

export interface SiteRequirement {
  requirementCode: string | null;
  /** The Admin's video for the requirement (2026-11-08). */
  videoUrl?: string | null;
  /** Milestone answers (SaConformance, BaselineRemarks, ...); empty for Silver/Gold. */
  milestone: Row;
  options: SiteOption[];
  /** DA evidences (PDFs). */
  evidences: SiteEvidence[];
  photos: SitePhoto[];
  surveillancePhotos: SitePhoto[];
  bullets: SiteBullets | null;
}

export interface SiteSection {
  sectionCode: string | null;
  sectionName: string | null;
  iButton: string | null;
  isAssessmentExcempted: string | null;
  ncCount: number | null;
  requirements: SiteRequirement[];
}

export interface SiteExteriorMilestone {
  ncCount: number | null;
  photos: SitePhoto[];
}

export interface SiteAssessmentData {
  /** Type the procedures were called with ("Silver", "GoldMilestone2", ...). */
  certification: string;
  kind: 'assessment' | 'milestone';
  msme: Row;
  basicInfo: Row;
  assessment: Row;
  products: SiteProduct[];
  rawMaterials: Row[];
  siteTourPhotos: SitePhoto[];
  surveillancePhotos: SitePhoto[];
  sections: SiteSection[];
  siteExteriorPhotos: SiteExteriorMilestone[];
  consultancyBasicInfo: Row[];
}

/** The values the API accepts (MsmeSiteAssessmentController.CertificationTypes). */
export const SITE_ASSESSMENT_TYPES = [
  'Silver', 'Gold', 'ZEDX',
  'SilverSurveillance', 'GoldSurveillance', 'ZEDXSurveillance',
  'SilverMilestone1', 'SilverMilestone2', 'SilverMilestone3',
  'GoldMilestone1', 'GoldMilestone2', 'GoldMilestone3',
] as const;

/**
 * Canonical spelling of a certification type from the URL, or null when the page does not exist for it: also a site level
 * the Admin added (2026-11-08, desktop and site assessment) or its surveillance.
 */
export function canonicalSiteAssessment(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  const known = SITE_ASSESSMENT_TYPES.find((t) => t.toLowerCase() === v);
  if (known) return known;
  const split = splitCertification(value);
  if (!split || !isV4Level(split.level) || levelMode(split.level) !== 'Site') return null;
  return split.suffix === '' || split.suffix === 'Surveillance' ? split.level + split.suffix : null;
}

/** Client for api/msme/site-assessment (Zed.Main.Api MsmeSiteAssessmentController). */
@Injectable({ providedIn: 'root' })
export class SiteAssessmentApi {
  private readonly http = inject(HttpClient);

  get(certification: string): Observable<SiteAssessmentData> {
    return this.http.get<SiteAssessmentData>(`/api/msme/site-assessment/${encodeURIComponent(certification)}`);
  }
}
