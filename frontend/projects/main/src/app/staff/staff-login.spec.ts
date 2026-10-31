import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { StaffLoginPage } from './staff-login';
import { FeesHostPage } from './fees/fees-host';

const settle = async (fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) => {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
};

describe('StaffLoginPage (one Admin)', () => {
  it('sends an Admin the Consultancy or Surveillance portal refused to the main portal, with that portal chosen', async () => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ imports: [StaffLoginPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(StaffLoginPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    await settle(fixture);
    for (const r of http.match(() => true)) r.flush(null);
    const page = fixture.componentInstance as unknown as { userId: string; password: string; captchaToken: string; login(): Promise<void> };
    page.userId = 'ADMIN1';
    page.password = 'secret';
    page.captchaToken = 'token';
    const done = page.login();
    await settle(fixture);
    http.expectOne('/api/staff/auth/login').flush(
      { title: 'The Admin of every portal now signs in on the main portal and chooses this portal there.', adminOnMainPortal: true },
      { status: 400, statusText: 'Bad Request' });
    await done;
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('signs in on the main portal');
    const link = [...el.querySelectorAll('a')].find((a) => a.textContent!.includes('Go to the Admin on the main portal')) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/login');
    link.addEventListener('click', (e) => e.preventDefault());
    link.click();
    // The test build is main's, so its own name is stored (on the other builds, theirs).
    expect(sessionStorage.getItem('zed.adminPortal')).toBe('main');
  });
});

describe('StaffLoginPage (session expired)', () => {
  it('says the session expired and returns to that page after signing in', async () => {
    TestBed.configureTestingModule({
      imports: [StaffLoginPage],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({ expired: '1', returnUrl: '/staff/monitoring' }) } } },
      ],
    });
    const fixture = TestBed.createComponent(StaffLoginPage);
    const http = TestBed.inject(HttpTestingController);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const el: HTMLElement = fixture.nativeElement;
    await settle(fixture);
    for (const r of http.match(() => true)) r.flush(null);
    expect(el.querySelector('.session-expired')!.textContent).toContain('Your session has expired. Please sign in again.');

    const page = fixture.componentInstance as unknown as { userId: string; password: string; captchaToken: string; login(): Promise<void> };
    page.userId = 'AGENCY1';
    page.password = 'secret';
    page.captchaToken = 'token';
    const done = page.login();
    await settle(fixture);
    http.expectOne('/api/staff/auth/login').flush({ userId: 'AGENCY1', userName: 'Agency', roleId: 2, role: 'Agency' });
    await done;
    expect(navigate).toHaveBeenCalledWith('/staff/monitoring');
  });
});

describe('FeesHostPage', () => {
  it('shows the handholding fees when the Admin chose the Consultancy portal', async () => {
    sessionStorage.setItem('zed.adminPortal', 'consultancy');
    TestBed.configureTestingModule({ imports: [FeesHostPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    const fixture = TestBed.createComponent(FeesHostPage);
    await settle(fixture);
    const el: HTMLElement = fixture.nativeElement;
    expect(el.querySelector('zed-staff-assessment-fees')).not.toBeNull();
    expect(el.querySelector('zed-staff-fee-structure')).toBeNull();
    expect(el.querySelector('.ps-tab.on')!.textContent!.trim()).toBe('Consultancy');
    for (const r of TestBed.inject(HttpTestingController).match(() => true)) r.flush(null);
    sessionStorage.clear();
  });
});
