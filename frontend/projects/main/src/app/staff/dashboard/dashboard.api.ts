import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

/** A row as the procedure named its columns (the API sends only the columns a page shows). */
export type Row = Record<string, string | number | boolean | null>;

export interface ListFilter {
  state?: string;
  certification?: string;
  size?: string;
  gender?: string;
}

export interface CountsFilter {
  state?: string;
  size?: string;
  socialCategory?: string;
  gender?: string;
}

export interface Counts {
  total: number;
  bronze: number;
  silver: number;
  gold: number;
}

export interface RegisteredMsmeQuery extends ListFilter {
  searchBy: string;
  search?: string;
  pageNo: number;
  pageSize: number;
}

export interface RegisteredMsmeList {
  rows: Row[];
  totalCounts: number;
  pageNo: number;
  pageSize: number;
}

export interface UpdatePaymentRequest {
  zedId: string;
  transactionId: string;
  certification: string;
  pgType: string;
  trackingId: string;
  bankRefNumber: string;
  bankCode: string;
  /** yyyy-MM-dd */
  paymentReceivedDate: string;
  gstNumber: string;
  paymentRemarks: string;
}

function params(values: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && v !== '') p = p.set(k, String(v));
  return p;
}

/** Endpoints of the staff dashboard pages (api/staff/dashboard). */
@Injectable({ providedIn: 'root' })
export class DashboardApi {
  private readonly http = inject(HttpClient);
  private readonly base = '/api/staff/dashboard';

  summary(): Observable<Row> {
    return this.http.get<Row>(this.base);
  }

  counts(filter: CountsFilter): Observable<Counts> {
    return this.http.get<Counts>(`${this.base}/counts`, { params: params(filter) });
  }

  registeredMsme(query: RegisteredMsmeQuery): Observable<RegisteredMsmeList> {
    return this.http.get<RegisteredMsmeList>(`${this.base}/registered-msme`, { params: params(query) });
  }

  resend(zedId: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/registered-msme/${encodeURIComponent(zedId)}/resend`, null);
  }

  disable(zedId: string, disableRemarks: string): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/registered-msme/${encodeURIComponent(zedId)}/disable`, { disableRemarks });
  }

  failedTransactions(filter: ListFilter): Observable<Row[]> {
    return this.http.get<Row[]>(`${this.base}/failed-transactions`, { params: params(filter) });
  }

  updatePayment(body: UpdatePaymentRequest): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${this.base}/failed-transactions/update-payment`, body);
  }

  paymentsReceived(filter: ListFilter): Observable<Row[]> {
    return this.http.get<Row[]>(`${this.base}/payments-received`, { params: params(filter) });
  }

  financialSupport(filter: ListFilter): Observable<Row[]> {
    return this.http.get<Row[]>(`${this.base}/financial-support`, { params: params(filter) });
  }
}
