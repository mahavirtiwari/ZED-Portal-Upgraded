import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService, CurrentUser } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { returnUrl, sessionExpiryInterceptor } from './session-expiry';

describe('sessionExpiryInterceptor', () => {
  let http: HttpClient;
  let backend: HttpTestingController;
  let auth: AuthService;
  let navigate: ReturnType<typeof vi.spyOn>;

  const staff: CurrentUser = { userId: 'AGENCY1', userName: 'Agency', roleId: 2, role: 'Agency' };
  const msme: CurrentUser = { userId: 'ZEDMSME000001', userName: 'Acme', roleId: 5, role: 'MSME' };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(withInterceptors([sessionExpiryInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
    http = TestBed.inject(HttpClient);
    backend = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
  });

  afterEach(() => backend.verify());

  async function fail(url: string, status = 401): Promise<void> {
    const call = firstValueFrom(http.post(url, {})).catch(() => undefined);
    backend.expectOne(url).flush({ title: 'x' }, { status, statusText: 'x' });
    await call;
  }

  it('sends a signed-in staff user to the login page with the note and the way back', async () => {
    auth.setUser(staff);
    await fail('/api/staff/monitoring/7/final-submit');
    expect(auth.currentUser()).toBeNull();
    expect(navigate).toHaveBeenCalledWith(['/login'], { queryParams: { expired: 1, returnUrl: '/' } });
  });

  it('sends an MSME to the MSME login page', async () => {
    auth.setUser(msme);
    await fail('/api/msme/payments/Bronze/checkout');
    expect(navigate).toHaveBeenCalledWith(['/msme/login'], expect.anything());
  });

  it('leaves sign-in calls, other errors, signed-out pages and the other portals alone', async () => {
    auth.setUser(staff);
    await fail('/api/staff/auth/login');
    await fail('/api/staff/users', 403);
    await fail('/Consultancy/api/staff/users');
    expect(navigate).not.toHaveBeenCalled();
    expect(auth.currentUser()).not.toBeNull();

    auth.setUser(null);
    await fail('/api/staff/users');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('returns only to a page of the same area', () => {
    expect(returnUrl('/staff/monitoring?x=1', '/staff')).toBe('/staff/monitoring?x=1');
    expect(returnUrl('/msme/dashboard', '/msme/')).toBe('/msme/dashboard');
    expect(returnUrl('/msme/dashboard', '/staff')).toBeNull();
    expect(returnUrl('//evil.example/staff', '/staff')).toBeNull();
    expect(returnUrl('https://evil.example/staff', '/staff')).toBeNull();
    expect(returnUrl(null, '/staff')).toBeNull();
  });
});
