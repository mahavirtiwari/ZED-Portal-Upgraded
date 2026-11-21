import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ASSESSMENT_LEGACY_REDIRECTS, ASSESSMENT_ROUTES } from './assessment.routes';
import { SCHEME_VERIFICATION_ROUTES } from '../scheme-verification/scheme-verification.routes';

describe('assessment routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  async function run(guard: CanActivateFn, url: string, roleId: number, subRoles: string[]): Promise<true | string> {
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'U', roleId, role: '', subRoles });
    const result = await TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)) as true | UrlTree;
    return result === true ? true : TestBed.inject(Router).serializeUrl(result);
  }

  function canOpen(path: string, roleId: number, subRoles: string[]): Promise<true | string> {
    const route = ASSESSMENT_ROUTES.find((r) => r.path === path)!;
    return run(route.canActivate![0] as CanActivateFn, '/staff/' + path.split('/:')[0], roleId, subRoles);
  }

  /** 2026-11-21 (Assessor UI audit): a refused login gets the "no access" page naming the screen. */
  const refused = (screen: string) => `/staff/no-access?screen=${encodeURIComponent(screen)}&reason=role`;

  it('limits each screen to the roles and sub-roles of its menu entry', async () => {
    expect(await canOpen('assessment/allot', 7, [])).toBe(true);
    expect(await canOpen('assessment/allot', 2, ['DesktopVerification'])).toBe(refused('/staff/assessment/allot'));
    expect(await canOpen('assessment/da-allotment', 2, ['DesktopVerification'])).toBe(true);
    expect(await canOpen('assessment/da-allotment', 2, ['SiteVerification'])).toBe(refused('/staff/assessment/da-allotment'));
    expect(await canOpen('assessment/da-verification', 3, ['SiteVerification'])).toBe(refused('/staff/assessment/da-verification'));
    expect(await canOpen('assessment/non-conformances', 3, [])).toBe(true);
    expect(await canOpen('assessment/da-details/:zedId/:certification', 17, [])).toBe(true);
    expect(await canOpen('assessment/da-details/:zedId/:certification', 1, [])).toBe(refused('/staff/assessment/da-details'));
  });

  it('checks the menu entry of a screen: sub-roles and the kind of agency', async () => {
    // The agency's Completed list needs desktop or site verification, as its menu entry; the assessor's does not.
    expect(await canOpen('assessment/completed', 2, [])).toBe(refused('/staff/assessment/completed'));
    expect(await canOpen('assessment/completed', 2, ['SiteVerification'])).toBe(true);
    expect(await canOpen('assessment/completed', 3, [])).toBe(true);
    // An assessor of a desktop incentive agency has no Non-Conformances (its menu has only the scheme verification).
    expect(await canOpen('assessment/non-conformances', 3, ['SchemeDesktop'])).toBe(refused('/staff/assessment/non-conformances'));
    // The details pages, opened from the lists, keep their role check only.
    expect(await canOpen('assessment/da-details/:zedId/:certification', 3, ['SchemeDesktop'])).toBe(true);
  });

  it('opens the scheme verification list only to the assessors of a desktop incentive agency', async () => {
    const children = SCHEME_VERIFICATION_ROUTES.find((r) => r.path === 'verification')!.children!;
    const list = children.find((r) => r.path === '')!.canActivate![0] as CanActivateFn;
    expect(await run(list, '/staff/schemes-verify/verification', 3, ['DesktopVerification'])).toBe(refused('/staff/schemes-verify/verification'));
    expect(await run(list, '/staff/schemes-verify/verification', 3, ['SchemeDesktop'])).toBe(true);
    // The application page opened from the list has no menu check of its own.
    expect(children.find((r) => r.path === ':id')!.canActivate).toBeUndefined();
  });

  it('redirects the old DaDetails address with its query parameters', () => {
    const redirect = ASSESSMENT_LEGACY_REDIRECTS.find((r) => r.path === 'Assessment/DaDetails')!.redirectTo as (s: { queryParams: Record<string, string> }) => string;
    expect(redirect({ queryParams: { zedId: 'ZEDMSME000001', Certification: 'Bronze' } })).toBe('/staff/assessment/da-details/ZEDMSME000001/Bronze');
  });
});
