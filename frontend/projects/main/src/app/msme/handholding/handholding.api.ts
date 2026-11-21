import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';

export type Row = Record<string, string | number | boolean | null>;

/** 2026-11-16 (approved): ZED-X ('ZEDX') for Gold-certified units, besides Silver and Gold. */
export type HandholdingLevel = 'Silver' | 'Gold' | 'ZEDX';

export const HANDHOLDING_LEVELS: readonly HandholdingLevel[] = ['Silver', 'Gold', 'ZEDX'];

/** The name shown for a level. */
export function handholdingLevelName(level: HandholdingLevel): string {
  return level === 'ZEDX' ? 'ZED-X' : level;
}

/** What the server decided about a level (HandholdingEligibility.LevelState). */
export interface LevelState {
  certification: HandholdingLevel;
  enabled: boolean;
  milestonesStarted: number;
  /** Milestone the next payment is for (1–3). */
  nextMilestone: number;
  canPay: boolean;
  refusal: string | null;
  awaitingAcceptance: number | null;
}

export interface HandholdingSummary {
  msme: Row;
  basicInfo: Row;
  status: Row;
  levels: LevelState[];
}

/** Milestone titles of the old page (Silver and Gold name them differently; ZED-X takes Gold's). */
export const MILESTONE_TITLES: Record<HandholdingLevel, readonly string[]> = {
  Silver: [
    'Milestone 1: Baseline Diagnostic Study and Handholding Action Plan',
    'Milestone 2: Implementation & Progress Review 1',
    'Milestone 3: Implementation & Progress Review 2',
  ],
  Gold: ['Milestone 1: BASIC DIAGNOSTIC STUDY AND HANDHOLDING', 'Milestone 2: PROGRESS REVIEW 1', 'Milestone 3: PROGRESS REVIEW 2'],
  ZEDX: ['Milestone 1: BASIC DIAGNOSTIC STUDY AND HANDHOLDING', 'Milestone 2: PROGRESS REVIEW 1', 'Milestone 3: PROGRESS REVIEW 2'],
};

export function handholdingLevel(value: string | null | undefined): HandholdingLevel | null {
  return HANDHOLDING_LEVELS.find((l) => l.toLowerCase() === (value ?? '').trim().toLowerCase()) ?? null;
}

/** SP_CONSULTANCY_APP_MSME_STATUS column with the CertificationStatus of a milestone. */
export function completionColumn(level: HandholdingLevel, milestone: number): string {
  if (level === 'Gold') return `MilestoneCompletionStatusGold${milestone}`;
  return level === 'ZEDX' ? `MilestoneCompletionStatusZEDX${milestone}` : `MilestoneCompletionStatus${milestone}`;
}

/**
 * "Accept milestone n" (2026-11-21): Started = one payment for all milestones, the next milestone has started (no payment page);
 * Pay = the next milestone is paid on its payment page; Completed = all three milestones are done.
 */
export interface AcceptResponse {
  message: string;
  next: 'Completed' | 'Started' | 'Pay';
  nextMilestone: number | null;
}

/** Client for api/msme/handholding (Zed.Main.Api HandholdingController). */
@Injectable({ providedIn: 'root' })
export class HandholdingApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/msme/handholding';

  get(): Observable<HandholdingSummary> {
    return this.http.get<HandholdingSummary>(this.base);
  }

  acceptMilestone(certification: HandholdingLevel, milestone: number): Observable<AcceptResponse> {
    return this.http.post<AcceptResponse>(`${this.base}/accept-milestone`, { certification, milestone });
  }
}
