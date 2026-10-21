import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { CheckoutRequest, CheckoutResponse, GstinResult, PaymentOptions } from './payment.api';

/** What the unit chose when it paid for the certification (the old page pre-filled the form with it). */
export interface SurveillancePrefill {
  unitGstin: 'Yes' | 'No' | null;
  gstin: string | null;
  tdsDeductible: 'Yes' | 'No' | null;
  tds: '1.5' | '7.5' | null;
  tan: string | null;
}

export interface SurveillanceOptions extends PaymentOptions {
  prefill: SurveillancePrefill;
}

export interface SurveillanceStatus {
  certification: string;
  eligible: boolean;
}

/** Client for api/msme/surveillance-payments (Zed.Main.Api SurveillancePaymentController). */
@Injectable({ providedIn: 'root' })
export class SurveillancePaymentApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/msme/surveillance-payments';

  status(certification: string): Observable<SurveillanceStatus> {
    return this.http.get<SurveillanceStatus>(`${this.base}/${encodeURIComponent(certification)}/status`);
  }

  options(certification: string): Observable<SurveillanceOptions> {
    return this.http.get<SurveillanceOptions>(`${this.base}/${encodeURIComponent(certification)}/options`);
  }

  verifyGstin(certification: string, gstin: string): Observable<GstinResult> {
    return this.http.post<GstinResult>(`${this.base}/gstin`, { certification, gstin });
  }

  correctPan(certification: string, gstin: string, pan: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/pan`, { certification, gstin, pan });
  }

  checkout(certification: string, req: CheckoutRequest): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`${this.base}/${encodeURIComponent(certification)}/checkout`, req);
  }
}
