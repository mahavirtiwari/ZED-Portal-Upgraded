import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService, authGuard } from '@zed/shared';
import { blockedScreen } from './sub-user-screens';

describe('sub-user screens (2026-11-21)', () => {
  const masterAdmin = 7;

  it('blocks an owner menu screen that was not given, and its sub-pages', () => {
    expect(blockedScreen('/staff/sub-users', masterAdmin, [], ['/staff/expenditure'])).toBe('/staff/sub-users');
    expect(blockedScreen('/staff/users/agencies/new', masterAdmin, [], ['/staff/expenditure'])).toBe('/staff/users/agencies');
    expect(blockedScreen('/staff/quality-observations?days=90', masterAdmin, [], ['/staff/expenditure'])).toBe('/staff/quality-observations');
  });

  it('leaves the given screens, the always-open ones, drill-down pages and non sub-users alone', () => {
    expect(blockedScreen('/staff/expenditure', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/dashboard', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/msme-profile/ZEDM000005', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/assessment/da-details/ZEDM000005/Silver', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/sub-users', masterAdmin, [], null)).toBeNull();
    // 2026-11-22: the ZED team's documents, for every sub-user.
    expect(blockedScreen('/staff/documents', masterAdmin, [], ['/staff/expenditure'])).toBeNull();
    expect(blockedScreen('/staff/documents', 2, ['SiteVerification'], [])).toBeNull();
  });
});

describe('role guard (authGuard, audit item 11)', () => {
  function run(guard: CanActivateFn, url: string, user: { roleId: number } | null) {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { ensureLoaded: () => Promise.resolve(), currentUser: () => user } }],
    });
    return TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as Promise<boolean | UrlTree>;
  }
  const show = (r: boolean | UrlTree) => (r instanceof UrlTree ? r.toString() : r);

  afterEach(() => TestBed.resetTestingModule());

  it('sends a signed-in staff user with another role to the no-access page naming the screen', async () => {
    const agency = { roleId: 2 };
    expect(show(await run(authGuard('/staff', [7]), '/staff/users/agencies?tab=1', agency))).toBe('/staff/no-access?screen=%2Fstaff%2Fusers%2Fagencies&reason=role');
    expect(show(await run(authGuard('/staff', [1]), '/staff/settings/texts', agency))).toBe('/staff/no-access?screen=%2Fstaff%2Fsettings%2Ftexts&reason=role');
  });

  it('lets the role in, and still sends signed-out users to the login', async () => {
    expect(await run(authGuard('/staff', [2, 7]), '/staff/users/agencies', { roleId: 7 })).toBe(true);
    expect(show(await run(authGuard('/staff', [7]), '/staff/users/agencies', null))).toBe('/staff');
    expect(show(await run(authGuard('/login', [1, 2, 7]), '/staff/monitoring', null))).toBe('/login');
  });

  it('leaves the MSME and public guards as they were', async () => {
    expect(show(await run(authGuard('/msme/login', [5]), '/msme/dashboard', { roleId: 2 }))).toBe('/msme/login');
    expect(show(await run(authGuard('/login', [1, 2, 7]), '/staff/monitoring', { roleId: 5 }))).toBe('/login');
  });
});
