import { HttpClient } from '@angular/common/http';
import { Component, OnInit, inject, signal } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, CurrentUser, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** Where the dashboard finds the "Back to UBP" address for this browser tab. */
export const UBP_RETURN_KEY = 'zed.ubpReturnUrl';

interface SignInResponse {
  user: CurrentUser;
  returnUrl: string | null;
}

/**
 * Landing page of the Udyami Bharat portal hand-over: UBP sends the browser to
 * /Msme/ZedDashboard?applicationNo=&token= (the old MVC address). The API checks the one-time token with UBP
 * and signs the MSME in; the page then opens the dashboard. Port of MsmeController.ZedDashboard.
 */
@Component({
  selector: 'zed-udyami-signin',
  imports: [RouterLink],
  host: { class: 'zed-login' },
  template: `
    <div class="container py-5 text-center">
      @if (error()) {
        <div class="alert alert-danger d-inline-block" role="alert">{{ error() }}</div>
        <p><a routerLink="/msme/login">Go to the MSME login</a></p>
      } @else {
        <p class="text-muted" role="status">Signing you in from Udyami Bharat…</p>
      }
    </div>
  `,
})
export class UdyamiSignInPage implements OnInit {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const q = this.route.snapshot.queryParamMap;
    const applicationNo = q.get('applicationNo') ?? q.get('ApplicationNo') ?? '';
    const token = q.get('token') ?? q.get('Token') ?? '';
    // The one-time token should not stay in the address bar or history.
    history.replaceState(history.state, '', '/Msme/ZedDashboard');
    if (!applicationNo || !token) {
      this.error.set('Invalid token.');
      return;
    }
    try {
      await this.auth.ensureLoaded().catch(() => undefined); // fetches the XSRF cookie
      const r = await firstValueFrom(this.http.post<SignInResponse>('/api/msme/auth/udyami-bharat', { applicationNo, token }));
      try {
        if (r.returnUrl) sessionStorage.setItem(UBP_RETURN_KEY, r.returnUrl);
        else sessionStorage.removeItem(UBP_RETURN_KEY);
      } catch {
        // Storage blocked: the dashboard just shows no "Back to UBP" link.
      }
      this.auth.setUser(r.user);
      await this.router.navigateByUrl('/msme/dashboard', { replaceUrl: true });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
