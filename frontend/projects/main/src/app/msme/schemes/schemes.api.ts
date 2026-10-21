import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';

export type Row = Record<string, string | number | boolean | null>;

/** The unit panel (SP_MSME_GET_DETAILS columns) shown on the left of the scheme pages. */
export type UnitPanel = Row;

/** A document as listed by the API (own files only, served by api/msme/schemes/{fa|tu}/files/...). */
export interface SchemeDocument {
  fileName: string;
  type: string | null;
  timeStamp: string | null;
  isPdf: boolean;
  url: string;
}

export interface SchemeAccount {
  accountNo: string;
  confirmAccountNo: string;
  ifscCode: string;
  branchAddress: string;
  bankName: string;
}

export interface DocumentRef {
  fileName: string;
  type: string;
}

// ----- financial assistance -----

export interface FaApplication {
  certification: string;
  details: Row;
  documents: SchemeDocument[];
}

export interface FaPage {
  unit: UnitPanel;
  canApply: boolean;
  message: string | null;
  certification: string | null;
  applications: FaApplication[];
}

export interface FaSubmission {
  categoryOfCertificate: string;
  nameOfCertficate: string;
  certificationAgency: string;
  certficateNumber: string;
  dateOfIssue: string;
  validityOfCertificate: number | null;
  anyOtherInformation: string;
  invoiceNo: string;
  invoiceBillDate: string;
  amountPaid: number | null;
  modeOfPayment: string;
  account: SchemeAccount;
  documents: DocumentRef[];
  declaration: boolean;
}

export interface FaSubmitResult {
  message: string;
  amountPaid: number;
  eligibleAmount: number;
}

// ----- technology upgradation -----

export interface TuTechnology {
  code: string;
  sNo: number | null;
  name: string;
  description: string | null;
  eligibleSubsidyPer: number | null;
  submitted: boolean;
  details: Row | null;
  documents: SchemeDocument[];
}

export interface TuPage {
  unit: UnitPanel;
  canApply: boolean;
  message: string | null;
  certification: string | null;
  /** Earliest purchase/invoice date (yyyy-MM-dd), from the days since certification. */
  minDate: string | null;
  technologies: TuTechnology[];
  totalAmount: number;
  eligibleTotal: number;
}

export interface TuTechnologySubmission {
  nameOfTheManufaturer: string;
  makeOrModelName: string;
  dateOfPurchase: string;
  agencyOrSupplier: string;
  invoiceNo: string;
  invoiceBillDate: string;
  amountPaid: number | null;
  modeOfPayment: string;
  documents: DocumentRef[];
}

export interface TuSubmission {
  account: SchemeAccount;
  documents: DocumentRef[];
  declaration: boolean;
}

// ----- public incentives -----

export interface Incentive {
  id: number;
  ministryOrDepartment: string | null;
  incentive: string | null;
  details: string | null;
  contactPerson: string | null;
  email: string | null;
  mobileNo: string | null;
  webLink: string | null;
  videoLink: string | null;
  document1: string | null;
  document2: string | null;
}

export interface IncentiveDetails {
  certification: string | null;
  state: number | null;
  common: Incentive[];
  states: Incentive[];
  other: Incentive[];
  financial: Incentive[];
  financialDepartments: string[];
}

export interface IncentiveSubmission {
  PUnitName: string | null;
  PStateName: string | null;
  Certification: string | null;
  ServiceName: string | null;
  IncentiveName: string | null;
  DataFrom: string | null;
}

/** Client for api/msme/schemes/* (MsmeFinancialAssistanceController, MsmeTechnologyUpgradationController) and api/public/incentives. */
@Injectable({ providedIn: 'root' })
export class SchemesApi {
  private readonly http = inject(HttpClient);

  faPage(): Observable<FaPage> {
    return this.http.get<FaPage>('/api/msme/schemes/fa');
  }

  upload(scheme: 'fa' | 'tu', type: string, file: File): Observable<SchemeDocument> {
    const form = new FormData();
    form.append('type', type);
    form.append('file', file, file.name);
    return this.http.post<SchemeDocument>(`/api/msme/schemes/${scheme}/documents`, form);
  }

  submitFa(body: FaSubmission): Observable<FaSubmitResult> {
    return this.http.post<FaSubmitResult>('/api/msme/schemes/fa', body);
  }

  tuPage(): Observable<TuPage> {
    return this.http.get<TuPage>('/api/msme/schemes/tu');
  }

  submitTechnology(code: string, body: TuTechnologySubmission): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`/api/msme/schemes/tu/technologies/${encodeURIComponent(code)}`, body);
  }

  submitTu(body: TuSubmission): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/msme/schemes/tu', body);
  }

  incentives(ct: string, state: string): Observable<IncentiveDetails> {
    let params = new HttpParams();
    if (ct) params = params.set('ct', ct);
    if (state) params = params.set('id', state);
    return this.http.get<IncentiveDetails>('/api/public/incentives', { params });
  }

  incentiveSubmissions(state: string, ct: string, msmeSize: string): Observable<IncentiveSubmission[]> {
    let params = new HttpParams();
    if (state) params = params.set('id', state);
    if (ct) params = params.set('ct', ct);
    if (msmeSize) params = params.set('msmeSize', msmeSize);
    return this.http.get<IncentiveSubmission[]>('/api/public/incentives/submissions', { params });
  }
}

/** Uploads accepted by the API (checked again there, by content). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function uploadProblem(file: File): string | null {
  if (file.size > MAX_UPLOAD_BYTES) return 'Please upload document less than 5 MB.';
  if (file.type !== 'application/pdf' && !file.type.startsWith('image/')) return 'Please upload valid document (PDF / JPG / PNG).';
  return null;
}

/** Stored dates are MM/dd/yyyy (the old date picker); date inputs need yyyy-MM-dd. */
export function toInputDate(value: unknown): string {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(value ?? '').trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : '';
}

export function todayIso(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Indian digit grouping with two decimals (the legacy formatIndianCurrency). */
export function inr(amount: unknown): string {
  const n = Number(amount);
  if (amount === null || amount === undefined || amount === '' || typeof amount === 'boolean' || Number.isNaN(n)) return '';
  return n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** The 38 states/UTs of the incentive filters (Msme.StateId codes). */
export const STATES: ReadonlyArray<readonly [string, string]> = [
  ['35', 'ANDAMAN AND NICOBAR ISLANDS'], ['28', 'ANDHRA PRADESH'], ['12', 'ARUNACHAL PRADESH'], ['18', 'ASSAM'], ['10', 'BIHAR'],
  ['4', 'CHANDIGARH'], ['22', 'CHHATTISGARH'], ['7', 'DELHI'], ['30', 'GOA'], ['24', 'GUJARAT'], ['6', 'HARYANA'],
  ['2', 'HIMACHAL PRADESH'], ['1', 'JAMMU AND KASHMIR'], ['20', 'JHARKHAND'], ['29', 'KARNATAKA'], ['32', 'KERALA'], ['37', 'LADAKH'],
  ['31', 'LAKSHADWEEP'], ['23', 'MADHYA PRADESH'], ['27', 'MAHARASHTRA'], ['14', 'MANIPUR'], ['17', 'MEGHALAYA'], ['15', 'MIZORAM'],
  ['13', 'NAGALAND'], ['21', 'ODISHA'], ['34', 'PUDUCHERRY'], ['3', 'PUNJAB'], ['8', 'RAJASTHAN'], ['11', 'SIKKIM'], ['33', 'TAMIL NADU'],
  ['36', 'TELANGANA'], ['38', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'], ['16', 'TRIPURA'], ['9', 'UTTAR PRADESH'],
  ['5', 'UTTARAKHAND'], ['19', 'WEST BENGAL'],
];
