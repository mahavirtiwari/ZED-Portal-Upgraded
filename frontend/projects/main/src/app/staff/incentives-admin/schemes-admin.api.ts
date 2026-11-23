import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { t } from '../../content/page-text';

/** The code of the built-in Financial Assistance scheme the dashboard card opens (SchemeTemplates.FaCode). */
export const FA_SCHEME_CODE = 'FA';

/** The field types that can be unique (SchemeRules.UniqueTypes). */
export const UNIQUE_TYPES: readonly string[] = ['text', 'number', 'amount', 'date'];

/** The vocabulary of a scheme definition (backend Features/Incentives/SchemeDefinition.cs, SchemeRules). */
export type ActivationMode = 'Levels' | 'Registration' | 'Handholding';
export type GradingMode = 'Level' | 'Size';
export type VerificationFlow = 'Desktop' | 'DesktopOnsite';
export type PickKind = 'Technologies' | 'Options';

export const FIELD_TYPES = ['text', 'longtext', 'number', 'amount', 'date', 'choice', 'multichoice', 'yesno', 'copy', 'document', 'photo'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The dashboard's card icons a scheme can use. */
export const CARD_ICONS = ['star', 'rupee', 'zap', 'award', 'users', 'building', 'bank', 'trend', 'pin'] as const;

export const SCHEME_LIMITS = { sections: 10, fields: 40, items: 50, options: 50, text: 4000, amount: 100_000_000, rounds: 5, days: 180, photos: 5, files: 3, schemeText: 10000 } as const;

export interface SchemeCard { title: string; highlight?: string | null; details?: string | null; icon: string }
export interface SchemeActivation { mode: ActivationMode; levels: string[] }
export interface SchemeGrade { key: string; sharePercent: number; maxAmount: number }
export interface SchemeGrading { mode: GradingMode; rows: SchemeGrade[] }
export interface SchemeBlocks { disclaimer: boolean; instructions: boolean; unitConfirm: boolean; bankAccount: boolean; declaration: boolean }
export interface PickSource { kind: PickKind; label: string; options: string[]; sectorFilter: boolean; noRepeat: boolean }

export interface FormField {
  key: string;
  label: string;
  help?: string | null;
  type: FieldType;
  required: boolean;
  assessorChecks: boolean;
  maxLength?: number | null;
  min?: number | null;
  max?: number | null;
  dateMin?: string | null;
  dateMax?: string | null;
  options: string[];
  copyOf?: string | null;
  isClaim: boolean;
  maxFiles?: number | null;
  /** Phase 2: who checks the answer (when assessorChecks) in the Desktop + Onsite flow; desktop when not set. */
  checkStage?: CheckStage | null;
  /** 2026-11-20: the value cannot repeat across the unit's other applications of the scheme (text, number, amount, date). */
  unique?: boolean;
  /** Whole numbers only (number fields; SchemeDefinition FormField.WholeNumber). */
  wholeNumber?: boolean;
}

/** Phase 2 (FormField.CheckStage): checked at the desktop, at the onsite visit, or both. */
export type CheckStage = 'desktop' | 'onsite' | 'both';
export const CHECK_STAGES: readonly CheckStage[] = ['desktop', 'onsite', 'both'];

export function checkStageLabel(stage: CheckStage | null | undefined): string {
  switch (stage) {
    case 'onsite': return t('staff.incentivesAdmin.field.stage.onsite', 'Onsite (at the visit)');
    case 'both': return t('staff.incentivesAdmin.field.stage.both', 'Desktop and onsite');
    default: return t('staff.incentivesAdmin.field.stage.desktop', 'Desktop');
  }
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

export interface DocumentRule { kind: 'AtLeast'; count: number; fields: string[]; message?: string | null }
export interface SchemeForm { blocks: SchemeBlocks; sections: FormSection[]; rules: DocumentRule[] }
export interface SchemeVerification {
  flow: VerificationFlow;
  correctionRounds: number;
  correctionDays: number;
  autoAllot: boolean;
  /** Phase 2: the onsite assessor's photos of each item (0–5 at least, 1–5 at most). */
  onsitePhotosMin?: number;
  onsitePhotosMax?: number;
}

export interface SchemeDefinition {
  code: string;
  name: string;
  active: boolean;
  orderNo: number;
  card: SchemeCard;
  activation: SchemeActivation;
  grading: SchemeGrading;
  form: SchemeForm;
  verification: SchemeVerification;
  /** 2026-11-20: the applicant's texts of this scheme (plain text); empty = the global wording of Admin → Texts. */
  disclaimer?: string | null;
  instructions?: string | null;
  declaration?: string | null;
  /** The template version a built-in scheme was brought up to (kept by the server). */
  templateVersion?: number;
}

export interface SchemeSummary {
  code: string;
  name: string;
  active: boolean;
  orderNo: number;
  cardTitle: string;
  activation: SchemeActivation;
  grading: SchemeGrading;
  flow: VerificationFlow;
  /** 2026-11-23 (list design): the card's icon, the correction rounds, and "on but not shown" (the direct TU scheme while
   *  the Technology Upgradation card still needs the consultant's recommendation). */
  icon?: string | null;
  correctionRounds?: number;
  hiddenByTuSetting?: boolean;
}

/** One line for a grading: "All levels: 75% up to ₹50,000" when every row is the same, else each row (or shares with one cap). */
export function gradingSummary(g: SchemeGrading, levels: readonly LevelOption[]): string[] {
  const rows = g.rows;
  if (!rows.length) return [];
  const same = rows.every((r) => r.sharePercent === rows[0].sharePercent && r.maxAmount === rows[0].maxAmount);
  if (same && rows.length > 1) {
    const all = g.mode === 'Size' ? t('staff.incentivesAdmin.grading.allSizes', 'All sizes') : t('staff.incentivesAdmin.grading.allLevels', 'All levels');
    return [t('staff.incentivesAdmin.grading.summaryRow', '{key}: {share}% up to {max}', { key: all, share: rows[0].sharePercent, max: rupees(rows[0].maxAmount) })];
  }
  if (rows.length > 1 && rows.every((r) => r.maxAmount === rows[0].maxAmount)) {
    const shares = rows.map((r) => `${gradeKeyLabel(r.key, levels)} ${r.sharePercent}%`).join(' · ');
    return [t('staff.incentivesAdmin.grading.summaryShares', '{shares} up to {max}', { shares, max: rupees(rows[0].maxAmount) })];
  }
  return rows.map((r) => t('staff.incentivesAdmin.grading.summaryRow', '{key}: {share}% up to {max}', { key: gradeKeyLabel(r.key, levels), share: r.sharePercent, max: rupees(r.maxAmount) }));
}

/** No benefit: every row pays 0 % or up to ₹0. */
export function noBenefit(g: SchemeGrading): boolean {
  return !g.rows.length || g.rows.every((r) => !r.sharePercent || !r.maxAmount);
}

export interface LevelOption { code: string; name: string }

export interface SchemesResponse { schemes: SchemeSummary[]; templates: string[]; levels: LevelOption[]; sizes: string[] }

export interface CardSettings {
  /** 2026-11-20: any certification level; the GET also lists the levels. */
  financialAssistance: { activatesAfter: string[]; levels?: LevelOption[] };
  technologyUpgradation: { recommendationRequired: boolean; directSchemeCode: string | null; schemes?: { code: string; name: string; active: boolean }[] };
}

/** Admin → Incentive Schemes (main portal, Admin only): api/staff/settings/schemes. */
@Injectable({ providedIn: 'root' })
export class SchemesAdminApi {
  private readonly http = inject(HttpClient);
  static readonly url = '/api/staff/settings/schemes';

  list(): Observable<SchemesResponse> {
    return this.http.get<SchemesResponse>(SchemesAdminApi.url);
  }

  get(code: string): Observable<SchemeDefinition> {
    return this.http.get<SchemeDefinition>(`${SchemesAdminApi.url}/${encodeURIComponent(code)}`);
  }

  create(body: { template: string | null; code: string; name: string }): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(SchemesAdminApi.url, body);
  }

  save(d: SchemeDefinition): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${SchemesAdminApi.url}/${encodeURIComponent(d.code)}`, d);
  }

  setActive(code: string, active: boolean): Observable<MessageResponse> {
    return this.http.post<MessageResponse>(`${SchemesAdminApi.url}/${encodeURIComponent(code)}/active`, { active });
  }

  cards(): Observable<CardSettings> {
    return this.http.get<CardSettings>(`${SchemesAdminApi.url}/cards`);
  }

  saveCards(s: CardSettings): Observable<MessageResponse> {
    return this.http.put<MessageResponse>(`${SchemesAdminApi.url}/cards`, s);
  }
}

/** A key from a title: lower case letters, digits and _, starting with a letter, at most 40, not one of `taken`. */
export function keyFrom(title: string, taken: readonly string[]): string {
  let base = title.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 36);
  if (!base) base = 'item';
  if (!/^[a-z]/.test(base)) base = `f_${base}`.slice(0, 36);
  let key = base;
  for (let n = 2; taken.includes(key); n++) key = `${base}_${n}`;
  return key;
}

/** A scheme code from a name: capitals, digits and _, starting with a letter, at most 40. */
export function codeFrom(name: string): string {
  let code = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
  if (code && !/^[A-Z]/.test(code)) code = `S_${code}`.slice(0, 40);
  return code;
}

/** Rupees in the Indian grouping (3,00,000). */
export function rupees(n: number | null | undefined): string {
  return `₹${(n ?? 0).toLocaleString('en-IN')}`;
}

/** The wording of a field type. */
export function fieldTypeLabel(type: string): string {
  switch (type) {
    case 'text': return t('staff.incentivesAdmin.type.text', 'Short text');
    case 'longtext': return t('staff.incentivesAdmin.type.longtext', 'Long text');
    case 'number': return t('staff.incentivesAdmin.type.number', 'Number');
    case 'amount': return t('staff.incentivesAdmin.type.amount', 'Amount (₹)');
    case 'date': return t('staff.incentivesAdmin.type.date', 'Date');
    case 'choice': return t('staff.incentivesAdmin.type.choice', 'One choice');
    case 'multichoice': return t('staff.incentivesAdmin.type.multichoice', 'Several choices');
    case 'yesno': return t('staff.incentivesAdmin.type.yesno', 'Yes / No');
    case 'copy': return t('staff.incentivesAdmin.type.copy', 'Copy of an earlier field');
    case 'document': return t('staff.incentivesAdmin.type.document', 'Document');
    case 'photo': return t('staff.incentivesAdmin.type.photo', 'Photo');
    default: return type;
  }
}

/** "Opens after": the level names, or Registration / Handholding. */
export function activationLabel(a: SchemeActivation, levels: readonly LevelOption[]): string {
  if (a.mode === 'Registration') return t('staff.incentivesAdmin.activation.registration', 'Registration');
  if (a.mode === 'Handholding') return t('staff.incentivesAdmin.activation.handholding', 'Handholding completed');
  return a.levels.map((c) => levels.find((l) => l.code.toLowerCase() === c.toLowerCase())?.name ?? c).join(', ');
}

export function gradingModeLabel(mode: GradingMode): string {
  return mode === 'Size' ? t('staff.incentivesAdmin.grading.bySize', 'By enterprise size') : t('staff.incentivesAdmin.grading.byLevel', 'By level');
}

export function flowLabel(flow: VerificationFlow): string {
  return flow === 'DesktopOnsite' ? t('staff.incentivesAdmin.flow.desktopOnsite', 'Desktop + Onsite') : t('staff.incentivesAdmin.flow.desktop', 'Desktop');
}

/** The wording of a grading row's key (a level code, All, Registration, Handholding or a size). */
export function gradeKeyLabel(key: string, levels: readonly LevelOption[]): string {
  if (key === 'All') return t('staff.incentivesAdmin.grading.allKey', 'All');
  if (key === 'Registration' || key === 'Handholding') return activationLabel({ mode: key, levels: [] }, levels);
  return levels.find((l) => l.code.toLowerCase() === key.toLowerCase())?.name ?? key;
}
