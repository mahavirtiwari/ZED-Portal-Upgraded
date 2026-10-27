import { HttpClient } from '@angular/common/http';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CollapseCard } from '../collapse-card';

/** A mail server as the API shows it: never the password, only whether one is saved. */
export interface SmtpServerView {
  host: string;
  port: number;
  startTls: boolean;
  from: string | null;
  userName: string | null;
  passwordSet: boolean;
  updatedBy?: string | null;
  updatedOn?: string | null;
}

/** Which server a module's mails use: its own, the page's Default, the server file's profile, its Default, or none. */
export type MailServerUse = 'Module' | 'Default' | 'ServerFile' | 'ServerFileDefault' | 'None';

export interface MailModuleView {
  key: string;
  label: string;
  help: string;
  saved: SmtpServerView | null;
  configured: SmtpServerView | null;
  uses: MailServerUse;
}

export interface MailServerInfo {
  modules: MailModuleView[];
  pickupDirectory: string | null;
  redirectAllTo: string | null;
  allowedRecipientDomains: string | null;
}

/** One e-mail address (the rule of the server's EmailAddresses). */
export const EMAIL_PATTERN = /^[^@\s<>()]+@[^@\s<>()]+\.[A-Za-z]{2,}$/;

/** Mail services that only accept the full mailbox address as the sign-in name. */
const ADDRESS_SIGN_IN_HOSTS = /(^|\.)(office365\.com|outlook\.com|office\.com|gmail\.com|googlemail\.com|zoho\.com|zoho\.in)$/i;

/** True when this host needs the mailbox address as sign-in name and the name given is not one. */
export function signInNeedsAddress(host: string | null | undefined, userName: string | null | undefined): boolean {
  const name = (userName ?? '').trim();
  return !!name && ADDRESS_SIGN_IN_HOSTS.test((host ?? '').trim()) && !EMAIL_PATTERN.test(name);
}

interface ServerForm {
  host: string;
  port: number;
  startTls: boolean;
  from: string;
  userName: string;
  password: string;
  clearPassword: boolean;
}

/**
 * Admin → Email Settings → Mail servers (new in V4): the SMTP server of each module (Registration, OTP, payment, document
 * upload, …). A module without its own uses Default; without a Default on this page, the server's settings file. Saved
 * passwords are never shown; a test mail goes out at once through a module's server and shows the mail server's error.
 */
@Component({
  selector: 'zed-staff-mail-servers',
  imports: [FormsModule, CollapseCard],
  template: `
    @if (info(); as s) {
      <zed-collapse-card class="mail-servers" title="Mail servers" [summary]="summary()" [(open)]="open">
        <p class="text-muted mb-2">
          The SMTP server each group of mails is sent with. A module without its own server uses <b>Default</b>; without a
          Default here, the server's settings file.
        </p>
        @if (s.pickupDirectory) {
          <div class="alert alert-warning mb-2" role="alert">
            Mails are not sent on this server: they are written as files to the folder {{ s.pickupDirectory }} (Email:PickupDirectory in the server's settings file).
          </div>
        }
        @if (s.redirectAllTo) {
          <div class="alert alert-info mb-2" role="note">
            @if (s.allowedRecipientDomains) {
              On this server mails reach only addresses in {{ s.allowedRecipientDomains }}; a mail with nobody there goes to {{ s.redirectAllTo }}.
            } @else {
              On this server every mail goes to {{ s.redirectAllTo }} instead of its recipients (Email:RedirectAllTo in the server's settings file).
            }
          </div>
        } @else if (s.allowedRecipientDomains) {
          <div class="alert alert-info mb-2" role="note">On this server mails reach only addresses in {{ s.allowedRecipientDomains }}.</div>
        }
        <div #messageBox>
          @if (message(); as m) {
            <div class="alert mb-2" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" role="status">{{ m.text }}</div>
          }
        </div>

        <div class="table-responsive">
          <table class="table mb-2">
            <thead>
              <tr><th>Module</th><th>Mail server used</th><th>Uses</th><th class="text-center">Actions</th></tr>
            </thead>
            <tbody>
              @for (m of s.modules; track m.key) {
                <tr [attr.data-module]="m.key">
                  <td data-label="Module">
                    <div class="fw-semibold">{{ m.label }}</div>
                    <small class="muted">{{ m.help }}</small>
                  </td>
                  <td class="server" data-label="Mail server used">
                    @if (used(m); as u) {
                      <div>{{ u.host }}:{{ u.port }}</div>
                      <small class="muted">From {{ u.from || '(none)' }}@if (u.userName) { · sign-in {{ u.userName }} }</small>
                    } @else {
                      <span class="status-badge is-rejected">No mail server</span>
                    }
                  </td>
                  <td class="uses" data-label="Uses">
                    @switch (m.uses) {
                      @case ('Module') { <span class="status-badge is-active">Own server</span> }
                      @case ('Default') { <span class="status-badge is-info">Default</span> }
                      @case ('ServerFile') { <span class="status-badge is-pending">Server file</span> }
                      @case ('ServerFileDefault') { <span class="status-badge is-pending">Server file (Default)</span> }
                      @default { <span class="status-badge is-rejected">Not set</span> }
                    }
                    @if (m.saved; as v) {
                      @if (v.userName && !v.passwordSet) { <div><span class="status-badge is-rejected">no password</span></div> }
                    }
                    @if (used(m); as u) {
                      @if (signInNeeds(u)) {
                        <div><span class="status-badge is-rejected" title="This mail service only accepts the full mailbox address as the sign-in name">check sign-in name</span></div>
                      }
                    }
                  </td>
                  <td class="actions">
                    <div class="row-actions justify-content-center">
                      <button type="button" class="btn btn-sm btn-outline-primary" (click)="edit(m)">{{ m.saved ? 'Edit' : 'Set' }}</button>
                      @if (m.saved) {
                        <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="clear(m)">
                          {{ m.key === 'Default' ? 'Clear' : 'Use Default' }}
                        </button>
                      }
                    </div>
                  </td>
                </tr>
                @if (editing() === m.key) {
                  <tr class="edit-row">
                    <td colspan="4">
                      <form class="server-form" (ngSubmit)="save(m)" novalidate autocomplete="off">
                        <h6>{{ m.label }}: mail server</h6>
                        <div class="form-grid">
                          <label for="smtpHost">Server (host)<span class="req">*</span></label>
                          <div class="host-port">
                            <input id="smtpHost" name="smtpHost" class="form-control" [class.is-invalid]="formError()?.field === 'host'" maxlength="255" placeholder="e.g. smtp.office365.com"
                                   [ngModel]="form().host" (ngModelChange)="set('host', $event)" />
                            <input id="smtpPort" name="smtpPort" class="form-control port" [class.is-invalid]="formError()?.field === 'port'" type="number" min="1" max="65535" aria-label="Port"
                                   [ngModel]="form().port" (ngModelChange)="set('port', +$event)" />
                          </div>
                          <label for="smtpTls">Secure connection</label>
                          <div class="form-check">
                            <input id="smtpTls" name="smtpTls" class="form-check-input" type="checkbox"
                                   [ngModel]="form().startTls" (ngModelChange)="set('startTls', $event)" />
                            <label class="form-check-label" for="smtpTls">STARTTLS (usual on port 587). Off: SSL on port 465, or as the server offers.</label>
                          </div>
                          <label for="smtpFrom">From<span class="req">*</span></label>
                          <input id="smtpFrom" name="smtpFrom" class="form-control" [class.is-invalid]="formError()?.field === 'from'" maxlength="320" placeholder="ZED <noreply@example.org>"
                                 [ngModel]="form().from" (ngModelChange)="set('from', $event)" />
                          <label for="smtpUser">Sign-in name</label>
                          <div>
                            <input id="smtpUser" name="smtpUser" class="form-control" [class.is-invalid]="formError()?.field === 'userName'" maxlength="320" autocomplete="off"
                                   placeholder="Usually the mailbox address; empty: no sign-in"
                                   [ngModel]="form().userName" (ngModelChange)="set('userName', $event)" />
                            @if (signInNeeds(form())) {
                              <small class="help-block">This mail service only accepts the full mailbox address as the sign-in name, e.g. {{ addressHint() }}.</small>
                            }
                          </div>
                          <label for="smtpPassword">Password</label>
                          <div>
                            <input id="smtpPassword" name="smtpPassword" class="form-control" [class.is-invalid]="formError()?.field === 'password'" type="password" maxlength="256" autocomplete="new-password"
                                   [placeholder]="m.saved?.passwordSet ? 'Saved. Leave empty to keep it' : ''"
                                   [disabled]="form().clearPassword" [ngModel]="form().password" (ngModelChange)="set('password', $event)" />
                            @if (m.saved?.passwordSet) {
                              <div class="form-check mt-1">
                                <input id="smtpClear" name="smtpClear" class="form-check-input" type="checkbox"
                                       [ngModel]="form().clearPassword" (ngModelChange)="set('clearPassword', $event)" />
                                <label class="form-check-label" for="smtpClear">Remove the saved password</label>
                              </div>
                            }
                            <small class="muted d-block mt-1">Stored encrypted for this server; never shown again.</small>
                          </div>
                        </div>
                        @if (formError(); as e) {
                          <div class="alert alert-danger mt-3 mb-0" role="alert">{{ e.text }}</div>
                        }
                        <div class="form-actions">
                          <button type="button" class="btn btn-default" (click)="cancel()">Cancel</button>
                          <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
                        </div>
                      </form>
                    </td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <form class="test-mail" (ngSubmit)="sendTest()" novalidate>
          <label for="testModule">Send a test mail of</label>
          <select id="testModule" name="testModule" class="form-select" [ngModel]="testModule()" (ngModelChange)="testModule.set($event)">
            @for (m of s.modules; track m.key) { <option [value]="m.key">{{ m.label }}</option> }
          </select>
          <label for="testTo">to</label>
          <input id="testTo" name="testTo" type="email" class="form-control" [class.is-invalid]="testInvalid()" maxlength="254" autocomplete="off" placeholder="name@example.com"
                 [ngModel]="testTo()" (ngModelChange)="testTo.set($event)" />
          <button type="submit" class="btn btn-primary" [disabled]="testing() || !testTo().trim() || testInvalid()">
            {{ testing() ? 'Sending…' : 'Send test mail' }}
          </button>
        </form>
        @if (testInvalid()) {
          <small class="help-block">Please enter one valid e-mail address.</small>
        }
        @if (testResult(); as t) {
          <div class="alert mt-2 mb-0" [class.alert-success]="t.ok" [class.alert-danger]="!t.ok" role="status">{{ t.text }}</div>
        }
      </zed-collapse-card>
    }
  `,
  styles: `
    .mail-servers .table td, .mail-servers .table th { text-align: left; vertical-align: middle; }
    .mail-servers .table th:last-child { text-align: center; width: 190px; }
    .mail-servers td small { display: block; }
    .mail-servers .uses .status-badge { white-space: nowrap; }
    .edit-row > td { background: #f7fafa; }
    .server-form h6 { font-weight: 700; color: #23474a; margin: 4px 0 12px; }
    .server-form .form-check-label { font-size: 14px; }
    .host-port { display: flex; gap: 8px; }
    .host-port .port { flex: 0 0 110px; }
    .test-mail { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin-top: 8px; }
    .test-mail label { margin: 0; font-weight: 600; }
    .test-mail .form-select { flex: 0 1 260px; }
    .test-mail .form-control { flex: 1 1 220px; max-width: 320px; }
    .mail-servers .uses div { margin-top: 4px; }
    /* Phones: each module as a block of label / value lines instead of a table that scrolls sideways. */
    @media (max-width: 767.98px) {
      .mail-servers .table thead { display: none; }
      .mail-servers .table, .mail-servers .table tbody, .mail-servers .table tr, .mail-servers .table td { display: block; width: 100%; }
      .mail-servers .table tr { border-bottom: 1px solid #d5e1e2; }
      .mail-servers .table tr:last-child { border-bottom: 0; }
      .mail-servers .table td { border: 0 !important; padding: 6px 12px; }
      .mail-servers .table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; }
      .mail-servers .table td:first-child::before { display: none; }
      .mail-servers .table td.actions { padding-bottom: 12px; }
      .mail-servers .table td.actions .row-actions { justify-content: flex-start !important; }
      .test-mail .form-select, .test-mail .form-control { flex: 1 1 100%; max-width: none; }
      .test-mail .btn { width: 100%; }
    }`,
})
export class MailServersCard {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/email';

  protected readonly info = signal<MailServerInfo | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly form = signal<ServerForm>(MailServersCard.blank());
  protected readonly busy = signal(false);
  protected readonly message = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly testModule = signal('Default');
  protected readonly testTo = signal('');
  protected readonly testing = signal(false);
  protected readonly testResult = signal<{ ok: boolean; text: string } | null>(null);
  /** A problem with the edited server, shown inside its form (field: the input to mark). */
  protected readonly formError = signal<{ field: keyof ServerForm | null; text: string } | null>(null);
  protected readonly testInvalid = computed(() => {
    const to = this.testTo().trim();
    return !!to && !EMAIL_PATTERN.test(to);
  });
  private readonly messageBox = viewChild<ElementRef<HTMLElement>>('messageBox');
  private readonly defaultModule = computed(() => this.info()?.modules.find((m) => m.key === 'Default') ?? null);
  /** Collapsed at first: the header says enough (how many modules have their own server, anything missing). */
  protected readonly open = signal(false);
  protected readonly summary = computed(() => {
    const modules = this.info()?.modules ?? [];
    const own = modules.filter((m) => m.uses === 'Module').length;
    const none = modules.filter((m) => m.uses === 'None').length;
    const parts = [`${modules.length} modules`, own === 1 ? '1 with its own server' : `${own} with their own server`];
    if (none) parts.push(`${none} without a mail server`);
    return parts.join(' · ');
  });

  constructor() {
    void this.load();
  }

  /** The server a module's mails go through now. */
  protected used(m: MailModuleView): SmtpServerView | null {
    const def = this.defaultModule();
    switch (m.uses) {
      case 'Module': return m.saved;
      case 'Default': return def?.saved ?? null;
      case 'ServerFile': return m.configured;
      case 'ServerFileDefault': return def?.configured ?? null;
      default: return null;
    }
  }

  protected signInNeeds(s: { host: string; userName: string | null }): boolean {
    return signInNeedsAddress(s.host, s.userName);
  }

  /** The From address as an example sign-in name. */
  protected addressHint(): string {
    const from = this.form().from.trim();
    const inner = (/<([^>]+)>/.exec(from)?.[1] ?? from).trim();
    return EMAIL_PATTERN.test(inner) ? inner : 'name@example.org';
  }

  protected cancel(): void {
    this.formError.set(null);
    this.editing.set(null);
  }

  /** The server's checks, made before sending: the first problem, or null. */
  private check(f: ServerForm, m: MailModuleView): { field: keyof ServerForm | null; text: string } | null {
    const host = f.host.trim();
    const from = f.from.trim();
    if (!host) return { field: 'host', text: 'Please enter the mail server (host name).' };
    if (/\s|\//.test(host)) return { field: 'host', text: 'Enter the host name only, e.g. smtp.office365.com.' };
    if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) return { field: 'port', text: 'The port must be a whole number between 1 and 65535.' };
    if (!from) return { field: 'from', text: 'Please enter the From address.' };
    const inner = /^[^<>]*<\s*([^<>\s]+)\s*>$/.exec(from)?.[1] ?? from;
    if (!EMAIL_PATTERN.test(inner)) return { field: 'from', text: `'${from}' is not a valid From address (e.g. ZED <noreply@example.org> or noreply@example.org).` };
    if (signInNeedsAddress(host, f.userName)) return { field: 'userName', text: `This mail service only accepts the full mailbox address as the sign-in name, e.g. ${this.addressHint()}.` };
    const keepsPassword = !!m.saved?.passwordSet && !f.clearPassword;
    if (f.userName.trim() && !f.password && !keepsPassword)
      return { field: 'password', text: 'Please enter the password of this sign-in name (or leave the sign-in name empty for a server without sign-in).' };
    return null;
  }

  private showMessage(message: { ok: boolean; text: string }): void {
    this.message.set(message);
    // The note sits above the table: bring it into view after a save or a clear further down.
    setTimeout(() => this.messageBox()?.nativeElement.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' }));
  }

  protected edit(m: MailModuleView): void {
    // A module's own server, else what its mails use now (without a password: it is never sent to the page).
    const from = m.saved ?? this.used(m);
    this.form.set(from
      ? { host: from.host, port: from.port, startTls: from.startTls, from: from.from ?? '', userName: from.userName ?? '', password: '', clearPassword: false }
      : MailServersCard.blank());
    this.message.set(null);
    this.formError.set(null);
    this.editing.set(m.key);
  }

  protected set<K extends keyof ServerForm>(key: K, value: ServerForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected async save(m: MailModuleView): Promise<void> {
    const f = this.form();
    const problem = this.check(f, m);
    this.formError.set(problem);
    if (problem) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(`${MailServersCard.url}/servers/${m.key}`, {
        host: f.host.trim(), port: f.port || 587, startTls: f.startTls, from: f.from.trim(), userName: f.userName.trim(),
        password: f.clearPassword ? '' : f.password, clearPassword: f.clearPassword,
      }));
      this.editing.set(null);
      await this.load();
      this.showMessage({ ok: true, text: r.message });
    } catch (err) {
      this.formError.set({ field: null, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async clear(m: MailModuleView): Promise<void> {
    const then = m.key === 'Default' ? "the server's settings file" : 'Default';
    if (!window.confirm(`Remove the mail server of ${m.label}? Its mails will use ${then}.`)) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const r = await firstValueFrom(this.http.delete<MessageResponse>(`${MailServersCard.url}/servers/${m.key}`));
      if (this.editing() === m.key) this.editing.set(null);
      await this.load();
      this.showMessage({ ok: true, text: r.message });
    } catch (err) {
      this.showMessage({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendTest(): Promise<void> {
    if (this.testing() || !this.testTo().trim() || this.testInvalid()) return;
    this.testing.set(true);
    this.testResult.set(null);
    try {
      const r = await firstValueFrom(this.http.post<MessageResponse>(`${MailServersCard.url}/test`, { to: this.testTo().trim(), module: this.testModule() }));
      this.testResult.set({ ok: true, text: r.message });
    } catch (err) {
      this.testResult.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.testing.set(false);
    }
  }

  /** Left out when the server does not answer (an older server). */
  private async load(): Promise<void> {
    try {
      this.info.set(await firstValueFrom(this.http.get<MailServerInfo>(`${MailServersCard.url}/servers`)));
    } catch {
      this.info.set(null);
    }
  }

  private static blank(): ServerForm {
    return { host: '', port: 587, startTls: true, from: '', userName: '', password: '', clearPassword: false };
  }
}
