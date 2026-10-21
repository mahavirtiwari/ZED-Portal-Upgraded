import { HttpClient } from '@angular/common/http';
import { Component, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, Recaptcha, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** "Contact ZED". Port of Views/Home/Contact.cshtml. */
@Component({
  selector: 'zed-msme-contact',
  imports: [FormsModule, Recaptcha],
  template: `
    <div class="container form-page">
      <div class="row justify-content-center mt-3">
        <div class="col-sm-9">
          <div class="panel panel-default panel-design">
            <div class="panel-body">
              <h3 class="registration-title">Contact ZED</h3>
              @if (success()) {
                <div class="alert alert-success" role="status"><strong>{{ success() }}</strong></div>
              } @else {
                @if (error()) {
                  <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div>
                }
                <form (ngSubmit)="submit()" novalidate>
                  <div class="mb-3">
                    <label class="contact-label" for="name">Your Name:</label>
                    <input id="name" name="name" class="form-control" placeholder="Type here" maxlength="200" [(ngModel)]="name" required />
                  </div>
                  <div class="mb-3">
                    <label class="contact-label" for="mobile">Your Mobile Number:</label>
                    <input id="mobile" name="mobile" class="form-control" placeholder="Type here" maxlength="10" inputmode="numeric" [(ngModel)]="mobile" required />
                  </div>
                  <div class="mb-3">
                    <label class="contact-label" for="email">Your Email:</label>
                    <input id="email" name="email" type="email" class="form-control" placeholder="Type here" maxlength="200" [(ngModel)]="email" required />
                  </div>
                  <div class="mb-3">
                    <label class="contact-label" for="query">Your Query:</label>
                    <textarea id="query" name="query" class="form-control" placeholder="Type here" rows="4" maxlength="4000" [(ngModel)]="query" required></textarea>
                  </div>
                  <div class="mb-3"><zed-recaptcha (token)="captchaToken = $event" /></div>
                  <div class="mb-3 text-center">
                    <button type="submit" class="btn btn-primary btn-block" [disabled]="busy()">SUBMIT</button>
                  </div>
                </form>
              }
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: `
    .contact-label { color: #8d8f90; text-transform: uppercase; font-size: 14px; font-weight: 600; }
    .form-control { max-width: 100%; }
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
