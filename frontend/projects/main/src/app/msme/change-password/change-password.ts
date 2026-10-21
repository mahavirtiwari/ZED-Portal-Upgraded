import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** Change password while signed in (MSME and staff). Port of Views/User/ChangePassword.cshtml. */
@Component({
  selector: 'zed-msme-change-password',
  imports: [FormsModule],
  template: `
    <div class="container form-page">
      <div class="row justify-content-center mt-3">
        <div class="col-sm-6">
          <div class="panel panel-default panel-design">
            <div class="panel-body">
              <h3 class="registration-title">Change Password</h3>
              <form (ngSubmit)="submit()" novalidate>
                <div class="mb-3">
                  <label class="input-title" for="oldPassword">Old Password</label>
                  <input id="oldPassword" name="oldPassword" type="password" class="form-control" autocomplete="current-password"
                         [(ngModel)]="oldPassword" required maxlength="50" />
                </div>
                <div class="mb-3">
                  <label class="input-title" for="newPassword">New Password</label>
                  <input id="newPassword" name="newPassword" type="password" class="form-control" autocomplete="new-password"
                         [(ngModel)]="newPassword" required maxlength="50" />
                  <small class="text-muted">At least 8 characters, with an uppercase letter, a lowercase letter, a number and a special character.</small>
                </div>
                <div class="mb-3">
                  <label class="input-title" for="confirmPassword">Confirm Password</label>
                  <input id="confirmPassword" name="confirmPassword" type="password" class="form-control" autocomplete="new-password"
                         [(ngModel)]="confirmPassword" required maxlength="50" />
                </div>
                @if (error()) {
                  <div class="alert alert-danger" role="alert">{{ error() }}</div>
                }
                <div class="stepper-footer-sec initial-step">
                  <button type="submit" class="btn btn-primary" [disabled]="busy()">CHANGE PASSWORD</button>
                </div>
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class ChangePasswordPage {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** Where to sign in again afterwards (route data `loginUrl`; MSME login by default). */
  private readonly loginUrl: string = inject(ActivatedRoute).snapshot.data['loginUrl'] ?? '/msme/login';

  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected oldPassword = '';
  protected newPassword = '';
  protected confirmPassword = '';

  protected async submit(): Promise<void> {
    this.error.set('');
    if (!this.oldPassword || !this.newPassword) {
      this.error.set('Please enter valid data.');
      return;
    }
    if (this.newPassword !== this.confirmPassword) {
      this.error.set('NewPassword and ConfirmPassword should be same.');
      return;
    }
    this.busy.set(true);
    try {
      await firstValueFrom(
        this.http.post<MessageResponse>('/api/account/change-password', {
          oldPassword: this.oldPassword,
          newPassword: this.newPassword,
          confirmPassword: this.confirmPassword,
        }),
      );
      // The API signs the user out, as the old page did; log in again with the new password.
      this.auth.setUser(null);
      await this.router.navigate([this.loginUrl], { state: { message: 'Password changed. Please login with your new password.' } });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      this.oldPassword = this.newPassword = this.confirmPassword = '';
    } finally {
      this.busy.set(false);
    }
  }
}
