import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Rows keep the procedure's column names (SectionCode, EvidenceName, ...); file columns hold api URLs. */
export type Row = Record<string, string | number | boolean | null>;

/** SP_ASSESSMENT_DA_DETAILS for the signed-in MSME (api/msme/assessment/{type}/basic-info). */
export interface AssessmentReport {
  certification: string;
  /** Answers of the unit (AuditsConducted, DomesticCustomers, EnergySources, ...) and NcCount. */
  assessment: Row;
  /** ProductName, Exported, PhotoUrl, DescriptionUrl, DescriptionType ('pdf' | 'image' | null). */
  products: Row[];
  rawMaterials: Row[];
  sections: Row[];
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  /** EvidenceName, GeneratedTime, FileUrl. */
  evidences: Row[];
  /** PhotoType (Selfie, SiteExteriorPhotos, ProductPhotos, ...), TimeStamp, CreatedDate, AssessorRemarks, FileUrl. */
  photos: Row[];
  esgCheckList: Row[];
}

/** One SP_ASSESSMENT_DA_DETAILS_NC round (NC1 ... NC5). */
export interface NonConformanceRound {
  number: number;
  products: Row[];
  sections: Row[];
  /** PreviousAssessorRemarks/UpdatedDate (the NC raised) and MsmeComments/MsmeUpdatedDate (the reply). */
  requirements: Row[];
  options: Row[];
  subOptions: Row[];
  evidences: Row[];
  photos: Row[];
  /** Silver/Gold: ProductId, ProductParentId, IsPdf, FileUrl. */
  productPhotos: Row[];
}

export type NcVariant = 'da' | 'sa';

export interface NonConformanceReport {
  certification: string;
  /** 'da': Bronze page (NonConformances.cshtml); 'sa': Silver/Gold page (NonConformancesSa.cshtml). */
  variant: NcVariant;
  ncCount: number;
  assessment: AssessmentReport;
  rounds: NonConformanceRound[];
  /** Silver/Gold: site assessment evidence photos (Name, SectionCode, RequirementCode, IsPdf, FileUrl). */
  saEvidencePhotos: Row[];
}

/** The values the API accepts (MsmeAssessment.Types in Zed.Main.Api). */
export const ASSESSMENT_TYPES = [
  'Bronze', 'Silver', 'Gold', 'BronzeSurveillance', 'SilverSurveillance', 'GoldSurveillance',
] as const;

/** Canonical spelling of a certification type from the URL, or null when these pages do not exist for it. */
export function assessmentType(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  return ASSESSMENT_TYPES.find((t) => t.toLowerCase() === v) ?? null;
}

/** Client for api/msme/assessment (Zed.Main.Api MsmeAssessmentReportController). Read-only. */
@Injectable({ providedIn: 'root' })
export class AssessmentApi {
  private readonly http = inject(HttpClient);

  basicInfo(certification: string): Observable<AssessmentReport> {
    return this.http.get<AssessmentReport>(`/api/msme/assessment/${encodeURIComponent(certification)}/basic-info`);
  }

  nonConformances(certification: string): Observable<NonConformanceReport> {
    return this.http.get<NonConformanceReport>(`/api/msme/assessment/${encodeURIComponent(certification)}/non-conformances`);
  }
}
