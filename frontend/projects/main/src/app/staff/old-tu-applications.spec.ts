import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from '@zed/shared';
import { OLD_TU_API, OldTuApplications } from './old-tu-applications';
import { MENUS, StaffMenuItem, menuFor } from './staff-menu';

describe('OldTuApplications (2026-11-27, "finish old ones only")', () => {
  const old = (items: StaffMenuItem[]) => items.filter((i) => i.whileOldTu).map((i) => i.label);

  it('puts "Old TU Applications" back on the consultancy menus of the Master Admin, the CO and the consultant only', () => {
    expect(old(menuFor(7, [], 'consultancy'))).toEqual(['Old TU Applications']);
    expect(old(menuFor(2, ['FinancialVerification'], 'consultancy'))).toEqual(['Old TU Applications']);
    expect(old(menuFor(3, ['FinancialVerification'], 'consultancy'))).toEqual(['Old TU Applications']);
    expect(old(menuFor(2, ['SiteVerification'], 'consultancy'))).toEqual([]);
    expect(MENUS.main.some((i) => i.whileOldTu)).toBe(false);
  });

  it('hides the entries until the server says some old applications are open', () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const service = TestBed.inject(OldTuApplications);
    const items = menuFor(7, [], 'consultancy');
    // The test build is the main portal: nothing is asked and the entries stay hidden.
    TestBed.inject(AuthService).setUser({ userId: 'MA1', userName: 'MA', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    TestBed.tick();
    TestBed.inject(HttpTestingController).expectNone(OLD_TU_API);
    expect(service.filter(items).some((i) => i.whileOldTu)).toBe(false);
    service.open.set(2);
    expect(old(service.filter(items))).toEqual(['Old TU Applications']);
  });
});
