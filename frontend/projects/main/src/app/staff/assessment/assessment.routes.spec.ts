import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, CanActivateFn, Router, RouterStateSnapshot, UrlTree, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ASSESSMENT_LEGACY_REDIRECTS, ASSESSMENT_ROUTES } from './assessment.routes';

describe('assessment routes', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
  });

  async function canOpen(path: string, roleId: number, subRoles: string[]): Promise<true | string> {
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'U', roleId, role: '', subRoles });
    const route = ASSESSMENT_ROUTES.find((r) => r.path === path)!;
    const guard = route.canActivate![0] as CanActivateFn;
    const result = await TestBed.runInInjectionContext(() => guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)) as true | UrlTree;
    return result === true ? true : TestBed.inject(Router).serializeUrl(result);
  }

  it('limits each screen to the roles and sub-roles of its menu entry', async () => {
    expect(await canOpen('assessment/allot', 7, [])).toBe(true);
    expect(await canOpen('assessment/allot', 2, ['DesktopVerification'])).toBe('/staff');
    expect(await canOpen('assessment/da-allotment', 2, ['DesktopVerification'])).toBe(true);
    expect(await canOpen('assessment/da-allotment', 2, ['SiteVerification'])).toBe('/staff');
    expect(await canOpen('assessment/da-verification', 3, ['SiteVerification'])).toBe('/staff');
    expect(await canOpen('assessment/non-conformances', 3, [])).toBe(true);
    expect(await canOpen('assessment/da-details/:zedId/:certification', 17, [])).toBe(true);
    expect(await canOpen('assessment/da-details/:zedId/:certification', 1, [])).toBe('/staff');
  });

  it('redirects the old DaDetails address with its query parameters', () => {
    const redirect = ASSESSMENT_LEGACY_REDIRECTS.find((r) => r.path === 'Assessment/DaDetails')!.redirectTo as (s: { queryParams: Record<string, string> }) => string;
    expect(redirect({ queryParams: { zedId: 'ZEDMSME000001', Certification: 'Bronze' } })).toBe('/staff/assessment/da-details/ZEDMSME000001/Bronze');
  });
});
