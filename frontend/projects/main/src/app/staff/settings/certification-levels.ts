import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { HttpClient, HttpContext, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { ADMIN_PORTAL, AdminPortalService } from '../admin-portal';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

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

interface LevelItem {
  level: CertificationLevel;
  /** A number in the general format, for ZEDMSME129350 today. */
  sample: string;
  logoUrl: string | null;
}

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

/** As CertificateNumbers.Format on the server (the preview of the formats). */
export function formatCertificateNo(format: string, date: Date, zedId: string, level: string, category: 'Manufacturing' | 'Services' | null): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const yyyy = String(date.getFullYear());
  const digits = zedId.length > 7 ? zedId.slice(7) : zedId;
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

const SAMPLE_ZED_ID = 'ZEDMSME129350';

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
  imports: [DecimalPipe, FormsModule, RouterLink, UpperCasePipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Certification Levels</h3>
        <p class="page-sub">The certification boxes MSMEs see, and each level's certificate settings.</p>
      </div>
      <button type="button" class="btn btn-primary" [disabled]="busy() || !stored()" (click)="startAdd()">+ Add level</button>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    @if (loaded() && !stored()) {
      <div class="alert alert-warning" role="alert">These are the built-in levels. They can be changed once the administrator has applied database migration 0028.</div>
    }
    @if (levels().length) {
      <p class="lv-summary">
        <strong>{{ levels().length }}</strong> levels · <span class="dot on"></span>{{ enabledCount() }} shown to MSMEs
        @if (levels().length - enabledCount()) { · <span class="dot"></span>{{ levels().length - enabledCount() }} hidden }
      </p>
    }

    <div class="lv-grid">
      @for (i of levels(); track i.level.code) {
        @let l = i.level;
        <article class="lv-box" [class.is-off]="!l.isEnabled" [attr.aria-label]="l.name" [style.--accent]="accent(l.code)">
          <div class="lv-band"></div>
          <div class="lv-top">
            @if (i.logoUrl) {
              <img class="lv-logo" [src]="i.logoUrl" [alt]="l.name + ' logo'" />
            } @else {
              <span class="lv-logo lv-logo-none" aria-hidden="true">{{ l.name }}</span>
            }
            <span class="status-badge" [class.is-active]="l.isEnabled" [class.is-inactive]="!l.isEnabled">{{ l.isEnabled ? 'Enabled' : 'Disabled' }}</span>
          </div>
          <div class="lv-title">
            <h5>{{ l.name | uppercase }} CERTIFICATION</h5>
            <code class="lv-code" title="Code">{{ l.code }}</code>
          </div>
          @if (l.description) { <p class="lv-desc">{{ l.description }}</p> }
          <dl class="lv-facts">
            <div><dt>Assessment</dt><dd>{{ l.assessmentMode === 'Desktop' ? 'Desktop' : 'Desktop + site' }}</dd></div>
            <div><dt>Valid for</dt><dd>{{ months(l.validityMonths) }}</dd></div>
            <div><dt>Surveillance</dt><dd>{{ surveillanceFact(l) }}</dd></div>
            <div><dt>Certificate no.</dt><dd><code class="lv-sample">{{ i.sample }}</code></dd></div>
            @if (l.fee !== null) { <div><dt>Fee</dt><dd>₹ {{ l.fee | number: '1.0-0' }}</dd></div> }
          </dl>
          <div class="lv-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy() || !stored()" (click)="edit(i)">Edit</button>
            <button type="button" class="btn btn-sm" [class.btn-outline-danger]="l.isEnabled" [class.btn-outline-primary]="!l.isEnabled"
                    [disabled]="busy() || !stored()" [attr.aria-label]="(l.isEnabled ? 'Disable ' : 'Enable ') + l.name" (click)="toggle(l)">{{ l.isEnabled ? 'Disable' : 'Enable' }}</button>
            <a class="btn btn-link btn-sm ms-auto" [routerLink]="['/staff/masters/parameters', l.code]">Questionnaire →</a>
          </div>
        </article>
      }
    </div>
    <p class="lv-note mt-3"><span class="info-dot" aria-hidden="true">i</span> The fees charged are set in Masters → Payments; the questionnaire of each level in the Questionnaire menu.</p>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="lv-edit-title">
        <div class="modal-dialog modal-xl modal-dialog-scrollable lv-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="lv-edit-title">{{ e.isNew ? 'Add level' : 'Edit ' + e.name }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form class="d-contents" (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <div class="lv-tabs" role="tablist" aria-label="Settings">
                  @for (t of tabs; track t.key) {
                    <button type="button" role="tab" class="lv-tab" [class.active]="tab() === t.key" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)">{{ t.label }}</button>
                  }
                </div>
                <div class="lv-edit">
                  <div class="lv-fields">
                    <div [hidden]="tab() !== 'box'">
                      <div class="form-grid">
                        @if (e.isNew) {
                          <label for="lv-code">Code<span class="req">*</span></label>
                          <div>
                            <input id="lv-code" name="code" class="form-control" maxlength="20" placeholder="e.g. ZEDX" [(ngModel)]="e.code" />
                            <small class="muted d-block">Letters and digits; stored with the level's questionnaire, fees and certificates, so it cannot change later.</small>
                          </div>
                        }
                        <label for="lv-name">Name<span class="req">*</span></label>
                        <input id="lv-name" name="name" class="form-control" maxlength="100" [(ngModel)]="e.name" />
                        <label for="lv-desc" class="top">Description</label>
                        <textarea id="lv-desc" name="description" class="form-control" rows="2" maxlength="1000" [(ngModel)]="e.description"></textarea>
                        <label for="lv-comment" class="top">Comment</label>
                        <div>
                          <textarea id="lv-comment" name="comment" class="form-control" rows="3" maxlength="2000" [(ngModel)]="e.comment"></textarea>
                          <small class="muted d-block">The information text of the box (its "i").</small>
                        </div>
                        @if (!e.isNew) {
                          <label for="lv-logo">Logo</label>
                          <div class="lv-logo-row">
                            @if (logoOf(e.code); as url) { <img [src]="url" alt="Current logo" class="lv-logo-small" /> }
                            <input id="lv-logo" type="file" class="form-control" accept="image/png,image/jpeg" (change)="pickLogo($event)" />
                            <small class="muted d-block w-100">PNG or JPG, up to 1 MB.</small>
                          </div>
                        }
                        <label for="lv-fee">Fee shown (₹)</label>
                        <div>
                          <input id="lv-fee" name="fee" type="number" min="0" class="form-control lv-short" [(ngModel)]="e.fee" />
                          <small class="muted d-block">For the box; the amounts charged are in Masters → Payments.</small>
                        </div>
                        <span class="label-like">Shown to MSMEs</span>
                        <div class="form-check form-switch lv-switch">
                          <input class="form-check-input" type="checkbox" role="switch" id="lv-enabled" name="isEnabled" [(ngModel)]="e.isEnabled" />
                          <label class="form-check-label" for="lv-enabled">{{ e.isEnabled ? 'Enabled' : 'Disabled' }}</label>
                        </div>
                      </div>
                    </div>

                    <div [hidden]="tab() !== 'certificate'">
                      <div class="form-grid">
                        <span class="label-like">Assessment</span>
                        <div class="lv-choice" role="radiogroup" aria-label="Assessment">
                          <label class="choice-card" [class.active]="e.assessmentMode === 'Desktop'">
                            <input type="radio" class="form-check-input" name="assessmentMode" value="Desktop" [(ngModel)]="e.assessmentMode" />
                            <span><strong>Desktop only</strong><small>Documents checked remotely, as Bronze.</small></span>
                          </label>
                          <label class="choice-card" [class.active]="e.assessmentMode === 'Site'">
                            <input type="radio" class="form-check-input" name="assessmentMode" value="Site" [(ngModel)]="e.assessmentMode" />
                            <span><strong>Desktop and site</strong><small>Then an assessor visits the unit.</small></span>
                          </label>
                        </div>
                        <label for="lv-validity">Valid for (months)<span class="req">*</span></label>
                        <div class="lv-surv">
                          <input id="lv-validity" name="validityMonths" type="number" min="1" max="120" class="form-control lv-short" [(ngModel)]="e.validityMonths" />
                          @if (e.validityMonths) { <span class="muted">{{ months(e.validityMonths) }}</span> }
                        </div>
                        <label for="lv-format">Certificate number<span class="req">*</span></label>
                        <div>
                          <input id="lv-format" name="certNoFormat" class="form-control lv-mono" maxlength="100" [(ngModel)]="e.certNoFormat" />
                          <small class="muted d-block">e.g. <code>{{ preview(e.certNoFormat, e.code, null) }}</code></small>
                        </div>
                        <label for="lv-format-m">Manufacturing units</label>
                        <div>
                          <input id="lv-format-m" name="certNoFormatManufacturing" class="form-control lv-mono" maxlength="100" placeholder="Same as above" [(ngModel)]="e.certNoFormatManufacturing" />
                          @if (e.certNoFormatManufacturing.trim()) { <small class="muted d-block">e.g. <code>{{ preview(e.certNoFormatManufacturing, e.code, 'Manufacturing') }}</code></small> }
                        </div>
                        <label for="lv-format-s">Services units</label>
                        <div>
                          <input id="lv-format-s" name="certNoFormatService" class="form-control lv-mono" maxlength="100" placeholder="Same as above" [(ngModel)]="e.certNoFormatService" />
                          @if (e.certNoFormatService.trim()) { <small class="muted d-block">e.g. <code>{{ preview(e.certNoFormatService, e.code, 'Services') }}</code></small> }
                        </div>
                        <span class="label-like top">Parts</span>
                        <div class="lv-tokens">
                          @for (t of tokens(); track t) { <code class="token">{{ t }}</code> }
                          <small class="muted d-block w-100">A number must include {{ '{' }}ZEDID{{ '}' }} or {{ '{' }}ZEDNO{{ '}' }}. The Manufacturing / Services formats apply once filled in.</small>
                        </div>
                      </div>
                    </div>

                    <div [hidden]="tab() !== 'surveillance'">
                      <div class="form-grid">
                        <span class="label-like">Surveillance</span>
                        <div class="lv-surv">
                          <div class="form-check form-switch lv-switch">
                            <input class="form-check-input" type="checkbox" role="switch" id="lv-surv" name="surveillanceEnabled" [(ngModel)]="e.surveillanceEnabled" />
                            <label class="form-check-label" for="lv-surv">{{ e.surveillanceEnabled ? 'Yes, first one due after' : 'No surveillance' }}</label>
                          </div>
                          @if (e.surveillanceEnabled) {
                            <input id="lv-first" name="firstSurveillanceMonths" type="number" min="1" max="120" class="form-control lv-short" aria-label="First surveillance due after (months)" [(ngModel)]="e.firstSurveillanceMonths" />
                            <span>months</span>
                          }
                        </div>
                        @if (e.surveillanceEnabled) {
                          <label for="lv-count">Surveillances<span class="req">*</span></label>
                          <div class="lv-surv">
                            <input id="lv-count" name="surveillanceCount" type="number" min="1" max="5" class="form-control lv-short" [(ngModel)]="e.surveillanceCount" />
                            @if ((e.surveillanceCount ?? 0) > 1) {
                              <span>one every</span>
                              <input id="lv-interval" name="surveillanceIntervalMonths" type="number" min="1" max="60" class="form-control lv-short" aria-label="Months between two surveillances" [(ngModel)]="e.surveillanceIntervalMonths" />
                              <span>months</span>
                            }
                          </div>
                          <label for="lv-notice">Notice mail<span class="req">*</span></label>
                          <div class="lv-surv">
                            <input id="lv-notice" name="surveillanceNoticeMonths" type="number" min="0" max="24" class="form-control lv-short" [(ngModel)]="e.surveillanceNoticeMonths" />
                            <span>months before the due date</span>
                          </div>
                          <label for="lv-reminders">Reminders<span class="req">*</span></label>
                          <div class="lv-surv">
                            <input id="lv-reminders" name="surveillanceReminders" type="number" min="0" max="5" class="form-control lv-short" [(ngModel)]="e.surveillanceReminders" />
                            @if ((e.surveillanceReminders ?? 0) > 0) {
                              <span>one every</span>
                              <input id="lv-every" name="surveillanceReminderEveryMonths" type="number" min="1" max="12" class="form-control lv-short" aria-label="Months between reminders" [(ngModel)]="e.surveillanceReminderEveryMonths" />
                              <span>months after the notice</span>
                            }
                          </div>
                          @if (e.assessmentMode === 'Desktop' && (e.surveillanceReminders ?? 0) > 0) {
                            <span></span>
                            <div class="form-check lv-check">
                              <input class="form-check-input" type="checkbox" id="lv-autoapply" name="surveillanceAutoApply" [(ngModel)]="e.surveillanceAutoApply" />
                              <label class="form-check-label" for="lv-autoapply">On the last reminder, the portal applies for the surveillance on the unit's behalf (as Bronze)</label>
                            </div>
                          }
                          <label for="lv-suspend-in">Suspension<span class="req">*</span></label>
                          <div class="lv-surv">
                            <select id="lv-suspend-in" name="surveillanceSuspendRounds" class="form-select lv-select" [(ngModel)]="e.surveillanceSuspendRounds">
                              <option [ngValue]="null">In every surveillance</option>
                              <option [ngValue]="1">In the first surveillance only</option>
                              <option [ngValue]="0">Never</option>
                            </select>
                            @if (e.surveillanceSuspendRounds !== 0) {
                              <input id="lv-suspend" name="surveillanceSuspendAfterMonths" type="number" min="0" max="24" class="form-control lv-short" aria-label="Suspended months after the due date" [(ngModel)]="e.surveillanceSuspendAfterMonths" />
                              <span>months after the due date, if not applied for</span>
                            }
                          </div>
                          @if (e.surveillanceSuspendRounds !== 0) {
                            <label for="lv-withdraw">Withdrawal<span class="req">*</span></label>
                            <div class="lv-surv">
                              <input id="lv-withdraw" name="surveillanceWithdrawAfterDays" type="number" min="1" max="365" class="form-control lv-short" [(ngModel)]="e.surveillanceWithdrawAfterDays" />
                              <span>days after the suspension</span>
                            </div>
                          }
                        }
                      </div>
                      @if (e.surveillanceEnabled) {
                        <p class="lv-note mt-3 mb-0">{{ scheduleSummary(e) }} {{ scheduleStart(e) }}</p>
                      }
                    </div>
                  </div>

                  <aside class="lv-preview" aria-label="Preview">
                    <h4>Dashboard box</h4>
                    <div class="pv-box" [style.--accent]="accent(e.code)" [class.is-off]="!e.isEnabled">
                      <div class="pv-head">{{ (e.name || 'Name') | uppercase }} CERTIFICATION</div>
                      <div class="pv-body">
                        <div>
                          <div class="pv-status">→ Get started</div>
                          <div class="pv-steps"><i></i><i></i><i></i>@if (e.assessmentMode === 'Site') {<i></i>}</div>
                        </div>
                        @if (logoOf(e.code); as url) { <img class="pv-logo" [src]="url" alt="" /> } @else { <span class="pv-logo pv-logo-none">{{ e.name || '?' }}</span> }
                      </div>
                      @if (e.description) { <p class="pv-desc">{{ e.description }}</p> }
                      @if (e.fee) { <div class="pv-fee">₹ {{ e.fee | number: '1.0-0' }}</div> }
                    </div>
                    <small class="muted d-block mt-1">{{ e.isEnabled ? 'Shown on the MSME dashboard.' : 'Hidden from MSMEs until enabled.' }}</small>

                    <h4 class="mt-3">Certificate numbers</h4>
                    <dl class="pv-numbers">
                      <dt>General</dt><dd><code>{{ preview(e.certNoFormat, e.code, null) }}</code></dd>
                      <dt>Manufacturing</dt><dd><code>{{ preview(e.certNoFormatManufacturing.trim() || e.certNoFormat, e.code, 'Manufacturing') }}</code></dd>
                      <dt>Services</dt><dd><code>{{ preview(e.certNoFormatService.trim() || e.certNoFormat, e.code, 'Services') }}</code></dd>
                    </dl>

                    @if (timeline(e); as tl) {
                      <h4 class="mt-3">Over {{ months(e.validityMonths ?? 0) }}</h4>
                      <div class="pv-timeline" role="img" [attr.aria-label]="tl.label">
                        <div class="tl-bar"></div>
                        @for (d of tl.due; track $index) {
                          <span class="tl-mark" [style.left.%]="d.at" [title]="'Surveillance ' + ($index + 1) + ': month ' + d.month"><b>S{{ $index + 1 }}</b><small>{{ d.month }}m</small></span>
                        }
                        <span class="tl-end"><small>{{ e.validityMonths }}m</small></span>
                      </div>
                      <small class="muted d-block">S = surveillance due, months after certification.</small>
                    }
                  </aside>
                </div>
                @if (editError()) { <div class="alert alert-danger help-block mt-3 mb-0" role="alert">{{ editError() }}</div> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ e.isNew ? 'ADD LEVEL' : 'UPDATE' }}</button>
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
  styles: `
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
    .lv-logo { height: 72px; max-width: 150px; object-fit: contain; }
    .lv-logo-none { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; padding: 0 10px; border-radius: 50%;
      background: linear-gradient(135deg, #2e858c, #23474a); color: #fff; font-weight: 800; letter-spacing: .5px; }
    .lv-title { display: flex; flex-wrap: wrap; align-items: center; gap: 6px 8px; }
    .lv-box h5 { margin: 0; font-size: 15px; font-weight: 800; color: #23474a; letter-spacing: .3px; }
    .lv-code { font-size: 11.5px; color: #23474a; background: #eef6f6; border-radius: 10px; padding: 1px 8px; }
    .lv-desc { margin: 0; font-size: 13px; color: #3b4b4c; }
    .lv-facts { margin: 0; font-size: 13px; border-top: 1px solid #eef3f3; }
    .lv-facts > div { display: grid; grid-template-columns: 112px minmax(0, 1fr); gap: 10px; padding: 6px 0; border-bottom: 1px solid #eef3f3; }
    .lv-facts dt { font-weight: 600; color: #5f6f70; }
    .lv-facts dd { margin: 0; overflow-wrap: anywhere; color: #232527; }
    .lv-sample { font-size: 12px; color: #23474a; background: #f4f8f8; border-radius: 4px; padding: 1px 6px; }
    .lv-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: auto; padding-top: 4px; }
    .lv-note { display: flex; gap: 8px; align-items: flex-start; font-size: 13px; color: #5f6f70; background: none; }
    .info-dot { flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif; }

    /* The pop-up: tabs, the fields, and a preview beside them. Wider than the skin's 760px form pop-ups. */
    .modal > .modal-dialog.modal-xl.lv-dialog { max-width: 1080px; width: calc(100% - 32px); margin-left: auto; margin-right: auto; }
    .d-contents { display: contents; }
    .modal .lv-dialog textarea.form-control { min-height: 0; height: auto; }
    .modal .lv-dialog .form-grid { grid-template-columns: 170px minmax(0, 1fr); }
    .lv-tabs { display: flex; gap: 4px; border-bottom: 1px solid #dfe9ea; margin: -4px 0 16px; }
    .lv-tab { border: 0; background: none; padding: 8px 16px; font-weight: 600; font-size: 14px; color: #5f6f70; border-bottom: 3px solid transparent; margin-bottom: -1px; cursor: pointer; }
    .lv-tab:hover { color: #2f7c83; }
    .lv-tab.active { color: #23474a; border-bottom-color: #45a5ad; }
    .lv-edit { display: grid; grid-template-columns: minmax(0, 1fr) 300px; gap: 20px; align-items: start; }
    /* The portal's form styles stretch every field; the numbers stay short. */
    .form-grid input.lv-short { width: 110px !important; max-width: 110px !important; flex: none; }
    .lv-mono { font-family: Consolas, 'Courier New', monospace; }
    .lv-choice { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
    .choice-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; }
    .choice-card.active { border-color: #45a5ad; background: #f4fafa; }
    .choice-card .form-check-input { flex: none; margin: 3px 0 0; }
    .choice-card small { display: block; color: #5f6f70; font-size: 12px; font-weight: 400; }
    .lv-switch { display: flex; align-items: center; gap: 8px; padding-left: 0; margin: 0; }
    .lv-switch .form-check-input { float: none; margin: 0; }
    .lv-surv { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .form-grid select.lv-select { width: auto !important; max-width: 260px; flex: none; }
    .lv-check { display: flex; align-items: flex-start; gap: 8px; padding-left: 0; margin: 0; }
    .lv-check .form-check-input { float: none; flex: none; margin: 3px 0 0; }
    .modal .lv-check .form-check-label { font-weight: 400; }
    .lv-logo-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .lv-logo-small { height: 40px; }
    .lv-tokens { display: flex; flex-wrap: wrap; gap: 4px; }
    .token { font-size: 12px; background: #eef6f6; color: #23474a; border-radius: 4px; padding: 1px 6px; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .label-like.top { align-self: start; padding-top: 2px; }

    .lv-preview { position: sticky; top: 0; background: #f4f8f8; border-radius: 12px; padding: 14px; }
    .lv-preview h4 { font-size: 13px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
    .pv-box { --accent: #45a5ad; background: #fff; border-radius: 10px; overflow: hidden; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.08); }
    .pv-box.is-off { opacity: .5; }
    .pv-head { background: var(--accent); color: #fff; font-weight: 800; font-size: 13px; padding: 10px 12px; letter-spacing: .3px; overflow-wrap: anywhere; }
    .pv-body { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 12px; }
    .pv-status { color: #e8a33d; font-weight: 700; font-size: 13px; }
    .pv-steps { display: flex; gap: 14px; margin-top: 10px; }
    .pv-steps i { width: 10px; height: 10px; border-radius: 5px; background: #dfe5e6; }
    .pv-logo { height: 52px; max-width: 90px; object-fit: contain; }
    .pv-logo-none { display: inline-flex; align-items: center; justify-content: center; width: 52px; border-radius: 26px; font-size: 10px; font-weight: 800;
      background: linear-gradient(135deg, #2e858c, #23474a); color: #fff; overflow: hidden; }
    .pv-desc { font-size: 12px; color: #3b4b4c; margin: 0; padding: 0 12px 10px; }
    .pv-fee { font-size: 12px; font-weight: 700; color: #23474a; padding: 0 12px 10px; }
    .pv-numbers { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 4px 10px; margin: 0; font-size: 12.5px; }
    .pv-numbers dt { color: #5f6f70; font-weight: 600; }
    .pv-numbers dd { margin: 0; overflow-wrap: anywhere; }
    .pv-timeline { position: relative; height: 46px; margin: 4px 12px 2px 4px; }
    .tl-bar { position: absolute; left: 0; right: 0; top: 10px; height: 6px; border-radius: 3px; background: linear-gradient(90deg, #cfe5e6, #45a5ad); }
    .tl-mark, .tl-end { position: absolute; top: 2px; transform: translateX(-50%); display: flex; flex-direction: column; align-items: center; }
    .tl-mark b { width: 22px; height: 22px; border-radius: 11px; background: #fff; border: 2px solid #23474a; font-size: 10px; display: grid; place-items: center; color: #23474a; }
    .tl-mark small, .tl-end small { font-size: 11px; color: #5f6f70; margin-top: 2px; }
    .tl-end { left: 100%; top: 26px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 991.98px) {
      .lv-edit { grid-template-columns: minmax(0, 1fr); }
      .lv-preview { position: static; }
    }
    @media (max-width: 575.98px) {
      .modal .lv-dialog .form-grid { grid-template-columns: minmax(0, 1fr); }
      .lv-choice { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class CertificationLevelsPage {
  private readonly portals = inject(AdminPortalService);
  private readonly http = inject(HttpClient);

  protected readonly levels = signal<LevelItem[]>([]);
  protected readonly enabledCount = computed(() => this.levels().filter((i) => i.level.isEnabled).length);
  protected readonly tabs: readonly { key: EditTab; label: string }[] = [
    { key: 'box', label: 'Dashboard box' },
    { key: 'certificate', label: 'Certificate' },
    { key: 'surveillance', label: 'Surveillance' },
  ];
  protected readonly tab = signal<EditTab>('box');
  protected readonly tokens = signal<string[]>([]);
  protected readonly stored = signal(false);
  protected readonly loaded = signal(false);
  protected readonly editing = signal<LevelForm | null>(null);
  protected readonly editError = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  private logo: File | null = null;

  constructor() {
    void this.load();
  }

  protected months(n: number): string {
    return n % 12 === 0 ? `${n / 12} year${n === 12 ? '' : 's'}` : `${n} months`;
  }

  protected surveillanceFact(l: CertificationLevel): string {
    if (!l.surveillanceEnabled) return 'none';
    const first = l.firstSurveillanceMonths ?? DEFAULT_SCHEDULE.firstSurveillanceMonths;
    const count = l.surveillanceCount ?? DEFAULT_SCHEDULE.surveillanceCount;
    const every = l.surveillanceIntervalMonths ?? DEFAULT_SCHEDULE.surveillanceIntervalMonths;
    return count > 1 ? `${count}, after ${first} months, then every ${every}` : `1, after ${this.months(first)}`;
  }

  /** "Due at 15 and 27 months after certification." */
  protected scheduleSummary(e: LevelForm): string {
    const first = e.firstSurveillanceMonths ?? 0, count = e.surveillanceCount ?? 0, every = e.surveillanceIntervalMonths ?? 0;
    if (first < 1 || count < 1 || count > 5 || (count > 1 && every < 1)) return '';
    const due = Array.from({ length: count }, (_, i) => first + i * every);
    const list = due.length > 1 ? `${due.slice(0, -1).join(', ')} and ${due[due.length - 1]}` : `${due[0]}`;
    return `Due at ${list} months after certification.`;
  }

  /** When the V4 schedule took the level over (Bronze / Silver / Gold: the day their legacy jobs were switched off). */
  protected scheduleStart(e: LevelForm): string {
    const from = e.surveillanceScheduleFrom ? new Date(e.surveillanceScheduleFrom) : null;
    if (!from || Number.isNaN(from.getTime())) return '';
    if (from.getFullYear() === 9999) return 'These timings apply from the day the new surveillance schedule is switched on for this level.';
    const day = from.toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' });
    return `Run by the new surveillance schedule since ${day}; a step that fell due before that day was not done.`;
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
    return due.length ? { due, label: `Surveillance due at ${due.map((d) => d.month).join(', ')} months of ${validity}` } : null;
  }

  protected preview(format: string, code: string, category: 'Manufacturing' | 'Services' | null): string {
    return formatCertificateNo(format, new Date(), SAMPLE_ZED_ID, code || 'LEVEL', category);
  }

  protected logoOf(code: string): string | null {
    return this.levels().find((l) => l.level.code === code)?.logoUrl ?? null;
  }

  protected startAdd(): void {
    this.logo = null;
    this.tab.set('box');
    this.editError.set('');
    this.editing.set({
      code: '', isNew: true, name: '', description: '', comment: '', isEnabled: false, assessmentMode: 'Site', validityMonths: 36,
      surveillanceEnabled: true, certNoFormat: '{DDMMYYYY}_{ZEDNO}', certNoFormatManufacturing: '', certNoFormatService: '', fee: null,
      ...DEFAULT_SCHEDULE, surveillanceAutoApply: false, surveillanceSuspendRounds: null, surveillanceScheduleFrom: null,
    });
  }

  protected edit(i: LevelItem): void {
    const l = i.level;
    this.logo = null;
    this.tab.set('box');
    this.editError.set('');
    this.editing.set({
      code: l.code, isNew: false, name: l.name, description: l.description ?? '', comment: l.comment ?? '', isEnabled: l.isEnabled,
      assessmentMode: l.assessmentMode, validityMonths: l.validityMonths, surveillanceEnabled: l.surveillanceEnabled,
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
      this.editError.set('Please choose a PNG or JPG image of up to 1 MB.');
      return;
    }
    this.logo = file;
  }

  protected async save(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    const problem = this.check(e);
    if (problem) return this.editError.set(problem);
    this.busy.set(true);
    this.editError.set('');
    this.error.set('');
    this.success.set('');
    const body = {
      code: e.isNew ? e.code.trim() : undefined, name: e.name.trim(), description: e.description, comment: e.comment, isEnabled: e.isEnabled,
      assessmentMode: e.assessmentMode, validityMonths: e.validityMonths, surveillanceEnabled: e.surveillanceEnabled,
      firstSurveillanceMonths: e.surveillanceEnabled ? e.firstSurveillanceMonths : null, certNoFormat: e.certNoFormat.trim(),
      certNoFormatManufacturing: e.certNoFormatManufacturing, certNoFormatService: e.certNoFormatService, fee: e.fee,
      ...(e.surveillanceEnabled
        ? {
            ...Object.fromEntries(SCHEDULE_KEYS.map((k) => [k, e[k]])),
            surveillanceAutoApply: e.assessmentMode === 'Desktop' && (e.surveillanceReminders ?? 0) > 0 && e.surveillanceAutoApply,
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
        message += ' Logo saved.';
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
      this.success.set(message);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(l: CertificationLevel): Promise<void> {
    if (l.isEnabled && !confirm(`Disable ${l.name}? MSMEs will no longer see it or apply for it.`)) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const enabled = (context?: HttpContext) => this.http.put<MessageResponse>(`${API}/${encodeURIComponent(l.code)}/enabled`, { enabled: !l.isEnabled }, { context });
      const message = (await firstValueFrom(enabled())).message;
      this.success.set(message + (await this.onSurveillance(async (context) => { await firstValueFrom(enabled(context)); })));
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
      return ' Saved on the Surveillance portal too.';
    } catch (err) {
      return ` Not saved on the Surveillance portal: ${apiErrorMessage(err)}`;
    }
  }

  /** The server's rules, so most mistakes show before saving. */
  private check(e: LevelForm): string {
    if (e.isNew && !/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(e.code.trim())) return 'The code must be 2 to 20 letters and digits, starting with a letter (e.g. ZEDX).';
    if (!e.name.trim()) return "Please enter the level's name.";
    if (!e.validityMonths || e.validityMonths < 1 || e.validityMonths > 120) return 'The validity must be 1 to 120 months.';
    if (e.surveillanceEnabled && (!e.firstSurveillanceMonths || e.firstSurveillanceMonths < 1 || e.firstSurveillanceMonths >= e.validityMonths))
      return 'The first surveillance must be due before the certificate expires.';
    if (e.surveillanceEnabled) {
      const problem = this.checkSchedule(e);
      if (problem) return problem;
    }
    for (const [label, f, required] of [['', e.certNoFormat, true], ['Manufacturing: ', e.certNoFormatManufacturing, false], ['Services: ', e.certNoFormatService, false]] as const) {
      const v = f.trim();
      if (!v) {
        if (required) return 'Please enter the certificate number format.';
        continue;
      }
      if (!v.includes('{ZEDID}') && !v.includes('{ZEDNO}')) return `${label}The format must include {ZEDID} or {ZEDNO}, so that every certificate gets its own number.`;
      const unknown = (v.match(/\{[A-Z]+\}/g) ?? []).find((t) => !this.tokens().includes(t));
      if (unknown) return `${label}${unknown} is not a known part.`;
    }
    return '';
  }

  /** As SurveillanceSchedule.Problem on the server. */
  private checkSchedule(e: LevelForm): string {
    const n = (v: number | null) => (v === null || v === undefined || Number.isNaN(v) ? -1 : v);
    const count = n(e.surveillanceCount), every = n(e.surveillanceIntervalMonths), reminders = n(e.surveillanceReminders);
    if (count < 1 || count > 5) return 'The number of surveillances must be 1 to 5.';
    if (count > 1 && (every < 1 || every > 60)) return 'The months between two surveillances must be 1 to 60.';
    if (n(e.firstSurveillanceMonths) + (count - 1) * Math.max(every, 0) >= (e.validityMonths ?? 0)) return 'The last surveillance must be due before the certificate expires.';
    if (n(e.surveillanceNoticeMonths) < 0 || n(e.surveillanceNoticeMonths) > 24) return 'The notice must go 0 to 24 months before the due date.';
    if (reminders < 0 || reminders > 5) return 'The reminders must be 0 to 5.';
    if (reminders > 0 && (n(e.surveillanceReminderEveryMonths) < 1 || n(e.surveillanceReminderEveryMonths) > 12)) return 'The months between reminders must be 1 to 12.';
    if (n(e.surveillanceSuspendAfterMonths) < 0 || n(e.surveillanceSuspendAfterMonths) > 24) return 'The suspension must come 0 to 24 months after the due date.';
    if (n(e.surveillanceWithdrawAfterDays) < 1 || n(e.surveillanceWithdrawAfterDays) > 365) return 'The withdrawal must come 1 to 365 days after the suspension.';
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
