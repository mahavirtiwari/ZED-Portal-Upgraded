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
  /** Where it appears: its own card on the MSME dashboard, or inside its stakeholder card (the default). */
  displayOn: IncentiveDisplay;
  /** The coloured line of its dashboard card (e.g. "Rs. 5,000/-"). */
  cardHighlight: string;
}

export type IncentiveDisplay = 'Dashboard' | 'Card';

/** A built-in card of "My Incentives" on the MSME dashboard (its buttons are the portal's own). */
export interface BuiltInCard {
  id: number;
  card: string;
  title: string | null;
  highlight: string | null;
  details: string | null;
  active: boolean;
}

/** An incentive of a stakeholder group that has its own card on the MSME dashboard. */
export interface DashboardIncentive {
  id: number;
  incentiveType: string;
  title: string | null;
  highlight: string | null;
  active: boolean;
  applicableForBronze: boolean;
  applicableForSilver: boolean;
  applicableForGold: boolean;
}

export interface DashboardCards {
  builtIn: BuiltInCard[];
  incentives: DashboardIncentive[];
}

export interface BuiltInCardForm {
  title: string;
  highlight: string;
  details: string;
  active: boolean;
}

/** The new incentive's Id (null when the server could not find it again). */
export interface IncentiveSaved extends MessageResponse {
  id: number | null;
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

  create(form: IncentiveForm): Observable<IncentiveSaved> {
    return this.http.post<IncentiveSaved>('/api/staff/schemes/incentive-master', form);
  }

  update(id: number, form: IncentiveForm): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`/api/staff/schemes/incentive-master/${id}`, form);
  }

  dashboardCards(): Observable<DashboardCards> {
    return this.http.get<DashboardCards>('/api/staff/schemes/incentive-master/dashboard');
  }

  saveBuiltInCard(card: string, form: BuiltInCardForm): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`/api/staff/schemes/incentive-master/dashboard/${encodeURIComponent(card)}`, form);
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

/**
 * The four groups of the Admin's Incentives menu (V4, as the LEAN portal's stakeholders). An incentive's IncentiveType
 * is the group's type, or the state's name for State Government.
 */
export type IncentiveGroupKey = 'ministry' | 'state' | 'financial' | 'others';

export interface IncentiveGroup {
  key: IncentiveGroupKey;
  label: string;
  /** IncentiveType of the group; null for State Government (the state's name). */
  type: string | null;
  title: string;
  subtitle: string;
  createSubtitle: string;
  /** Label of MinistryOrDepartment in this group. */
  department: string;
  departmentHint: string;
}

export const INCENTIVE_GROUPS: IncentiveGroup[] = [
  {
    key: 'ministry', label: 'Ministry of MSME', type: 'Common', title: 'Ministry of MSME Incentives',
    subtitle: 'Central schemes administered by the Ministry of MSME and the Office of DC (MSME)',
    createSubtitle: 'Add a central scheme administered by the Ministry of MSME or the Office of DC (MSME)',
    department: 'Administering Department', departmentHint: 'e.g. Office of DC (MSME)',
  },
  {
    key: 'state', label: 'State Government', type: null, title: 'State Government Incentives',
    subtitle: 'Benefits notified by State Governments and Union Territory administrations',
    createSubtitle: 'Add a benefit notified by a State Government or Union Territory',
    department: 'State Department', departmentHint: 'e.g. Department of Industries',
  },
  {
    key: 'financial', label: 'Financial Institution', type: 'Financial', title: 'Financial Institution Incentives',
    subtitle: 'Credit and fee benefits offered by banks and financial institutions',
    createSubtitle: 'Add a credit or fee benefit offered by a bank or financial institution',
    department: 'Financial Institution', departmentHint: 'e.g. SIDBI',
  },
  {
    key: 'others', label: 'Others', type: 'Other', title: 'Other Incentives',
    subtitle: 'Support offered by agencies outside the categories above',
    createSubtitle: 'Add support offered by an agency outside the categories above',
    department: 'Issuing Agency', departmentHint: 'e.g. National Small Industries Corporation',
  },
];

/** The group of an IncentiveType (a state's name: State Government). */
export function groupOfType(type: string): IncentiveGroup {
  return INCENTIVE_GROUPS.find((g) => g.type === type) ?? INCENTIVE_GROUPS.find((g) => g.key === 'state')!;
}
