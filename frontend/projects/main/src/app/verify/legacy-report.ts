import { Component, InjectionToken, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@zed/shared';

/** Leaves the Angular app for a file address (replaced in tests). */
export const OPEN_FILE = new InjectionToken<(url: string) => void>('OPEN_FILE', {
  providedIn: 'root',
  factory: () => (url: string) => location.replace(url),
});

const LEVELS = ['Bronze', 'Silver', 'Gold'];
const MSME_ROLE = 5;

/**
 * Old report address /SA/ReportSummary/{id}?certification=X, still in e-mails already sent (certificate,
 * report and rejection mails). The old page was public; now the report opens only for the signed-in MSME
 * that owns it (its own or a rejected record, ZEDMSME000123_D_45) or for staff allowed to see the record.
 * Runs in the browser after the app has loaded, so the SameSite=Strict session cookie is sent.
 */
@Component({
  selector: 'zed-legacy-report',
  template: `
    <div class="container mt-5 text-center">
      @if (message()) {
        <div class="alert alert-danger" role="alert">{{ message() }}</div>
      } @else {
        <p>Opening the assessment report ...</p>
      }
    </div>
  `,
})
export class LegacyReportRedirect implements OnInit {
  /** Route parameter (the ZED ID of the record) and query parameter. */
  readonly id = input<string>('');
  readonly certification = input<string>('');

  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly open = inject(OPEN_FILE);
  protected readonly message = signal('');

  ngOnInit(): void {
    void this.go();
  }

  private async go(): Promise<void> {
    const level = LEVELS.find((l) => l.toLowerCase() === this.certification().trim().toLowerCase());
    const id = this.id().trim();
    if (!level || !/^[A-Za-z0-9_]{1,50}$/.test(id)) {
      this.message.set('This report link is not valid.');
      return;
    }
    await this.auth.ensureLoaded().catch(() => undefined);
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/msme/login');
      return;
    }
    if (user.roleId === MSME_ROLE) {
      const own = id.toLowerCase() === user.userId.toLowerCase();
      this.open(`/api/msme/certification-documents/${level}/report${own ? '' : `?record=${encodeURIComponent(id)}`}`);
    } else {
      this.open(`/api/staff/certification-documents/${encodeURIComponent(id)}/${level}/report`);
    }
  }
}
