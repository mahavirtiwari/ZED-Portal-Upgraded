import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AdminPortal, AdminPortalService, PortalSwitchComponent, adminPortalInterceptor, dashboardPortals, neftPortals } from './admin-portal';
import { AuthService, CurrentUser } from '@zed/shared';

const flushTicks = () => new Promise((r) => setTimeout(r));

describe('One Admin: portal switch and calls to the chosen portal', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let portals: AdminPortalService;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([adminPortalInterceptor])), provideHttpClientTesting()] });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    portals = TestBed.inject(AdminPortalService);
  });

  afterEach(() => backend.verify());

  async function handOver(portal: AdminPortal, xsrf: string) {
    await flushTicks();
    const issue = backend.expectOne(`/api/staff/admin-portals/${portal}/handoff`);
    expect(issue.request.method).toBe('POST');
    issue.flush({ token: 'pass-' + portal });
    await flushTicks();
    const accept = backend.expectOne(portal === 'consultancy' ? '/Consultancy/api/staff/admin-portals/handoff' : '/surveillance/api/staff/admin-portals/handoff');
    expect(accept.request.body).toEqual({ token: 'pass-' + portal });
    accept.flush({ userName: 'Admin', xsrfToken: xsrf });
    await flushTicks();
  }

  it('sends a switched screen to the chosen portal with its anti-forgery token, and others to main', async () => {
    expect(portals.current()).toBe('main');
    const mainCall = firstValueFrom(http.get('/api/staff/settings/texts'));
    backend.expectOne('/api/staff/settings/texts').flush([]);
    await mainCall;

    portals.select('consultancy');
    expect(sessionStorage.getItem('zed.adminPortal')).toBe('consultancy');
    const call = firstValueFrom(http.put('/api/staff/settings/texts/web.disclaimer', { text: 'x' }));
    await handOver('consultancy', 'cons-xsrf');
    const req = backend.expectOne('/Consultancy/api/staff/settings/texts/web.disclaimer');
    expect(req.request.headers.get('X-XSRF-TOKEN')).toBe('cons-xsrf');
    req.flush({ message: 'Saved.' });
    expect(await call).toEqual({ message: 'Saved.' });

    // A screen without the switch stays on main.
    const other = firstValueFrom(http.get('/api/staff/masters/categories'));
    backend.expectOne('/api/staff/masters/categories').flush([]);
    await other;
    // The second call reuses the sign-in.
    const again = firstValueFrom(http.get('/api/staff/settings/texts'));
    await flushTicks();
    backend.expectOne('/Consultancy/api/staff/settings/texts').flush([]);
    await again;
  });

  it('signs in again once when the other portal has signed the Admin out', async () => {
    portals.select('surveillance');
    const call = firstValueFrom(http.get('/api/staff/settings/texts'));
    await handOver('surveillance', 'first');
    backend.expectOne('/surveillance/api/staff/settings/texts').flush(null, { status: 401, statusText: 'Unauthorized' });
    await handOver('surveillance', 'second');
    const retried = backend.expectOne('/surveillance/api/staff/settings/texts');
    expect(retried.request.headers.get('X-XSRF-TOKEN')).toBe('second');
    retried.flush([{ key: 'k' }]);
    expect(await call).toEqual([{ key: 'k' }]);
  });

  it('sends the site tour sections to the Consultancy portal too (the consultant app has a site tour)', async () => {
    portals.select('consultancy');
    const call = firstValueFrom(http.get('/api/staff/settings/site-tour-sections'));
    await handOver('consultancy', 'cons-xsrf');
    backend.expectOne('/Consultancy/api/staff/settings/site-tour-sections').flush({ sections: [] });
    expect(await call).toEqual({ sections: [] });
    // A screen the Consultancy portal does not have stays on main.
    expect(portals.effective(['main', 'surveillance'])).toBe('main');
  });
});

@Component({
  imports: [PortalSwitchComponent],
  template: `<zed-portal-switch [portals]="['main', 'surveillance']" (changed)="last = $event" />`,
})
class Host {
  last: AdminPortal | null = null;
}

describe('One Dashboard Admin (2026-11-07)', () => {
  const user = (screens: string[] | null): CurrentUser => ({ userId: 'DASH1', userName: 'Dash', roleId: 10, role: 'SuperAdmin', screens });

  it('lists the portals where a screen was ticked (every portal offering it when every screen was given)', () => {
    const u = user(['main:reports', 'surveillance:reports', 'consultancy:history', 'main:hide-names']);
    expect(dashboardPortals(u, ['reports'])).toEqual(['main', 'surveillance']);
    expect(dashboardPortals(u, ['history'])).toEqual(['consultancy']);
    expect(dashboardPortals(u, ['failed-transactions'])).toEqual([]);
    expect(dashboardPortals(user(null), ['financial-support'])).toEqual(['main', 'surveillance']);
    expect(dashboardPortals(user(null), ['incentive-submissions'])).toEqual(['main']);
  });

  it("sends a screen's calls to its ticked portal, even when the switch names another", async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([adminPortalInterceptor])), provideHttpClientTesting()] });
    TestBed.inject(AuthService).setUser(user(['consultancy:history', 'main:reports']));
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    // Reports on main (the only portal where it was ticked).
    const reports = firstValueFrom(http.get('/api/staff/reports'));
    backend.expectOne('/api/staff/reports').flush([]);
    await reports;
    // History only on Consultancy: handed over there.
    const history = firstValueFrom(http.get('/api/staff/history/ZEDM1'));
    await flushTicks();
    backend.expectOne('/api/staff/admin-portals/consultancy/handoff').flush({ token: 'pass' });
    await flushTicks();
    backend.expectOne('/Consultancy/api/staff/admin-portals/handoff').flush({ userName: 'Dash', xsrfToken: 'x' });
    await flushTicks();
    backend.expectOne('/Consultancy/api/staff/history/ZEDM1').flush({});
    await history;
    backend.verify();
  });
});

describe('One MSME DFO for Financial Assistance and Handholding (2026-11-07)', () => {
  const dfo = (screens: string[] | null, isNeftAdmin = false): CurrentUser =>
    ({ userId: 'DFO1', userName: 'DFO', roleId: 6, role: 'StateCoordinator', screens, isNeftAdmin });

  it('offers the NEFT lists it was given (the NEFT Admin both)', () => {
    expect(neftPortals(dfo(['main:neft', 'consultancy:neft']))).toEqual(['main', 'consultancy']);
    expect(neftPortals(dfo(['consultancy:neft']))).toEqual(['consultancy']);
    expect(neftPortals(dfo(['main:neft']))).toEqual(['main']);
    expect(neftPortals(dfo(null, true))).toEqual(['main', 'consultancy']);
    expect(neftPortals({ ...dfo(null), roleId: 10 })).toBeNull();
  });

  it('sends the NEFT list of a DFO with Handholding only to the Consultancy portal', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [provideHttpClient(withInterceptors([adminPortalInterceptor])), provideHttpClientTesting()] });
    TestBed.inject(AuthService).setUser(dfo(['consultancy:neft']));
    const http = TestBed.inject(HttpClient);
    const backend = TestBed.inject(HttpTestingController);
    const list = firstValueFrom(http.get('/api/staff/neft/transactions', { params: { list: 'new' } }));
    await flushTicks();
    backend.expectOne('/api/staff/admin-portals/consultancy/handoff').flush({ token: 'pass' });
    await flushTicks();
    backend.expectOne('/Consultancy/api/staff/admin-portals/handoff').flush({ userName: 'DFO', xsrfToken: 'x' });
    await flushTicks();
    backend.expectOne((r) => r.url === '/Consultancy/api/staff/neft/transactions').flush({ transactions: [] });
    await list;
    // Other screens stay on main.
    const other = firstValueFrom(http.get('/api/staff/reports'));
    backend.expectOne('/api/staff/reports').flush([]);
    await other;
    backend.verify();
  });
});

describe('PortalSwitchComponent', () => {
  it('offers the portals that have the screen and remembers the choice', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ imports: [Host], providers: [provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    const el: HTMLElement = fixture.nativeElement;
    const tabs = [...el.querySelectorAll('.ps-tab')] as HTMLButtonElement[];
    expect(tabs.map((t) => t.textContent!.trim())).toEqual(['ZED Certification', 'Surveillance']);
    expect(tabs[0].getAttribute('aria-pressed')).toBe('true');
    tabs[1].click();
    fixture.detectChanges();
    expect(fixture.componentInstance.last).toBe('surveillance');
    expect(TestBed.inject(AdminPortalService).current()).toBe('surveillance');
    expect(tabs[1].classList).toContain('on');
  });
});
