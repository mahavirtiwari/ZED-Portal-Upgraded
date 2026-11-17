import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { StepTracker, TrackerStep } from '../../msme/shared/step-tracker';
import { LABELS } from '../../portal-labels';
import { staffCrumbs } from '../staff-crumbs';
import { STAFF_SYSTEM } from '../staff-menu';
import { ToastService } from '../toast';
import { initialsOf, sentTo } from './user-display';
import { ResetTarget } from './users.api';

/** A link sent from this page since it was opened (kept in the page only). */
interface SentLink {
  userId: string;
  userName: string;
  sentTo: string;
  at: Date;
}

const API = '/api/staff/password-reset/';

/**
 * MasterAdmin: e-mails any staff account of this portal a link to set a new password, including MasterAdmin and
 * SuperAdmin accounts, which cannot use "Forgot password?". The administrator never sees or sets the password.
 * 2026-11-17 (approved staff redesign, staff-06): the full-width three-step tracker; after the User ID the page looks up
 * who it belongs to (GET api/staff/password-reset/{userId}: name, role, status, the masked address) and says up front why a
 * link cannot be sent (blocked, no valid e-mail, ...); "Send reset link" is the confirmation. On the right how the link
 * works and the links sent since the page was opened.
 */
@Component({
  selector: 'zed-staff-password-reset-link',
  imports: [FormsModule, DatePipe, PageHead, StepTracker],
  template: `
    <zed-page-head [crumbs]="crumbs" title="Password Reset Link" subtitle="E-mails any staff account of this portal a link to set a new password." />
    <div class="prl-grid">
      <section class="zed-card prl-main">
        <zed-step-tracker class="prl-steps" [steps]="steps()" [current]="step() === 2 ? 3 : step()" label="Steps" />
        <form class="prl-form" (ngSubmit)="step() === 0 ? lookUp() : send()" novalidate>
          <label class="form-label" for="resetUserId">User ID<span class="req">*</span></label>
          <div class="prl-id">
            <input id="resetUserId" name="userId" class="form-control" [(ngModel)]="userId" required maxlength="50" autocomplete="off"
                   placeholder="e.g. ZEDAA0001" aria-describedby="resetUserIdHelp" [readonly]="step() > 0" />
            @if (step() > 0) { <button type="button" class="btn btn-link prl-change" (click)="restart()">Change</button> }
          </div>
          <small id="resetUserIdHelp" class="prl-help">The login ID of any staff account: agency, assessor, Master Admin, Ministry, MSME DFO or dashboard.</small>
          @if (error()) { <div class="alert alert-danger prl-alert" role="alert">{{ error() }}</div> }

          @if (target(); as t) {
            <div class="prl-who" [class.is-blocked]="!t.canSend">
              <span class="prl-av" aria-hidden="true">{{ initials(t.userName) }}</span>
              <div class="prl-who-text">
                <strong>{{ t.userName }}</strong>
                <small>{{ roleName(t) }} · {{ t.userId }}</small>
                @if (t.canSend) {
                  <span>Link will go to <b>{{ t.maskedEmail }}</b></span>
                } @else {
                  <span class="prl-why" role="alert">{{ t.reason }}</span>
                }
              </div>
              <span class="status-badge" [class.is-active]="t.isActive" [class.is-rejected]="!t.isActive">{{ t.isActive ? 'Active' : 'Blocked' }}</span>
            </div>
          }
          @if (step() === 2 && lastSent(); as s) {
            <div class="prl-done" role="status">Link e-mailed to <b>{{ s.sentTo }}</b>. It works once, for a short time.</div>
          }

          <div class="prl-actions">
            @switch (step()) {
              @case (0) { <button type="submit" class="btn btn-primary" [disabled]="busy()">Find user</button> }
              @case (1) {
                <button type="button" class="btn btn-ph" (click)="restart()">Cancel</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy() || !target()?.canSend">Send reset link</button>
              }
              @default { <button type="button" class="btn btn-primary" (click)="restart()">Send another link</button> }
            }
            <small class="prl-help ms-auto">Works once, for a short time.</small>
          </div>
        </form>
      </section>

      <div class="prl-side">
        <section class="zed-card" aria-labelledby="prl-how-title">
          <h2 class="prl-title" id="prl-how-title">How the link works</h2>
          <ul class="prl-points">
            <li>It goes to the registered e-mail address; you see only a masked address.</li>
            <li>You never see or set the password: the user chooses it.</li>
            <li>It works once, for a short time. A newer link replaces the older one.</li>
            <li class="is-amber">A blocked user must be unblocked first, and a user without a valid e-mail address needs it updated first.</li>
          </ul>
        </section>
        <section class="zed-card" aria-labelledby="prl-sent-title">
          <h2 class="prl-title" id="prl-sent-title">Sent from this page <span class="prl-count">{{ sent().length }}</span></h2>
          @for (s of sent(); track $index) {
            <div class="prl-sent-row">
              <span class="prl-tick" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
              <span class="prl-sent-who">
                <strong><span class="prl-sent-id">{{ s.userId }}</span> · {{ s.userName }}</strong>
                <small>{{ s.sentTo }} · {{ s.at | date: 'hh:mm a' }}</small>
              </span>
            </div>
          }
          <p class="prl-none">{{ sent().length ? 'Listed here until you leave the page.' : 'Links you send are listed here until you leave the page.' }}</p>
        </section>
      </div>
    </div>
  `,
  styles: `
    .prl-grid { display: grid; grid-template-columns: minmax(0, 1.75fr) minmax(0, 1fr); gap: 20px; align-items: start; }
    .prl-main { margin: 0; padding: 0; overflow: hidden; }
    .prl-steps ::ng-deep .st { border: 0; border-bottom: 1px solid #e6eeee; border-radius: 0; box-shadow: none; }
    .prl-form { padding: 18px 22px 22px; }
    .prl-id { display: flex; align-items: center; gap: 12px; max-width: 520px; }
    .prl-id input { flex: 1; }
    .prl-change { font-weight: 700; color: var(--zt-ink, #173f44); text-decoration: none; }
    .prl-help { display: block; margin-top: 6px; font-size: 12.5px; color: #5f6f70; }
    .prl-alert { margin: 12px 0 0; }
    .prl-who { display: flex; align-items: flex-start; gap: 14px; margin-top: 16px; padding: 16px 18px; border: 1px solid var(--zt-soft, #d4ebe6); border-radius: 12px; background: #f6fbfa; }
    .prl-who.is-blocked { border-color: #f1d9a6; background: #fffaf0; }
    .prl-av { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #e6f1ef; color: var(--zt-ink, #173f44); font-weight: 700; }
    .prl-who-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; overflow-wrap: anywhere; }
    .prl-who-text strong { font-size: 16px; color: var(--zt-ink, #173f44); }
    .prl-who-text small { color: #5f6f70; }
    .prl-why { color: #8a5a00; font-weight: 600; }
    .prl-done { margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: #e8f5ec; color: #1e6b3c; font-size: 13.5px; }
    .prl-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 18px; }
    .prl-actions .btn { min-width: 120px; height: 40px; font-weight: 700; }
    .prl-side { display: flex; flex-direction: column; gap: 20px; }
    .prl-side .zed-card { margin: 0; }
    .prl-title { margin: 0 0 12px; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); display: flex; align-items: center; gap: 8px; }
    .prl-count { margin-left: auto; font-size: 12px; background: #e6f1ef; border-radius: 10px; padding: 1px 9px; }
    .prl-points { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 8px; font-size: 13.5px; color: #24393b; }
    .prl-points li::marker { color: var(--zt-mid2, #2a8a8c); }
    .prl-points li.is-amber::marker { color: #d9a400; }
    .prl-sent-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .prl-tick { flex: none; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; background: #2e9e57; }
    .prl-tick svg { width: 13px; height: 13px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .prl-sent-who { min-width: 0; display: flex; flex-direction: column; font-size: 13.5px; overflow-wrap: anywhere; }
    .prl-sent-who strong { font-weight: 600; color: #24393b; }
    .prl-sent-who small { color: #5f6f70; }
    .prl-none { margin: 6px 0 0; font-size: 12.5px; color: #5f6f70; }
    @media (max-width: 991.98px) { .prl-grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class PasswordResetLinkPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly labels = LABELS[inject(STAFF_SYSTEM)];

  protected readonly crumbs = staffCrumbs({ label: 'Password Reset Link' });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  /** 0: enter the User ID, 1: confirm who gets the link, 2: link e-mailed. */
  protected readonly step = signal(0);
  protected readonly target = signal<ResetTarget | null>(null);
  /** The links sent since the page was opened, newest first. */
  protected readonly sent = signal<SentLink[]>([]);
  protected readonly lastSent = computed(() => this.sent()[0] ?? null);
  protected readonly initials = initialsOf;
  protected userId = '';

  protected readonly steps = computed<TrackerStep[]>(() => {
    const s = this.step();
    const note = (i: number) => (s > i ? 'Done' : s === i ? 'You are here' : null);
    return [{ label: 'Enter the User ID', note: note(0) }, { label: 'Confirm', note: note(1) }, { label: 'Link e-mailed', note: s === 2 ? 'Done' : null }];
  });

  /** The role as this portal names it (Consultancy: Consultant Organisation, Consultant/Expert). */
  protected roleName(t: ResetTarget): string {
    return t.roleId === 2 ? this.labels.agency : t.roleId === 3 ? this.labels.assessor : t.role;
  }

  /** Step 1 → 2: who the User ID belongs to (read-only; nothing is sent). */
  protected async lookUp(): Promise<void> {
    this.error.set('');
    const id = this.userId.trim();
    if (!id) {
      this.error.set('Please enter the User ID.');
      return;
    }
    this.busy.set(true);
    try {
      this.target.set(await firstValueFrom(this.http.get<ResetTarget>(API + encodeURIComponent(id))));
      this.userId = this.target()!.userId;
      this.step.set(1);
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse && err.status === 404 ? 'User not found.' : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Step 2 → 3: "Send reset link" is the confirmation. */
  protected async send(): Promise<void> {
    const t = this.target();
    if (!t?.canSend || this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      const message = (await firstValueFrom(this.http.post<MessageResponse>(API + encodeURIComponent(t.userId), null))).message;
      // The answer names the masked address in brackets, e.g. "(m******@zed.test)".
      const to = /\(([^()]*@[^()]*)\)/.test(message) ? sentTo(message, null) : t.maskedEmail ?? 'Registered e-mail address';
      this.sent.update((list) => [{ userId: t.userId, userName: t.userName, sentTo: to, at: new Date() }, ...list]);
      this.step.set(2);
      this.toast.success('Reset link sent', `E-mailed to ${to}`);
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse && err.status === 404 ? 'User not found.' : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected restart(): void {
    this.userId = '';
    this.target.set(null);
    this.error.set('');
    this.step.set(0);
  }
}
