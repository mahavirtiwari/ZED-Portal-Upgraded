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

/** Which application's report page the old link named (route data `system`). */
export type LegacyReportSystem = 'main' | 'surveillance' | 'consultancy';

/**
 * Old report address /SA/ReportSummary/{id}?certification=X, still in e-mails already sent (certificate,
 * report and rejection mails). The old page was public; now the report opens only for the signed-in MSME
 * that owns it (its own or a rejected record, ZEDMSME000123_D_45) or for staff allowed to see the record.
 * Runs in the browser after the app has loaded, so the SameSite=Strict session cookie is sent.
 * The surveillance and consultancy applications had the same page (/surveillance/SA/ReportSummary/{id}?certification=X,
 * /consultancy/SA/ReportSummary/{id}?certification=X&milestone=n, linked from Certification details and mails); they
 * open the surveillance report and the handholding milestone report, which this portal now draws.
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
  /** Query parameter of the consultancy link (1-3). */
  readonly milestone = input<string>('');
  /** Route data. */
  readonly system = input<LegacyReportSystem>('main');

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
    const system = this.system() ?? 'main';
    const milestone = String(this.milestone() ?? '').trim();
    const milestoneOk = system !== 'consultancy' || (/^[1-3]$/.test(milestone) && level !== 'Bronze');
    if (!level || !/^[A-Za-z0-9_]{1,50}$/.test(id) || !milestoneOk) {
      this.message.set('This report link is not valid.');
      return;
    }
    await this.auth.ensureLoaded().catch(() => undefined);
    const user = this.auth.currentUser();
    if (!user) {
      await this.router.navigateByUrl('/msme/login');
      return;
    }
    const own = id.toLowerCase() === user.userId.toLowerCase();
    if (system === 'consultancy') {
      if (user.roleId === MSME_ROLE && !own) {
        this.message.set('This report link is not valid.');
        return;
      }
      this.open(
        user.roleId === MSME_ROLE
          ? `/api/msme/certification-documents/${level}/report?milestone=${milestone}`
          : `/api/staff/certification-documents/${encodeURIComponent(id)}/${level}/report?milestone=${milestone}`,
      );
      return;
    }
    const type = system === 'surveillance' ? `${level}Surveillance` : level;
    if (user.roleId === MSME_ROLE) {
      this.open(`/api/msme/certification-documents/${type}/report${own ? '' : `?record=${encodeURIComponent(id)}`}`);
    } else {
      this.open(`/api/staff/certification-documents/${encodeURIComponent(id)}/${level}/report`);
    }
  }
}
