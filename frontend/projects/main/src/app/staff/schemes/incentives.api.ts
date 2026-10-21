import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';

export type Row = Record<string, string | number | boolean | null>;

export interface IncentiveFilter {
  state: string;
  certification: string;
  msmeSize: string;
  gender: string;
}

export interface UploadResult {
  message: string;
  inserted: number;
  /** The rows saved by this upload. */
  rows: Record<string, string | null>[];
  /** Rows that were already uploaded (same unit, application, approval, incentive, date and amount); not saved again. */
  skipped?: SkippedRow[];
}

export interface SkippedRow {
  row: number;
  udyamNo: string | null;
  uploadedOn: string | null;
}

export interface RowError {
  row: number;
  column: string;
  message: string;
}

export interface CatalogueItem {
  incentive: Row;
  hasDocument1: boolean;
  hasDocument2: boolean;
}

export interface IncentiveForm {
  incentiveType: string;
  incentive: string;
  details: string;
  ministryOrDepartment: string;
  contactPerson: string;
  webLink: string;
  email: string;
  mobileNo: string;
  videoLink: string;
  applicableForBronze: boolean;
  applicableForSilver: boolean;
  applicableForGold: boolean;
  activeStatus: boolean;
}

/** Client for api/staff/schemes/incentives and api/staff/schemes/incentive-master (Zed.Main.Api). */
@Injectable({ providedIn: 'root' })
export class IncentivesApi {
  private readonly http = inject(HttpClient);

  submissions(f: IncentiveFilter): Observable<Row[]> {
    let params = new HttpParams();
    for (const [k, v] of Object.entries(f)) if (v) params = params.set(k, v);
    return this.http.get<Row[]>('/api/staff/schemes/incentives/submissions', { params });
  }

  upload(file: File): Observable<UploadResult> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<UploadResult>('/api/staff/schemes/incentives/upload', form);
  }

  catalogue(type: string): Observable<CatalogueItem[]> {
    return this.http.get<CatalogueItem[]>('/api/staff/schemes/incentive-master', { params: new HttpParams().set('type', type) });
  }

  create(form: IncentiveForm): Observable<MessageResponse> {
    return this.http.post<MessageResponse>('/api/staff/schemes/incentive-master', form);
  }

  update(id: number, form: IncentiveForm): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`/api/staff/schemes/incentive-master/${id}`, form);
  }

  uploadDocument(id: number, n: 1 | 2, type: string, file: File): Observable<MessageResponse> {
    const form = new FormData();
    form.append('file', file, file.name);
    return this.http.post<MessageResponse>(`/api/staff/schemes/incentive-master/${id}/documents/${n}`, form, { params: new HttpParams().set('type', type) });
  }
}

/** State ids (Msme.StateId) of the legacy filter. */
export const STATES: { id: string; name: string }[] = [
  ['35', 'ANDAMAN AND NICOBAR ISLANDS'], ['28', 'ANDHRA PRADESH'], ['12', 'ARUNACHAL PRADESH'], ['18', 'ASSAM'], ['10', 'BIHAR'],
  ['4', 'CHANDIGARH'], ['22', 'CHHATTISGARH'], ['7', 'DELHI'], ['30', 'GOA'], ['24', 'GUJARAT'], ['6', 'HARYANA'], ['2', 'HIMACHAL PRADESH'],
  ['1', 'JAMMU AND KASHMIR'], ['20', 'JHARKHAND'], ['29', 'KARNATAKA'], ['32', 'KERALA'], ['37', 'LADAKH'], ['31', 'LAKSHADWEEP'],
  ['23', 'MADHYA PRADESH'], ['27', 'MAHARASHTRA'], ['14', 'MANIPUR'], ['17', 'MEGHALAYA'], ['15', 'MIZORAM'], ['13', 'NAGALAND'],
  ['21', 'ODISHA'], ['34', 'PUDUCHERRY'], ['3', 'PUNJAB'], ['8', 'RAJASTHAN'], ['11', 'SIKKIM'], ['33', 'TAMIL NADU'], ['36', 'TELANGANA'],
  ['38', 'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU'], ['16', 'TRIPURA'], ['9', 'UTTAR PRADESH'], ['5', 'UTTARAKHAND'], ['19', 'WEST BENGAL'],
].map(([id, name]) => ({ id, name }));

/** Incentive types of the legacy Admin menu. */
export const INCENTIVE_TYPES: { value: string; label: string }[] = [
  { value: 'Common', label: 'Ministry of MSME' },
  { value: 'Other', label: 'Other Incentives' },
  { value: 'Financial', label: 'Financial Institution' },
  ...STATES.map((s) => ({ value: s.name, label: s.name })).sort((a, b) => a.label.localeCompare(b.label)),
];
