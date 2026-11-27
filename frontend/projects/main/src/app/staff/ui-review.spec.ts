import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { staffMenuGuard } from './assessment/assessment-shared';
import { staffDashboardGuard } from './staff-home.guard';
import { menuScreenAllows } from './staff-menu';

/** 2026-11-27 (UI review of every login): the screens a login is sent to are the ones it may open. */
describe('UI review (2026-11-27)', () => {
  function run(guard: CanActivateFn, url: string, user: { roleId: number; subRoles?: string[] } | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { ensureLoaded: () => Promise.resolve(), currentUser: () => user } }],
    });
    return Promise.resolve(TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as boolean | UrlTree | Promise<boolean | UrlTree>);
  }
  const show = (r: boolean | UrlTree) => (r instanceof UrlTree ? r.toString() : r);

  afterEach(() => TestBed.resetTestingModule());

  it('opens the incentives dashboard for the incentive verification agencies and the Incentives Master Admin', async () => {
    const guard = staffMenuGuard('/staff/incentives/dashboard');
    expect(show(await run(guard, '/staff/incentives/dashboard', { roleId: 2, subRoles: ['SchemeDesktop'] }))).toBe(true);
    expect(show(await run(guard, '/staff/incentives/dashboard', { roleId: 2, subRoles: ['SchemeOnsite'] }))).toBe(true);
    expect(show(await run(guard, '/staff/incentives/dashboard', { roleId: 7, subRoles: ['IncentivesOnly'] }))).toBe(true);
    // An assessment agency and the main Master Admin keep their own dashboard.
    expect(menuScreenAllows('/staff/incentives/dashboard', 2, ['DesktopVerification'], 'main')).toBe(false);
    expect(menuScreenAllows('/staff/incentives/dashboard', 7, [], 'main')).toBe(false);
  });

  it('sends a login without the staff dashboard to its own home instead of a bare refusal', async () => {
    expect(show(await run(staffDashboardGuard, '/staff/dashboard', { roleId: 6 }))).toBe('/staff');
    expect(show(await run(staffDashboardGuard, '/staff/dashboard', { roleId: 7 }))).toBe(true);
    // The incentive logins have the incentives dashboard.
    expect(show(await run(staffDashboardGuard, '/staff/dashboard', { roleId: 2, subRoles: ['SchemeOnsite'] }))).toBe('/staff/incentives/dashboard');
    expect(show(await run(staffDashboardGuard, '/staff/dashboard', { roleId: 7, subRoles: ['IncentivesOnly'] }))).toBe('/staff/incentives/dashboard');
    expect(show(await run(staffDashboardGuard, '/staff/dashboard', { roleId: 2, subRoles: ['DesktopVerification'] }))).toBe(true);
  });
});
