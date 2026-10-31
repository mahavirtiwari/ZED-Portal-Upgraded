import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** "Contact ZED". Port of Views/Home/Contact.cshtml; V4: page head, label / field grid in a card. */
@Component({
  selector: 'zed-msme-contact',
  imports: [FormsModule, Recaptcha],
  template: `
    <div class="container form-page">
      <div class="narrow-page">
        <div class="page-head">
          <div>
            <h3 class="registration-title">Contact ZED</h3>
          </div>
        </div>
        <div class="zed-card">
          @if (success()) {
            <div class="alert alert-success mb-0" role="status"><strong>{{ success() }}</strong></div>
          } @else {
            @if (error()) {
              <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
            }
            <form (ngSubmit)="submit()" novalidate>
              <div class="form-grid">
                <label for="name">Your Name:</label>
                <input id="name" name="name" class="form-control" placeholder="Type here" maxlength="200" [(ngModel)]="name" required />
                <label for="mobile">Your Mobile Number:</label>
                <input id="mobile" name="mobile" class="form-control" placeholder="Type here" maxlength="10" inputmode="numeric" [(ngModel)]="mobile" required />
                <label for="email">Your Email:</label>
                <input id="email" name="email" type="email" class="form-control" placeholder="Type here" maxlength="200" [(ngModel)]="email" required />
                <label for="query" class="align-self-start">Your Query:</label>
                <textarea id="query" name="query" class="form-control" placeholder="Type here" rows="4" maxlength="4000" [(ngModel)]="query" required></textarea>
                <span></span>
                <div><zed-recaptcha (token)="captchaToken = $event" /></div>
              </div>
              <div class="form-actions">
                <button type="submit" class="btn btn-primary" [disabled]="busy()">SUBMIT</button>
              </div>
            </form>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .narrow-page { max-width: 760px; margin: 24px auto 0; }
    .form-grid > .align-self-start { padding-top: 9px; }
    @media (max-width: 767.98px) { .form-grid > span:empty { display: none; } }
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

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.name.trim() || !this.mobile.trim() || !this.email.trim() || !this.query.trim()) {
      this.error.set('Please enter all the required data.');
      return;
    }
    // As the server checks them (ContactController), so the user is told which field is wrong.
    if (!/^\d{10}$/.test(this.mobile.trim())) {
      this.error.set('Please enter a valid 10 digit mobile number.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(this.email.trim())) {
      this.error.set('Please enter a valid e-mail address.');
      return;
    }
    if (!this.captchaToken) {
      this.error.set('Please complete the verification.');
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
