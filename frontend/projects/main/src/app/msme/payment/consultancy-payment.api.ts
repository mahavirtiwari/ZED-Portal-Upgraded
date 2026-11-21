import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { t } from '../../content/page-text';
import { LevelState } from '../handholding/handholding.api';
import { CheckoutRequest, CheckoutResponse, GstinResult, PaymentConfirmation, PaymentOptions } from './payment.api';

/** What each handholding milestone is (the legacy success page's wording; the Admin can change it). */
const MILESTONES: Record<number, () => string> = {
  1: () => t('msme.handholdingPayment.milestone1.text', 'Baseline Diagnostic Study and Handholding Action Plan'),
  2: () => t('msme.handholdingPayment.milestone2.text', 'Implementation & Progress Review 1'),
  3: () => t('msme.handholdingPayment.milestone3.text', 'Implementation & Progress Review 2'),
};

/** "Baseline Diagnostic Study and Handholding Action Plan" for milestone 1; null for anything else. */
export function milestoneTitle(milestone: number | null | undefined): string | null {
  return MILESTONES[milestone ?? 0]?.() ?? null;
}

/** 2026-11-17: the handholding payment's confirmation (ConsultancyConfirmationController): the certification one plus the milestone. */
export interface ConsultancyConfirmation extends PaymentConfirmation {
  milestone: number | null;
}

export interface ConsultancyOptions extends PaymentOptions {
  /** Milestone the payment is for (decided by the server). */
  milestone: number;
  /** Andhra Pradesh state subsidy row (StateAssessmentFee). */
  stateSubsidy: boolean;
  /** Milestone 1 charged for all three milestones (the schedule "pay all at milestone 1"). */
  coversAllMilestones?: boolean;
  /** Milestone 2 or 3 already paid at milestone 1: nothing to pay. */
  paidAtMilestone1?: boolean;
}

export interface ConsultancyCheckoutRequest extends CheckoutRequest {
  /** The milestone the page showed; the server refuses when another one is due. */
  milestone: number;
  /** 2026-11-21, milestone 1 only (required there): "Did any Consultant Organisation assist you?" */
  assistedByCo?: boolean | null;
  /** With Yes: the organisation's user id (one of consultantOrganisations). */
  assistedCoId?: string | null;
}

/** 2026-11-21: a Consultant Organisation the unit may name at the milestone 1 payment (active, purchase order not used up). */
export interface ConsultantOrganisation {
  userId: string;
  name: string;
}

/** Client for api/msme/consultancy-payments (Zed.Main.Api ConsultancyPaymentController). */
@Injectable({ providedIn: 'root' })
export class ConsultancyPaymentApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/msme/consultancy-payments';

  status(certification: string): Observable<LevelState> {
    return this.http.get<LevelState>(`${this.base}/${encodeURIComponent(certification)}/status`);
  }

  options(certification: string): Observable<ConsultancyOptions> {
    return this.http.get<ConsultancyOptions>(`${this.base}/${encodeURIComponent(certification)}/options`);
  }

  verifyGstin(certification: string, gstin: string): Observable<GstinResult> {
    return this.http.post<GstinResult>(`${this.base}/gstin`, { certification, gstin });
  }

  correctPan(certification: string, gstin: string, pan: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/pan`, { certification, gstin, pan });
  }

  /** The organisations for "Did any Consultant Organisation assist you?" (milestone 1 only; the server refuses otherwise). */
  consultantOrganisations(certification: string): Observable<ConsultantOrganisation[]> {
    return this.http.get<ConsultantOrganisation[]>(`${this.base}/${encodeURIComponent(certification)}/consultant-organisations`);
  }

  checkout(certification: string, req: ConsultancyCheckoutRequest): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${this.base}/${encodeURIComponent(certification)}/checkout`, req);
  }

  /** The level's latest milestone payment (404 when there is none, or it is not <code>milestone</code>'s). */
  confirmation(certification: string, milestone?: number | null): Observable<ConsultancyConfirmation> {
    return this.http.get<ConsultancyConfirmation>(`${this.base}/${encodeURIComponent(certification)}/confirmation`, { params: milestoneParam(milestone) });
  }

  /** The confirmation mail again, to the unit's registered e-mail (named in full in the answer). */
  emailCopy(certification: string, milestone?: number | null): Observable<{ sentTo: string }> {
    return this.http.post<{ sentTo: string }>(`${this.base}/${encodeURIComponent(certification)}/email-copy`, {}, { params: milestoneParam(milestone) });
  }
}

function milestoneParam(milestone: number | null | undefined): Record<string, number> {
  return milestone ? { milestone } : {};
}
