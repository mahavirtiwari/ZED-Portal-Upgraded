import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { LevelState } from '../handholding/handholding.api';
import { CheckoutRequest, CheckoutResponse, GstinResult, PaymentOptions } from './payment.api';

export interface ConsultancyOptions extends PaymentOptions {
  /** Milestone the payment is for (decided by the server). */
  milestone: number;
  /** Andhra Pradesh state subsidy row (StateAssessmentFee). */
  stateSubsidy: boolean;
}

export interface ConsultancyCheckoutRequest extends CheckoutRequest {
  /** The milestone the page showed; the server refuses when another one is due. */
  milestone: number;
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

  checkout(certification: string, req: ConsultancyCheckoutRequest): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${this.base}/${encodeURIComponent(certification)}/checkout`, req);
  }
}
