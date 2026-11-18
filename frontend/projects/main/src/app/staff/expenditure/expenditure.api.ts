import { HttpClient, HttpContext, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { ADMIN_PORTAL, AdminPortal } from '../admin-portal';

/**
 * 2026-11-18 (approved design "Expenditure monitoring"): the API of the Expenditure tab, the purchase orders, the monthly
 * invoices and Admin → Fees → Expenditure rates. On main, the Admin's "Consultant organisations" view reads the Consultancy
 * portal's API (`portal` = 'consultancy', through the Admin's hand-over).
 */
export type PayeeKind = 'Agency' | 'Consultant';
export type PoState = 'NoPo' | 'Open' | 'Low' | 'Stopped';
export type InvoiceStatus = 'Submitted' | 'Approved' | 'Returned';

export interface Option { code: string; name: string }

export interface ExpenditureCards {
  poCases: number;
  completed: number;
  rejected: number;
  surveillance: number;
  milestones: number;
  payable: number;
  approved: number;
}

export interface ExpenditureRow {
  partyId: string;
  partyName: string;
  level: string;
  levelName: string;
  poLabel: string | null;
  poCases: number;
  completed: number;
  rejected: number;
  surveillance: number;
  milestones: number;
  used: number;
  inProgress: number;
  balance: number | null;
  poState: PoState;
  payable: number;
  invoiced: number;
  outstanding: number;
}

export interface ExpenditureSummary {
  kind: PayeeKind;
  parties: Option[];
  levels: Option[];
  states: string[];
  cards: ExpenditureCards;
  rows: ExpenditureRow[];
}

export interface ExpenditureFilter {
  partyId?: string;
  level?: string;
  state?: string;
  from?: string;
  to?: string;
}

export interface ExpenditureCase {
  zedId: string;
  unitName: string | null;
  state: string | null;
  level: string;
  kind: string;
  milestone: number | null;
  countedOn: string | null;
  rate: number | null;
  /** A milestone that is its level's last: counted when the unit was certified (the others when the next one was paid). */
  lastMilestone?: boolean;
}

export interface Invoice {
  id: number;
  partyId: string;
  partyName: string;
  month: string;
  monthLabel: string;
  invoiceNo: string;
  invoiceDate: string;
  invoiceAmount: number;
  portalCompleted: number;
  portalRejected: number;
  portalSurveillance: number;
  portalMilestones: number;
  portalCases: number;
  portalAmount: number;
  gstPercent: number;
  portalTotal: number;
  difference: number;
  status: InvoiceStatus;
  remarks: string | null;
  submittedOn: string | null;
  reviewedBy: string | null;
  reviewedOn: string | null;
  erpExport: string | null;
  canReview: boolean;
}

export interface MonthFigures {
  month: string;
  completed: number;
  rejected: number;
  surveillance: number;
  milestones: number;
  amount: number;
  gst: number;
  total: number;
}

export interface RateLine {
  kind: string;
  level: string;
  levelName: string;
  milestone: number | null;
  rate: number | null;
  rateFrom: string | null;
  cases: number;
  amount: number;
}

export interface InvoiceDetail {
  invoice: Invoice;
  live: MonthFigures;
  liveDifference: number;
  lines: RateLine[];
}

export interface PoItem { id: number; poNumber: string; poDate: string; cases: number }

export interface PoLevel {
  level: string;
  name: string;
  cases: number;
  used: number;
  inProgress: number;
  left: number;
  percent: number;
  state: PoState;
  pos: PoItem[];
}

export interface PoView {
  partyId: string;
  partyName: string;
  canEdit: boolean;
  levels: PoLevel[];
  levelOptions: Option[];
}

export interface PoChange {
  id: number;
  level: string;
  levelName: string;
  type: 'Added' | 'Edited' | 'Amended' | 'NewPo';
  reason: string | null;
  casesBefore: number | null;
  casesAfter: number | null;
  details: string | null;
  by: string | null;
  on: string | null;
}

export interface PoInput { partyId: string; level: string; poNumber: string; poDate: string; cases: number | null }

export interface ReopenInput {
  partyId: string;
  level: string;
  reason: string;
  extraCases?: number | null;
  poNumber?: string;
  poDate?: string;
  cases?: number | null;
}

export interface MyMonth {
  month: string;
  label: string;
  completed: number;
  rejected: number;
  surveillance: number;
  milestones: number;
  cases: number;
  amount: number;
  gstPercent: number;
  total: number;
  invoice: Invoice | null;
  canUpload: boolean;
}

export interface MyInvoices { partyId: string; partyName: string; kind: PayeeKind; months: MyMonth[] }

export interface AgencyRateLevel { level: string; name: string; flow: string }
export interface ConsultantRateLevel { level: string; name: string; milestones: number }

export interface SetLevel {
  level: string;
  completed: number | null;
  rejected: number | null;
  surveillance: number | null;
  milestones: (number | null)[];
}

export interface RateSet {
  kind: PayeeKind;
  effectiveFrom: string;
  gstPercent: number;
  inForce: boolean;
  locked: boolean;
  savedBy: string | null;
  savedOn: string | null;
  levels: SetLevel[];
}

export interface RatesResponse {
  gstPercent: number;
  today: string;
  agencyLevels: AgencyRateLevel[];
  consultantLevels: ConsultantRateLevel[];
  sets: RateSet[];
}

export interface RateHistoryEntry {
  kind: PayeeKind;
  effectiveFrom: string;
  gstPercent: number;
  savedBy: string | null;
  savedOn: string | null;
  current: boolean;
  levels: SetLevel[];
}

export interface SaveRates {
  kind: PayeeKind;
  effectiveFrom: string;
  edit: boolean;
  gstPercent: number | null;
  levels: { level: string; completed?: number | null; rejected?: number | null; surveillance?: number | null; milestones?: (number | null)[] }[];
}

const BASE = '/api/staff/expenditure';

@Injectable({ providedIn: 'root' })
export class ExpenditureApi {
  private readonly http = inject(HttpClient);

  private ctx(portal?: AdminPortal | null): { context?: HttpContext } {
    return portal ? { context: new HttpContext().set(ADMIN_PORTAL, portal) } : {};
  }

  summary(f: ExpenditureFilter, portal?: AdminPortal | null): Observable<ExpenditureSummary> {
    return this.http.get<ExpenditureSummary>(`${BASE}/summary`, { params: params(f), ...this.ctx(portal) });
  }

  cases(f: ExpenditureFilter, portal?: AdminPortal | null): Observable<ExpenditureCase[]> {
    return this.http.get<ExpenditureCase[]>(`${BASE}/cases`, { params: params(f), ...this.ctx(portal) });
  }

  invoices(partyId: string | null, portal?: AdminPortal | null): Observable<Invoice[]> {
    return this.http.get<Invoice[]>(`${BASE}/invoices`, { params: params({ partyId: partyId ?? undefined }), ...this.ctx(portal) });
  }

  invoice(id: number, portal?: AdminPortal | null): Observable<InvoiceDetail> {
    return this.http.get<InvoiceDetail>(`${BASE}/invoices/${id}`, this.ctx(portal));
  }

  approve(id: number, remarks: string, portal?: AdminPortal | null): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/invoices/${id}/approve`, { remarks }, this.ctx(portal));
  }

  returnInvoice(id: number, remarks: string, portal?: AdminPortal | null): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/invoices/${id}/return`, { remarks }, this.ctx(portal));
  }

  invoicePdf(id: number, portal?: AdminPortal | null): Observable<Blob> {
    return this.http.get(`${BASE}/invoices/${id}/file`, { responseType: 'blob', ...this.ctx(portal) });
  }

  po(partyId: string, portal?: AdminPortal | null): Observable<PoView> {
    return this.http.get<PoView>(`${BASE}/po`, { params: params({ partyId }), ...this.ctx(portal) });
  }

  poHistory(partyId: string, portal?: AdminPortal | null): Observable<PoChange[]> {
    return this.http.get<PoChange[]>(`${BASE}/po/history`, { params: params({ partyId }), ...this.ctx(portal) });
  }

  addPo(req: PoInput): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/po`, req);
  }

  editPo(id: number, req: { poNumber: string; poDate: string; cases: number | null; reason?: string }): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${BASE}/po/${id}`, req);
  }

  reopenPo(req: ReopenInput): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/po/reopen`, req);
  }

  my(): Observable<MyInvoices> {
    return this.http.get<MyInvoices>(`${BASE}/my`);
  }

  upload(form: FormData): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${BASE}/my/invoices`, form);
  }

  rates(): Observable<RatesResponse> {
    return this.http.get<RatesResponse>('/api/staff/expenditure-rates');
  }

  rateHistory(): Observable<RateHistoryEntry[]> {
    return this.http.get<RateHistoryEntry[]>('/api/staff/expenditure-rates/history');
  }

  saveRates(req: SaveRates): Observable<MessageResponse> {
    return this.http.put<MessageResponse>('/api/staff/expenditure-rates', req);
  }
}

function params(f: object): HttpParams {
  let p = new HttpParams();
  for (const [k, v] of Object.entries(f)) if (typeof v === 'string' && v) p = p.set(k, v);
  return p;
}

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 });

/** "₹ 9,80,000" (Indian grouping). */
export function rupees(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `₹ ${INR.format(v)}`;
}

/** The headline cards' short form: "₹ 41.6 L", "₹ 2.3 Cr", else the full amount. */
export function rupeesShort(v: number): string {
  if (Math.abs(v) >= 1e7) return `₹ ${(v / 1e7).toFixed(1)} Cr`;
  if (Math.abs(v) >= 1e5) return `₹ ${(v / 1e5).toFixed(1)} L`;
  return rupees(v);
}

/** "2026-11-05" → "05 Nov 2026". */
export function shownDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return iso;
  return `${String(d).padStart(2, '0')} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
}

/** "2026-11-15" → "15-11-2026" (the dates of effect, as the Admin enters them). */
export function dmy(iso: string | null | undefined): string {
  if (!iso) return '—';
  const [y, m, d] = iso.slice(0, 10).split('-');
  return `${d}-${m}-${y}`;
}

/**
 * What a counted case is (the Cases pop-up and its export). 2026-11-18 (the user): milestone k counts when the MSME pays
 * milestone k+1; the level's last milestone when the unit is certified at the level.
 */
export function caseText(c: ExpenditureCase): string {
  if (c.kind === 'Milestone') {
    const m = c.milestone ?? 0;
    return c.lastMilestone
      ? `M${m} · counted when the unit was certified on ${shownDate(c.countedOn)}`
      : `M${m} · counted when M${m + 1} was paid on ${shownDate(c.countedOn)}`;
  }
  if (c.kind === 'Rejected') return 'Rejected after assessment';
  if (c.kind === 'Surveillance') return 'Surveillance visit';
  return 'Completed';
}

/** The PO pill: "Open", "9 left" (amber), "Stopped" (red), "No PO". */
export function poPill(state: PoState, left: number | null): { text: string; tone: 'is-active' | 'is-pending' | 'is-rejected' | 'is-inactive' } {
  switch (state) {
    case 'Stopped': return { text: 'Stopped', tone: 'is-rejected' };
    case 'Low': return { text: `${left ?? 0} left`, tone: 'is-pending' };
    case 'Open': return { text: 'Open', tone: 'is-active' };
    default: return { text: 'No PO', tone: 'is-inactive' };
  }
}

/** The invoice status pill. */
export function statusTone(status: InvoiceStatus): string {
  return status === 'Approved' ? 'is-active' : status === 'Returned' ? 'is-rejected' : 'is-pending';
}

/** A rate line as the review shows it: "41 completed × ₹ 3,000 (Bronze, from 01-11-2026)". */
export function rateLineText(l: RateLine): string {
  const what = l.kind === 'Milestone' ? `milestone ${l.milestone ?? ''}`.trim() : l.kind === 'Surveillance' ? 'surveillance' : l.kind.toLowerCase();
  const rate = l.rate === null ? 'no rate' : rupees(l.rate);
  return `${l.cases} ${what} × ${rate} (${l.levelName}${l.rateFrom ? ', from ' + dmy(l.rateFrom) : ''})`;
}
