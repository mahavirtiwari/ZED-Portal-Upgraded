import { HttpClient } from '@angular/common/http';
import { NgTemplateOutlet } from '@angular/common';
import { Component, ElementRef, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CollapseCard } from '../collapse-card';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

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
 * V4 layout: the order a server is chosen in, Default in its own panel (every module falls back on it), the other modules
 * listed with "same as Default" in place of the repeated details, and the test mail in a panel of its own.
 */
@Component({
  selector: 'zed-staff-mail-servers',
  imports: [FormsModule, CollapseCard, NgTemplateOutlet, TextPipe],
  template: `
    @if (info(); as s) {
      <zed-collapse-card class="mail-servers" [title]="'Mail servers' | t: 'staff.mailServers.title'" [summary]="summary()" [(open)]="open">
        <p class="intro">{{ 'The SMTP server each group of mails is sent with. Which one a module uses:' | t: 'staff.mailServers.intro' }}</p>
        <ol class="chain" [attr.aria-label]="'Which mail server a module uses' | t: 'staff.mailServers.chain.aria'">
          <li>{{ 'Its own server' | t: 'staff.mailServers.chain.own' }}</li>
          <li>{{ 'else' | t: 'staff.mailServers.chain.else' }} <b>{{ 'Default' | t: 'staff.mailServers.chain.default' }}</b></li>
          <li>{{ "else the server's settings file" | t: 'staff.mailServers.chain.file' }}</li>
        </ol>
        @if (s.pickupDirectory) {
          <div class="alert alert-warning mb-2" role="alert">
            {{ "Mails are not sent on this server: they are written as files to the folder {folder} (Email:PickupDirectory in the server's settings file)." | t: 'staff.mailServers.pickupNote' : { folder: s.pickupDirectory } }}
          </div>
        }
        @if (s.redirectAllTo) {
          <div class="alert alert-info mb-2" role="note">
            @if (s.allowedRecipientDomains) {
              {{ 'On this server mails reach only addresses in {domains}; a mail with nobody there goes to {address}.' | t: 'staff.mailServers.redirectDomainsNote' : { domains: s.allowedRecipientDomains, address: s.redirectAllTo } }}
            } @else {
              {{ "On this server every mail goes to {address} instead of its recipients (Email:RedirectAllTo in the server's settings file)." | t: 'staff.mailServers.redirectNote' : { address: s.redirectAllTo } }}
            }
          </div>
        } @else if (s.allowedRecipientDomains) {
          <div class="alert alert-info mb-2" role="note">{{ 'On this server mails reach only addresses in {domains}.' | t: 'staff.mailServers.domainsNote' : { domains: s.allowedRecipientDomains } }}</div>
        }
        <div #messageBox>
          @if (message(); as m) {
            <div class="alert mb-2" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" role="status">{{ m.text }}</div>
          }
        </div>

        @if (defaultModule(); as d) {
          <section class="default-panel" [attr.data-module]="d.key" [attr.aria-label]="'Default mail server' | t: 'staff.mailServers.default.aria'">
            <div class="dp-icon" aria-hidden="true">✉</div>
            <div class="dp-main">
              <div class="dp-title">{{ '{module} mail server' | t: 'staff.mailServers.default.title' : { module: d.label } }}</div>
              <small class="muted d-block">{{ d.help }}</small>
              <div class="server dp-server">
                @if (used(d); as u) {
                  <div class="hp">{{ u.host }}:{{ u.port }}</div>
                  <small class="muted">@if (u.userName) { {{ 'From {from} · sign-in {name}' | t: 'staff.mailServers.server.fromSignIn' : { from: u.from || ('(none)' | t: 'staff.mailServers.server.fromNone'), name: u.userName } }} }
                  @else { {{ 'From {from}' | t: 'staff.mailServers.server.from' : { from: u.from || ('(none)' | t: 'staff.mailServers.server.fromNone') } }} }</small>
                  <span class="tls">{{ u.startTls ? ('STARTTLS' | t: 'staff.mailServers.server.startTls') : ('SSL / plain' | t: 'staff.mailServers.server.sslPlain') }}</span>
                } @else {
                  <span class="status-badge is-rejected">{{ 'No mail server' | t: 'staff.mailServers.server.none' }}</span>
                }
              </div>
            </div>
            <div class="dp-side">
              <div class="uses">
                @switch (d.uses) {
                  @case ('Module') { <span class="status-badge is-active">{{ 'Own server' | t: 'staff.mailServers.uses.own' }}</span> }
                  @case ('ServerFile') { <span class="status-badge is-pending">{{ 'Server file' | t: 'staff.mailServers.uses.file' }}</span> }
                  @case ('ServerFileDefault') { <span class="status-badge is-pending">{{ 'Server file (Default)' | t: 'staff.mailServers.uses.fileDefault' }}</span> }
                  @default { <span class="status-badge is-rejected">{{ 'Not set' | t: 'staff.mailServers.uses.notSet' }}</span> }
                }
                @if (d.saved; as v) {
                  @if (v.userName && !v.passwordSet) { <div><span class="status-badge is-rejected">{{ 'no password' | t: 'staff.mailServers.uses.noPassword' }}</span></div> }
                }
                @if (used(d); as u) {
                  @if (signInNeeds(u)) {
                    <div><span class="status-badge is-rejected" [title]="'This mail service only accepts the full mailbox address as the sign-in name' | t: 'staff.mailServers.uses.checkSignInTooltip'">{{ 'check sign-in name' | t: 'staff.mailServers.uses.checkSignIn' }}</span></div>
                  }
                }
              </div>
              <div class="row-actions">
                <button type="button" class="btn btn-sm btn-outline-primary" (click)="edit(d)">{{ d.saved ? ('Edit' | t: 'staff.mailServers.editButton') : ('Set' | t: 'staff.mailServers.setButton') }}</button>
                @if (d.saved) {
                  <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="clear(d)">{{ 'Clear' | t: 'staff.mailServers.default.clearButton' }}</button>
                }
              </div>
            </div>
            @if (editing() === d.key) {
              <div class="dp-form"><ng-container *ngTemplateOutlet="serverForm; context: { $implicit: d }" /></div>
            }
          </section>
        }

        <div class="mods-head">
          <span class="mods-title">{{ 'Modules' | t: 'staff.mailServers.modules.title' }}</span>
          <small class="muted">{{ '{count} with their own server · the others use Default' | t: 'staff.mailServers.modules.sub' : { count: ownCount() } }}</small>
        </div>
        <div class="table-responsive">
          <table class="table table-zed mods mb-2">
            <thead>
              <tr><th>{{ 'Module' | t: 'staff.mailServers.column.module' }}</th><th>{{ 'Mail server used' | t: 'staff.mailServers.column.server' }}</th><th>{{ 'Uses' | t: 'staff.mailServers.column.uses' }}</th><th class="text-center">{{ 'Actions' | t: 'staff.mailServers.column.actions' }}</th></tr>
            </thead>
            <tbody>
              @for (m of modules(); track m.key) {
                <tr [attr.data-module]="m.key" [class.own]="m.uses === 'Module'">
                  <td [attr.data-label]="'Module' | t: 'staff.mailServers.column.module'">
                    <div class="fw-semibold">{{ m.label }}</div>
                    <small class="muted">{{ m.help }}</small>
                  </td>
                  <td class="server" [attr.data-label]="'Mail server used' | t: 'staff.mailServers.column.server'">
                    @if (used(m); as u) {
                      <div class="hp">{{ u.host }}:{{ u.port }} <span class="tls">{{ u.startTls ? ('STARTTLS' | t: 'staff.mailServers.server.startTls') : ('SSL / plain' | t: 'staff.mailServers.server.sslPlain') }}</span></div>
                      @if (m.uses === 'Module' || m.uses === 'ServerFile') {
                        <small class="muted">@if (u.userName) { {{ 'From {from} · sign-in {name}' | t: 'staff.mailServers.server.fromSignIn' : { from: u.from || ('(none)' | t: 'staff.mailServers.server.fromNone'), name: u.userName } }} }
                        @else { {{ 'From {from}' | t: 'staff.mailServers.server.from' : { from: u.from || ('(none)' | t: 'staff.mailServers.server.fromNone') } }} }</small>
                      } @else {
                        <small class="muted inherit">{{ 'same as Default' | t: 'staff.mailServers.server.sameAsDefault' }}</small>
                      }
                    } @else {
                      <span class="status-badge is-rejected">{{ 'No mail server' | t: 'staff.mailServers.server.none' }}</span>
                    }
                  </td>
                  <td class="uses" [attr.data-label]="'Uses' | t: 'staff.mailServers.column.uses'">
                    @switch (m.uses) {
                      @case ('Module') { <span class="status-badge is-active">{{ 'Own server' | t: 'staff.mailServers.uses.own' }}</span> }
                      @case ('Default') { <span class="status-badge is-info">{{ 'Default' | t: 'staff.mailServers.uses.default' }}</span> }
                      @case ('ServerFile') { <span class="status-badge is-pending">{{ 'Server file' | t: 'staff.mailServers.uses.file' }}</span> }
                      @case ('ServerFileDefault') { <span class="status-badge is-pending">{{ 'Server file (Default)' | t: 'staff.mailServers.uses.fileDefault' }}</span> }
                      @default { <span class="status-badge is-rejected">{{ 'Not set' | t: 'staff.mailServers.uses.notSet' }}</span> }
                    }
                    @if (m.saved; as v) {
                      @if (v.userName && !v.passwordSet) { <div><span class="status-badge is-rejected">{{ 'no password' | t: 'staff.mailServers.uses.noPassword' }}</span></div> }
                    }
                    @if (used(m); as u) {
                      @if (signInNeeds(u)) {
                        <div><span class="status-badge is-rejected" [title]="'This mail service only accepts the full mailbox address as the sign-in name' | t: 'staff.mailServers.uses.checkSignInTooltip'">{{ 'check sign-in name' | t: 'staff.mailServers.uses.checkSignIn' }}</span></div>
                      }
                    }
                  </td>
                  <td class="actions">
                    <div class="row-actions justify-content-center">
                      <button type="button" class="btn btn-sm btn-outline-primary" (click)="edit(m)">{{ m.saved ? ('Edit' | t: 'staff.mailServers.editButton') : ('Set' | t: 'staff.mailServers.setButton') }}</button>
                      @if (m.saved) {
                        <button type="button" class="btn btn-sm btn-outline-danger" [disabled]="busy()" (click)="clear(m)">{{ 'Use Default' | t: 'staff.mailServers.useDefaultButton' }}</button>
                      }
                    </div>
                  </td>
                </tr>
                @if (editing() === m.key) {
                  <tr class="edit-row">
                    <td colspan="4"><ng-container *ngTemplateOutlet="serverForm; context: { $implicit: m }" /></td>
                  </tr>
                }
              }
            </tbody>
          </table>
        </div>

        <section class="test-panel" aria-labelledby="testTitle">
          <div class="tp-title" id="testTitle">{{ 'Test a mail server' | t: 'staff.mailServers.test.title' }}</div>
          <small class="muted d-block mb-2">{{ "The mail goes out at once through the module's server; a refusal shows the mail server's own message." | t: 'staff.mailServers.test.sub' }}</small>
          <form class="test-mail" (ngSubmit)="sendTest()" novalidate>
            <label for="testModule">{{ 'Send a test mail of' | t: 'staff.mailServers.test.moduleLabel' }}</label>
            <select id="testModule" name="testModule" class="form-select" [ngModel]="testModule()" (ngModelChange)="testModule.set($event)">
              @for (m of s.modules; track m.key) { <option [value]="m.key">{{ m.label }}</option> }
            </select>
            <label for="testTo">{{ 'to' | t: 'staff.mailServers.test.toLabel' }}</label>
            <input id="testTo" name="testTo" type="email" class="form-control" [class.is-invalid]="testInvalid()" maxlength="254" autocomplete="off" placeholder="name@example.com"
                   [ngModel]="testTo()" (ngModelChange)="testTo.set($event)" />
            <button type="submit" class="btn btn-primary" [disabled]="testing() || !testTo().trim() || testInvalid()">
              {{ testing() ? ('Sending…' | t: 'staff.mailServers.test.sending') : ('Send test mail' | t: 'staff.mailServers.test.sendButton') }}
            </button>
          </form>
          @if (testInvalid()) {
            <small class="help-block">{{ 'Please enter one valid e-mail address.' | t: 'staff.mailServers.test.invalidError' }}</small>
          }
          @if (testResult(); as r) {
            <div class="alert mt-2 mb-0" [class.alert-success]="r.ok" [class.alert-danger]="!r.ok" role="status">{{ r.text }}</div>
          }
        </section>
      </zed-collapse-card>
    }

    <ng-template #serverForm let-m>
      <form class="server-form" (ngSubmit)="save(m)" novalidate autocomplete="off">
        <h6>{{ '{module}: mail server' | t: 'staff.mailServers.form.title' : { module: m.label } }}</h6>
        <div class="form-grid">
          <label for="smtpHost">{{ 'Server (host)' | t: 'staff.mailServers.form.hostLabel' }}<span class="req">*</span></label>
          <div class="host-port">
            <input id="smtpHost" name="smtpHost" class="form-control" [class.is-invalid]="formError()?.field === 'host'" maxlength="255" [placeholder]="'e.g. smtp.office365.com' | t: 'staff.mailServers.form.hostPlaceholder'"
                   [ngModel]="form().host" (ngModelChange)="set('host', $event)" />
            <input id="smtpPort" name="smtpPort" class="form-control port" [class.is-invalid]="formError()?.field === 'port'" type="number" min="1" max="65535" [attr.aria-label]="'Port' | t: 'staff.mailServers.form.portAria'"
                   [ngModel]="form().port" (ngModelChange)="set('port', +$event)" />
          </div>
          <label class="top" for="smtpTls">{{ 'Secure connection' | t: 'staff.mailServers.form.tlsLabel' }}</label>
          <div class="form-check">
            <input id="smtpTls" name="smtpTls" class="form-check-input" type="checkbox"
                   [ngModel]="form().startTls" (ngModelChange)="set('startTls', $event)" />
            <label class="form-check-label" for="smtpTls">{{ 'STARTTLS (usual on port 587). Off: SSL on port 465, or as the server offers.' | t: 'staff.mailServers.form.tlsCheck' }}</label>
          </div>
          <label for="smtpFrom">{{ 'From' | t: 'staff.mailServers.form.fromLabel' }}<span class="req">*</span></label>
          <input id="smtpFrom" name="smtpFrom" class="form-control" [class.is-invalid]="formError()?.field === 'from'" maxlength="320" [placeholder]="'ZED <noreply@example.org>' | t: 'staff.mailServers.form.fromPlaceholder'"
                 [ngModel]="form().from" (ngModelChange)="set('from', $event)" />
          <label class="top" for="smtpUser">{{ 'Sign-in name' | t: 'staff.mailServers.form.userLabel' }}</label>
          <div>
            <input id="smtpUser" name="smtpUser" class="form-control" [class.is-invalid]="formError()?.field === 'userName'" maxlength="320" autocomplete="off"
                   [placeholder]="'Usually the mailbox address; empty: no sign-in' | t: 'staff.mailServers.form.userPlaceholder'"
                   [ngModel]="form().userName" (ngModelChange)="set('userName', $event)" />
            @if (signInNeeds(form())) {
              <small class="help-block">{{ 'This mail service only accepts the full mailbox address as the sign-in name, e.g. {address}.' | t: 'staff.mailServers.form.signInHint' : { address: addressHint() } }}</small>
            }
          </div>
          <label class="top" for="smtpPassword">{{ 'Password' | t: 'staff.mailServers.form.passwordLabel' }}</label>
          <div>
            <input id="smtpPassword" name="smtpPassword" class="form-control" [class.is-invalid]="formError()?.field === 'password'" type="password" maxlength="256" autocomplete="new-password"
                   [placeholder]="m.saved?.passwordSet ? ('Saved. Leave empty to keep it' | t: 'staff.mailServers.form.passwordPlaceholder') : ''"
                   [disabled]="form().clearPassword" [ngModel]="form().password" (ngModelChange)="set('password', $event)" />
            @if (m.saved?.passwordSet) {
              <div class="form-check mt-1">
                <input id="smtpClear" name="smtpClear" class="form-check-input" type="checkbox"
                       [ngModel]="form().clearPassword" (ngModelChange)="set('clearPassword', $event)" />
                <label class="form-check-label" for="smtpClear">{{ 'Remove the saved password' | t: 'staff.mailServers.form.clearPasswordCheck' }}</label>
              </div>
            }
            <small class="muted d-block mt-1">{{ 'Stored encrypted for this server; never shown again.' | t: 'staff.mailServers.form.passwordNote' }}</small>
          </div>
        </div>
        @if (formError(); as e) {
          <div class="alert alert-danger mt-3 mb-0" role="alert">{{ e.text }}</div>
        }
        <div class="form-actions">
          <button type="button" class="btn btn-default" (click)="cancel()">{{ 'Cancel' | t: 'staff.mailServers.form.cancelButton' }}</button>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'Save' | t: 'staff.mailServers.form.saveButton' }}</button>
        </div>
      </form>
    </ng-template>
  `,
  styles: `
    .intro { color: #5f6f70; margin: 0 0 6px; }
    .chain { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; list-style: none; padding: 0; margin: 0 0 14px; font-size: 13px; }
    .chain li { background: #eef6f6; color: #23474a; border-radius: 14px; padding: 3px 12px; }
    .chain li + li::before { content: '→'; color: #8a9899; margin: 0 8px 0 -2px; }

    /* Default: every module falls back on it. */
    .default-panel { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 4px 14px; align-items: start; padding: 14px 16px; margin-bottom: 16px;
      border: 1px solid #b9d8da; border-left: 4px solid #45a5ad; border-radius: 12px; background: #f6fbfb; }
    .dp-icon { width: 44px; height: 44px; border-radius: 12px; background: #45a5ad; color: #fff; display: grid; place-items: center; font-size: 20px; }
    .dp-title { font-weight: 700; color: #23474a; font-size: 15px; }
    .dp-server { margin-top: 8px; }
    .dp-server .hp { font-size: 15px; font-weight: 600; color: #232527; }
    .dp-side { display: flex; flex-direction: column; align-items: flex-end; gap: 8px; }
    .dp-side .uses { display: flex; flex-direction: column; align-items: flex-end; gap: 4px; }
    .dp-form { grid-column: 1 / -1; margin-top: 10px; padding-top: 12px; border-top: 1px solid #dfe9ea; }
    .tls { display: inline-block; font-size: 11px; font-weight: 700; letter-spacing: .03em; color: #3f3a7a; background: #f1f0fb; border-radius: 4px; padding: 0 6px; margin-left: 4px; vertical-align: 1px; }

    .mods-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px 12px; margin-bottom: 8px; }
    .mods-title { font-weight: 700; color: #23474a; font-size: 15px; }
    .mail-servers .table td, .mail-servers .table th { text-align: left; vertical-align: middle; }
    .mail-servers .table th:last-child { text-align: center; width: 200px; }
    .mods .row-actions { flex-wrap: nowrap; white-space: nowrap; }
    .mail-servers td small { display: block; }
    .mods td .fw-semibold { color: #232527; }
    .mods td small.muted { font-size: 12.5px; }
    .mods tr.own td:first-child { box-shadow: inset 3px 0 0 #2e9e5b; }
    .mods .server .hp { font-weight: 600; color: #232527; }
    .mods .inherit { font-style: italic; }
    .mail-servers .uses .status-badge { white-space: nowrap; }
    .mail-servers .uses div { margin-top: 4px; }
    .edit-row > td { background: #f7fafa; }
    .server-form h6 { font-weight: 700; color: #23474a; margin: 4px 0 12px; }
    .server-form .form-check-label { font-size: 14px; font-weight: 400; }
    /* Labels sit level with their input (not centred against the input + help lines); checkboxes line up with the inputs. */
    .server-form .form-grid > label.top { align-self: start; padding-top: 8px; }
    .server-form .form-check { display: flex; align-items: flex-start; gap: 8px; padding-left: 0; margin: 0; min-height: 0; }
    .server-form .form-check .form-check-input { float: none; flex: none; margin: 3px 0 0; }
    .server-form .form-grid > .form-check { align-self: center; }
    .host-port { display: flex; gap: 8px; }
    .host-port .port { flex: 0 0 110px; }

    .test-panel { margin-top: 14px; padding: 14px 16px; border: 1px dashed #b9d8da; border-radius: 12px; background: #fbfdfd; }
    .tp-title { font-weight: 700; color: #23474a; font-size: 15px; }
    .test-mail { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .test-mail label { margin: 0; font-weight: 600; }
    .test-mail .form-select { flex: 0 1 260px; }
    .test-mail .form-control { flex: 1 1 220px; max-width: 320px; }
    /* Phones: each module as a block of label / value lines instead of a table that scrolls sideways. */
    @media (max-width: 767.98px) {
      .default-panel { grid-template-columns: minmax(0, 1fr); }
      .dp-icon { display: none; }
      .dp-side, .dp-side .uses { align-items: flex-start; }
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
  private readonly confirms = inject(ConfirmService);
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
  protected readonly defaultModule = computed(() => this.info()?.modules.find((m) => m.key === 'Default') ?? null);
  /** The modules other than Default (the table). */
  protected readonly modules = computed(() => (this.info()?.modules ?? []).filter((m) => m.key !== 'Default'));
  protected readonly ownCount = computed(() => this.modules().filter((m) => m.uses === 'Module').length);
  /** Collapsed at first: the header says enough (how many modules have their own server, anything missing). */
  protected readonly open = signal(false);
  protected readonly summary = computed(() => {
    const modules = this.info()?.modules ?? [];
    const own = modules.filter((m) => m.uses === 'Module').length;
    const none = modules.filter((m) => m.uses === 'None').length;
    const parts = [
      t('staff.mailServers.summary.modules', '{count} modules', { count: modules.length }),
      own === 1 ? t('staff.mailServers.summary.ownOne', '1 with its own server') : t('staff.mailServers.summary.own', '{count} with their own server', { count: own }),
    ];
    if (none) parts.push(t('staff.mailServers.summary.none', '{count} without a mail server', { count: none }));
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
    return EMAIL_PATTERN.test(inner) ? inner : t('staff.mailServers.form.addressExample', 'name@example.org');
  }

  protected cancel(): void {
    this.formError.set(null);
    this.editing.set(null);
  }

  /** The server's checks, made before sending: the first problem, or null. */
  private check(f: ServerForm, m: MailModuleView): { field: keyof ServerForm | null; text: string } | null {
    const host = f.host.trim();
    const from = f.from.trim();
    if (!host) return { field: 'host', text: t('staff.mailServers.error.hostMissing', 'Please enter the mail server (host name).') };
    if (/\s|\//.test(host)) return { field: 'host', text: t('staff.mailServers.error.hostInvalid', 'Enter the host name only, e.g. smtp.office365.com.') };
    if (!Number.isInteger(f.port) || f.port < 1 || f.port > 65535) return { field: 'port', text: t('staff.mailServers.error.port', 'The port must be a whole number between 1 and 65535.') };
    if (!from) return { field: 'from', text: t('staff.mailServers.error.fromMissing', 'Please enter the From address.') };
    const inner = /^[^<>]*<\s*([^<>\s]+)\s*>$/.exec(from)?.[1] ?? from;
    if (!EMAIL_PATTERN.test(inner)) return { field: 'from', text: t('staff.mailServers.error.fromInvalid', "'{from}' is not a valid From address (e.g. ZED <noreply@example.org> or noreply@example.org).", { from }) };
    if (signInNeedsAddress(host, f.userName)) return { field: 'userName', text: t('staff.mailServers.form.signInHint', 'This mail service only accepts the full mailbox address as the sign-in name, e.g. {address}.', { address: this.addressHint() }) };
    const keepsPassword = !!m.saved?.passwordSet && !f.clearPassword;
    if (f.userName.trim() && !f.password && !keepsPassword)
      return { field: 'password', text: t('staff.mailServers.error.passwordMissing', 'Please enter the password of this sign-in name (or leave the sign-in name empty for a server without sign-in).') };
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
    const message = m.key === 'Default'
      ? t('staff.mailServers.removeConfirm.messageFile', "The mails of {module} will use the server's settings file.", { module: m.label })
      : t('staff.mailServers.removeConfirm.messageDefault', 'The mails of {module} will use Default.', { module: m.label });
    if (!(await this.confirms.ask({
      title: t('staff.mailServers.removeConfirm.title', 'Remove the Mail Server?'), message,
      confirmLabel: t('staff.mailServers.removeConfirm.button', 'Remove'), danger: true,
    }))) return;
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
