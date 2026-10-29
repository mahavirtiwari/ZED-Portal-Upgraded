import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { RESET_CONFIRM } from './users.api';

/** A link sent from this page since it was opened (kept in the page only). */
interface SentLink {
  userId: string;
  sentTo: string;
  at: Date;
}

/**
 * MasterAdmin: e-mails any staff account of this portal a link to set a new password, including MasterAdmin and
 * SuperAdmin accounts, which cannot use "Forgot password?". The administrator never sees or sets the password. V4 layout:
 * page head, a card with the three steps (User ID, confirm, link e-mailed) and the form, a card on how the link works, and
 * the links sent since the page was opened with the masked address each went to (messages above the cards).
 */
@Component({
  selector: 'zed-staff-password-reset-link',
  imports: [FormsModule, DatePipe],
  template: `
    <div class="page-head">
      <div>
        <h1 class="registration-title">Password Reset Link</h1>
        <p class="page-sub">E-mails any staff account of this portal a link to set a new password.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <div class="prl-grid">
      <form class="zed-card prl-form" (ngSubmit)="send()" novalidate>
        <ol class="prl-steps" aria-label="Steps">
          <li [class.is-on]="!userId.trim()" [class.is-done]="!!userId.trim()"><span class="prl-step-no">1</span>Enter the User ID</li>
          <li [class.is-on]="!!userId.trim()"><span class="prl-step-no">2</span>Confirm</li>
          <li [class.is-done]="!!sent().length && !userId.trim()"><span class="prl-step-no">3</span>Link e-mailed</li>
        </ol>
        <p class="text-muted">The link is sent to the e-mail address registered for the account and works once, for a short time.
          Agencies and assessors can also be sent a link from their lists.</p>
        <div class="form-grid">
          <label for="resetUserId">User ID<span class="req">*</span></label>
          <div>
            <input id="resetUserId" name="userId" class="form-control" [(ngModel)]="userId" required maxlength="50" autocomplete="off"
                   placeholder="e.g. ZEDAA0001" aria-describedby="resetUserIdHelp" />
            <small id="resetUserIdHelp" class="text-muted">The login ID of any staff account: agency, assessor, Master Admin, Ministry, MSME DFO or dashboard.</small>
          </div>
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Send Reset Link</button>
        </div>
      </form>

      <div class="prl-side">
        <section class="zed-card prl-how" aria-labelledby="prl-how-title">
          <h2 class="prl-title" id="prl-how-title">How the link works</h2>
          <ul class="prl-points">
            <li><span class="prl-dot" aria-hidden="true"></span>It goes to the registered e-mail address; you see only a masked address.</li>
            <li><span class="prl-dot" aria-hidden="true"></span>You never see or set the password: the user chooses it.</li>
            <li><span class="prl-dot" aria-hidden="true"></span>It works once, for a short time. A newer link replaces the older one.</li>
            <li><span class="prl-dot is-amber" aria-hidden="true"></span>A blocked user must be unblocked first, and a user without a valid e-mail address needs it updated first.</li>
          </ul>
        </section>

        <section class="zed-card prl-sent" aria-labelledby="prl-sent-title">
          <h2 class="prl-title" id="prl-sent-title">Sent from this page <span class="prl-count">{{ sent().length }}</span></h2>
          @for (s of sent(); track $index) {
            <div class="prl-sent-row">
              <span class="prl-tick" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
              <span class="prl-sent-who">
                <strong class="prl-sent-id">{{ s.userId }}</strong>
                <small class="muted">{{ s.sentTo }}</small>
              </span>
              <small class="prl-sent-at muted">{{ s.at | date: 'HH:mm' }}</small>
            </div>
          } @empty {
            <p class="muted prl-none">Links you send are listed here until you leave the page.</p>
          }
        </section>
      </div>
    </div>
  `,
  styles: `
    .prl-grid { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 16px; align-items: start; }
    .prl-form { margin: 0; }
    .prl-side { display: flex; flex-direction: column; gap: 16px; }
    .prl-side .zed-card { margin: 0; }
    .prl-steps { display: flex; flex-wrap: wrap; gap: 8px; list-style: none; padding: 0; margin: 0 0 16px; }
    .prl-steps li { display: inline-flex; align-items: center; gap: 8px; padding: 6px 14px 6px 6px; border-radius: 20px; border: 1px solid #dfe9ea;
      background: #fff; color: #5f6f70; font-size: 13px; font-weight: 600; }
    .prl-step-no { flex: none; width: 24px; height: 24px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      background: #eef6f6; color: #2f7c83; font-size: 12px; }
    .prl-steps li.is-on { border-color: #45a5ad; color: #23474a; background: #eef6f6; }
    .prl-steps li.is-on .prl-step-no { background: #45a5ad; color: #fff; }
    .prl-steps li.is-done .prl-step-no { background: #2e9e5b; color: #fff; }
    .prl-form .form-grid small { display: block; margin-top: 4px; }
    .prl-title { margin: 0 0 12px; font-size: 15px; font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; }
    .prl-count { font-size: 12px; font-weight: 600; background: #eef6f6; color: #23474a; border-radius: 10px; padding: 0 8px; }
    .prl-points { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 10px; font-size: 14px; color: #232527; }
    .prl-points li { display: flex; gap: 10px; align-items: baseline; }
    .prl-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: #45a5ad; transform: translateY(-1px); }
    .prl-dot.is-amber { background: #d9a400; }
    .prl-sent-row { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-top: 1px solid #dfe9ea; }
    .prl-sent-row:first-of-type { border-top: 0; padding-top: 0; }
    .prl-tick { flex: 0 0 30px; width: 30px; height: 30px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center; background: #e7f5ec; }
    .prl-tick svg { width: 15px; height: 15px; fill: none; stroke: #1e7a3c; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .prl-sent-who { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; }
    .prl-sent-id { color: #232527; overflow-wrap: anywhere; }
    .prl-sent-who small { overflow-wrap: anywhere; }
    .prl-sent-at { flex: none; }
    .prl-none { margin: 0; font-size: 13px; }
    @media (max-width: 991.98px) {
      .prl-grid { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class PasswordResetLinkPage {
  private readonly http = inject(HttpClient);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  /** The links sent since the page was opened, newest first. */
  protected readonly sent = signal<SentLink[]>([]);
  protected userId = '';

  protected async send(): Promise<void> {
    this.error.set('');
    this.success.set('');
    const id = this.userId.trim();
    if (!id) {
      this.error.set('Please enter the User ID.');
      return;
    }
    if (!window.confirm(RESET_CONFIRM)) return;
    this.busy.set(true);
    try {
      const message = (await firstValueFrom(this.http.post<MessageResponse>(`/api/staff/password-reset/${encodeURIComponent(id)}`, null))).message;
      this.success.set(message);
      // The answer names the masked address in brackets, e.g. "(m******@zed.test)".
      const sentTo = /\(([^()]*@[^()]*)\)/.exec(message)?.[1] ?? 'Registered e-mail address';
      this.sent.update((list) => [{ userId: id, sentTo, at: new Date() }, ...list]);
      this.userId = '';
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse && err.status === 404 ? 'User not found.' : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
