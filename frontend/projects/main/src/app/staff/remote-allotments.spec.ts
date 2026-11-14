import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { AuthService } from '@zed/shared';
import { RemoteAllotments } from './remote-allotments';
import { StaffRole, type StaffMenuItem } from './staff-menu';

describe('RemoteAllotments (2026-11-14)', () => {
  const remote = { label: 'Remote Assessments', route: '/staff/remote-assessments', roles: [StaffRole.DesktopAssessor] } as StaffMenuItem;
  const other = { label: 'Completed', route: '/staff/assessment/completed', roles: [StaffRole.DesktopAssessor] } as StaffMenuItem;

  it('shows Remote Assessments only when the assessor has a remote or onsite assessment allotted', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AuthService).setUser({ userId: 'ASSESSOR1', userName: 'A', roleId: StaffRole.DesktopAssessor, role: 'x', subRoles: ['SiteVerification'] });
    const service = TestBed.inject(RemoteAllotments);
    TestBed.tick();
    const http = TestBed.inject(HttpTestingController);
    expect(service.filter([remote, other])).toEqual([other]);
    // The server's route (api/staff/site-assessment/remote-assessments).
    http.expectOne('/api/staff/site-assessment/remote-assessments').flush([{ ZedId: 'ZEDM000001' }]);
    expect(service.filter([remote, other])).toEqual([remote, other]);
    http.verify();
  });
});
