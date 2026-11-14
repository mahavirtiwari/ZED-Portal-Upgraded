import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { LoginPage } from './login';

describe('LoginPage', () => {
  let fixture: ComponentFixture<LoginPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const type = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  /** Lets pending promise continuations run, then renders. */
  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(LoginPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;

    await settle();
    http.expectOne('/api/auth/me').flush(null, { status: 204, statusText: 'No Content' });
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '' });
    await settle();
  });

  afterEach(() => http.verify());

  it('shows the new-user eligibility from the Texts', () => {
    expect(el.querySelector('.ml-new [data-key="msme.login.newUserEligibility"]')).not.toBeNull();
  });

  it('forgot password: finds the units of a PAN, sends the link for the chosen one and shows the hidden e-mail', async () => {
    const buttons = () => Array.from(el.querySelectorAll('button')) as HTMLButtonElement[];
    buttons().find((b) => b.textContent?.includes('Forgot password'))!.click();
    await settle();
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '' });
    await settle();
    buttons().find((b) => b.textContent?.trim() === 'PAN')!.click();
    await settle();
    type('#findValue', 'abcde1234f');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const find = http.expectOne('/api/msme/auth/forgot-password/find');
    expect(find.request.body).toEqual({ by: 'pan', value: 'abcde1234f', captchaToken: 'disabled' });
    find.flush({
      units: [
        { ref: 'r1', unitName: 'Acme Foods Unit 1', district: 'East Delhi', state: 'Delhi', zedId: 'ZEDM•••123' },
        { ref: 'r2', unitName: 'Acme Foods Unit 2', district: 'Kanpur', state: 'Uttar Pradesh', zedId: 'ZEDM•••456' },
      ],
    });
    await settle();
    expect(el.textContent).toContain('Acme Foods Unit 2');
    expect(el.textContent).toContain('Kanpur, Uttar Pradesh');
    const radios = el.querySelectorAll('input[name="foundUnit"]');
    (radios[1] as HTMLInputElement).click();
    await settle();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const send = http.expectOne('/api/msme/auth/forgot-password/send');
    expect(send.request.body).toEqual({ ref: 'r2' });
    send.flush({ message: 'sent', maskedEmail: 'ra•••••@gm•••.com' });
    await settle();
    expect(el.querySelector('[data-testid="masked-email"]')!.textContent).toContain('ra•••••@gm•••.com');
  });

  it('signs in and opens the dashboard', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    type('#userId', ' ZEDMSME000001 ');
    type('#password', 'Secret#123');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();

    const req = http.expectOne('/api/msme/auth/login');
    expect(req.request.body).toEqual({ userId: 'ZEDMSME000001', password: 'Secret#123', captchaToken: 'disabled' });
    req.flush({ userId: 'ZEDMSME000001', userName: 'Acme', roleId: 5, role: 'Msme' });
    await settle();

    expect(TestBed.inject(AuthService).currentUser()?.userId).toBe('ZEDMSME000001');
    expect(navigate).toHaveBeenCalledWith('/msme/dashboard');
  });

  it('shows the message from the API and clears the password on failure', async () => {
    type('#userId', 'ZEDMSME000001');
    type('#password', 'wrong');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();

    http.expectOne('/api/msme/auth/login').flush({ title: 'INVALID CREDENTIAILS' }, { status: 400, statusText: 'Bad Request' });
    await settle();

    expect(el.querySelector('.alert-danger')!.textContent).toContain('INVALID CREDENTIAILS');
    expect((el.querySelector('#password') as HTMLInputElement).value).toBe('');
  });
});
