import { UpperCasePipe } from '@angular/common';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ADMIN_PORTAL, AdminPortalService } from '../admin-portal';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';
import { ToastService } from '../toast';

export interface CertificationLevel {
  /** Stored everywhere (Bronze, Silver, Gold, ZEDX); cannot change. */
  code: string;
  /** What pages show ("ZED-X"). */
  name: string;
  orderNo: number;
  description: string | null;
  /** The information text of the level's box (its "i" pop-up). */
  comment: string | null;
  logoPath: string | null;
  isEnabled: boolean;
  /** Desktop: desktop assessment only (as Bronze); Site: desktop and site assessment. */
  assessmentMode: 'Desktop' | 'Site';
  validityMonths: number;
  surveillanceEnabled: boolean;
  firstSurveillanceMonths: number | null;
  certNoFormat: string;
  certNoFormatManufacturing: string | null;
  certNoFormatService: string | null;
  fee: number | null;
  updatedBy: string | null;
  updatedOn: string | null;
  /** The surveillance schedule (migration 0032; Bronze / Silver / Gold too since 0037); null = the Silver / Gold value. */
  surveillanceCount?: number | null;
  surveillanceIntervalMonths?: number | null;
  surveillanceNoticeMonths?: number | null;
  surveillanceReminders?: number | null;
  surveillanceReminderEveryMonths?: number | null;
  surveillanceSuspendAfterMonths?: number | null;
  surveillanceWithdrawAfterDays?: number | null;
  /** 0037: the last reminder applies the unit for its surveillance itself (desktop levels, as Bronze). */
  surveillanceAutoApply?: boolean | null;
  /** 0037: the rounds that suspend a unit that did not apply: null every round, 1 the first only, 0 none. */
  surveillanceSuspendRounds?: number | null;
  /** 0037: the day the V4 schedule started for the level (year 9999 = not yet; null = no limit). */
  surveillanceScheduleFrom?: string | null;
}

/** The surveillance schedule fields of the form. */
type ScheduleKey =
  | 'surveillanceCount' | 'surveillanceIntervalMonths' | 'surveillanceNoticeMonths' | 'surveillanceReminders'
  | 'surveillanceReminderEveryMonths' | 'surveillanceSuspendAfterMonths' | 'surveillanceWithdrawAfterDays';

/** What the Silver / Gold jobs do (SurveillanceSchedule.Default): the values a new level starts with. */
export const DEFAULT_SCHEDULE: Readonly<Record<ScheduleKey | 'firstSurveillanceMonths', number>> = {
  firstSurveillanceMonths: 15, surveillanceCount: 2, surveillanceIntervalMonths: 12, surveillanceNoticeMonths: 4, surveillanceReminders: 2,
  surveillanceReminderEveryMonths: 1, surveillanceSuspendAfterMonths: 1, surveillanceWithdrawAfterDays: 64,
};

const SCHEDULE_KEYS: readonly ScheduleKey[] = [
  'surveillanceCount', 'surveillanceIntervalMonths', 'surveillanceNoticeMonths', 'surveillanceReminders',
  'surveillanceReminderEveryMonths', 'surveillanceSuspendAfterMonths', 'surveillanceWithdrawAfterDays',
];

/**
 * 2026-11-08: what a level still needs before it can be switched on (built-in Bronze, Silver, Gold and ZED-X: all true).
 * The server refuses to enable a level while questionnaire, fees, artwork or columns is false.
 */
export interface LevelReadiness {
  /** The level has a parameter at least (Master → Questionnaire). */
  questionnaire: boolean;
  parameterCount: number;
  /** Master → Payments has its fees (Micro, Small and Medium). */
  fees: boolean;
  /** The certificate and report background images are uploaded. */
  artwork: boolean;
  /** An active desktop agency may be allotted it (Agency level allocation; not needed to switch on). */
  agencies: boolean;
  /** The level's database columns exist (created when it was added, or by the next update). */
  columns: boolean;
  columnsMessage: string | null;
}

interface LevelItem {
  level: CertificationLevel;
  /** A number in the general format, for ZEDMSME129350 today. */
  sample: string;
  logoUrl: string | null;
  /** 2026-11-08: the level's fees in Master → Payments (with GST, before subsidy) by enterprise type. */
  fees?: { type: string; total: number | null }[];
  readiness?: LevelReadiness;
  /** 2026-11-14: how the level is assessed and its surveillance's mode; the choices the portal runs today. */
  assessmentFlow?: AssessmentFlow;
  surveillanceMode?: SurveillanceMode;
  availableFlows?: string[];
  availableSurveillanceModes?: string[];
  /** 2026-11-16 (approved, migration 0086): the level's NC rounds (1-5) and days to close them (from the first NC). */
  ncRounds?: number;
  ncDays?: number;
  /** 2026-11-18 (migration 0101): the man-days of the site assessment and of the surveillance visit (null = not set). */
  manDays?: number | null;
  surveillanceManDays?: number | null;
}

export type AssessmentFlow = 'Desktop' | 'Remote' | 'Onsite' | 'DesktopRemote' | 'DesktopOnsite';
export type SurveillanceMode = 'Remote' | 'Onsite';

/** The Admin's choices (2026-11-14, approved): the level's flow decides the assessment steps (wording: Administration → Texts). */
export const assessmentFlows = (): { value: AssessmentFlow; label: string; hint: string }[] => [
  { value: 'Desktop', label: t('staff.levels.flow.desktop.label', 'Desktop only'), hint: t('staff.levels.flow.desktop.hint', 'Documents checked, as Bronze today.') },
  { value: 'Remote', label: t('staff.levels.flow.remote.label', 'Remote only'), hint: t('staff.levels.flow.remote.hint', 'No desktop step; a remote visit.') },
  { value: 'Onsite', label: t('staff.levels.flow.onsite.label', 'Onsite only'), hint: t('staff.levels.flow.onsite.hint', 'No desktop step; an onsite visit.') },
  { value: 'DesktopRemote', label: t('staff.levels.flow.desktopRemote.label', 'Desktop + Remote'), hint: t('staff.levels.flow.desktopRemote.hint', 'Desktop, then a remote visit.') },
  { value: 'DesktopOnsite', label: t('staff.levels.flow.desktopOnsite.label', 'Desktop + Onsite'), hint: t('staff.levels.flow.desktopOnsite.hint', 'Desktop, then an onsite visit.') },
];
export const surveillanceModes = (): { value: SurveillanceMode; label: string; hint: string }[] => [
  { value: 'Remote', label: t('staff.levels.surveillanceMode.remote.label', 'Remote'), hint: t('staff.levels.surveillanceMode.remote.hint', 'The current surveillance flow (meeting link).') },
  { value: 'Onsite', label: t('staff.levels.surveillanceMode.onsite.label', 'Onsite'),
    hint: t('staff.levels.surveillanceMode.onsite.hint', 'As an onsite assessment, on the parameters marked "In surveillance".') },
];
/**
 * The flows a level can choose: every flow the server runs, for every level (2026-11-15: Bronze, Silver and Gold too; the
 * server routes them, migration 0078). An older server sends fewer and the others show as "available soon".
 */
export function levelFlowsFor(_code: string, available: string[]): string[] {
  return available;
}
/** 2026-11-16: the NC days when the Admin has not set them: 30 for Desktop only, 60 for a flow with a visit. */
export const defaultNcDays = (flow: AssessmentFlow): number => (flow === 'Desktop' ? 30 : 60);

/** A man-days field as sent: 0 when blank (clears the stored value), else the number. */
export const manDaysValue = (v: number | string | null | undefined): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
export const NC_MAX_ROUNDS = 5;
export const NC_MAX_DAYS = 365;
/** Where a flow raises its NCs: the desktop for Desktop only, otherwise the visit (none at a combined flow's desktop step). */
export const ncStage = (flow: AssessmentFlow): 'desktop' | 'remote' | 'onsite' =>
  flow === 'Desktop' ? 'desktop' : flow === 'Remote' || flow === 'DesktopRemote' ? 'remote' : 'onsite';
export const ncNote = (flow: AssessmentFlow): string => {
  switch (flow) {
    case 'Desktop': return t('staff.levels.nc.desktop.note', 'Raised at the desktop assessment.');
    case 'DesktopRemote': return t('staff.levels.nc.desktopRemote.note', 'Raised at the remote assessment only. The desktop assessment raises no NCs in this flow.');
    case 'DesktopOnsite': return t('staff.levels.nc.desktopOnsite.note', 'Raised at the onsite assessment only. The desktop assessment raises no NCs in this flow.');
    case 'Remote': return t('staff.levels.nc.remote.note', 'Raised at the remote assessment.');
    default: return t('staff.levels.nc.onsite.note', 'Raised at the onsite assessment.');
  }
};

export const flowLabel = (f: string | undefined, mode: string) =>
  assessmentFlows().find((x) => x.value === f)?.label
    ?? (mode === 'Desktop' ? t('staff.levels.flow.desktop.label', 'Desktop only') : t('staff.levels.flow.desktopOnsite.label', 'Desktop + Onsite'));

/** The built-in levels: ready by themselves, no checklist. */
const BUILT_IN_LEVELS = ['bronze', 'silver', 'gold', 'zedx'];

type ArtworkKind = 'certificate' | 'report';

interface LevelsResponse {
  levels: LevelItem[];
  tokens: string[];
  /** False before migration 0028: the built-in levels are shown and cannot be saved. */
  stored: boolean;
}

interface LevelForm {
  code: string;
  isNew: boolean;
  name: string;
  description: string;
  comment: string;
  isEnabled: boolean;
  assessmentMode: 'Desktop' | 'Site';
  assessmentFlow: AssessmentFlow;
  surveillanceMode: SurveillanceMode;
  /** The choices the portal runs today; the others show as "available soon". */
  availableFlows: string[];
  availableSurveillanceModes: string[];
  ncRounds: number | null;
  ncDays: number | null;
  manDays: number | null;
  surveillanceManDays: number | null;
  validityMonths: number | null;
  surveillanceEnabled: boolean;
  firstSurveillanceMonths: number | null;
  certNoFormat: string;
  certNoFormatManufacturing: string;
  certNoFormatService: string;
  fee: number | null;
  surveillanceCount: number | null;
  surveillanceIntervalMonths: number | null;
  surveillanceNoticeMonths: number | null;
  surveillanceReminders: number | null;
  surveillanceReminderEveryMonths: number | null;
  surveillanceSuspendAfterMonths: number | null;
  surveillanceWithdrawAfterDays: number | null;
  surveillanceAutoApply: boolean;
  /** null every surveillance, 1 the first only, 0 never. */
  surveillanceSuspendRounds: number | null;
  surveillanceScheduleFrom: string | null;
}

/**
 * The serial of a certificate number, as ZedIds.CertificateSerial on the server (migration 0051): old IDs lose
 * "ZEDMSME" (ZEDMSME129350 → 129350), new IDs lose "ZED" (ZEDM000123 → M000123, ZEDS000045 → S000045).
 */
export function certificateSerial(zedId: string): string {
  if (/^ZEDMSME/i.test(zedId)) return zedId.slice(7);
  if (/^ZED[MS]\d/i.test(zedId)) return zedId.slice(3);
  return zedId.length > 7 ? zedId.slice(7) : zedId;
}

/** As CertificateNumbers.Format on the server (the preview of the formats). */
export function formatCertificateNo(format: string, date: Date, zedId: string, level: string, category: 'Manufacturing' | 'Services' | null): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  const digits = certificateSerial(zedId);
  return format
    .replaceAll('{DDMMYYYY}', `${p(date.getDate())}${p(date.getMonth() + 1)}${yyyy}`)
    .replaceAll('{YYYY}', yyyy)
    .replaceAll('{YY}', yyyy.slice(2))
    .replaceAll('{MM}', p(date.getMonth() + 1))
    .replaceAll('{DD}', p(date.getDate()))
    .replaceAll('{ZEDID}', zedId)
    .replaceAll('{ZEDNO}', digits)
    .replaceAll('{LEVEL}', level)
    .replaceAll('{CAT}', category === 'Services' ? 'S' : category === 'Manufacturing' ? 'M' : '');
}

/** A new unit's ZED ID for the previews (ZEDM / ZEDS by sector since migration 0051). */
const sampleZedId = (category: 'Manufacturing' | 'Services' | null) => (category === 'Services' ? 'ZEDS000123' : 'ZEDM000123');

/** The colour of a level's card and preview (the dashboard boxes' colours; teal for the others). */
const ACCENTS: Record<string, string> = { BRONZE: '#d07b5c', SILVER: '#9aa5ab', GOLD: '#c9a227', ZEDX: '#3f8f96' };

type EditTab = 'box' | 'certificate' | 'surveillance';
const API = '/api/staff/settings/levels';

/**
 * Administration → Certification Levels (new in V4): the certification boxes of the MSME dashboard (Bronze, Silver,
 * Gold, ZED-X and the levels the Admin adds): name, logo, description and information text, shown or hidden, and the
 * certificate settings: desktop or desktop and site assessment, validity, surveillance, and the certificate number
 * format, in general and for Manufacturing / Services units, and the surveillance schedule (how many, when due, notice,
 * reminders, the portal applying on the last one, suspension, withdrawal; migrations 0032, 0037: Bronze, Silver and Gold
 * too, since the V4 schedule replaced their legacy jobs). V4 layout: a
 * card per level in its colour; the pop-up in three tabs (box, certificate, surveillance) beside a preview of the
 * dashboard box, the certificate numbers and the surveillance due dates.
 */
@Component({
  selector: 'zed-staff-certification-levels',
  imports: [FormsModule, RouterLink, UpperCasePipe, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Certification Levels' | t: 'staff.levels.title' }}</h3>
        <p class="page-sub">{{ "The certification boxes MSMEs see, and each level's certificate settings." | t: 'staff.levels.sub' }}</p>
      </div>
      <button type="button" class="btn btn-primary" [disabled]="busy() || !stored()" (click)="startAdd()">{{ '+ Add level' | t: 'staff.levels.addButton' }}</button>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (loaded() && !stored()) {
      <div class="alert alert-warning" role="alert">{{ 'These are the built-in levels. They can be changed once the administrator has applied database migration 0028.' | t: 'staff.levels.notStored.warning' }}</div>
    }
    @if (levels().length) {
      <p class="lv-summary">
        <strong>{{ levels().length }}</strong> {{ 'levels' | t: 'staff.levels.summary.levels.label' }} · <span class="dot on"></span>{{ '{count} shown to MSMEs' | t: 'staff.levels.summary.shown' : { count: enabledCount() } }}
        @if (levels().length - enabledCount()) { · <span class="dot"></span>{{ '{count} hidden' | t: 'staff.levels.summary.hidden' : { count: levels().length - enabledCount() } }} }
      </p>
    }

    <div class="lv-grid">
      @for (i of levels(); track i.level.code) {
        @let l = i.level;
        <article class="lv-box" [class.is-off]="!l.isEnabled" [attr.aria-label]="l.name" [style.--accent]="accent(l.code)">
          <div class="lv-band"></div>
          <div class="lv-top">
            @if (i.logoUrl) {
              <img class="lv-logo" [src]="i.logoUrl" [alt]="'{name} logo' | t: 'staff.levels.card.logoAlt' : { name: l.name }" />
            } @else {
              <span class="lv-logo lv-logo-none" aria-hidden="true">{{ l.name }}</span>
            }
            @if (!l.isEnabled && missing(i).length) {
              <span class="status-badge is-inactive lv-until" data-off-until-ready>{{ 'Off until ready' | t: 'staff.levels.card.offUntilReady' }}</span>
            } @else {
              <span class="status-badge" [class.is-active]="l.isEnabled" [class.is-inactive]="!l.isEnabled">{{ l.isEnabled ? ('Enabled' | t: 'staff.levels.card.enabled') : ('Disabled' | t: 'staff.levels.card.disabled') }}</span>
            }
          </div>
          <div class="lv-title">
            <h5>{{ '{level} CERTIFICATION' | t: 'staff.levels.card.title' : { level: (l.name | uppercase) } }}</h5>
            <code class="lv-code" [title]="'Code' | t: 'staff.levels.card.codeTooltip'">{{ l.code }}</code>
          </div>
          <!-- Always present (empty when none) and clamped, so the facts of the cards line up across a row. -->
          <p class="lv-desc" [attr.title]="l.description || null">{{ l.description }}</p>
          <dl class="lv-facts">
            <div><dt>{{ 'Assessment' | t: 'staff.levels.fact.assessment' }}</dt><dd>{{ flowOf(l) }}</dd></div>
            <div><dt>{{ 'NCs' | t: 'staff.levels.fact.ncs' }}</dt><dd data-nc-fact>{{ ncFact(i) }}</dd></div>
            <div><dt>{{ 'Valid for' | t: 'staff.levels.fact.validity' }}</dt><dd>{{ months(l.validityMonths) }}</dd></div>
            <div><dt>{{ 'Surveillance' | t: 'staff.levels.fact.surveillance' }}</dt><dd>{{ surveillanceFact(l) }}</dd></div>
            <div><dt>{{ 'Certificate no.' | t: 'staff.levels.fact.certificateNo' }}</dt><dd><code class="lv-sample">{{ i.sample }}</code></dd></div>
            <div><dt>{{ 'Fees' | t: 'staff.levels.fact.fees' }}</dt><dd>
              @if (i.fees?.length) { <span class="lv-fees" data-fees>{{ feeText(i) }}</span> }
              @else { <a class="lv-fees-missing" routerLink="/staff/fees" data-fees-missing>{{ 'Not set in Master → Payments' | t: 'staff.levels.fact.feesMissingLink' }}</a> }
            </dd></div>
          </dl>
          @if (checklist(i); as r) {
            <!-- 2026-11-08: what a level the Admin added still needs before it can be switched on. -->
            <section class="lv-ready" [attr.aria-label]="'What {name} needs' | t: 'staff.levels.checklist.aria' : { name: l.name }" data-checklist>
              <div class="lv-ready-head"><span>{{ 'Ready to switch on' | t: 'staff.levels.checklist.title' }}</span><span class="lv-ready-count">{{ '{done} of {total}' | t: 'staff.levels.checklist.count' : { done: doneCount(r), total: 6 } }}</span></div>
              <ul>
                <li class="ok" data-check="settings">
                  <span class="ck" aria-hidden="true">✓</span>
                  <span class="ck-text">{{ 'Name, logo, validity, certificate number' | t: 'staff.levels.checklist.settings' }}</span>
                </li>
                <li [class.ok]="r.questionnaire" data-check="questionnaire">
                  <span class="ck" aria-hidden="true">{{ r.questionnaire ? '✓' : '!' }}</span>
                  <span class="ck-text">{{ r.parameterCount === 1 ? ('Questionnaire ({count} parameter)' | t: 'staff.levels.checklist.questionnaire.parameter' : { count: r.parameterCount })
                    : ('Questionnaire ({count} parameters)' | t: 'staff.levels.checklist.questionnaire.parameters' : { count: r.parameterCount }) }}
                    @if (!r.questionnaire) { <em class="ck-hint">{{ 'missing' | t: 'staff.levels.checklist.questionnaire.hint' }}</em> }</span>
                  <a class="ck-link" [routerLink]="['/staff/masters/parameters', l.code]">{{ r.questionnaire ? ('Open →' | t: 'staff.levels.checklist.questionnaire.openLink') : ('Add →' | t: 'staff.levels.checklist.questionnaire.addLink') }}</a>
                </li>
                <li [class.ok]="r.fees" data-check="fees">
                  <span class="ck" aria-hidden="true">{{ r.fees ? '✓' : '!' }}</span>
                  <span class="ck-text">{{ 'Fees in Master → Payments' | t: 'staff.levels.checklist.fees.text' }} @if (!r.fees) { <em class="ck-hint">{{ 'missing' | t: 'staff.levels.checklist.fees.hint' }}</em> }</span>
                  <a class="ck-link" routerLink="/staff/fees" [queryParams]="{ level: l.code }">{{ r.fees ? ('Open →' | t: 'staff.levels.checklist.fees.openLink') : ('Set →' | t: 'staff.levels.checklist.fees.setLink') }}</a>
                </li>
                <li [class.ok]="r.artwork" data-check="artwork">
                  <span class="ck" aria-hidden="true">{{ r.artwork ? '✓' : '!' }}</span>
                  <span class="ck-text">{{ 'Certificate and report artwork' | t: 'staff.levels.checklist.artwork.text' }} @if (!r.artwork) { <em class="ck-hint">{{ 'upload' | t: 'staff.levels.checklist.artwork.hint' }}</em> }</span>
                  <span class="ck-art">
                    @for (k of artworkKinds(); track k.key) {
                      <label class="btn btn-outline-primary btn-sm ck-upload" [class.disabled]="busy()">
                        {{ k.label }}
                        <input type="file" class="visually-hidden" accept="image/png,image/jpeg" [attr.data-artwork]="k.key"
                               [attr.aria-label]="k.key === 'certificate' ? ('Upload the certificate artwork of {name}' | t: 'staff.levels.checklist.artwork.certificateAria' : { name: l.name })
                                 : ('Upload the report artwork of {name}' | t: 'staff.levels.checklist.artwork.reportAria' : { name: l.name })" [disabled]="busy()" (change)="uploadArtwork(l.code, k.key, $event)" />
                      </label>
                      <button type="button" class="btn btn-link btn-sm p-0" [attr.data-view-artwork]="k.key" [disabled]="busy()" (click)="viewArtwork(l, k.key)">{{ 'View' | t: 'staff.levels.checklist.artwork.viewButton' }}</button>
                    }
                  </span>
                </li>
                <li [class.ok]="r.agencies" data-check="agencies">
                  <span class="ck" aria-hidden="true">{{ r.agencies ? '✓' : '!' }}</span>
                  <span class="ck-text">{{ 'Agencies allowed (Agency level allocation)' | t: 'staff.levels.checklist.agencies.text' }} @if (!r.agencies) { <em class="ck-hint">{{ 'none yet' | t: 'staff.levels.checklist.agencies.hint' }}</em> }</span>
                  <a class="ck-link" routerLink="/staff/users/bronze-agencies" [title]="agenciesLinkTitle()">{{ 'Open →' | t: 'staff.levels.checklist.agencies.openLink' }}</a>
                </li>
                <li [class.ok]="r.columns" data-check="columns">
                  <span class="ck" aria-hidden="true">{{ r.columns ? '✓' : '!' }}</span>
                  <span class="ck-text">{{ 'Database columns' | t: 'staff.levels.checklist.columns.text' }}
                    @if (!r.columns) { <em class="ck-hint" data-columns-message>{{ r.columnsMessage || ('Ready after the next update' | t: 'staff.levels.checklist.columns.hint') }}</em> }</span>
                </li>
              </ul>
            </section>
          }
          <div class="lv-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy() || !stored()" (click)="edit(i)">{{ 'Edit' | t: 'staff.levels.card.editButton' }}</button>
            <button type="button" class="btn btn-sm" [class.btn-outline-danger]="l.isEnabled" [class.btn-outline-primary]="!l.isEnabled"
                    [disabled]="busy() || !stored()"
                    [attr.aria-label]="l.isEnabled ? ('Disable {name}' | t: 'staff.levels.card.disableAria' : { name: l.name }) : ('Enable {name}' | t: 'staff.levels.card.enableAria' : { name: l.name })"
                    [attr.title]="!l.isEnabled && missing(i).length ? ('Missing: {list}' | t: 'staff.levels.card.missingTooltip' : { list: listText(missing(i)) }) : null" (click)="toggle(l)">{{ l.isEnabled ? ('Disable' | t: 'staff.levels.card.disableButton') : ('Enable' | t: 'staff.levels.card.enableButton') }}</button>
            <a class="btn btn-link btn-sm ms-auto" [routerLink]="['/staff/masters/parameters', l.code]">{{ 'Questionnaire →' | t: 'staff.levels.card.questionnaireLink' }}</a>
          </div>
          @if (!l.isEnabled && missing(i).length) {
            <p class="lv-why" data-why>{{ 'To enable {name}, add {list}.' | t: 'staff.levels.card.why' : { name: l.name, list: listText(missing(i)) } }}</p>
          }
        </article>
      }
    </div>
    <p class="lv-note mt-3"><span class="info-dot" aria-hidden="true">i</span> {{ 'The fees charged are set in Master → Payments; the questionnaire of each level in the Questionnaire menu.' | t: 'staff.levels.note' }}</p>

    @if (artwork(); as a) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="lv-art-title">
        <div class="modal-dialog modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="lv-art-title">{{ a.kind === 'certificate' ? ('{name}: certificate artwork' | t: 'staff.levels.artwork.certificateTitle' : { name: a.name })
                  : ('{name}: report artwork' | t: 'staff.levels.artwork.reportTitle' : { name: a.name }) }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.levels.artwork.closeAria'" (click)="closeArtwork()"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body text-center">
              @if (a.url) { <img class="lv-art-preview" [src]="a.url" [alt]="a.kind === 'certificate' ? ('{name} certificate artwork' | t: 'staff.levels.artwork.certificateAlt' : { name: a.name })
                : ('{name} report artwork' | t: 'staff.levels.artwork.reportAlt' : { name: a.name })" /> }
              @else { <p class="muted m-0" data-no-artwork>{{ a.message }}</p> }
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="lv-edit-title">
        <div class="modal-dialog modal-xl modal-dialog-scrollable lv-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="lv-edit-title">{{ e.isNew ? ('Add level' | t: 'staff.levels.edit.addTitle') : ('Edit {name}' | t: 'staff.levels.edit.title' : { name: e.name }) }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.levels.edit.closeAria'" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form class="d-contents" (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <div class="lv-tabs" role="tablist" [attr.aria-label]="'Settings' | t: 'staff.levels.edit.tabsAria'">
                  @for (t of tabs(); track t.key) {
                    <button type="button" role="tab" class="lv-tab" [class.active]="tab() === t.key" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
                  }
                </div>
                <div class="lv-edit">
                  <div class="lv-fields">
                    <div [hidden]="tab() !== 'box'">
                      <div class="form-grid">
                        @if (e.isNew) {
                          <label for="lv-code">{{ 'Code' | t: 'staff.levels.edit.code.label' }}<span class="req">*</span></label>
                          <div>
                            <input id="lv-code" name="code" class="form-control" maxlength="20" [placeholder]="'e.g. ZEDX' | t: 'staff.levels.edit.code.placeholder'" [(ngModel)]="e.code" />
                            <small class="muted d-block">{{ "Letters and digits; stored with the level's questionnaire, fees and certificates, so it cannot change later." | t: 'staff.levels.edit.code.note' }}</small>
                          </div>
                        }
                        <label for="lv-name">{{ 'Name' | t: 'staff.levels.edit.name.label' }}<span class="req">*</span></label>
                        <input id="lv-name" name="name" class="form-control" maxlength="100" [(ngModel)]="e.name" />
                        <label for="lv-desc" class="top">{{ 'Description' | t: 'staff.levels.edit.description.label' }}</label>
                        <textarea id="lv-desc" name="description" class="form-control" rows="2" maxlength="1000" [(ngModel)]="e.description"></textarea>
                        <label for="lv-comment" class="top">{{ 'Comment' | t: 'staff.levels.edit.comment.label' }}</label>
                        <div>
                          <textarea id="lv-comment" name="comment" class="form-control" rows="3" maxlength="2000" [(ngModel)]="e.comment"></textarea>
                          <small class="muted d-block">{{ 'The information text of the box (its "i").' | t: 'staff.levels.edit.comment.note' }}</small>
                        </div>
                        @if (!e.isNew) {
                          <label for="lv-logo">{{ 'Logo' | t: 'staff.levels.edit.logo.label' }}</label>
                          <div class="lv-logo-row">
                            @if (logoOf(e.code); as url) { <img [src]="url" [alt]="'Current logo' | t: 'staff.levels.edit.logo.currentAlt'" class="lv-logo-small" /> }
                            <!-- 2026-11-19 (admin audit): a styled upload control instead of the browser's native file input. -->
                            <input id="lv-logo" type="file" class="visually-hidden" accept="image/png,image/jpeg" (change)="pickLogo($event)" />
                            <label class="lv-upload" for="lv-logo">
                              <span class="btn btn-outline-primary btn-sm">{{ logoName() ? ('Choose another' | t: 'staff.levels.edit.logo.anotherButton') : ('Choose logo' | t: 'staff.levels.edit.logo.chooseButton') }}</span>
                              <span class="lv-upload-name" [class.muted]="!logoName()">{{ logoName() || ('No file chosen' | t: 'staff.levels.edit.logo.none') }}</span>
                            </label>
                            <small class="muted d-block w-100">{{ 'PNG or JPG, up to 1 MB.' | t: 'staff.levels.edit.logo.note' }}</small>
                          </div>
                        }
                        <span class="label-like">{{ 'Fees' | t: 'staff.levels.edit.fees.label' }}</span>
                        <div data-edit-fees>
                          @if (feesOf(e.code); as f) { <span>{{ f }}</span> } @else { <span class="lv-fees-missing">{{ 'Not set yet' | t: 'staff.levels.edit.fees.none' }}</span> }
                          <small class="muted d-block">{{ 'With GST, before subsidy. Each MSME sees its own fee on the box.' | t: 'staff.levels.edit.fees.note' }}
                            <a routerLink="/staff/fees" (click)="editing.set(null)">{{ 'Edit in Master → Payments' | t: 'staff.levels.edit.fees.link' }}</a></small>
                        </div>
                        <span class="label-like">{{ 'Shown to MSMEs' | t: 'staff.levels.edit.enabled.label' }}</span>
                        <div class="form-check form-switch lv-switch">
                          <input class="form-check-input" type="checkbox" role="switch" id="lv-enabled" name="isEnabled" [(ngModel)]="e.isEnabled" />
                          <label class="form-check-label" for="lv-enabled">{{ e.isEnabled ? ('Enabled' | t: 'staff.levels.edit.enabled.on') : ('Disabled' | t: 'staff.levels.edit.enabled.off') }}</label>
                        </div>
                        @if (!e.isNew && missingOf(e.code).length) {
                          <span></span>
                          <small class="lv-why d-block">{{ 'Off until ready: add {list} first.' | t: 'staff.levels.edit.why' : { list: listText(missingOf(e.code)) } }}</small>
                        }
                      </div>
                    </div>

                    <div [hidden]="tab() !== 'certificate'">
                      <div class="form-grid">
                        <span class="label-like">{{ 'Assessment' | t: 'staff.levels.edit.flow.label' }}</span>
                        <!-- 2026-11-14 (approved): five flows; those the portal does not run yet show as "available soon". -->
                        <div class="lv-choice lv-flows" role="radiogroup" [attr.aria-label]="'Assessment' | t: 'staff.levels.edit.flow.aria'">
                          @for (f of flows(); track f.value) {
                            @let soon = !e.availableFlows.includes(f.value) && e.assessmentFlow !== f.value;
                            <label class="choice-card" [class.active]="e.assessmentFlow === f.value" [class.is-soon]="soon">
                              <input type="radio" class="form-check-input" name="assessmentFlow" [value]="f.value" [attr.disabled]="soon ? '' : null"
                                     [ngModel]="e.assessmentFlow" (ngModelChange)="setFlow(e, $event)" />
                              <span><strong>{{ f.label }}</strong><small>{{ f.hint }}</small>@if (soon) { <em class="lv-soon">{{ 'Available soon' | t: 'staff.levels.edit.flow.soon' }}</em> }</span>
                            </label>
                          }
                        </div>
                        <!-- 2026-11-16 (approved): the level's NC rounds and days (migration 0086). -->
                        <span class="label-like top">{{ 'Non-conformities' | t: 'staff.levels.edit.nc.label' }}</span>
                        <div class="lv-nc" data-nc>
                          <small class="muted d-block" data-nc-note>{{ ncNote(e.assessmentFlow) }}</small>
                          <div class="lv-nc-row">
                            <label for="lv-nc-rounds">{{ 'NC rounds' | t: 'staff.levels.edit.nc.rounds.label' }}<span class="req">*</span></label>
                            <input id="lv-nc-rounds" name="ncRounds" type="number" min="1" [max]="ncMaxRounds" class="form-control lv-short" [(ngModel)]="e.ncRounds" />
                            <label for="lv-nc-days">{{ 'Days to close' | t: 'staff.levels.edit.nc.days.label' }}<span class="req">*</span></label>
                            <input id="lv-nc-days" name="ncDays" type="number" min="1" [max]="ncMaxDays" class="form-control lv-short" [(ngModel)]="e.ncDays" />
                          </div>
                          <small class="muted d-block">{{ '1 to {max} rounds. The days count from the first NC and cover every round; after that the application is rejected automatically.' | t: 'staff.levels.edit.nc.note' : { max: ncMaxRounds } }}</small>
                        </div>
                        <!-- 2026-11-18 (migration 0101): man-days of the site assessment and the surveillance visit (monitoring's "submission pending"). -->
                        <span class="label-like top">{{ 'Man-days' | t: 'staff.levels.edit.manDays.label' }}</span>
                        <div class="lv-nc" data-man-days>
                          <div class="lv-nc-row">
                            <label for="lv-man-days">{{ 'Assessment' | t: 'staff.levels.edit.manDays.assessment.label' }}</label>
                            <input id="lv-man-days" name="manDays" type="number" min="1" max="30" class="form-control lv-short" [placeholder]="'Not set' | t: 'staff.levels.edit.manDays.assessment.placeholder'" [(ngModel)]="e.manDays" />
                            <label for="lv-surv-man-days">{{ 'Surveillance' | t: 'staff.levels.edit.manDays.surveillance.label' }}</label>
                            <input id="lv-surv-man-days" name="surveillanceManDays" type="number" min="1" max="30" class="form-control lv-short" [placeholder]="'Not set' | t: 'staff.levels.edit.manDays.surveillance.placeholder'" [(ngModel)]="e.surveillanceManDays" />
                          </div>
                          <small class="muted d-block">{{ 'Days a site visit takes (1 to 30). A visit still not submitted through the mobile app this many days after it started shows as "Submission pending through mobile app" in monitoring. Blank = not set.' | t: 'staff.levels.edit.manDays.note' }}</small>
                        </div>
                        <label for="lv-validity">{{ 'Valid for (months)' | t: 'staff.levels.edit.validity.label' }}<span class="req">*</span></label>
                        <div class="lv-surv">
                          <input id="lv-validity" name="validityMonths" type="number" min="1" max="120" class="form-control lv-short" [(ngModel)]="e.validityMonths" />
                          @if (e.validityMonths) { <span class="muted">{{ months(e.validityMonths) }}</span> }
                        </div>
                        <label for="lv-format">{{ 'Certificate number' | t: 'staff.levels.edit.format.label' }}<span class="req">*</span></label>
                        <div>
                          <input id="lv-format" name="certNoFormat" class="form-control lv-mono" maxlength="100" [(ngModel)]="e.certNoFormat" />
                          <small class="muted d-block">{{ 'e.g.' | t: 'staff.levels.edit.format.example' }} <code>{{ preview(e.certNoFormat, e.code, null) }}</code></small>
                          @if (builtIn(e.code)) {
                            <!-- 2026-11-08: the legacy procedures number Bronze, Silver and Gold certificates and set their first surveillance. -->
                            <small class="lv-builtin d-block" data-builtin-note>{{ 'Bronze, Silver and Gold certificates keep the number the certification gives them (date_ZED number) and their usual first surveillance date; these formats apply to ZED-X and the levels you add.' | t: 'staff.levels.edit.format.builtInNote' }}</small>
                          }
                        </div>
                        <label for="lv-format-m">{{ 'Manufacturing units' | t: 'staff.levels.edit.format.manufacturing.label' }}</label>
                        <div>
                          <input id="lv-format-m" name="certNoFormatManufacturing" class="form-control lv-mono" maxlength="100" [placeholder]="'Same as above' | t: 'staff.levels.edit.format.manufacturing.placeholder'" [(ngModel)]="e.certNoFormatManufacturing" />
                          @if (e.certNoFormatManufacturing.trim()) { <small class="muted d-block">{{ 'e.g.' | t: 'staff.levels.edit.format.example' }} <code>{{ preview(e.certNoFormatManufacturing, e.code, 'Manufacturing') }}</code></small> }
                        </div>
                        <label for="lv-format-s">{{ 'Services units' | t: 'staff.levels.edit.format.services.label' }}</label>
                        <div>
                          <input id="lv-format-s" name="certNoFormatService" class="form-control lv-mono" maxlength="100" [placeholder]="'Same as above' | t: 'staff.levels.edit.format.services.placeholder'" [(ngModel)]="e.certNoFormatService" />
                          @if (e.certNoFormatService.trim()) { <small class="muted d-block">{{ 'e.g.' | t: 'staff.levels.edit.format.example' }} <code>{{ preview(e.certNoFormatService, e.code, 'Services') }}</code></small> }
                        </div>
                        <span class="label-like top">{{ 'Parts' | t: 'staff.levels.edit.parts.label' }}</span>
                        <div class="lv-tokens">
                          @for (t of tokens(); track t) { <code class="token">{{ t }}</code> }
                          <small class="muted d-block w-100">{{ partsNote() }}</small>
                        </div>
                      </div>
                    </div>

                    <div [hidden]="tab() !== 'surveillance'">
                      <div class="form-grid">
                        <span class="label-like">{{ 'Surveillance' | t: 'staff.levels.edit.surveillance.label' }}</span>
                        <div class="lv-surv">
                          <div class="form-check form-switch lv-switch">
                            <input class="form-check-input" type="checkbox" role="switch" id="lv-surv" name="surveillanceEnabled" [(ngModel)]="e.surveillanceEnabled" />
                            <label class="form-check-label" for="lv-surv">{{ e.surveillanceEnabled ? ('Yes, first one due after' | t: 'staff.levels.edit.surveillance.on') : ('No surveillance' | t: 'staff.levels.edit.surveillance.off') }}</label>
                          </div>
                          @if (e.surveillanceEnabled) {
                            <input id="lv-first" name="firstSurveillanceMonths" type="number" min="1" max="120" class="form-control lv-short" [attr.aria-label]="'First surveillance due after (months)' | t: 'staff.levels.edit.surveillance.firstAria'" [(ngModel)]="e.firstSurveillanceMonths" />
                            <span>{{ 'months' | t: 'staff.levels.edit.surveillance.firstMonths' }}</span>
                          }
                        </div>
                        @if (e.surveillanceEnabled) {
                          <!-- 2026-11-14 (approved): how the surveillance is assessed. -->
                          <span class="label-like">{{ 'Mode of assessment' | t: 'staff.levels.edit.surveillanceMode.label' }}</span>
                          <div class="lv-choice lv-flows" role="radiogroup" [attr.aria-label]="'Surveillance mode of assessment' | t: 'staff.levels.edit.surveillanceMode.aria'">
                            @for (m of surveillanceModes(); track m.value) {
                              @let soon = !e.availableSurveillanceModes.includes(m.value) && e.surveillanceMode !== m.value;
                              <label class="choice-card" [class.active]="e.surveillanceMode === m.value" [class.is-soon]="soon">
                                <input type="radio" class="form-check-input" name="surveillanceMode" [value]="m.value" [attr.disabled]="soon ? '' : null" [(ngModel)]="e.surveillanceMode" />
                                <span><strong>{{ m.label }}</strong><small>{{ m.hint }}</small>@if (soon) { <em class="lv-soon">{{ 'Available soon' | t: 'staff.levels.edit.surveillanceMode.soon' }}</em> }</span>
                              </label>
                            }
                          </div>
                        }
                        @if (e.surveillanceEnabled) {
                          <label for="lv-count">{{ 'Surveillances' | t: 'staff.levels.edit.count.label' }}<span class="req">*</span></label>
                          <div class="lv-surv">
                            <input id="lv-count" name="surveillanceCount" type="number" min="1" max="5" class="form-control lv-short" [(ngModel)]="e.surveillanceCount" />
                            @if ((e.surveillanceCount ?? 0) > 1) {
                              <span>{{ 'one every' | t: 'staff.levels.edit.count.every' }}</span>
                              <input id="lv-interval" name="surveillanceIntervalMonths" type="number" min="1" max="60" class="form-control lv-short" [attr.aria-label]="'Months between two surveillances' | t: 'staff.levels.edit.count.intervalAria'" [(ngModel)]="e.surveillanceIntervalMonths" />
                              <span>{{ 'months' | t: 'staff.levels.edit.count.months' }}</span>
                            }
                          </div>
                          <label for="lv-notice">{{ 'Notice mail' | t: 'staff.levels.edit.notice.label' }}<span class="req">*</span></label>
                          <div class="lv-surv">
                            <input id="lv-notice" name="surveillanceNoticeMonths" type="number" min="0" max="24" class="form-control lv-short" [(ngModel)]="e.surveillanceNoticeMonths" />
                            <span>{{ 'months before the due date' | t: 'staff.levels.edit.notice.months' }}</span>
                          </div>
                          <label for="lv-reminders">{{ 'Reminders' | t: 'staff.levels.edit.reminders.label' }}<span class="req">*</span></label>
                          <div class="lv-surv">
                            <input id="lv-reminders" name="surveillanceReminders" type="number" min="0" max="5" class="form-control lv-short" [(ngModel)]="e.surveillanceReminders" />
                            @if ((e.surveillanceReminders ?? 0) > 0) {
                              <span>{{ 'one every' | t: 'staff.levels.edit.reminders.every' }}</span>
                              <input id="lv-every" name="surveillanceReminderEveryMonths" type="number" min="1" max="12" class="form-control lv-short" [attr.aria-label]="'Months between reminders' | t: 'staff.levels.edit.reminders.everyAria'" [(ngModel)]="e.surveillanceReminderEveryMonths" />
                              <span>{{ 'months after the notice' | t: 'staff.levels.edit.reminders.months' }}</span>
                            }
                          </div>
                          @if (autoApplies(e) && (e.surveillanceReminders ?? 0) > 0) {
                            <span></span>
                            <div class="form-check lv-check">
                              <input class="form-check-input" type="checkbox" id="lv-autoapply" name="surveillanceAutoApply" [(ngModel)]="e.surveillanceAutoApply" />
                              <label class="form-check-label" for="lv-autoapply">{{ "On the last reminder, the portal applies for the surveillance on the unit's behalf (as Bronze)" | t: 'staff.levels.edit.autoApply.label' }}</label>
                            </div>
                          }
                          <label for="lv-suspend-in">{{ 'Suspension' | t: 'staff.levels.edit.suspension.label' }}<span class="req">*</span></label>
                          <div class="lv-surv">
                            <select id="lv-suspend-in" name="surveillanceSuspendRounds" class="form-select lv-select" [(ngModel)]="e.surveillanceSuspendRounds">
                              <option [ngValue]="null">{{ 'In every surveillance' | t: 'staff.levels.edit.suspension.everyOption' }}</option>
                              <option [ngValue]="1">{{ 'In the first surveillance only' | t: 'staff.levels.edit.suspension.firstOption' }}</option>
                              <option [ngValue]="0">{{ 'Never' | t: 'staff.levels.edit.suspension.neverOption' }}</option>
                            </select>
                            @if (e.surveillanceSuspendRounds !== 0) {
                              <input id="lv-suspend" name="surveillanceSuspendAfterMonths" type="number" min="0" max="24" class="form-control lv-short" [attr.aria-label]="'Suspended months after the due date' | t: 'staff.levels.edit.suspension.monthsAria'" [(ngModel)]="e.surveillanceSuspendAfterMonths" />
                              <span>{{ 'months after the due date, if not applied for' | t: 'staff.levels.edit.suspension.months' }}</span>
                            }
                          </div>
                          @if (e.surveillanceSuspendRounds !== 0) {
                            <label for="lv-withdraw">{{ 'Withdrawal' | t: 'staff.levels.edit.withdrawal.label' }}<span class="req">*</span></label>
                            <div class="lv-surv">
                              <input id="lv-withdraw" name="surveillanceWithdrawAfterDays" type="number" min="1" max="365" class="form-control lv-short" [(ngModel)]="e.surveillanceWithdrawAfterDays" />
                              <span>{{ 'days after the suspension' | t: 'staff.levels.edit.withdrawal.days' }}</span>
                            </div>
                          }
                        }
                      </div>
                      @if (e.surveillanceEnabled) {
                        <p class="lv-note mt-3 mb-0">{{ scheduleSummary(e) }} {{ scheduleStart(e) }}</p>
                      }
                    </div>
                  </div>

                  <aside class="lv-preview" [attr.aria-label]="'Preview' | t: 'staff.levels.preview.aria'">
                    <h4>{{ 'Dashboard box' | t: 'staff.levels.preview.box.title' }}</h4>
                    <div class="pv-box" [style.--accent]="accent(e.code)" [class.is-off]="!e.isEnabled">
                      <div class="pv-head">{{ '{level} CERTIFICATION' | t: 'staff.levels.card.title' : { level: ((e.name || ('Name' | t: 'staff.levels.preview.box.noName')) | uppercase) } }}</div>
                      <div class="pv-body">
                        <div>
                          <div class="pv-status">{{ '→ Get started' | t: 'staff.levels.preview.box.status' }}</div>
                          <div class="pv-steps"><i></i><i></i><i></i>@if (e.assessmentMode === 'Site') {<i></i>}</div>
                        </div>
                        @if (logoOf(e.code); as url) { <img class="pv-logo" [src]="url" alt="" /> } @else { <span class="pv-logo pv-logo-none">{{ e.name || '?' }}</span> }
                      </div>
                      @if (e.description) { <p class="pv-desc">{{ e.description }}</p> }
                      @if (feesOf(e.code); as f) { <div class="pv-fee">{{ f }}</div> }
                    </div>
                    <small class="muted d-block mt-1">{{ e.isEnabled ? ('Shown on the MSME dashboard.' | t: 'staff.levels.preview.box.shown') : ('Hidden from MSMEs until enabled.' | t: 'staff.levels.preview.box.hidden') }}</small>

                    <h4 class="mt-3">{{ 'Certificate numbers' | t: 'staff.levels.preview.numbers.title' }}</h4>
                    <dl class="pv-numbers">
                      <dt>{{ 'General' | t: 'staff.levels.preview.numbers.general' }}</dt><dd><code>{{ preview(e.certNoFormat, e.code, null) }}</code></dd>
                      <dt>{{ 'Manufacturing' | t: 'staff.levels.preview.numbers.manufacturing' }}</dt><dd><code>{{ preview(e.certNoFormatManufacturing.trim() || e.certNoFormat, e.code, 'Manufacturing') }}</code></dd>
                      <dt>{{ 'Services' | t: 'staff.levels.preview.numbers.services' }}</dt><dd><code>{{ preview(e.certNoFormatService.trim() || e.certNoFormat, e.code, 'Services') }}</code></dd>
                    </dl>

                    @if (timeline(e); as tl) {
                      <h4 class="mt-3">{{ 'Over {period}' | t: 'staff.levels.preview.timeline.title' : { period: months(e.validityMonths ?? 0) } }}</h4>
                      <div class="pv-timeline" role="img" [attr.aria-label]="tl.label">
                        <div class="tl-bar"></div>
                        @for (d of tl.due; track $index) {
                          <span class="tl-mark" [style.left.%]="d.at" [title]="'Surveillance {number}: month {month}' | t: 'staff.levels.preview.timeline.markTooltip' : { number: $index + 1, month: d.month }"><b>{{ 'S{number}' | t: 'staff.levels.preview.timeline.mark' : { number: $index + 1 } }}</b><small>{{ '{months}m' | t: 'staff.levels.preview.timeline.months' : { months: d.month } }}</small></span>
                        }
                        <span class="tl-end"><small>{{ '{months}m' | t: 'staff.levels.preview.timeline.months' : { months: e.validityMonths } }}</small></span>
                      </div>
                      <small class="muted d-block">{{ 'S = surveillance due, months after certification.' | t: 'staff.levels.preview.timeline.note' }}</small>
                    }
                  </aside>
                </div>
                @if (editError()) { <div class="alert alert-danger help-block mt-3 mb-0" role="alert">{{ editError() }}</div> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.levels.edit.cancelButton' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ e.isNew ? ('Add level' | t: 'staff.levels.edit.addButton') : ('Update' | t: 'staff.levels.edit.updateButton') }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  // The readiness checklist's and the pop-up's rules are in their own files (the per-file style budget).
  styleUrls: ['./certification-levels-checklist.scss', './certification-levels-dialog.scss'],
  styles: `
    .lv-builtin { margin-top: 4px; font-size: 12px; color: #8a6100; background: #fff4d6; border-radius: 6px; padding: 4px 8px; }
    .page-head { align-items: center; }
    .lv-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; color: #5f6f70; font-size: 14px; margin: -4px 0 14px; }
    .lv-summary strong { color: #23474a; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #b7c3c4; }
    .dot.on { background: #2e9e5b; }

    /* A card per level, with the level's colour on top. */
    .lv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 16px; }
    .lv-box { --accent: #45a5ad; position: relative; display: flex; flex-direction: column; gap: 10px; padding: 18px 16px 14px; background: #fff;
      border: 1px solid #dfe9ea; border-radius: 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); overflow: hidden; transition: box-shadow .15s; }
    .lv-box:hover { box-shadow: 0 6px 18px rgba(16, 61, 64, 0.12); }
    .lv-band { position: absolute; inset: 0 0 auto 0; height: 5px; background: var(--accent); }
    .lv-box.is-off { background: #f6f8f8; }
    .lv-box.is-off .lv-band { opacity: .35; }
    .lv-box.is-off .lv-logo, .lv-box.is-off h5, .lv-box.is-off .lv-desc { opacity: .55; }
    .lv-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .lv-top .status-badge { text-transform: none; letter-spacing: 0; white-space: nowrap; flex: none; }
    .lv-logo { height: 72px; max-width: 150px; object-fit: contain; }
    .lv-logo-none { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; padding: 0 10px; border-radius: 50%;
      background: linear-gradient(135deg, #2e858c, #23474a); color: #fff; font-weight: 800; letter-spacing: .5px; }
    .lv-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .lv-title { min-height: 44px; align-content: flex-start; }
    .lv-box h5 { margin: 0; font-size: 15px; font-weight: 800; color: #23474a; letter-spacing: .3px; }
    .lv-code { font-size: 11.5px; color: #23474a; background: #eef6f6; border-radius: 10px; padding: 1px 8px; }
    .lv-desc { margin: 0; font-size: 13px; line-height: 1.45; color: #3b4b4c; min-height: 4.35em; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .lv-facts { margin: 0; font-size: 13px; border-top: 1px solid #eef3f3; }
    .lv-facts > div { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; padding: 6px 0; border-bottom: 1px solid #eef3f3; }
    .lv-facts dt { font-weight: 600; color: #5f6f70; }
    .lv-facts dd { margin: 0; overflow-wrap: break-word; color: #232527; }
    .lv-sample { font-size: 12px; color: #23474a; background: #f4f8f8; border-radius: 4px; padding: 1px 6px; }
    .lv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: auto; padding-top: 4px; }
    .lv-actions .btn { white-space: nowrap; }
    .lv-note { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: #5f6f70; background: none; }
    .info-dot { flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif; }

    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class CertificationLevelsPage {
  /** Bronze, Silver and Gold: numbered by the legacy procedures (the format fields do not apply to them). */
  /** "Micro ₹ 10,000 · Small ₹ 20,000 · Medium ₹ 30,000" from Master → Payments (2026-11-08). */
  protected feeText(i: LevelItem): string {
    return (i.fees ?? [])
      .filter((f) => f.total !== null)
      .map((f) => `${f.type} ₹ ${Math.round(f.total!).toLocaleString('en-IN')}`)
      .join(' · ');
  }

  protected feesOf(code: string | null | undefined): string | null {
    const item = this.levels().find((i) => i.level.code === code);
    return item && item.fees?.length ? this.feeText(item) || null : null;
  }

  protected readonly artworkKinds = computed<readonly { key: ArtworkKind; label: string }[]>(() => [
    { key: 'certificate', label: t('staff.levels.checklist.artwork.certificateButton', 'Certificate') },
    { key: 'report', label: t('staff.levels.checklist.artwork.reportButton', 'Report') },
  ]);

  /** The checklist's link to the agencies' level allocation: its tooltip. */
  protected agenciesLinkTitle(): string {
    return t('staff.levels.checklist.agencies.linkTooltip', "The Master Admin's Agency Level Allocation");
  }

  /** The certificate number's parts: the note under them. */
  protected partsNote(): string {
    return t('staff.levels.edit.parts.note', 'A number must include {zedId} or {zedNo}. The Manufacturing / Services formats apply once filled in.',
      { zedId: '{ZEDID}', zedNo: '{ZEDNO}' });
  }
  /** The artwork shown in the preview pop-up. */
  protected readonly artwork = signal<{ name: string; kind: ArtworkKind; url: string | null; message: string } | null>(null);

  /** The checklist of a level the Admin added; none for the built-in levels (ready by themselves) or an older server. */
  protected checklist(i: LevelItem): LevelReadiness | null {
    return i.readiness && !BUILT_IN_LEVELS.includes(i.level.code.toLowerCase()) ? i.readiness : null;
  }

  protected doneCount(r: LevelReadiness): number {
    return 1 + [r.questionnaire, r.fees, r.artwork, r.agencies, r.columns].filter(Boolean).length;
  }

  /** What the server wants before it enables the level (CertificationLevelsController: questionnaire, fees, artwork, columns). */
  protected missing(i: LevelItem): string[] {
    const r = this.checklist(i);
    if (!r) return [];
    return [
      !r.questionnaire && t('staff.levels.missing.questionnaire', 'the questionnaire'),
      !r.fees && t('staff.levels.missing.fees', 'the fees in Master → Payments'),
      !r.artwork && t('staff.levels.missing.artwork', 'the certificate and report artwork'),
      !r.columns && t('staff.levels.missing.columns', 'the database columns ({reason})',
        { reason: r.columnsMessage || t('staff.levels.missing.columnsReason', 'ready after the next update') }),
    ].filter((m): m is string => !!m);
  }

  protected missingOf(code: string): string[] {
    const item = this.levels().find((i) => i.level.code === code);
    return item ? this.missing(item) : [];
  }

  /** "a, b and c". */
  protected listText(items: readonly string[]): string {
    return items.length > 1 ? t('staff.levels.list.and', '{items} and {last}', { items: items.slice(0, -1).join(', '), last: items[items.length - 1] }) : (items[0] ?? '');
  }

  /** Uploads the background image of the level's certificate or report (JPG / PNG, up to 2 MB). */
  protected async uploadArtwork(code: string, kind: ArtworkKind, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    input.value = '';
    if (!file) return;
    this.error.set('');
    if (file.size > 2 * 1024 * 1024 || !/\.(png|jpe?g)$/i.test(file.name)) {
      this.error.set(t('staff.levels.error.artworkFile', 'Please choose a JPG or PNG image of up to 2 MB.'));
      return;
    }
    this.busy.set(true);
    try {
      const form = new FormData();
      form.append('file', file, file.name);
      const r = await firstValueFrom(this.http.post<MessageResponse>(`${API}/${encodeURIComponent(code)}/artwork`, form, { params: { kind } }));
      this.toast.success(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Shows the level's certificate or report artwork (the server's image, read as the Admin). */
  protected async viewArtwork(l: CertificationLevel, kind: ArtworkKind): Promise<void> {
    this.closeArtwork();
    this.busy.set(true);
    try {
      const blob = await firstValueFrom(this.http.get(`${API}/${encodeURIComponent(l.code)}/artwork`, { params: { kind }, responseType: 'blob' }));
      const url = typeof URL.createObjectURL === 'function' ? URL.createObjectURL(blob) : null;
      this.artwork.set({ name: l.name, kind, url, message: url ? '' : t('staff.levels.artwork.cannotShow', 'The image cannot be shown in this browser.') });
    } catch (err) {
      const notFound = err instanceof HttpErrorResponse && err.status === 404;
      const none = kind === 'certificate' ? t('staff.levels.artwork.noCertificate', 'No certificate artwork uploaded yet.')
        : t('staff.levels.artwork.noReport', 'No report artwork uploaded yet.');
      this.artwork.set({ name: l.name, kind, url: null, message: notFound ? none : apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected closeArtwork(): void {
    const url = this.artwork()?.url;
    if (url && typeof URL.revokeObjectURL === 'function') URL.revokeObjectURL(url);
    this.artwork.set(null);
  }

  protected builtIn(code: string | null | undefined): boolean {
    return code === 'Bronze' || code === 'Silver' || code === 'Gold';
  }
  private readonly portals = inject(AdminPortalService);
  private readonly confirms = inject(ConfirmService);
  /** 2026-11-19 (admin audit): the saved message as a toast at the bottom, where Update was clicked (the top alert was out of view). */
  private readonly toast = inject(ToastService);
  private readonly http = inject(HttpClient);

  protected readonly levels = signal<LevelItem[]>([]);
  protected readonly enabledCount = computed(() => this.levels().filter((i) => i.level.isEnabled).length);
  protected readonly tabs = computed<readonly { key: EditTab; label: string }[]>(() => [
    { key: 'box', label: t('staff.levels.edit.tab.box', 'Dashboard box') },
    { key: 'certificate', label: t('staff.levels.edit.tab.certificate', 'Certificate') },
    { key: 'surveillance', label: t('staff.levels.edit.tab.surveillance', 'Surveillance') },
  ]);
  protected readonly tab = signal<EditTab>('box');
  protected readonly tokens = signal<string[]>([]);
  protected readonly stored = signal(false);
  protected readonly loaded = signal(false);
  protected readonly editing = signal<LevelForm | null>(null);
  protected readonly editError = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  private logo: File | null = null;
  /** The chosen logo file's name, shown by the upload control. */
  protected readonly logoName = signal('');

  constructor() {
    void this.load();
  }

  protected months(n: number): string {
    if (n % 12 !== 0) return t('staff.levels.months', '{count} months', { count: n });
    return n === 12 ? t('staff.levels.year', '{count} year', { count: n / 12 }) : t('staff.levels.years', '{count} years', { count: n / 12 });
  }

  protected surveillanceFact(l: CertificationLevel): string {
    if (!l.surveillanceEnabled) return t('staff.levels.fact.surveillanceNone', 'none');
    const first = l.firstSurveillanceMonths ?? DEFAULT_SCHEDULE.firstSurveillanceMonths;
    const count = l.surveillanceCount ?? DEFAULT_SCHEDULE.surveillanceCount;
    const every = l.surveillanceIntervalMonths ?? DEFAULT_SCHEDULE.surveillanceIntervalMonths;
    return count > 1 ? t('staff.levels.fact.surveillanceMany', '{count}, after {first} months, then every {every}', { count, first, every })
      : t('staff.levels.fact.surveillanceOne', '1, after {period}', { period: this.months(first) });
  }

  /** "Due at 15 and 27 months after certification." */
  protected scheduleSummary(e: LevelForm): string {
    const first = e.firstSurveillanceMonths ?? 0, count = e.surveillanceCount ?? 0, every = e.surveillanceIntervalMonths ?? 0;
    if (first < 1 || count < 1 || count > 5 || (count > 1 && every < 1)) return '';
    const due = Array.from({ length: count }, (_, i) => first + i * every);
    return due.length > 1
      ? t('staff.levels.schedule.dueMany', 'Due at {list} and {last} months after certification.', { list: due.slice(0, -1).join(', '), last: due[due.length - 1] })
      : t('staff.levels.schedule.dueOne', 'Due at {month} months after certification.', { month: due[0] });
  }

  /** The portal applies a unit for its surveillance only for Bronze (CertificationLevelsController.AutoApplies). */
  protected autoApplies(e: LevelForm): boolean {
    return e.code.toLowerCase() === 'bronze' && e.assessmentMode === 'Desktop';
  }

  /** When the V4 schedule took the level over (Bronze / Silver / Gold: the day their legacy jobs were switched off). */
  protected scheduleStart(e: LevelForm): string {
    const from = e.surveillanceScheduleFrom ? new Date(e.surveillanceScheduleFrom) : null;
    if (!from || Number.isNaN(from.getTime())) return '';
    if (from.getFullYear() === 9999) return t('staff.levels.schedule.notStarted', 'These timings apply from the day the new surveillance schedule is switched on for this level.');
    const day = from.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    return t('staff.levels.schedule.since', 'Run by the new surveillance schedule since {day}; a step that fell due before that day was not done.', { day });
  }

  protected accent(code: string): string {
    return ACCENTS[(code || '').toUpperCase()] ?? '#45a5ad';
  }

  /** The surveillance due dates along the validity, for the preview; null when there is nothing to draw. */
  protected timeline(e: LevelForm): { due: { month: number; at: number }[]; label: string } | null {
    const validity = e.validityMonths ?? 0, first = e.firstSurveillanceMonths ?? 0;
    if (!e.surveillanceEnabled || validity < 1 || first < 1) return null;
    const count = Math.min(Math.max(e.surveillanceCount ?? 1, 1), 5);
    const every = e.surveillanceIntervalMonths ?? 0;
    const due = Array.from({ length: count }, (_, i) => first + i * (count > 1 ? every : 0))
      .filter((m) => m > 0 && m < validity)
      .map((month) => ({ month, at: (month / validity) * 100 }));
    return due.length
      ? { due, label: t('staff.levels.preview.timeline.aria', 'Surveillance due at {months} months of {validity}', { months: due.map((d) => d.month).join(', '), validity }) }
      : null;
  }

  protected preview(format: string, code: string, category: 'Manufacturing' | 'Services' | null): string {
    return formatCertificateNo(format, new Date(), sampleZedId(category), code || 'LEVEL', category);
  }

  protected logoOf(code: string): string | null {
    return this.levels().find((l) => l.level.code === code)?.logoUrl ?? null;
  }

  protected startAdd(): void {
    this.logo = null;
    this.logoName.set('');
    this.tab.set('box');
    this.editError.set('');
    this.editing.set({
      code: '', isNew: true, name: '', description: '', comment: '', isEnabled: false, assessmentMode: 'Site',
      assessmentFlow: 'DesktopOnsite', surveillanceMode: 'Remote', availableFlows: ['Desktop', 'DesktopOnsite'], availableSurveillanceModes: ['Remote'],
      ncRounds: NC_MAX_ROUNDS, ncDays: defaultNcDays('DesktopOnsite'), manDays: null, surveillanceManDays: null,
      validityMonths: 36,
      surveillanceEnabled: true, certNoFormat: '{DDMMYYYY}_{ZEDNO}', certNoFormatManufacturing: '', certNoFormatService: '', fee: null,
      ...DEFAULT_SCHEDULE, surveillanceAutoApply: false, surveillanceSuspendRounds: null, surveillanceScheduleFrom: null,
    });
  }

  protected readonly flows = computed(() => assessmentFlows());
  protected readonly surveillanceModes = computed(() => surveillanceModes());

  /** The level's flow as the list shows it. */
  protected flowOf(l: CertificationLevel): string {
    return flowLabel(this.levels().find((i) => i.level.code === l.code)?.assessmentFlow, l.assessmentMode);
  }

  protected readonly ncNote = ncNote;
  protected readonly ncMaxRounds = NC_MAX_ROUNDS;
  protected readonly ncMaxDays = NC_MAX_DAYS;

  /** The level card's NC line: where they are raised, rounds and days. */
  protected ncFact(i: LevelItem): string {
    const flow = i.assessmentFlow ?? (i.level.assessmentMode === 'Desktop' ? 'Desktop' : 'DesktopOnsite');
    const rounds = i.ncRounds ?? NC_MAX_ROUNDS;
    const stage = ncStage(flow);
    const where = stage === 'desktop' ? t('staff.levels.fact.nc.desktop', 'Desktop')
      : stage === 'remote' ? t('staff.levels.fact.nc.remote', 'Remote') : t('staff.levels.fact.nc.onsite', 'Onsite');
    const days = i.ncDays ?? defaultNcDays(flow);
    return rounds === 1 ? t('staff.levels.fact.nc.round', '{stage}, {rounds} round, {days} days', { stage: where, rounds, days })
      : t('staff.levels.fact.nc.rounds', '{stage}, {rounds} rounds, {days} days', { stage: where, rounds, days });
  }

  /**
   * A flow chosen: the old Desktop / Site follows it (the preview and the Bronze rules read it). The NC days move to the new
   * flow's default while they are still the old flow's default (30 Desktop only, 60 with a visit).
   */
  protected setFlow(e: LevelForm, flow: AssessmentFlow): void {
    const ncDays = e.ncDays === defaultNcDays(e.assessmentFlow) ? defaultNcDays(flow) : e.ncDays;
    this.editing.set({ ...e, assessmentFlow: flow, assessmentMode: flow === 'Desktop' ? 'Desktop' : 'Site', ncDays });
  }

  protected edit(i: LevelItem): void {
    const l = i.level;
    this.logo = null;
    this.logoName.set('');
    this.tab.set('box');
    this.editError.set('');
    this.editing.set({
      code: l.code, isNew: false, name: l.name, description: l.description ?? '', comment: l.comment ?? '', isEnabled: l.isEnabled,
      assessmentMode: l.assessmentMode, validityMonths: l.validityMonths, surveillanceEnabled: l.surveillanceEnabled,
      assessmentFlow: i.assessmentFlow ?? (l.assessmentMode === 'Desktop' ? 'Desktop' : 'DesktopOnsite'), surveillanceMode: i.surveillanceMode ?? 'Remote',
      availableFlows: levelFlowsFor(l.code, i.availableFlows ?? ['Desktop', 'DesktopOnsite']), availableSurveillanceModes: i.availableSurveillanceModes ?? ['Remote'],
      ncRounds: i.ncRounds ?? NC_MAX_ROUNDS,
      ncDays: i.ncDays ?? defaultNcDays(i.assessmentFlow ?? (l.assessmentMode === 'Desktop' ? 'Desktop' : 'DesktopOnsite')),
      manDays: i.manDays ?? null, surveillanceManDays: i.surveillanceManDays ?? null,
      firstSurveillanceMonths: l.firstSurveillanceMonths, certNoFormat: l.certNoFormat, certNoFormatManufacturing: l.certNoFormatManufacturing ?? '',
      certNoFormatService: l.certNoFormatService ?? '', fee: l.fee,
      ...(Object.fromEntries(SCHEDULE_KEYS.map((k) => [k, l[k] ?? DEFAULT_SCHEDULE[k]])) as Record<ScheduleKey, number>),
      surveillanceAutoApply: !!l.surveillanceAutoApply, surveillanceSuspendRounds: l.surveillanceSuspendRounds ?? null,
      surveillanceScheduleFrom: l.surveillanceScheduleFrom ?? null,
    });
  }

  protected pickLogo(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.editError.set('');
    if (file && (file.size > 1024 * 1024 || !/\.(png|jpe?g)$/i.test(file.name))) {
      input.value = '';
      this.logo = null;
      this.logoName.set('');
      this.editError.set(t('staff.levels.error.logoFile', 'Please choose a PNG or JPG image of up to 1 MB.'));
      return;
    }
    this.logo = file;
    this.logoName.set(file?.name ?? '');
  }

  protected async save(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    const problem = this.check(e);
    if (problem) return this.editError.set(problem);
    this.busy.set(true);
    this.editError.set('');
    this.error.set('');
    const body = {
      code: e.isNew ? e.code.trim() : undefined, name: e.name.trim(), description: e.description, comment: e.comment, isEnabled: e.isEnabled,
      assessmentMode: e.assessmentMode, validityMonths: e.validityMonths, surveillanceEnabled: e.surveillanceEnabled,
      assessmentFlow: e.assessmentFlow, surveillanceMode: e.surveillanceMode, ncRounds: e.ncRounds, ncDays: e.ncDays,
      // 0 clears a man-days value (null would keep the stored one).
      manDays: manDaysValue(e.manDays), surveillanceManDays: manDaysValue(e.surveillanceManDays),
      firstSurveillanceMonths: e.surveillanceEnabled ? e.firstSurveillanceMonths : null, certNoFormat: e.certNoFormat.trim(),
      certNoFormatManufacturing: e.certNoFormatManufacturing, certNoFormatService: e.certNoFormatService, fee: e.fee,
      ...(e.surveillanceEnabled
        ? {
            ...Object.fromEntries(SCHEDULE_KEYS.map((k) => [k, e[k]])),
            surveillanceAutoApply: this.autoApplies(e) && (e.surveillanceReminders ?? 0) > 0 && e.surveillanceAutoApply,
            surveillanceSuspendRounds: e.surveillanceSuspendRounds,
          }
        : {}),
    };
    try {
      const level = (context?: HttpContext) => e.isNew
        ? this.http.post<MessageResponse>(API, body, { context })
        : this.http.put<MessageResponse>(`${API}/${encodeURIComponent(e.code)}`, body, { context });
      let message = (await firstValueFrom(level())).message;
      const logo = (context?: HttpContext) => {
        const form = new FormData();
        form.append('file', this.logo!, this.logo!.name);
        return this.http.post<MessageResponse>(`${API}/${encodeURIComponent(e.code)}/logo`, form, { context });
      };
      if (this.logo && !e.isNew) {
        await firstValueFrom(logo());
        message += ' ' + t('staff.levels.toast.logoSaved', 'Logo saved.');
      }
      message += await this.onSurveillance(async (context) => {
        // A level the surveillance portal does not have yet is added there.
        try {
          await firstValueFrom(level(context));
        } catch (err) {
          if (e.isNew || !(err instanceof HttpErrorResponse) || err.status !== 404) throw err;
          await firstValueFrom(this.http.post<MessageResponse>(API, { ...body, code: e.code }, { context }));
        }
        if (this.logo && !e.isNew) await firstValueFrom(logo(context));
      });
      this.editing.set(null);
      this.toast.success(message);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(l: CertificationLevel): Promise<void> {
    if (l.isEnabled && !(await this.confirms.ask({
      title: t('staff.levels.disable.confirm.title', 'Disable {name}?', { name: l.name }),
      message: t('staff.levels.disable.confirm.message', 'MSMEs will no longer see it or apply for it.'),
      confirmLabel: t('staff.levels.disable.confirm.button', 'Disable'), danger: true,
    }))) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const enabled = (context?: HttpContext) => this.http.put<MessageResponse>(`${API}/${encodeURIComponent(l.code)}/enabled`, { enabled: !l.isEnabled }, { context });
      const message = (await firstValueFrom(enabled())).message;
      this.toast.success(message + (await this.onSurveillance(async (context) => { await firstValueFrom(enabled(context)); })));
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * One Admin (V4, main portal): the surveillance portal keeps a copy of the levels (its surveillance procedures read
   * them), so a change saved here is saved there too, through its own API. Returns the note for the message.
   */
  private async onSurveillance(save: (context: HttpContext) => Promise<void>): Promise<string> {
    if (!this.portals.enabled) return '';
    try {
      await save(new HttpContext().set(ADMIN_PORTAL, 'surveillance'));
      return ' ' + t('staff.levels.toast.surveillanceSaved', 'Saved on the Surveillance portal too.');
    } catch (err) {
      return ' ' + t('staff.levels.toast.surveillanceFailed', 'Not saved on the Surveillance portal: {error}', { error: apiErrorMessage(err) });
    }
  }

  /** The server's rules, so most mistakes show before saving. */
  private check(e: LevelForm): string {
    if (e.isNew && !/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(e.code.trim())) return t('staff.levels.error.code', 'The code must be 2 to 20 letters and digits, starting with a letter (e.g. ZEDX).');
    if (!e.name.trim()) return t('staff.levels.error.name', "Please enter the level's name.");
    if (!e.validityMonths || e.validityMonths < 1 || e.validityMonths > 120) return t('staff.levels.error.validity', 'The validity must be 1 to 120 months.');
    if (!Number.isInteger(e.ncRounds) || e.ncRounds! < 1 || e.ncRounds! > NC_MAX_ROUNDS) return t('staff.levels.error.ncRounds', 'NC rounds must be 1 to {max}.', { max: NC_MAX_ROUNDS });
    if (!Number.isInteger(e.ncDays) || e.ncDays! < 1 || e.ncDays! > NC_MAX_DAYS) return t('staff.levels.error.ncDays', 'Days to close NCs must be 1 to {max}.', { max: NC_MAX_DAYS });
    const badManDays = (v: number | null) => manDaysValue(v) !== 0 && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 30);
    if (badManDays(e.manDays)) return t('staff.levels.error.manDaysAssessment', 'Man-days (assessment) must be 1 to 30.');
    if (badManDays(e.surveillanceManDays)) return t('staff.levels.error.manDaysSurveillance', 'Man-days (surveillance) must be 1 to 30.');
    if (e.surveillanceEnabled && (!e.firstSurveillanceMonths || e.firstSurveillanceMonths < 1 || e.firstSurveillanceMonths >= e.validityMonths))
      return t('staff.levels.error.firstSurveillance', 'The first surveillance must be due before the certificate expires.');
    if (e.surveillanceEnabled) {
      const problem = this.checkSchedule(e);
      if (problem) return problem;
    }
    const parts = { zedId: '{ZEDID}', zedNo: '{ZEDNO}' };
    for (const [kind, f, required] of [['general', e.certNoFormat, true], ['manufacturing', e.certNoFormatManufacturing, false], ['services', e.certNoFormatService, false]] as const) {
      const v = f.trim();
      if (!v) {
        if (required) return t('staff.levels.error.format', 'Please enter the certificate number format.');
        continue;
      }
      if (!v.includes('{ZEDID}') && !v.includes('{ZEDNO}')) {
        return kind === 'general' ? t('staff.levels.error.formatId', 'The format must include {zedId} or {zedNo}, so that every certificate gets its own number.', parts)
          : kind === 'manufacturing'
            ? t('staff.levels.error.formatIdManufacturing', 'Manufacturing: The format must include {zedId} or {zedNo}, so that every certificate gets its own number.', parts)
            : t('staff.levels.error.formatIdServices', 'Services: The format must include {zedId} or {zedNo}, so that every certificate gets its own number.', parts);
      }
      const unknown = (v.match(/\{[A-Z]+\}/g) ?? []).find((p) => !this.tokens().includes(p));
      if (unknown) {
        return kind === 'general' ? t('staff.levels.error.formatPart', '{part} is not a known part.', { part: unknown })
          : kind === 'manufacturing' ? t('staff.levels.error.formatPartManufacturing', 'Manufacturing: {part} is not a known part.', { part: unknown })
            : t('staff.levels.error.formatPartServices', 'Services: {part} is not a known part.', { part: unknown });
      }
    }
    return '';
  }

  /** As SurveillanceSchedule.Problem on the server. */
  private checkSchedule(e: LevelForm): string {
    const n = (v: number | null) => (v === null || v === undefined || Number.isNaN(v) ? -1 : v);
    const count = n(e.surveillanceCount), every = n(e.surveillanceIntervalMonths), reminders = n(e.surveillanceReminders);
    if (count < 1 || count > 5) return t('staff.levels.error.surveillanceCount', 'The number of surveillances must be 1 to 5.');
    if (count > 1 && (every < 1 || every > 60)) return t('staff.levels.error.surveillanceInterval', 'The months between two surveillances must be 1 to 60.');
    if (n(e.firstSurveillanceMonths) + (count - 1) * Math.max(every, 0) >= (e.validityMonths ?? 0)) {
      return t('staff.levels.error.lastSurveillance', 'The last surveillance must be due before the certificate expires.');
    }
    if (n(e.surveillanceNoticeMonths) < 0 || n(e.surveillanceNoticeMonths) > 24) return t('staff.levels.error.notice', 'The notice must go 0 to 24 months before the due date.');
    if (reminders < 0 || reminders > 5) return t('staff.levels.error.reminders', 'The reminders must be 0 to 5.');
    if (reminders > 0 && (n(e.surveillanceReminderEveryMonths) < 1 || n(e.surveillanceReminderEveryMonths) > 12)) {
      return t('staff.levels.error.reminderEvery', 'The months between reminders must be 1 to 12.');
    }
    if (n(e.surveillanceSuspendAfterMonths) < 0 || n(e.surveillanceSuspendAfterMonths) > 24) return t('staff.levels.error.suspension', 'The suspension must come 0 to 24 months after the due date.');
    if (n(e.surveillanceWithdrawAfterDays) < 1 || n(e.surveillanceWithdrawAfterDays) > 365) return t('staff.levels.error.withdrawal', 'The withdrawal must come 1 to 365 days after the suspension.');
    return '';
  }

  private async load(): Promise<void> {
    try {
      const r = await firstValueFrom(this.http.get<LevelsResponse>(API));
      this.levels.set(r.levels);
      this.tokens.set(r.tokens);
      this.stored.set(r.stored);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
