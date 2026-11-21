import { DatePipe } from '@angular/common';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
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
 * who it belongs to (GET api/staff/password-reset/{userId}: name, role, status, the address: in full since 2026-11-18, the user) and says up front why a
 * link cannot be sent (blocked, no valid e-mail, ...); "Send reset link" is the confirmation. On the right how the link
 * works and the links sent since the page was opened.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-06's 856 / 420 columns, a 360px User ID box, icon tiles
 * and dividers in the rail card heads, the status pill top right of the user card, 40px buttons (grey Cancel, a mail icon
 * on Send reset link).
 */
@Component({
  selector: 'zed-staff-password-reset-link',
  imports: [FormsModule, DatePipe, PageHead, StepTracker, TextPipe],
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="'Password Reset Link' | t: 'staff.passwordResetLink.title'"
                   [subtitle]="'E-mails any staff account of this portal a link to set a new password.' | t: 'staff.passwordResetLink.subtitle'" />
    <div class="prl-grid">
      <section class="zed-card prl-main">
        <zed-step-tracker class="prl-steps" [steps]="steps()" [current]="step() === 2 ? 3 : step()" [label]="'Steps' | t: 'staff.passwordResetLink.stepsLabel'" />
        <form class="prl-form" (ngSubmit)="step() === 0 ? lookUp() : send()" novalidate>
          <label class="form-label" for="resetUserId">{{ 'User ID' | t: 'staff.passwordResetLink.userIdLabel' }}<span class="req">*</span></label>
          <div class="prl-id">
            <input id="resetUserId" name="userId" class="form-control" [ngModel]="userId" (ngModelChange)="typed($event)" required maxlength="50" autocomplete="off"
                   [placeholder]="'e.g. ZEDAA0001' | t: 'staff.passwordResetLink.userIdPlaceholder'" aria-describedby="resetUserIdHelp" [readonly]="step() > 0" />
            @if (step() > 0) { <button type="button" class="btn btn-link prl-change" (click)="restart()">{{ 'Change' | t: 'staff.passwordResetLink.changeButton' }}</button> }
          </div>
          <small id="resetUserIdHelp" class="prl-help">{{ 'The login ID of any staff account: agency, assessor, Master Admin, Ministry, MSME DFO or dashboard.' | t: 'staff.passwordResetLink.userIdHelp' }}</small>
          @if (target(); as tg) {
            <div class="prl-who" [class.is-blocked]="!tg.canSend">
              <span class="prl-av" aria-hidden="true">{{ initials(tg.userName) }}</span>
              <div class="prl-who-text">
                <strong>{{ tg.userName }}</strong>
                <small>{{ '{role} · {id}' | t: 'staff.passwordResetLink.who.line' : { role: roleName(tg), id: tg.userId } }}</small>
                @if (tg.canSend) {
                  <span class="prl-to" [title]="tg.email">{{ 'Link will go to' | t: 'staff.passwordResetLink.who.linkTo' }} <b>{{ tg.email }}</b></span>
                } @else {
                  <span class="prl-why" role="alert">{{ tg.reason }}</span>
                }
              </div>
              <span class="status-badge" [class.is-active]="tg.isActive" [class.is-rejected]="!tg.isActive">{{ tg.isActive ? ('Active' | t: 'staff.passwordResetLink.who.active') : ('Blocked' | t: 'staff.passwordResetLink.who.blocked') }}</span>
            </div>
          }
          @if (step() === 2 && lastSent(); as s) {
            <div class="prl-done" role="status">{{ 'Link e-mailed to {to}. It works once, for a short time.' | t: 'staff.passwordResetLink.done.text' : { to: s.sentTo } }}</div>
          }

          <div class="prl-actions">
            @switch (step()) {
              @case (0) { <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'Find user' | t: 'staff.passwordResetLink.findButton' }}</button> }
              @case (1) {
                <button type="button" class="btn btn-default" (click)="restart()">{{ 'Cancel' | t: 'staff.passwordResetLink.cancelButton' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy() || !target()?.canSend"><svg class="prl-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6" /></svg>{{ 'Send reset link' | t: 'staff.passwordResetLink.sendButton' }}</button>
              }
              @default { <button type="button" class="btn btn-primary" (click)="restart()">{{ 'Send another link' | t: 'staff.passwordResetLink.anotherButton' }}</button> }
            }
            <small class="prl-help ms-auto">{{ 'Works once, for a short time.' | t: 'staff.passwordResetLink.worksOnceNote' }}</small>
          </div>
          <!-- 2026-11-21 (UI audit F6): the error under the buttons, so it never pushes "Find user" down; typing clears it. -->
          @if (error()) { <div class="alert alert-danger prl-alert" role="alert">{{ error() }}</div> }
        </form>
      </section>

      <div class="prl-side">
        <section class="zed-card" aria-labelledby="prl-how-title">
          <h2 class="prl-title" id="prl-how-title"><span class="prl-tile" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01" /></svg></span>{{ 'How the link works' | t: 'staff.passwordResetLink.how.title' }}</h2>
          <ul class="prl-points">
            <li>{{ 'It goes to the registered e-mail address shown above.' | t: 'staff.passwordResetLink.how.point1' }}</li>
            <li>{{ 'You never see or set the password: the user chooses it.' | t: 'staff.passwordResetLink.how.point2' }}</li>
            <li>{{ 'It works once, for a short time. A newer link replaces the older one.' | t: 'staff.passwordResetLink.how.point3' }}</li>
            <li class="is-amber">{{ 'A blocked user must be unblocked first, and a user without a valid e-mail address needs it updated first.' | t: 'staff.passwordResetLink.how.point4' }}</li>
          </ul>
        </section>
        <section class="zed-card" aria-labelledby="prl-sent-title">
          <h2 class="prl-title" id="prl-sent-title"><span class="prl-tile" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6" /></svg></span>{{ 'Sent from this page' | t: 'staff.passwordResetLink.sent.title' }} <span class="prl-count">{{ sent().length }}</span></h2>
          <div class="prl-card-body">
          @for (s of sent(); track $index) {
            <div class="prl-sent-row">
              <span class="prl-tick" aria-hidden="true"><svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg></span>
              <span class="prl-sent-who">
                <strong><span class="prl-sent-id">{{ s.userId }}</span> · {{ s.userName }}</strong>
                <small>{{ s.sentTo }} · {{ s.at | date: 'hh:mm a' }}</small>
              </span>
            </div>
          }
          <p class="prl-none">{{ sent().length ? ('Listed here until you leave the page.' | t: 'staff.passwordResetLink.sent.note') : ('Links you send are listed here until you leave the page.' | t: 'staff.passwordResetLink.sent.empty') }}</p>
          </div>
        </section>
      </div>
    </div>
  `,
  styles: `
    .prl-grid { display: grid; grid-template-columns: minmax(0, 856fr) minmax(0, 420fr); gap: 20px; align-items: start; }
    .prl-main { margin: 0; padding: 0; overflow: hidden; }
    .prl-steps ::ng-deep .st { border: 0; border-bottom: 1px solid #dde7e8; border-radius: 0; box-shadow: none; }
    .prl-form { padding: 20px 24px 24px; }
    .prl-form .form-label { font-size: 12.5px; font-weight: 600; color: #17373b; }
    .prl-id { display: flex; align-items: center; gap: 16px; }
    .prl-id input { flex: 0 1 360px; height: 40px; border-radius: 9px; font-size: 13px; }
    .prl-change { min-height: 0; padding: 0; font-size: 13px; font-weight: 700; color: #17373b; text-decoration: none; }
    .prl-help { display: block; margin-top: 8px; font-size: 12px; font-weight: 500; color: #6f8487; }
    .prl-alert { margin: 16px 0 0; }
    .prl-who { display: flex; align-items: flex-start; gap: 14px; margin-top: 18px; padding: 18px 20px; border: 1px solid #cfe3e5; border-radius: 12px; background: #f6fbfb; }
    .prl-who.is-blocked { border-color: #f1d9a6; background: #fffaf0; }
    .prl-av { flex: none; width: 44px; height: 44px; margin-top: 4px; border-radius: 50%; display: grid; place-items: center; background: #e6f2f3; color: #24666b; font-size: 13px; font-weight: 800; }
    .prl-who-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 12.5px; font-weight: 500; color: #17373b; overflow-wrap: anywhere; }
    .prl-who-text strong { font-size: 15px; font-weight: 700; color: #17373b; }
    .prl-who-text small { font-size: 12.5px; color: #6f8487; }
    .prl-who-text b { font-weight: 600; }
    .prl-who-text .prl-to { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; overflow-wrap: normal; }
    .prl-why { color: #9a5f06; font-weight: 600; }
    .prl-done { margin-top: 12px; padding: 10px 14px; border-radius: 10px; background: #e5f5ea; color: #1e6b3c; font-size: 13px; }
    .prl-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-top: 24px; }
    .prl-actions .btn { min-width: 120px; min-height: 42px; }
    .prl-actions .btn-primary { min-width: 200px; }
    .prl-ic, .prl-tile svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .prl-ic { width: 16px; height: 16px; }
    .prl-side { display: flex; flex-direction: column; gap: 20px; }
    .prl-side .zed-card { margin: 0; padding: 0; overflow: hidden; }
    .prl-title { margin: 0; padding: 13px 20px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; display: flex; align-items: center; gap: 12px; }
    .prl-tile { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; }
    .prl-tile svg { width: 16px; height: 16px; }
    .prl-count { margin-left: auto; min-width: 26px; padding: 2px 9px; border-radius: 10px; background: #e6f2f3; color: #24666b; font-size: 10.5px; text-align: center; }
    .prl-points { margin: 0; padding: 18px 24px 18px 42px; display: flex; flex-direction: column; gap: 8px; font-size: 12.5px; font-weight: 500; color: #17373b; }
    .prl-points li::marker { color: #24666b; }
    .prl-points li.is-amber::marker { color: #d98a12; }
    .prl-card-body { padding: 14px 24px 16px; }
    .prl-sent-row { display: flex; align-items: center; gap: 10px; padding: 6px 0; }
    .prl-tick { flex: none; width: 20px; height: 20px; border-radius: 50%; display: grid; place-items: center; background: #2f9e58; }
    .prl-tick svg { width: 12px; height: 12px; fill: none; stroke: #fff; stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .prl-sent-who { min-width: 0; display: flex; flex-direction: column; font-size: 12.5px; overflow-wrap: anywhere; }
    .prl-sent-who strong { font-weight: 600; color: #17373b; }
    .prl-sent-who small { font-size: 11.5px; color: #6f8487; }
    .prl-none { margin: 6px 0 0; font-size: 11.5px; font-weight: 500; color: #6f8487; }
    @media (max-width: 991.98px) { .prl-grid { grid-template-columns: minmax(0, 1fr); } }
  `,
})
export class PasswordResetLinkPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);
  private readonly labels = LABELS[inject(STAFF_SYSTEM)];

  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.passwordResetLink.crumb', 'Password Reset Link') }));
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
    const done = t('staff.passwordResetLink.step.done', 'Done');
    const note = (i: number) => (s > i ? done : s === i ? t('staff.passwordResetLink.step.here', 'You are here') : null);
    return [{ label: t('staff.passwordResetLink.step.enter', 'Enter the User ID'), note: note(0) },
      { label: t('staff.passwordResetLink.step.confirm', 'Confirm'), note: note(1) },
      { label: t('staff.passwordResetLink.step.emailed', 'Link e-mailed'), note: s === 2 ? done : null }];
  });

  /** The role as this portal names it (Consultancy: Consultant Organisation, Consultant/Expert). */
  protected roleName(r: ResetTarget): string {
    return r.roleId === 2 ? this.labels.agency : r.roleId === 3 ? this.labels.assessor : r.role;
  }

  /** 2026-11-21 (UI audit F6): a new User ID clears the last error. */
  protected typed(value: string): void {
    this.userId = value;
    if (this.error()) this.error.set('');
  }

  /** Step 1 → 2: who the User ID belongs to (read-only; nothing is sent). */
  protected async lookUp(): Promise<void> {
    this.error.set('');
    const id = this.userId.trim();
    if (!id) {
      this.error.set(t('staff.passwordResetLink.error.noUserId', 'Please enter the User ID.'));
      return;
    }
    this.busy.set(true);
    try {
      this.target.set(await firstValueFrom(this.http.get<ResetTarget>(API + encodeURIComponent(id))));
      this.userId = this.target()!.userId;
      this.step.set(1);
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse && err.status === 404 ? t('staff.passwordResetLink.error.notFound', 'User not found.') : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** Step 2 → 3: "Send reset link" is the confirmation. */
  protected async send(): Promise<void> {
    const tg = this.target();
    if (!tg?.canSend || this.busy()) return;
    this.error.set('');
    this.busy.set(true);
    try {
      const message = (await firstValueFrom(this.http.post<MessageResponse>(API + encodeURIComponent(tg.userId), null))).message;
      // The answer names the address in brackets, e.g. "(meena@zed.test)".
      const to = /\(([^()]*@[^()]*)\)/.test(message) ? sentTo(message, null) : tg.email ?? t('staff.passwordResetLink.toast.noEmail', 'Registered e-mail address');
      this.sent.update((list) => [{ userId: tg.userId, userName: tg.userName, sentTo: to, at: new Date() }, ...list]);
      this.step.set(2);
      this.toast.success(t('staff.passwordResetLink.toast.sent', 'Reset link sent'), t('staff.passwordResetLink.toast.sentTo', 'E-mailed to {to}', { to }));
    } catch (err) {
      this.error.set(err instanceof HttpErrorResponse && err.status === 404 ? t('staff.passwordResetLink.error.notFound', 'User not found.') : apiErrorMessage(err));
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
