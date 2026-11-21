import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { REMOTE_ALLOTMENTS_CACHE_KEY, REMOTE_ALLOTMENTS_TTL_MS, RemoteAllotments } from './remote-allotments';
import { StaffRole, type StaffMenuItem } from './staff-menu';

describe('RemoteAllotments (2026-11-14)', () => {
  const remote = { label: 'Remote Assessments', route: '/staff/remote-assessments', roles: [StaffRole.DesktopAssessor] } as StaffMenuItem;
  const other = { label: 'Completed', route: '/staff/assessment/completed', roles: [StaffRole.DesktopAssessor] } as StaffMenuItem;
  const API = '/api/staff/site-assessment/remote-assessments';

  function start(): { service: RemoteAllotments; http: HttpTestingController } {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AuthService).setUser({ userId: 'ASSESSOR1', userName: 'A', roleId: StaffRole.DesktopAssessor, role: 'x', subRoles: ['SiteVerification'] });
    const service = TestBed.inject(RemoteAllotments);
    TestBed.tick();
    return { service, http: TestBed.inject(HttpTestingController) };
  }

  beforeEach(() => sessionStorage.removeItem(REMOTE_ALLOTMENTS_CACHE_KEY));
  afterEach(() => sessionStorage.removeItem(REMOTE_ALLOTMENTS_CACHE_KEY));

  it('shows Remote Assessments only when the assessor has a remote or onsite assessment allotted', () => {
    const { service, http } = start();
    expect(service.filter([remote, other])).toEqual([other]);
    // The server's route (api/staff/site-assessment/remote-assessments).
    http.expectOne(API).flush([{ ZedId: 'ZEDM000001' }]);
    expect(service.filter([remote, other])).toEqual([remote, other]);
    http.verify();
  });

  // 2026-11-21 (Assessor UI audit): asked on every staff page, often twice.
  it('keeps the answer for a few minutes of the session, then asks again', () => {
    sessionStorage.setItem(REMOTE_ALLOTMENTS_CACHE_KEY, JSON.stringify({ user: 'ASSESSOR1', has: true, at: Date.now() }));
    const { service, http } = start();
    http.expectNone(API);
    expect(service.filter([remote, other])).toEqual([remote, other]);
    http.verify();

    TestBed.resetTestingModule();
    sessionStorage.setItem(REMOTE_ALLOTMENTS_CACHE_KEY, JSON.stringify({ user: 'ASSESSOR1', has: true, at: Date.now() - REMOTE_ALLOTMENTS_TTL_MS - 1 }));
    const again = start();
    again.http.expectOne(API).flush([]);
    expect(again.service.filter([remote, other])).toEqual([other]);
    again.http.verify();
  });

  it('shares one request with the Remote Assessments page and follows the page reading the list', async () => {
    const { service, http } = start();
    const page = firstValueFrom(service.list());
    // The menu's request and the page's are one.
    http.expectOne(API).flush([]);
    expect(await page).toEqual([]);
    expect(service.filter([remote, other])).toEqual([other]);
    // The page read again (Refresh): a new request, and the menu follows it.
    const refreshed = firstValueFrom(service.list());
    http.expectOne(API).flush([{ ZedId: 'ZEDM000001' }]);
    await refreshed;
    expect(service.filter([remote, other])).toEqual([remote, other]);
    expect(JSON.parse(sessionStorage.getItem(REMOTE_ALLOTMENTS_CACHE_KEY)!).has).toBe(true);
    http.verify();
  });
});
