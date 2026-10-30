import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { AdminPortal, AdminPortalService, PortalSwitchComponent, adminPortalInterceptor } from './admin-portal';

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
});

@Component({
  imports: [PortalSwitchComponent],
  template: `<zed-portal-switch [portals]="['main', 'surveillance']" (changed)="last = $event" />`,
})
class Host {
  last: AdminPortal | null = null;
}

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
