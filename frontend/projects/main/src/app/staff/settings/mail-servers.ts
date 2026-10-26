import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
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
        @if (message(); as m) {
          <div class="alert mb-2" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" role="status">{{ m.text }}</div>
        }

        <div class="table-responsive">
          <table class="table mb-2">
            <thead>
              <tr><th>Module</th><th>Mail server used</th><th>Set</th><th class="text-center">Actions</th></tr>
            </thead>
            <tbody>
              @for (m of s.modules; track m.key) {
                <tr [attr.data-module]="m.key">
                  <td>
                    <div class="fw-semibold">{{ m.label }}</div>
                    <small class="muted">{{ m.help }}</small>
                  </td>
                  <td class="server">
                    @if (used(m); as u) {
                      <div>{{ u.host }}:{{ u.port }}</div>
                      <small class="muted">From {{ u.from || '(none)' }}@if (u.userName) { · sign-in {{ u.userName }} }</small>
                    } @else {
                      <span class="status-badge is-rejected">No mail server</span>
                    }
                  </td>
                  <td class="uses">
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
                  </td>
                  <td>
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
                          <label for="smtpHost" class="req">Server (host)</label>
                          <div class="host-port">
                            <input id="smtpHost" name="smtpHost" class="form-control" maxlength="255" placeholder="e.g. smtp.office365.com"
                                   [ngModel]="form().host" (ngModelChange)="set('host', $event)" />
                            <input id="smtpPort" name="smtpPort" class="form-control port" type="number" min="1" max="65535" aria-label="Port"
                                   [ngModel]="form().port" (ngModelChange)="set('port', +$event)" />
                          </div>
                          <label for="smtpTls">Secure connection</label>
                          <div class="form-check">
                            <input id="smtpTls" name="smtpTls" class="form-check-input" type="checkbox"
                                   [ngModel]="form().startTls" (ngModelChange)="set('startTls', $event)" />
                            <label class="form-check-label" for="smtpTls">STARTTLS (usual on port 587). Off: SSL on port 465, or as the server offers.</label>
                          </div>
                          <label for="smtpFrom" class="req">From</label>
                          <input id="smtpFrom" name="smtpFrom" class="form-control" maxlength="320" placeholder="ZED <noreply@example.org>"
                                 [ngModel]="form().from" (ngModelChange)="set('from', $event)" />
                          <label for="smtpUser">Sign-in name</label>
                          <input id="smtpUser" name="smtpUser" class="form-control" maxlength="320" autocomplete="off" placeholder="Usually the mailbox address; empty: no sign-in"
                                 [ngModel]="form().userName" (ngModelChange)="set('userName', $event)" />
                          <label for="smtpPassword">Password</label>
                          <div>
                            <input id="smtpPassword" name="smtpPassword" class="form-control" type="password" maxlength="256" autocomplete="new-password"
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
                        <div class="form-actions">
                          <button type="button" class="btn btn-default" (click)="editing.set(null)">Cancel</button>
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
          <input id="testTo" name="testTo" type="email" class="form-control" maxlength="254" autocomplete="off" placeholder="name@example.com"
                 [ngModel]="testTo()" (ngModelChange)="testTo.set($event)" />
          <button type="submit" class="btn btn-primary" [disabled]="testing() || !testTo().trim()">
            {{ testing() ? 'Sending…' : 'Send test mail' }}
          </button>
        </form>
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
    .test-mail .form-control { flex: 1 1 220px; max-width: 320px; }`,
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

  protected edit(m: MailModuleView): void {
    // A module's own server, else what its mails use now (without a password: it is never sent to the page).
    const from = m.saved ?? this.used(m);
    this.form.set(from
      ? { host: from.host, port: from.port, startTls: from.startTls, from: from.from ?? '', userName: from.userName ?? '', password: '', clearPassword: false }
      : MailServersCard.blank());
    this.message.set(null);
    this.editing.set(m.key);
  }

  protected set<K extends keyof ServerForm>(key: K, value: ServerForm[K]): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected async save(m: MailModuleView): Promise<void> {
    const f = this.form();
    this.busy.set(true);
    this.message.set(null);
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(`${MailServersCard.url}/servers/${m.key}`, {
        host: f.host.trim(), port: f.port || 587, startTls: f.startTls, from: f.from.trim(), userName: f.userName.trim(),
        password: f.clearPassword ? '' : f.password, clearPassword: f.clearPassword,
      }));
      this.message.set({ ok: true, text: r.message });
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err) });
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
      this.message.set({ ok: true, text: r.message });
      if (this.editing() === m.key) this.editing.set(null);
      await this.load();
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async sendTest(): Promise<void> {
    if (this.testing() || !this.testTo().trim()) return;
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
