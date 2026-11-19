import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../shared/page-head';
import { TextPipe, t } from '../../content/page-text';

/** "Contact ZED". Port of Views/Home/Contact.cshtml; V4: page head, label / field grid in a card. */
@Component({
  selector: 'zed-msme-contact',
  imports: [FormsModule, Recaptcha, PageHead, TextPipe],
  template: `
    <div class="container form-page">
      <div class="narrow-page">
        <zed-page-head [crumbs]="crumbs()" [title]="'Contact ZED' | t: 'msme.contact.title'" />
        <div class="zed-card">
          @if (success()) {
            <div class="alert alert-success mb-0" role="status"><strong>{{ success() }}</strong></div>
          } @else {
            @if (error()) {
              <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
            }
            <form (ngSubmit)="submit()" novalidate>
              <div class="form-grid">
                <label for="name">{{ 'Your Name:' | t: 'msme.contact.nameLabel' }}</label>
                <input id="name" name="name" class="form-control" [placeholder]="'Type here' | t: 'msme.contact.placeholder'" maxlength="200" [(ngModel)]="name" required />
                <label for="mobile">{{ 'Your Mobile Number:' | t: 'msme.contact.mobileLabel' }}</label>
                <input id="mobile" name="mobile" class="form-control" [placeholder]="'Type here' | t: 'msme.contact.placeholder'" maxlength="10" inputmode="numeric" [(ngModel)]="mobile" required />
                <label for="email">{{ 'Your Email:' | t: 'msme.contact.emailLabel' }}</label>
                <input id="email" name="email" type="email" class="form-control" [placeholder]="'Type here' | t: 'msme.contact.placeholder'" maxlength="200" [(ngModel)]="email" required />
                <label for="query" class="align-self-start">{{ 'Your Query:' | t: 'msme.contact.queryLabel' }}</label>
                <textarea id="query" name="query" class="form-control" [placeholder]="'Type here' | t: 'msme.contact.placeholder'" rows="4" maxlength="4000" [(ngModel)]="query" required></textarea>
                <span></span>
                <div><zed-recaptcha (token)="captchaToken = $event" /></div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'Submit' | t: 'msme.contact.submitButton' }}</button>
              </div>
            </form>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .narrow-page { max-width: 760px; margin: 24px auto 0; }
    /* 2026-11-20 (applicant UI pass): the fields take the card's width (they stopped at 280px, half the card empty) and the
       query box is tall enough to write in. */
    .form-grid { display: grid; grid-template-columns: 190px minmax(0, 1fr); gap: 14px 18px; align-items: center; }
    .form-grid > .form-control { width: 100%; max-width: none; }
    .form-grid > textarea.form-control { min-height: 130px; resize: vertical; }
    .form-grid > label { margin: 0; font-weight: 600; }
    .form-grid > .align-self-start { padding-top: 9px; }
    .form-actions { display: flex; justify-content: flex-end; margin-top: 18px; }
    @media (max-width: 767.98px) {
      .form-grid { grid-template-columns: minmax(0, 1fr); gap: 6px; }
      .form-grid > label:not(:first-child) { margin-top: 10px; }
      .form-grid > span:empty { display: none; }
      .form-actions .btn { width: 100%; }
    }
  `,
})
export class ContactPage {
  private readonly http = inject(HttpClient);
  private readonly captcha = viewChild(Recaptcha);

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected name = '';
  protected mobile = '';
  protected email = '';
  protected query = '';
  protected captchaToken = '';
  protected readonly crumbs = computed(() => [{ label: t('msme.contact.crumb.home', 'Home'), link: '/msme/dashboard' }, { label: t('msme.contact.crumb.contact', 'Contact ZED') }]);

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.name.trim() || !this.mobile.trim() || !this.email.trim() || !this.query.trim()) {
      this.error.set(t('msme.contact.missingError', 'Please enter all the required data.'));
      return;
    }
    // As the server checks them (ContactController), so the user is told which field is wrong.
    if (!/^\d{10}$/.test(this.mobile.trim())) {
      this.error.set(t('msme.contact.mobileError', 'Please enter a valid 10 digit mobile number.'));
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.error.set(t('msme.contact.emailError', 'Please enter a valid e-mail address.'));
      return;
    }
    if (!this.captchaToken) {
      this.error.set(t('msme.contact.captchaError', 'Please complete the verification.'));
      return;
    }
    this.busy.set(true);
    try {
      const res = await firstValueFrom(
        this.http.post<MessageResponse>('/api/contact', {
          name: this.name,
          mobile: this.mobile,
          email: this.email,
          query: this.query,
          captchaToken: this.captchaToken,
        }),
      );
      this.success.set(res.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.captcha()?.reset();
    } finally {
      this.busy.set(false);
    }
  }
}
