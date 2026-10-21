import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

/** Rows keep the procedure's column names (EnterpriseName, BronzeStatus, Nc1Raised, ...). */
export type Row = Record<string, string | number | boolean | null>;

export interface CertificationData {
  /** Canonical spelling, e.g. "SilverMilestone1". */
  certification: string;
  msme: Row;
  basicInfo: Row;
  certStatus: Row;
  /** MsmeHistory descriptions by status type (ApplicationReceived, ScheduledOn, Nc1Raised, ...). */
  status: Row;
}

export type Level = 'Bronze' | 'Silver' | 'Gold';

/** Which branch of the old page applies: certification, surveillance or handholding milestone. */
export type CertificationKind = 'bronze' | 'silverGold' | 'surveillance' | 'milestone';

/** The values the API accepts (same list as MsmeCertificationController.CertificationTypes). */
export const CERTIFICATION_TYPES = [
  'Bronze', 'Silver', 'Gold',
  'BronzeSurveillance', 'SilverSurveillance', 'GoldSurveillance',
  'SilverMilestone1', 'SilverMilestone2', 'SilverMilestone3',
  'GoldMilestone1', 'GoldMilestone2', 'GoldMilestone3',
] as const;

/** Canonical spelling of a certification type from the URL, or null when it is not one. */
export function canonicalCertification(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  return CERTIFICATION_TYPES.find((t) => t.toLowerCase() === v) ?? null;
}

export function certificationKind(certification: string): CertificationKind {
  if (certification === 'Bronze') return 'bronze';
  if (certification === 'Silver' || certification === 'Gold') return 'silverGold';
  if (certification.endsWith('Surveillance')) return 'surveillance';
  return 'milestone';
}

/** "SilverMilestone2" → "Silver"; "BronzeSurveillance" → "Bronze". */
export function certificationLevel(certification: string): Level {
  return certification.startsWith('Gold') ? 'Gold' : certification.startsWith('Silver') ? 'Silver' : 'Bronze';
}

/** "GoldMilestone3" → 3; 0 for other types. */
export function milestoneNumber(certification: string): number {
  const m = /Milestone(\d)$/.exec(certification);
  return m ? Number(m[1]) : 0;
}

/**
 * "Avail Incentives" link: the address SP_MSME_GET_DETAILS builds from UrlsMasterData (old portal's
 * Incentive/Details page), or the same page on the configured old portal when the table is empty.
 */
/** The public incentive list of this level (and the unit's state), now in this portal. */
export function incentiveUrl(data: CertificationData | null): string {
  if (!data) return '';
  const q = new URLSearchParams({ ct: certificationLevel(data.certification) });
  const state = String(data.msme['StateId'] ?? '');
  if (state) q.set('id', state);
  return `/incentives?${q}`;
}

/** Client for api/msme/certifications (Zed.Main.Api MsmeCertificationController). */
@Injectable({ providedIn: 'root' })
export class CertificationApi {
  private readonly http = inject(HttpClient);

  get(certification: string): Observable<CertificationData> {
    return this.http.get<CertificationData>(`/api/msme/certifications/${encodeURIComponent(certification)}`);
  }
}
