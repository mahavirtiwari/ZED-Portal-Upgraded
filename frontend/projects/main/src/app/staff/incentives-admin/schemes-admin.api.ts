import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { t } from '../../content/page-text';

/** The vocabulary of a scheme definition (backend Features/Incentives/SchemeDefinition.cs, SchemeRules). */
export type ActivationMode = 'Levels' | 'Registration' | 'Handholding';
export type GradingMode = 'Level' | 'Size';
export type VerificationFlow = 'Desktop' | 'DesktopOnsite';
export type PickKind = 'Technologies' | 'Options';

export const FIELD_TYPES = ['text', 'longtext', 'number', 'amount', 'date', 'choice', 'multichoice', 'yesno', 'copy', 'document', 'photo'] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

/** The dashboard's card icons a scheme can use. */
export const CARD_ICONS = ['star', 'rupee', 'zap', 'award', 'users', 'building', 'bank', 'trend', 'pin'] as const;

export const SCHEME_LIMITS = { sections: 10, fields: 40, items: 50, options: 50, text: 4000, amount: 100_000_000, rounds: 5, days: 180 } as const;

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
export interface SchemeVerification { flow: VerificationFlow; correctionRounds: number; correctionDays: number; autoAllot: boolean }

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
}

export interface LevelOption { code: string; name: string }

export interface SchemesResponse { schemes: SchemeSummary[]; templates: string[]; levels: LevelOption[]; sizes: string[] }

export interface CardSettings {
  financialAssistance: { activatesAfter: string[] };
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
