import { DecimalPipe, UpperCasePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
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
}

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
const API = '/api/staff/settings/levels';

/**
 * Administration → Certification Levels (new in V4): the certification boxes of the MSME dashboard (Bronze, Silver,
 * Gold, ZED-X and the levels the Admin adds): name, logo, description and information text, shown or hidden, and the
 * certificate settings: desktop or desktop and site assessment, validity, surveillance, and the certificate number
 * format, in general and for Manufacturing / Services units.
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

    <div class="lv-grid">
      @for (i of levels(); track i.level.code) {
        @let l = i.level;
        <article class="lv-box" [class.is-off]="!l.isEnabled" [attr.aria-label]="l.name">
          <div class="lv-top">
            @if (i.logoUrl) {
              <img class="lv-logo" [src]="i.logoUrl" [alt]="l.name + ' logo'" />
            } @else {
              <span class="lv-logo lv-logo-none" aria-hidden="true">{{ l.name }}</span>
            }
            <span class="status-badge" [class.is-active]="l.isEnabled" [class.is-inactive]="!l.isEnabled">{{ l.isEnabled ? 'Enabled' : 'Disabled' }}</span>
          </div>
          <h5>{{ l.name | uppercase }} CERTIFICATION</h5>
          @if (l.description) { <p class="lv-desc">{{ l.description }}</p> }
          <dl class="lv-facts">
            <dt>Code</dt><dd><code>{{ l.code }}</code></dd>
            <dt>Assessment</dt><dd>{{ l.assessmentMode === 'Desktop' ? 'Desktop' : 'Desktop + site' }}</dd>
            <dt>Valid for</dt><dd>{{ months(l.validityMonths) }}</dd>
            <dt>Surveillance</dt><dd>{{ l.surveillanceEnabled ? 'after ' + months(l.firstSurveillanceMonths ?? 0) : 'none' }}</dd>
            <dt>Certificate no.</dt><dd><code>{{ i.sample }}</code></dd>
            @if (l.fee !== null) { <dt>Fee</dt><dd>₹ {{ l.fee | number: '1.0-0' }}</dd> }
          </dl>
          <div class="lv-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy() || !stored()" (click)="edit(i)">Edit</button>
            <button type="button" class="btn btn-sm" [class.btn-outline-danger]="l.isEnabled" [class.btn-outline-success]="!l.isEnabled"
                    [disabled]="busy() || !stored()" [attr.aria-label]="(l.isEnabled ? 'Disable ' : 'Enable ') + l.name" (click)="toggle(l)">{{ l.isEnabled ? 'Disable' : 'Enable' }}</button>
            <a class="btn btn-link btn-sm" [routerLink]="['/staff/masters/parameters', l.code]">Questionnaire</a>
          </div>
        </article>
      }
    </div>
    <p class="lv-note mt-3">The fees charged are set in Masters → Payments; the questionnaire of each level in the Questionnaire menu.</p>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="lv-edit-title">
        <div class="modal-dialog modal-lg modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="lv-edit-title">{{ e.isNew ? 'Add level' : 'Edit ' + e.name }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <h6 class="lv-h">Box</h6>
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

                <h6 class="lv-h mt-4">Certificate</h6>
                <div class="form-grid">
                  <span class="label-like">Assessment</span>
                  <div class="lv-radios" role="radiogroup" aria-label="Assessment">
                    <label><input type="radio" class="form-check-input" name="assessmentMode" value="Desktop" [(ngModel)]="e.assessmentMode" /> Desktop only</label>
                    <label><input type="radio" class="form-check-input" name="assessmentMode" value="Site" [(ngModel)]="e.assessmentMode" /> Desktop and site</label>
                  </div>
                  <label for="lv-validity">Valid for (months)<span class="req">*</span></label>
                  <input id="lv-validity" name="validityMonths" type="number" min="1" max="120" class="form-control lv-short" [(ngModel)]="e.validityMonths" />
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
                  <label for="lv-format">Certificate number<span class="req">*</span></label>
                  <div>
                    <input id="lv-format" name="certNoFormat" class="form-control" maxlength="100" [(ngModel)]="e.certNoFormat" />
                    <small class="muted d-block">e.g. <code>{{ preview(e.certNoFormat, e.code, null) }}</code></small>
                  </div>
                  <label for="lv-format-m">Manufacturing units</label>
                  <div>
                    <input id="lv-format-m" name="certNoFormatManufacturing" class="form-control" maxlength="100" placeholder="Same as above" [(ngModel)]="e.certNoFormatManufacturing" />
                    @if (e.certNoFormatManufacturing.trim()) { <small class="muted d-block">e.g. <code>{{ preview(e.certNoFormatManufacturing, e.code, 'Manufacturing') }}</code></small> }
                  </div>
                  <label for="lv-format-s">Services units</label>
                  <div>
                    <input id="lv-format-s" name="certNoFormatService" class="form-control" maxlength="100" placeholder="Same as above" [(ngModel)]="e.certNoFormatService" />
                    @if (e.certNoFormatService.trim()) { <small class="muted d-block">e.g. <code>{{ preview(e.certNoFormatService, e.code, 'Services') }}</code></small> }
                  </div>
                </div>
                <p class="lv-note mt-2 mb-0">Parts: @for (t of tokens(); track t) { <code class="me-2">{{ t }}</code> } — a number must include {{ '{' }}ZEDID{{ '}' }} or {{ '{' }}ZEDNO{{ '}' }}. The Manufacturing / Services formats apply once filled in.</p>
                @if (editError()) { <span class="help-block d-block mt-2" role="alert">{{ editError() }}</span> }
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
    .lv-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(250px, 1fr)); gap: 16px; }
    .lv-box { display: flex; flex-direction: column; gap: 8px; padding: 16px; background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; }
    .lv-box.is-off { background: #f6f8f8; }
    .lv-box.is-off .lv-logo, .lv-box.is-off h5, .lv-box.is-off .lv-desc { opacity: .55; }
    .lv-top { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
    .lv-logo { height: 72px; max-width: 150px; object-fit: contain; }
    .lv-logo-none { display: inline-flex; align-items: center; justify-content: center; min-width: 72px; padding: 0 10px; border-radius: 50%;
      background: linear-gradient(135deg, #2e858c, #23474a); color: #fff; font-weight: 800; letter-spacing: .5px; }
    .lv-box h5 { margin: 4px 0 0; font-size: 15px; font-weight: 800; color: #23474a; letter-spacing: .3px; }
    .lv-desc { margin: 0; font-size: 13px; color: #3b4b4c; }
    .lv-facts { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; margin: 4px 0 0; font-size: 13px; }
    .lv-facts dt { font-weight: 600; color: #5f6f70; }
    .lv-facts dd { margin: 0; overflow-wrap: anywhere; }
    .lv-actions { display: flex; flex-wrap: wrap; gap: 6px; margin-top: auto; padding-top: 6px; }
    .lv-h { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: #2f7c83; border-left: 3px solid #45a5ad; padding-left: 8px; }
    /* The portal's form styles stretch every field; the numbers stay short. */
    .form-grid input.lv-short { width: 120px !important; max-width: 120px !important; flex: none; }
    .lv-radios { display: flex; gap: 18px; flex-wrap: wrap; }
    .lv-radios label { display: flex; align-items: center; gap: 6px; margin: 0; }
    .lv-radios .form-check-input { margin: 0; }
    .lv-switch { display: flex; align-items: center; gap: 8px; padding-left: 0; margin: 0; }
    .lv-switch .form-check-input { float: none; margin: 0; }
    .lv-surv { display: flex; align-items: center; gap: 10px; flex-wrap: nowrap; }
    .lv-logo-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .lv-logo-small { height: 40px; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .lv-note { font-size: 13px; color: #5f6f70; background: none; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class CertificationLevelsPage {
  private readonly http = inject(HttpClient);

  protected readonly levels = signal<LevelItem[]>([]);
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

  protected preview(format: string, code: string, category: 'Manufacturing' | 'Services' | null): string {
    return formatCertificateNo(format, new Date(), SAMPLE_ZED_ID, code || 'LEVEL', category);
  }

  protected logoOf(code: string): string | null {
    return this.levels().find((l) => l.level.code === code)?.logoUrl ?? null;
  }

  protected startAdd(): void {
    this.logo = null;
    this.editError.set('');
    this.editing.set({
      code: '', isNew: true, name: '', description: '', comment: '', isEnabled: false, assessmentMode: 'Site', validityMonths: 36,
      surveillanceEnabled: true, firstSurveillanceMonths: 12, certNoFormat: '{DDMMYYYY}_{ZEDNO}', certNoFormatManufacturing: '', certNoFormatService: '', fee: null,
    });
  }

  protected edit(i: LevelItem): void {
    const l = i.level;
    this.logo = null;
    this.editError.set('');
    this.editing.set({
      code: l.code, isNew: false, name: l.name, description: l.description ?? '', comment: l.comment ?? '', isEnabled: l.isEnabled,
      assessmentMode: l.assessmentMode, validityMonths: l.validityMonths, surveillanceEnabled: l.surveillanceEnabled,
      firstSurveillanceMonths: l.firstSurveillanceMonths, certNoFormat: l.certNoFormat, certNoFormatManufacturing: l.certNoFormatManufacturing ?? '',
      certNoFormatService: l.certNoFormatService ?? '', fee: l.fee,
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
    };
    try {
      let message = e.isNew
        ? (await firstValueFrom(this.http.post<MessageResponse>(API, body))).message
        : (await firstValueFrom(this.http.put<MessageResponse>(`${API}/${encodeURIComponent(e.code)}`, body))).message;
      if (this.logo && !e.isNew) {
        const form = new FormData();
        form.append('file', this.logo, this.logo.name);
        await firstValueFrom(this.http.post<MessageResponse>(`${API}/${encodeURIComponent(e.code)}/logo`, form));
        message += ' Logo saved.';
      }
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
      this.success.set((await firstValueFrom(this.http.put<MessageResponse>(`${API}/${encodeURIComponent(l.code)}/enabled`, { enabled: !l.isEnabled }))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** The server's rules, so most mistakes show before saving. */
  private check(e: LevelForm): string {
    if (e.isNew && !/^[A-Za-z][A-Za-z0-9]{1,19}$/.test(e.code.trim())) return 'The code must be 2 to 20 letters and digits, starting with a letter (e.g. ZEDX).';
    if (!e.name.trim()) return "Please enter the level's name.";
    if (!e.validityMonths || e.validityMonths < 1 || e.validityMonths > 120) return 'The validity must be 1 to 120 months.';
    if (e.surveillanceEnabled && (!e.firstSurveillanceMonths || e.firstSurveillanceMonths < 1 || e.firstSurveillanceMonths >= e.validityMonths))
      return 'The first surveillance must be due before the certificate expires.';
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
