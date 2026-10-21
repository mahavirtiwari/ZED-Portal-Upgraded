import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

/** Fee row fields (AssessmentFee columns, as the old summary used them). */
export type FeeRow = Record<string, string | number | null>;

export interface PaymentOptions {
  certification: string;
  withReward: FeeRow | null;
  withoutReward: FeeRow;
  rewardAvailable: boolean;
  udyamPan: string | null;
}

export interface GstinResult {
  message: string;
  panMatches: boolean;
  gstinPan: string;
  udyamPan: string | null;
}

export interface CheckoutRequest {
  useReward: boolean;
  gstinApplicable: boolean;
  gstin: string | null;
  tdsDeductible: boolean;
  tds: '1.5' | '7.5' | null;
  tan: string | null;
}

export interface CheckoutResponse {
  status: 'paid' | 'gateway';
  gatewayUrl?: string;
  encRequest?: string;
  accessCode?: string;
}

/** Client for api/msme/payments (Zed.Main.Api MsmePaymentController). */
@Injectable({ providedIn: 'root' })
export class PaymentApi {
  private readonly http = inject(HttpClient);

  options(certification: string): Observable<PaymentOptions> {
    return this.http.get<PaymentOptions>(`/api/msme/payments/${encodeURIComponent(certification)}/options`);
  }

  verifyGstin(certification: string, gstin: string): Observable<GstinResult> {
    return this.http.post<GstinResult>('/api/msme/payments/gstin', { certification, gstin });
  }

  correctPan(certification: string, gstin: string, pan: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/msme/payments/pan', { certification, gstin, pan });
  }

  checkout(certification: string, req: CheckoutRequest): Observable<CheckoutResponse> {
    return this.http.post<CheckoutResponse>(`/api/msme/payments/${encodeURIComponent(certification)}/checkout`, req);
  }
}

/** Sends the browser to CCAvenue with the encrypted request (the old page did this with a hidden form). */
export function postToGateway(res: CheckoutResponse, doc: Document = document): void {
  const form = doc.createElement('form');
  form.method = 'post';
  form.action = res.gatewayUrl!;
  for (const [name, value] of [
    ['encRequest', res.encRequest!],
    ['access_code', res.accessCode!],
  ]) {
    const input = doc.createElement('input');
    input.type = 'hidden';
    input.name = name;
    input.value = value;
    form.appendChild(input);
  }
  doc.body.appendChild(form);
  form.submit();
}
