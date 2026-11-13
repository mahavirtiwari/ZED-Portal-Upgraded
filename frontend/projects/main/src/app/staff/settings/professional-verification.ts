import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ADMIN_PORTALS, AdminPortal, PortalSwitchComponent } from '../admin-portal';

export type VerificationMode = 'Off' | 'TrainingPortal' | 'Api';

interface ApiSettings {
  url: string | null;
  method: 'POST' | 'GET';
  keyHeader: string | null;
  keySet: boolean;
  keyReadable: boolean;
  certificateField: string;
  panField: string;
  nameField: string;
  emailField: string;
  mobileField: string;
  successField: string | null;
}

interface VerificationSettings {
  mode: VerificationMode;
  api: ApiSettings;
  portal: AdminPortal;
}

interface TestResult {
  ok: boolean;
  name: string | null;
  email: string | null;
  mobileNo: string | null;
  error: string | null;
}

/** The API part of the form (the key only when a new one is typed). */
interface ApiForm {
  url: string;
  method: 'POST' | 'GET';
  keyHeader: string;
  key: string;
  certificateField: string;
  panField: string;
  nameField: string;
  emailField: string;
  mobileField: string;
  successField: string;
}

/**
 * Administration → Settings → Professional Verification (2026-11-13): how an agency (a Consultant Organisation) proves the
 * certified professional it adds as an assessor (consultant), per portal (the portal switch): Off — the agency types the
 * certificate number, PAN, name, e-mail and mobile (the default); the training portal's candidates (certificate number and
 * e-mail, the old check); or another portal's API (certificate number and PAN), whose address, method, key and field names
 * are set here and can be tried with a certificate and PAN. The key is never shown again: "Key is set", a blank box keeps it.
 */
@Component({
  selector: 'zed-staff-professional-verification',
  imports: [FormsModule, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Professional Verification</h3>
        <p class="page-sub">How an agency proves the certified professional it adds as an assessor (consultant) on this portal.</p>
      </div>
    </div>
    <zed-portal-switch />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }
    @if (loaded()) {
      <form class="zed-card" (ngSubmit)="save()" novalidate>
        <h5 class="card-title">Add professional on {{ portalName() }}</h5>
        @if (portal() === 'surveillance') {
          <p class="pv-note">Surveillance assessors are added on the ZED Certification portal; this setting is kept for this portal's own data.</p>
        }
        <div class="pv-options" role="radiogroup" aria-label="Verification">
          @for (o of options; track o.mode) {
            <label class="pv-option" [class.is-on]="mode() === o.mode" [for]="'pv-' + o.mode">
              <span class="pv-head">
                <input class="form-check-input" type="radio" name="mode" [id]="'pv-' + o.mode" [value]="o.mode" [ngModel]="mode()" (ngModelChange)="mode.set($event)" />
                <span class="pv-title">{{ o.title }} @if (saved() === o.mode) { <span class="status-badge is-active">Current</span> }</span>
              </span>
              <span class="pv-help">{{ o.help }}</span>
            </label>
          }
        </div>

        @if (mode() === 'Api') {
          <div class="pv-api">
            <div class="form-grid">
              <label for="pv-url">API address<span class="req">*</span></label>
              <input id="pv-url" name="url" class="form-control" maxlength="500" placeholder="https://" [(ngModel)]="api.url" />
              <span class="af-label">Method</span>
              <div class="pv-methods" role="radiogroup" aria-label="Method">
                <label><input type="radio" name="method" value="POST" [(ngModel)]="api.method" /> POST (JSON body)</label>
                <label><input type="radio" name="method" value="GET" [(ngModel)]="api.method" /> GET (query string)</label>
              </div>
              <label for="pv-header">Key header</label>
              <input id="pv-header" name="keyHeader" class="form-control pv-short" maxlength="100" placeholder="x-api-key" [(ngModel)]="api.keyHeader" />
              <label for="pv-key">Key</label>
              <div>
                <input id="pv-key" name="key" type="password" class="form-control pv-short" maxlength="500" autocomplete="new-password"
                       [placeholder]="keySet() ? 'Key is set — leave blank to keep' : ''" [(ngModel)]="api.key" />
                @if (keySet() && !keyReadable()) { <small class="text-danger d-block">The saved key cannot be read on this server: enter it again.</small> }
                @if (keySet()) {
                  <label class="pv-remove"><input type="checkbox" name="removeKey" [(ngModel)]="removeKey" /> Remove the saved key</label>
                }
              </div>
              <span class="af-label">Request fields</span>
              <div class="pv-fields">
                <label>Certificate number <input name="certificateField" class="form-control" maxlength="100" [(ngModel)]="api.certificateField" /></label>
                <label>PAN <input name="panField" class="form-control" maxlength="100" [(ngModel)]="api.panField" /></label>
              </div>
              <span class="af-label">Response fields</span>
              <div class="pv-fields">
                <label>Name <input name="nameField" class="form-control" maxlength="100" [(ngModel)]="api.nameField" /></label>
                <label>E-mail <input name="emailField" class="form-control" maxlength="100" [(ngModel)]="api.emailField" /></label>
                <label>Mobile <input name="mobileField" class="form-control" maxlength="100" [(ngModel)]="api.mobileField" /></label>
                <label>Success field (optional) <input name="successField" class="form-control" maxlength="100" placeholder="e.g. status" [(ngModel)]="api.successField" /></label>
              </div>
            </div>
            <small class="text-muted d-block mt-2">Nested fields with dots (data.name). The answer must give a name, a valid e-mail and a 10 digit mobile number.</small>

            <div class="pv-test">
              <strong class="d-block mb-2">Test with a certificate and PAN</strong>
              <div class="filter-bar">
                <div class="filter"><label class="form-label" for="pv-test-cert">Certificate number</label>
                  <input id="pv-test-cert" name="testCert" class="form-control" maxlength="20" [(ngModel)]="testCert" /></div>
                <div class="filter"><label class="form-label" for="pv-test-pan">PAN</label>
                  <input id="pv-test-pan" name="testPan" class="form-control" maxlength="10" [ngModel]="testPan" (ngModelChange)="testPan = ($event ?? '').toUpperCase()" /></div>
                <button type="button" class="btn btn-default" [disabled]="busy()" (click)="test()">Test</button>
              </div>
              @if (tested(); as t) {
                @if (t.ok) {
                  <div class="alert alert-success mt-2 mb-0" role="status">The API answered: <strong>{{ t.name }}</strong> · {{ t.email }} · {{ t.mobileNo }}</div>
                } @else {
                  <div class="alert alert-warning mt-2 mb-0" role="status">{{ t.error }}</div>
                }
              }
            </div>
          </div>
        }

        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
        </div>
      </form>
    }
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .pv-note { font-size: 13px; color: #6b4d00; background: #fff8e6; border: 1px solid #f0d79a; border-radius: 8px; padding: 8px 12px; }
    .pv-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(230px, 1fr)); gap: 14px; }
    .pv-option { display: flex; flex-direction: column; gap: 6px; margin: 0; padding: 16px; border: 1px solid #dfe9ea; border-radius: 12px; background: #fff; cursor: pointer; }
    .pv-option:hover { border-color: #45a5ad; }
    .pv-option.is-on { border-color: #45a5ad; background: #eef6f6; box-shadow: inset 0 0 0 1px #45a5ad; }
    .pv-head { display: flex; align-items: center; gap: 10px; }
    .pv-option .form-check-input { flex: 0 0 auto; margin: 0; }
    .pv-title { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 700; color: #23474a; font-size: 15px; }
    .pv-help { font-size: 13px; color: #5f6f70; }
    .pv-api { margin-top: 18px; padding-top: 16px; border-top: 1px solid #eef3f3; }
    .pv-methods { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; }
    .pv-methods label, .pv-remove { display: inline-flex; gap: 6px; align-items: center; font-weight: 400; margin: 0; }
    .pv-remove { font-size: 13px; margin-top: 4px; }
    .form-grid .form-control.pv-short { max-width: 340px; }
    .pv-fields { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px; }
    .pv-fields label { font-size: 13px; color: #5f6f70; margin: 0; }
    .pv-test { margin-top: 16px; padding: 12px 14px; border-radius: 10px; background: #f5fafa; border: 1px solid #e1eded; }
    .af-label { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class ProfessionalVerificationPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/professional-verification';

  protected readonly options: { mode: VerificationMode; title: string; help: string }[] = [
    { mode: 'Off', title: 'Off: the agency enters the details', help: 'Certificate number, PAN, name, e-mail and mobile are typed on the Add form.' },
    { mode: 'TrainingPortal', title: 'Training portal: certificate number and e-mail', help: "The current check against the training portal's candidates." },
    { mode: 'Api', title: 'Other portal API: certificate number and PAN', help: "Another portal's API answers the name, e-mail and mobile for a certificate number and PAN." },
  ];

  protected readonly mode = signal<VerificationMode>('Off');
  /** The mode on the server (the "Current" badge). */
  protected readonly saved = signal<VerificationMode>('Off');
  protected readonly portal = signal<AdminPortal>('main');
  protected readonly keySet = signal(false);
  protected readonly keyReadable = signal(true);
  protected api: ApiForm = {
    url: '', method: 'POST', keyHeader: '', key: '', certificateField: 'certificateNo', panField: 'pan', nameField: 'name', emailField: 'email',
    mobileField: 'mobile', successField: '',
  };
  protected removeKey = false;
  protected testCert = '';
  protected testPan = '';
  protected readonly tested = signal<TestResult | null>(null);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected portalName(): string {
    return ADMIN_PORTALS.find((p) => p.key === this.portal())?.name ?? this.portal();
  }

  /** The API fields as the server takes them (blank = default / none). */
  private apiBody() {
    const a = this.api;
    return {
      url: a.url.trim(), method: a.method, keyHeader: a.keyHeader.trim(), key: a.key.trim() || null, certificateField: a.certificateField.trim(),
      panField: a.panField.trim(), nameField: a.nameField.trim(), emailField: a.emailField.trim(), mobileField: a.mobileField.trim(),
      successField: a.successField.trim(),
    };
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const body = this.mode() === 'Api' ? { mode: this.mode(), ...this.apiBody(), removeKey: this.removeKey } : { mode: this.mode() };
      const r = await firstValueFrom(this.http.put<MessageResponse>(ProfessionalVerificationPage.url, body));
      this.success.set(r.message);
      await this.load(false);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async test(): Promise<void> {
    this.error.set('');
    this.tested.set(null);
    this.busy.set(true);
    try {
      const body = { certificateNo: this.testCert.trim(), pan: this.testPan.trim(), ...this.apiBody() };
      this.tested.set(await firstValueFrom(this.http.post<TestResult>(`${ProfessionalVerificationPage.url}/test`, body)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const s = await firstValueFrom(this.http.get<VerificationSettings>(ProfessionalVerificationPage.url));
      this.mode.set(s.mode);
      this.saved.set(s.mode);
      this.portal.set(s.portal);
      this.keySet.set(s.api.keySet);
      this.keyReadable.set(s.api.keyReadable);
      this.removeKey = false;
      this.api = {
        url: s.api.url ?? '', method: s.api.method === 'GET' ? 'GET' : 'POST', keyHeader: s.api.keyHeader ?? '', key: '',
        certificateField: s.api.certificateField, panField: s.api.panField, nameField: s.api.nameField, emailField: s.api.emailField,
        mobileField: s.api.mobileField, successField: s.api.successField ?? '',
      };
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
