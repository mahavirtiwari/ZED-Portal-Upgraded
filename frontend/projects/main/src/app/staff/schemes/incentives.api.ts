import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { MessageResponse } from '@zed/shared';
import { onStates } from '../../msme/shared/states';
import { t } from '../../content/page-text';

export type Row = Record<string, string | number | boolean | null>;

export interface IncentiveFilter {
  state: string;
  certification: string;
  msmeSize: string;
  gender: string;
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

export type IncentiveActivity = 'Manufacturing' | 'Services' | 'Both';

export const INCENTIVE_ACTIVITIES: { value: IncentiveActivity; label: string }[] = [
  { value: 'Manufacturing', label: 'Manufacturing' }, { value: 'Services', label: 'Services' }, { value: 'Both', label: 'Both' },
];

/** The activity saved on an incentive (NULL = both). */
export function incentiveActivity(value: unknown): IncentiveActivity {
  const v = String(value ?? '').trim().toLowerCase();
  return v.startsWith('manu') ? 'Manufacturing' : v.startsWith('serv') ? 'Services' : 'Both';
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
  /** 2026-11-16 (migration 0091): ZED-X (Export) certified units. */
  applicableForZEDX: boolean;
  /** 2026-11-16 (migration 0091): Manufacturing, Services or Both (the MSMEs by their Udyam activity). */
  applicableActivity: IncentiveActivity;
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
  applicableForZEDX?: boolean;
  applicableActivity?: string | null;
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

/** State ids (Msme.StateId) of the legacy filter: the LG Directory masters (2026-11-08). */
export const STATES: { id: string; name: string }[] = [];
onStates((list) => STATES.splice(0, STATES.length, ...list.map((s) => ({ id: s.code, name: s.name }))));

/**
 * The four groups of the Admin's Incentives menu (V4, as the LEAN portal's stakeholders). An incentive's IncentiveType
 * is the group's type, or the state's name for State Government.
 */
export type IncentiveGroupKey = 'ministry' | 'state' | 'financial' | 'others';

export interface IncentiveGroup {
  key: IncentiveGroupKey;
  /** The group's name as the code knows it (the Incentives menu's entry); the wording shown is groupText(key).label. */
  label: string;
  /** IncentiveType of the group; null for State Government (the state's name). */
  type: string | null;
}

export const INCENTIVE_GROUPS: IncentiveGroup[] = [
  { key: 'ministry', label: 'Ministry of MSME', type: 'Common' },
  { key: 'state', label: 'State Government', type: null },
  { key: 'financial', label: 'Financial Institution', type: 'Financial' },
  { key: 'others', label: 'Others', type: 'Other' },
];

/** The wording of a group on the incentive pages. */
export interface IncentiveGroupText {
  label: string;
  title: string;
  subtitle: string;
  createSubtitle: string;
  /** Label of MinistryOrDepartment in this group. */
  department: string;
  departmentHint: string;
  /** The MSME dashboard card that lists the group's incentives (the MSME dashboard's own wording, msme.dashboard.stakeholder.*). */
  card: string;
}

/**
 * 2026-11-19 ("All page wording"): the wording of a group is the Admin's (Texts → Page wording, staff.incentives.group.*)
 * or the standard one written here; read it where it is shown (a computed or template), the group's key stays the code value.
 */
export function groupText(key: IncentiveGroupKey): IncentiveGroupText {
  switch (key) {
    case 'ministry':
      return {
        label: t('staff.incentives.group.ministry.label', 'Ministry of MSME'),
        title: t('staff.incentives.group.ministry.title', 'Ministry of MSME Incentives'),
        subtitle: t('staff.incentives.group.ministry.sub', 'Central schemes administered by the Ministry of MSME and the Office of DC (MSME)'),
        createSubtitle: t('staff.incentives.group.ministry.createSub', 'Add a central scheme administered by the Ministry of MSME or the Office of DC (MSME)'),
        department: t('staff.incentives.group.ministry.departmentLabel', 'Administering Department'),
        departmentHint: t('staff.incentives.group.ministry.departmentPlaceholder', 'e.g. Office of DC (MSME)'),
        card: t('msme.dashboard.stakeholder.msme.title', 'Ministry of MSME'),
      };
    case 'state':
      return {
        label: t('staff.incentives.group.state.label', 'State Government'),
        title: t('staff.incentives.group.state.title', 'State Government Incentives'),
        subtitle: t('staff.incentives.group.state.sub', 'Benefits notified by State Governments and Union Territory administrations'),
        createSubtitle: t('staff.incentives.group.state.createSub', 'Add a benefit notified by a State Government or Union Territory'),
        department: t('staff.incentives.group.state.departmentLabel', 'State Department'),
        departmentHint: t('staff.incentives.group.state.departmentPlaceholder', 'e.g. Department of Industries'),
        card: t('msme.dashboard.stakeholder.states.title', 'States/UTs'),
      };
    case 'financial':
      return {
        label: t('staff.incentives.group.financial.label', 'Financial Institution'),
        title: t('staff.incentives.group.financial.title', 'Financial Institution Incentives'),
        subtitle: t('staff.incentives.group.financial.sub', 'Credit and fee benefits offered by banks and financial institutions'),
        createSubtitle: t('staff.incentives.group.financial.createSub', 'Add a credit or fee benefit offered by a bank or financial institution'),
        department: t('staff.incentives.group.financial.departmentLabel', 'Financial Institution'),
        departmentHint: t('staff.incentives.group.financial.departmentPlaceholder', 'e.g. SIDBI'),
        card: t('msme.dashboard.stakeholder.financial.title', 'Financial Institutions'),
      };
    default:
      return {
        label: t('staff.incentives.group.others.label', 'Others'),
        title: t('staff.incentives.group.others.title', 'Other Incentives'),
        subtitle: t('staff.incentives.group.others.sub', 'Support offered by agencies outside the categories above'),
        createSubtitle: t('staff.incentives.group.others.createSub', 'Add support offered by an agency outside the categories above'),
        department: t('staff.incentives.group.others.departmentLabel', 'Issuing Agency'),
        departmentHint: t('staff.incentives.group.others.departmentPlaceholder', 'e.g. National Small Industries Corporation'),
        card: t('msme.dashboard.stakeholder.other.title', 'Other Incentives'),
      };
  }
}

/** Manufacturing, Services or Both as shown (the value stays the code). */
export function activityText(value: IncentiveActivity): string {
  return value === 'Manufacturing' ? t('staff.incentives.activity.manufacturing', 'Manufacturing')
    : value === 'Services' ? t('staff.incentives.activity.services', 'Services') : t('staff.incentives.activity.both', 'Both');
}

/** The group of an IncentiveType (a state's name: State Government). */
export function groupOfType(type: string): IncentiveGroup {
  return INCENTIVE_GROUPS.find((g) => g.type === type) ?? INCENTIVE_GROUPS.find((g) => g.key === 'state')!;
}
