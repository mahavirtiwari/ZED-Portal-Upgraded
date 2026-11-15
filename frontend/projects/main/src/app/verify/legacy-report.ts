import { Component, InjectionToken, OnInit, inject, input, signal } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from '@zed/shared';
import { PORTAL_API_BASE } from '../staff/admin-portal';
import { canonicalLevelCode } from '../msme/shared/levels';
import { reportRoute } from '../report/report.api';

/** Leaves the Angular app for a file address (replaced in tests). */
export const OPEN_FILE = new InjectionToken<(url: string) => void>('OPEN_FILE', {
  providedIn: 'root',
  factory: () => (url: string) => location.replace(url),
});

/** The old e-mails' levels; 2026-11-08: every level of Administration → Certification Levels (consultancy: Silver and Gold). */
const levelOf = (value: string, system: LegacyReportSystem): string | undefined => {
  const code = canonicalLevelCode(value) ?? undefined;
  return system === 'consultancy' && code !== 'Silver' && code !== 'Gold' && code !== 'Bronze' ? undefined : code;
};
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
 * 2026-11-15: the reports are pages (/msme/report/..., /staff/report/...), a rejected copy's report included.
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
    const system = this.system() ?? 'main';
    // The router sets an input the address does not carry to undefined.
    const level = levelOf((this.certification() ?? '').trim(), system);
    const id = (this.id() ?? '').trim();
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
    const msme = user.roleId === MSME_ROLE;
    if (system === 'consultancy') {
      if (msme && !own) {
        this.message.set('This report link is not valid.');
        return;
      }
      // Staff: the consultancy portal's page (main's staff API knows only main's report).
      const route = reportRoute({ kind: 'milestone', level, milestone: Number(milestone), zedId: msme ? undefined : id });
      if (msme) await this.router.navigateByUrl(route, { replaceUrl: true });
      else this.open(PORTAL_API_BASE.consultancy + route);
      return;
    }
    const kind = system === 'surveillance' ? 'surveillance' : 'assessment';
    if (msme && !own && id.includes('_')) {
      // A rejected copy of the MSME's own record (ZEDMSME000123_D_45): the report page, like any report (the
      // server checks the copy belongs to the signed-in MSME).
      await this.router.navigateByUrl(reportRoute({ kind, level, record: id }), { replaceUrl: true });
      return;
    }
    if (msme) {
      if (!own) {
        this.message.set('This report link is not valid.');
        return;
      }
      await this.router.navigateByUrl(reportRoute({ kind, level }), { replaceUrl: true });
    } else if (system === 'surveillance') {
      // Staff: the surveillance portal's page.
      this.open(PORTAL_API_BASE.surveillance + reportRoute({ kind, level, zedId: id }));
    } else {
      await this.router.navigateByUrl(reportRoute({ kind, level, zedId: id }), { replaceUrl: true });
    }
  }
}
