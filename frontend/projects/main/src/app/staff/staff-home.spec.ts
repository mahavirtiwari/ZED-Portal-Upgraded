import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { AuthService, CurrentUser } from '@zed/shared';
import { routes } from '../app.routes';
import { StaffHomePage } from './staff-home';
import { STAFF_UNKNOWN_ROUTE, unknownAddressRedirect } from './staff-home.guard';
import { StaffRole } from './staff-menu';

describe('StaffHomePage', () => {
  async function render(roleId: number, role: string) {
    TestBed.configureTestingModule({ imports: [StaffHomePage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'Test User', roleId, role, subRoles: [] });
    const fixture = TestBed.createComponent(StaffHomePage);
    fixture.detectChanges();
    TestBed.inject(HttpTestingController).match('/api/config').forEach((r) => r.flush({ legacyPortalUrl: '' }));
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows each menu as a card with its headings', async () => {
    const el = await render(1, 'Admin');
    expect(el.querySelector('h3')!.textContent).toContain('Welcome, Test User');
    const cards = [...el.querySelectorAll('.group-card h4')].map((h) => h.textContent!.trim());
    expect(cards).toEqual(['Master', 'Questionnaire', 'Technology Upgradation', 'Incentives', 'Administration']);
    const questionnaire = [...el.querySelectorAll('.group-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === 'Questionnaire')!;
    expect([...questionnaire.querySelectorAll('li')].map((li) => li.textContent!.replace('›', '').trim())).toEqual(['Bronze', 'Silver', 'Gold', 'ZED-X', 'ESG Checklist']);
    expect(el.querySelector('.group-card')!.textContent).toContain('Sectors');
    // The incentives in their four groups.
    const incentives = [...el.querySelectorAll('.group-card')].find((c) => c.querySelector('h4')!.textContent!.trim() === 'Incentives')!;
    expect([...incentives.querySelectorAll('li')].map((li) => li.textContent!.replace('›', '').trim())).toEqual(['Ministry of MSME', 'State Government', 'Financial Institution', 'Others', 'Main Dashboard Cards', 'Incentive Schemes']);
  });

  it('shows the single screens of a role as tiles', async () => {
    const el = await render(10, 'SuperAdmin');
    const tiles = [...el.querySelectorAll('a.tile')].map((a) => a.textContent!.replace(/\s+/g, ' ').trim());
    expect(tiles).toEqual(expect.arrayContaining([expect.stringContaining('Reports'), expect.stringContaining('Registered MSMEs')]));
    expect(tiles.some((t) => t.includes('Customer History'))).toBe(false);
  });
});

describe('unknown addresses (2026-11-19 admin audit: /documents sent a signed-in Admin to /msme/login)', () => {
  @Component({ template: 'page' })
  class Page {}

  async function land(url: string, user: CurrentUser | null): Promise<string> {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(),
        // The portal's shape: lazy staff sections, then the staff catch-all, then the portal's catch-all.
        provideRouter([
          { path: 'msme/login', component: Page },
          { path: 'msme/dashboard', component: Page },
          {
            path: 'staff',
            children: [
              { path: '', pathMatch: 'full', component: Page },
              { path: 'documents', component: Page },
              { path: 'settings', loadChildren: () => Promise.resolve([{ path: 'texts', component: Page }]) },
              STAFF_UNKNOWN_ROUTE,
            ],
          },
          { path: '**', canActivate: [unknownAddressRedirect('/msme/login')], children: [] },
        ]),
      ],
    });
    TestBed.inject(AuthService).setUser(user);
    const harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    return TestBed.inject(Router).url;
  }

  const admin: CurrentUser = { userId: 'ZEDV4AD01', userName: 'Admin', roleId: StaffRole.Admin, role: 'Admin' };

  it('sends a signed-in staff user to the address under /staff', async () => {
    expect(await land('/documents', admin)).toBe('/staff/documents');
  });

  it("opens a staff user's home for a staff address that is no screen here (e.g. a section not deployed)", async () => {
    expect(await land('/staff/settings/tat', admin)).toBe('/staff');
    expect(await land('/staff/settings/texts', admin)).toBe('/staff/settings/texts');
  });

  it('sends an MSME to its dashboard and others to the login page, as before', async () => {
    expect(await land('/documents', { userId: 'ZEDMSME1', userName: 'Unit', roleId: 5, role: 'MSME' })).toBe('/msme/dashboard');
    expect(await land('/documents', null)).toBe('/msme/login');
  });

  it("is the last route of the portal and of its staff screens", () => {
    expect(routes.at(-1)!.path).toBe('**');
    expect(routes.at(-1)!.canActivate?.length).toBe(1);
    expect(routes.find((r) => r.path === 'staff')!.children!.at(-1)).toBe(STAFF_UNKNOWN_ROUTE);
  });
});
