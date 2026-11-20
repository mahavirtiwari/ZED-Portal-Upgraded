import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { t } from '../../content/page-text';
import { levelName } from '../shared/levels';
import { SchemeAccount, UnitPanel } from '../schemes/schemes.api';

/** Where a unit stands with a scheme (MsmeIncentiveSchemesController, ApplicantState). */
export type SchemeState = 'locked' | 'open' | 'progress' | 'onhold' | 'availed';

export interface SchemeGrade {
  sharePercent: number;
  maxAmount: number;
}

/** A dashboard tile of a scheme. */
export interface SchemeTile {
  code: string;
  title: string;
  highlight: string | null;
  details: string | null;
  icon: string;
  state: SchemeState;
  /** Why it is locked: notEligible, financialBlocked, notCertified, suspended, levelNotCovered, handholding, notGraded, legacyInProgress, closed. */
  note: string | null;
  /** The server's sentence for a locked scheme (the standard wording of the note). */
  message: string | null;
  applicationId: number | null;
  status: string | null;
  level: string | null;
  grade: SchemeGrade | null;
  activationMode: string;
  activationLevels: string[];
}

/** GET api/msme/incentive-schemes. */
export interface SchemesDashboard {
  schemes: SchemeTile[];
  /**
   * The Technology Upgradation card: direct = without the consultant's recommendation, through the scheme; the scheme's tile
   * (also while a direct application is not final after the card went back to the recommendation); legacy = an application of
   * the consultant-recommended flow is in progress (the old page).
   */
  tu: { direct: boolean; scheme: SchemeTile | null; legacy?: boolean };
  /** 2026-11-20: the Financial Assistance card opens the built-in scheme FA; legacy = an application made before is in progress (the old page). */
  fa: { scheme: SchemeTile | null; legacy: boolean };
}

export type FieldType = 'text' | 'longtext' | 'number' | 'amount' | 'date' | 'choice' | 'multichoice' | 'yesno' | 'copy' | 'document' | 'photo';

export interface FormField {
  key: string;
  label: string;
  help?: string | null;
  type: FieldType;
  required: boolean;
  assessorChecks?: boolean;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  dateMin?: string | null;
  dateMax?: string | null;
  options?: string[];
  copyOf?: string | null;
  isClaim?: boolean;
  maxFiles?: number | null;
  /** The value cannot repeat across the unit's other applications of the scheme. */
  unique?: boolean;
}

export interface PickSource {
  kind: 'Technologies' | 'Options';
  label: string;
  options?: string[];
  sectorFilter?: boolean;
  noRepeat: boolean;
}

export interface FormSection {
  key: string;
  title: string;
  help?: string | null;
  repeating: boolean;
  minItems: number;
  maxItems: number;
  pick?: PickSource | null;
  fields: FormField[];
}

export interface DocumentRule {
  kind: string;
  count: number;
  fields: string[];
  message: string | null;
}

export interface SchemeBlocks {
  disclaimer: boolean;
  instructions: boolean;
  unitConfirm: boolean;
  bankAccount: boolean;
  declaration: boolean;
}

export interface SchemeInfo {
  code: string;
  name: string;
  card: { title: string; highlight?: string | null; details?: string | null; icon: string };
  blocks: SchemeBlocks;
  sections: FormSection[];
  rules: DocumentRule[];
  grading: { mode: string; rows: { key: string; sharePercent: number; maxAmount: number }[] };
  activationMode: string;
  activationLevels: string[];
  correctionRounds: number;
  correctionDays: number;
  /** The scheme's own texts (plain text), or null: the global wording of Admin → Texts. */
  disclaimer?: string | null;
  instructions?: string | null;
  declaration?: string | null;
}

export interface FormItem {
  pick?: string | null;
  pickName?: string | null;
  values: Record<string, string | null>;
  saved: boolean;
}

export interface FormAnswers {
  sections: Record<string, FormItem[]>;
}

export interface SchemeApplication {
  id: number;
  status: string;
  level: string | null;
  answers: FormAnswers;
  /** During a correction round: the answers / documents found not valid ("{section}/{item}/{field}") with the remarks. */
  checks: { path: string; remarks: string | null }[];
  claimAmount: number;
  eligibleAmount: number;
  approvedAmount: number | null;
  sharePercent: number | null;
  maxAmount: number | null;
  correctionRound: number | null;
  correctionDueOn: string | null;
  correctionOpen: boolean;
  submittedOn: string | null;
  decidedOn: string | null;
  reason: string | null;
  /** The applicant's sentence for a hold (never the staff's stored reason). */
  holdReason: string | null;
  /** While on hold: suspended, withdrawn or other (the page words it through Admin → Texts). */
  holdKind?: 'suspended' | 'withdrawn' | 'other' | null;
  account: { accountNo: string | null; ifscCode: string | null; branchAddress: string | null; bankName: string | null } | null;
}

export interface PickEntry {
  code: string;
  name: string;
  description: string | null;
}

/** GET api/msme/incentive-schemes/{code}. */
export interface SchemePage {
  scheme: SchemeInfo;
  unit: UnitPanel;
  window: { level: string; certRef: string; openedOn: string | null; grade: SchemeGrade | null } | null;
  state: SchemeState;
  note: string | null;
  canApply: boolean;
  message: string | null;
  application: SchemeApplication | null;
  picks: Record<string, PickEntry[]>;
  history: { id: number; date: string | null; status: string; level: string | null; amount: number | null; reason: string | null }[];
}

export interface SchemeUpload {
  fileName: string;
  isPdf: boolean;
  url: string;
}

export interface SchemeSubmission {
  account: SchemeAccount | null;
  cheque: string[];
  unitConfirmed: boolean;
  declaration: boolean;
}

/** The bank block's cheque in the answers and checks (ApplicantForm.BankSection / ChequeField). */
export const BANK_SECTION = '_bank';
export const CHEQUE_FIELD = 'cheque';
export const ACCOUNT_FIELD = 'account';

/** Client for api/msme/incentive-schemes (MsmeIncentiveSchemesController). */
@Injectable({ providedIn: 'root' })
export class IncentiveSchemesApi {
  private readonly http = inject(HttpClient);

  private url(code: string, rest = ''): string {
    return `/api/msme/incentive-schemes/${encodeURIComponent(code)}${rest}`;
  }

  dashboard(): Observable<SchemesDashboard> {
    return this.http.get<SchemesDashboard>('/api/msme/incentive-schemes');
  }

  page(code: string): Observable<SchemePage> {
    return this.http.get<SchemePage>(this.url(code));
  }

  draft(code: string): Observable<SchemePage> {
    return this.http.post<SchemePage>(this.url(code, '/draft'), {});
  }

  saveSection(code: string, section: string, values: Record<string, string | null>): Observable<SchemePage> {
    return this.http.put<SchemePage>(this.url(code, `/sections/${encodeURIComponent(section)}`), { values });
  }

  saveItem(code: string, section: string, index: number, pick: string | null, values: Record<string, string | null>): Observable<SchemePage> {
    return this.http.put<SchemePage>(this.url(code, `/sections/${encodeURIComponent(section)}/items/${index}`), { pick, values });
  }

  removeItem(code: string, section: string, index: number): Observable<SchemePage> {
    return this.http.delete<SchemePage>(this.url(code, `/sections/${encodeURIComponent(section)}/items/${index}`));
  }

  upload(code: string, section: string, item: number, field: string, file: File): Observable<SchemeUpload> {
    const form = new FormData();
    form.append('section', section);
    form.append('item', String(item));
    form.append('field', field);
    form.append('file', file, file.name);
    return this.http.post<SchemeUpload>(this.url(code, '/documents'), form);
  }

  submit(code: string, body: SchemeSubmission): Observable<SchemePage> {
    return this.http.post<SchemePage>(this.url(code, '/submit'), body);
  }

  correction(code: string, body: { account: SchemeAccount | null; cheque: string[] | null }): Observable<SchemePage> {
    return this.http.post<SchemePage>(this.url(code, '/correction'), body);
  }

  fileUrl(code: string, name: string): string {
    return this.url(code, `/files/${encodeURIComponent(name)}`);
  }
}

/** The stored file names of a document value (a JSON list). */
export function filesOf(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const list = JSON.parse(value) as unknown;
    return Array.isArray(list) ? list.filter((n): n is string => typeof n === 'string' && !!n) : [];
  } catch {
    return [];
  }
}

/** The claim of the answers: the claim amounts of every saved item (as FormAnswers.Claim on the server). */
export function claimOf(sections: FormSection[], answers: FormAnswers): number {
  let total = 0;
  for (const s of sections) {
    const keys = s.fields.filter((f) => f.isClaim).map((f) => f.key);
    for (const item of answers.sections[s.key] ?? []) {
      if (s.repeating && !item.saved) continue;
      for (const k of keys) {
        const v = Number(item.values[k]);
        if (item.values[k] && !Number.isNaN(v)) total += v;
      }
    }
  }
  return Math.round(total * 100) / 100;
}

/** Eligible = share % of the claim (whole rupees), at most the cap (SchemeEligibility.Eligible). */
export function eligibleOf(claim: number, grade: SchemeGrade | null | undefined): number {
  if (!grade) return 0;
  return Math.min(Math.round(Math.trunc(claim) * grade.sharePercent) / 100, grade.maxAmount);
}

/** A date bound of a field as yyyy-MM-dd (today, certified, days:N, date:yyyy-MM-dd), or '' when none. */
export function dateBound(bound: string | null | undefined, certified: string | null | undefined, latest: boolean, today = new Date()): string {
  if (!bound) return '';
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  if (bound === 'today') return iso(today);
  if (bound === 'certified') return certified ?? '';
  const days = /^days:(\d+)$/.exec(bound);
  if (days) {
    const d = new Date(today);
    d.setDate(d.getDate() + (latest ? 1 : -1) * Number(days[1]));
    return iso(d);
  }
  const date = /^date:(\d{4}-\d{2}-\d{2})$/.exec(bound);
  return date ? date[1] : '';
}

/** The applicant's sentence for an application on hold (2026-11-20: never the staff's "Certificate X SUSPENDED (was …)"). */
export function holdText(kind: string | null | undefined): string {
  switch (kind) {
    case 'suspended': return t('msme.incentiveScheme.hold.suspended', 'Your certificate is suspended; the ZED team will resume or close the application.');
    case 'withdrawn': return t('msme.incentiveScheme.hold.withdrawn', 'Your certificate is withdrawn; the ZED team will resume or close the application.');
    default: return t('msme.incentiveScheme.hold.other', 'The ZED team will resume or close the application.');
  }
}

/** Why a scheme is locked, in the Admin's wording (the reason keys of the API). */
export function lockedNote(note: string | null | undefined, levels: string[]): string | null {
  const names = levels.map(levelName).join(', ');
  switch (note) {
    case 'notEligible': return t('msme.incentiveScheme.locked.notEligible', 'You are not eligible for benefits. Please contact ZED team.');
    case 'notCertified': return names ? t('msme.incentiveScheme.locked.notCertifiedLevels', 'Opens after {levels} certification', { levels: names })
      : t('msme.incentiveScheme.locked.notCertified', 'Opens after your unit is ZED certified');
    case 'levelNotCovered': return t('msme.incentiveScheme.locked.levelNotCovered', 'For units certified at {levels}', { levels: names });
    case 'handholding': return t('msme.incentiveScheme.locked.handholding', 'Opens once your Handholding support is completed');
    case 'financialBlocked': return t('msme.incentiveScheme.locked.financialBlocked', 'Financial assistance is not available for your unit. Please contact ZED team.');
    case 'suspended': return t('msme.incentiveScheme.locked.suspended', 'Your highest certificate is suspended or withdrawn. The scheme opens again once it is active.');
    case 'notGraded': return t('msme.incentiveScheme.locked.notGraded', 'This scheme is not yet set up for your unit\'s certification or size. Please contact ZED team.');
    case 'legacyInProgress': return t('msme.incentiveScheme.locked.legacyInProgress', 'Your earlier application for this benefit is still in progress. It continues on its own page.');
    case 'closed': return t('msme.incentiveScheme.locked.closed', 'This scheme is not taking new applications now.');
    default: return null;
  }
}
