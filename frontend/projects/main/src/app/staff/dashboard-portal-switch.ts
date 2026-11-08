import { Component, Provider, computed, inject, input } from '@angular/core';
import { AuthService } from '@zed/shared';
import { AdminPortalService, PortalSwitchComponent, dashboardPortals, isDashboardAdmin } from './admin-portal';
import { STAFF_SYSTEM } from './staff-menu';

/** The portals' names on a Dashboard Admin's switch. */
export const DASHBOARD_PORTAL_LABELS = { main: 'ZED Certification', consultancy: 'Handholding', surveillance: 'Surveillance' } as const;

/**
 * One Dashboard Admin (2026-11-07): the portal switch on its screens (dashboard, registered MSMEs, reports, ...), listing the
 * portals where the Admin ticked the screen. Nothing for other users or with a single main portal.
 */
@Component({
  selector: 'zed-dashboard-portal-switch',
  imports: [PortalSwitchComponent],
  template: `
    @if (shown()) {
      <zed-portal-switch [portals]="portals()" [labels]="labels" />
    }
  `,
})
export class DashboardPortalSwitchComponent {
  private readonly user = inject(AuthService).currentUser;
  /** The screen keys of the page (Zed.Core DashboardScreens). */
  readonly screens = input.required<readonly string[]>();
  protected readonly labels = DASHBOARD_PORTAL_LABELS;
  protected readonly portals = computed(() => dashboardPortals(this.user(), this.screens()));
  protected readonly shown = computed(() => {
    const p = this.portals();
    return isDashboardAdmin(this.user()) && (p.length > 1 || (p.length === 1 && p[0] !== 'main'));
  });
}

/**
 * For a page whose layout differs per portal (STAFF_SYSTEM): a Dashboard Admin on main gets the layout of the portal it
 * chose on the page; everybody else the build's.
 */
export function dashboardSystemProvider(screens: readonly string[]): Provider {
  return {
    provide: STAFF_SYSTEM,
    useFactory: () => {
      const build = inject(STAFF_SYSTEM, { skipSelf: true });
      const user = inject(AuthService).currentUser();
      return isDashboardAdmin(user) ? inject(AdminPortalService).effective(dashboardPortals(user, screens)) : build;
    },
  };
}
