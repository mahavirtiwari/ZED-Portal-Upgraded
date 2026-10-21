import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { UBP_RETURN_KEY, UdyamiSignInPage } from './udyami-signin';

describe('Udyami Bharat sign-in hand-over', () => {
  let http: HttpTestingController;

  async function open(query: Record<string, string>) {
    await TestBed.configureTestingModule({
      imports: [UdyamiSignInPage],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query) } } },
      ],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    TestBed.inject(AuthService).setUser(null);
    const fixture = TestBed.createComponent(UdyamiSignInPage);
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    return fixture;
  }

  const settle = () => new Promise((r) => setTimeout(r));

  afterEach(() => sessionStorage.removeItem(UBP_RETURN_KEY));

  it('posts the token, keeps the back link and opens the dashboard', async () => {
    const fixture = await open({ applicationNo: 'ZEDMSME000001', token: 'one-time' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    const req = http.expectOne('/api/msme/auth/udyami-bharat');
    expect(req.request.body).toEqual({ applicationNo: 'ZEDMSME000001', token: 'one-time' });
    req.flush({ user: { userId: 'ZEDMSME000001', userName: 'Acme', roleId: 5, role: 'Msme' }, returnUrl: 'https://ubp.ubputl.com/x' });
    await settle();
    expect(TestBed.inject(AuthService).currentUser()?.userId).toBe('ZEDMSME000001');
    expect(sessionStorage.getItem(UBP_RETURN_KEY)).toBe('https://ubp.ubputl.com/x');
    expect(navigate).toHaveBeenCalledWith('/msme/dashboard', { replaceUrl: true });
    expect(location.search).not.toContain('one-time');
    fixture.destroy();
  });

  it('shows the API message and a login link when the token is refused', async () => {
    const fixture = await open({ applicationNo: 'ZEDMSME000001', token: 'bad' });
    http.expectOne('/api/msme/auth/udyami-bharat').flush({ title: 'Invalid token.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.alert-danger').textContent).toContain('Invalid token.');
    expect(fixture.nativeElement.querySelector('a').getAttribute('href')).toBe('/msme/login');
  });

  it('does not call the API without a token', async () => {
    const fixture = await open({ applicationNo: 'ZEDMSME000001' });
    http.expectNone('/api/msme/auth/udyami-bharat');
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Invalid token.');
  });
});
