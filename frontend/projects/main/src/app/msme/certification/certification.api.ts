import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { splitCertification } from '../shared/levels';

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

/** A level's code: Bronze, Silver, Gold, ZEDX (ZED-X) or a level the Admin added (2026-11-08), which works as ZED-X does. */
export type Level = string;

/** Which branch of the old page applies: certification, surveillance or handholding milestone. */
export type CertificationKind = 'bronze' | 'silverGold' | 'surveillance' | 'milestone';

/** The built-in values the API accepts (MsmeCertificationController.CertificationTypes); every level's own and surveillance too. */
export const CERTIFICATION_TYPES = [
  'Bronze', 'Silver', 'Gold', 'ZEDX',
  'BronzeSurveillance', 'SilverSurveillance', 'GoldSurveillance', 'ZEDXSurveillance',
  'SilverMilestone1', 'SilverMilestone2', 'SilverMilestone3',
  'GoldMilestone1', 'GoldMilestone2', 'GoldMilestone3',
] as const;

/**
 * Canonical spelling of a certification type from the URL, or null when it is not one: a level (the Admin's levels too,
 * Administration → Certification Levels) or its surveillance; the handholding milestones of Silver and Gold.
 */
export function canonicalCertification(value: string | null | undefined): string | null {
  const v = (value ?? '').toLowerCase();
  const known = CERTIFICATION_TYPES.find((t) => t.toLowerCase() === v);
  if (known) return known;
  const split = splitCertification(value);
  if (!split || split.suffix.startsWith('Milestone')) return null;
  return split.level + split.suffix;
}

export function certificationKind(certification: string): CertificationKind {
  if (certification.endsWith('Surveillance')) return 'surveillance';
  if (/Milestone\d$/.test(certification)) return 'milestone';
  if (certification === 'Bronze') return 'bronze';
  return 'silverGold';
}

/** "SilverMilestone2" → "Silver"; "BronzeSurveillance" → "Bronze"; "ZEDXSurveillance" → "ZEDX"; "PLATINUMSurveillance" → "PLATINUM". */
export function certificationLevel(certification: string): Level {
  return certification.replace(/(Surveillance|Milestone\d)$/, '') || 'Bronze';
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
