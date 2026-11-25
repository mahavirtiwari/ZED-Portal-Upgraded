/**
 * New (2026-11-25, the product owner: the Admin's incentive schemes in the app with the full forms, not a link to the web): the
 * incentive schemes of the portal (Msme/AppIncentiveSchemes, the web's api/msme/incentive-schemes with the app sign-in token) as
 * the web page reads them (frontend msme/incentive-schemes/incentive-schemes.api.ts): the dashboard tiles, one scheme's page, and
 * the same small rules (claim, eligible amount, date bounds, the files of a document value). Every wording is an Admin text
 * (Admin → Texts, "MSME app", app.msme.incentiveSchemes.*), the standard one in builtInTexts.ts.
 */
import { useCallback, useSyncExternalStore } from 'react';
import { htmlToPlain, type AppTexts } from '@zed/shared';
import { useMsme } from './app/context';
import { levelName } from './models';

/** Where a unit stands with a scheme (the server's ApplicantState). */
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
  /** The server's sentence for a locked scheme. */
  message: string | null;
  applicationId: number | null;
  status: string | null;
  level: string | null;
  grade: SchemeGrade | null;
  activationMode: string;
  activationLevels: string[];
}

/** Msme/AppIncentiveSchemes: the Admin's schemes, the Technology Upgradation card's direct scheme, the FA card's scheme. */
export interface SchemesDashboard {
  schemes: SchemeTile[];
  tu: { direct: boolean; scheme: SchemeTile | null; legacy?: boolean };
  fa: { scheme: SchemeTile | null; legacy: boolean };
}

export type FieldType = 'text' | 'longtext' | 'number' | 'amount' | 'date' | 'choice' | 'multichoice' | 'yesno' | 'copy' | 'document' | 'photo';

export interface FormField {
  key: string;
  label: string;
  help?: string | null;
  type: FieldType;
  required: boolean;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  dateMin?: string | null;
  dateMax?: string | null;
  options?: string[];
  copyOf?: string | null;
  isClaim?: boolean;
  maxFiles?: number | null;
  wholeNumber?: boolean;
}

export interface PickSource {
  kind: 'Technologies' | 'Options';
  label: string;
  options?: string[];
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
  activationMode: string;
  activationLevels: string[];
  correctionRounds: number;
  correctionDays: number;
  /** The scheme's own texts (plain text), or null: the app's standard wording. */
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
  holdReason: string | null;
  holdKind?: 'suspended' | 'withdrawn' | 'other' | null;
  account: { accountNo: string | null; ifscCode: string | null; branchAddress: string | null; bankName: string | null } | null;
}

export interface PickEntry {
  code: string;
  name: string;
  description: string | null;
}

/** Msme/AppIncentiveSchemes/{code}. */
export interface SchemePage {
  scheme: SchemeInfo;
  unit: Record<string, string | number | boolean | null>;
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

export interface SchemeAccount {
  accountNo: string;
  confirmAccountNo: string;
  ifscCode: string;
  branchAddress: string;
  bankName: string;
}

/** The bank block's cheque in the answers and checks (the server's ApplicantForm.BankSection / ChequeField). */
export const BANK_SECTION = '_bank';
export const CHEQUE_FIELD = 'cheque';
export const ACCOUNT_FIELD = 'account';

/** The stored file names of a document value (a JSON list); also the options of a multiple choice. */
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
    const keys = s.fields.filter(f => f.isClaim).map(f => f.key);
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

/** Eligible = share % of the claim (whole rupees), at most the cap (the server's SchemeEligibility.Eligible). */
export function eligibleOf(claim: number, grade: SchemeGrade | null | undefined): number {
  if (!grade) return 0;
  return Math.min(Math.round(Math.trunc(claim) * grade.sharePercent) / 100, grade.maxAmount);
}

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** A date bound of a field as yyyy-MM-dd (today, certified, days:N, date:yyyy-MM-dd), or '' when none. */
export function dateBound(bound: string | null | undefined, certified: string | null | undefined, latest: boolean, today = new Date()): string {
  if (!bound) return '';
  if (bound === 'today') return iso(today);
  if (bound === 'certified') return certified ?? '';
  const days = /^days:(\d+)$/.exec(bound);
  if (days) {
    const d = new Date(today);
    d.setDate(d.getDate() + (latest ? 1 : -1) * Number(days[1]));
    return iso(d);
  }
  const date = /^date:(\d{4}-\d{2}-\d{2})$/.exec(bound);
  return date ? date[1]! : '';
}

/** yyyy-MM-dd as dd-MM-yyyy (the web page's dates). */
export function displayDate(value: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value ?? '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : value ?? '';
}

/** An amount in the Indian grouping (1,00,000.5). */
export function inr(value: number | string | null | undefined): string {
  const n = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isFinite(n) ? n.toLocaleString('en-IN', { maximumFractionDigits: 2 }) : String(value ?? '');
}

// ----- texts -----

/** The prefix of the incentive schemes' texts (Admin → Texts, "MSME app", backend ContentCatalogue.Apps.cs). */
export const SCHEME_TEXTS = 'app.msme.incentiveSchemes.';

export type TextFields = Record<string, string | number | null | undefined>;
export type SchemeT = (key: string, fields?: TextFields) => string;

/** A scheme text as plain text: the Admin's wording or the standard one; empty when the Admin switched it off. */
export function schemeText(texts: AppTexts, key: string, fields?: TextFields): string {
  const r = texts.get(SCHEME_TEXTS + key, fields);
  return r ? htmlToPlain(r.html).trim() : '';
}

/** `t(key, fields)` of the incentive scheme screens, re-rendered when newer Admin texts arrive. */
export function useSchemeTexts(): SchemeT {
  const app = useMsme();
  const revision = useSyncExternalStore(
    l => app.texts.subscribe(l),
    () => app.texts.getRevision(),
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useCallback((key: string, fields?: TextFields) => schemeText(app.texts, key, fields), [app, revision]);
}

/** Why a scheme is locked, in the Admin's wording (the reason keys of the API), or null for an unknown reason. */
export function lockedNote(t: SchemeT, note: string | null | undefined, levels: string[]): string | null {
  const names = levels.map(l => levelName(l)).join(', ');
  switch (note) {
    case 'notCertified':
      return names ? t('locked.notCertifiedLevels', { Levels: names }) : t('locked.notCertified');
    case 'levelNotCovered':
      return t('locked.levelNotCovered', { Levels: names });
    case 'notEligible':
    case 'handholding':
    case 'financialBlocked':
    case 'suspended':
    case 'notGraded':
    case 'legacyInProgress':
    case 'closed':
      return t('locked.' + note);
    default:
      return null;
  }
}

/** The applicant's sentence for an application on hold (never the staff's stored reason). */
export function holdText(t: SchemeT, kind: string | null | undefined): string {
  return kind === 'suspended' || kind === 'withdrawn' ? t('hold.' + kind) : t('hold.other');
}

/** The status as the applicant reads it. */
export function statusLabel(t: SchemeT, status: string): string {
  switch (status) {
    case 'Draft':
      return t('status.draft');
    case 'Submitted':
    case 'WithAgency':
      return t('status.submitted');
    case 'WithAssessor':
    case 'Verifying':
      return t('status.desktop');
    case 'Correction':
      return t('status.correction');
    case 'Qc':
      return t('status.qc');
    case 'Approved':
      return t('status.approved');
    case 'Paid':
      return t('status.paid');
    case 'Rejected':
      return t('status.rejected');
    case 'OnHold':
      return t('status.onHold');
    default:
      return status;
  }
}

/** The label of a tile's state (My Incentives). */
export function stateLabel(t: SchemeT, state: SchemeState): string {
  return t('list.state.' + state);
}
