import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { menuFor, StaffRole } from '../staff-menu';
import { PasswordResetLinkPage } from './password-reset-link';

describe('PasswordResetLinkPage', () => {
  let fixture: ComponentFixture<PasswordResetLinkPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [PasswordResetLinkPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(PasswordResetLinkPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  function send(userId: string) {
    const input = el.querySelector('#resetUserId') as HTMLInputElement;
    input.value = userId;
    input.dispatchEvent(new Event('input'));
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
  }

  it('sends a link after confirmation and shows where it went', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    send('MASTER2');
    expect(confirm).toHaveBeenCalled();
    const req = http.expectOne('/api/staff/password-reset/MASTER2');
    expect(req.request.method).toBe('POST');
    req.flush({ message: "A password reset link has been sent to the user's registered e-mail address (m******@zed.test)." });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('m******@zed.test');
  });

  it('sends nothing without confirmation, and names an unknown user', async () => {
    vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValue(true);
    send('ZEDAA0001');
    http.expectNone('/api/staff/password-reset/ZEDAA0001');
    send('NOBODY');
    http.expectOne('/api/staff/password-reset/NOBODY').flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('User not found.');
  });

  it('walks through the steps and lists each link sent with the masked address', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    const steps = () => [...el.querySelectorAll('.prl-steps li')];
    expect(steps().map((s) => s.textContent!.trim())).toEqual(['1Enter the User ID', '2Confirm', '3Link e-mailed']);
    expect(steps()[0].classList).toContain('is-on');
    expect(el.querySelector('.prl-none')!.textContent).toContain('Links you send are listed here');

    send('MASTER2');
    await settle();
    expect(steps()[1].classList).toContain('is-on');
    http.expectOne('/api/staff/password-reset/MASTER2').flush({ message: "A password reset link has been sent to the user's registered e-mail address (m******@zed.test)." });
    await settle();
    send('NOBODY');
    http.expectOne('/api/staff/password-reset/NOBODY').flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelectorAll('.prl-sent-row').length).toBe(1);
    expect(el.querySelector('.prl-sent-id')!.textContent).toBe('MASTER2');
    expect(el.querySelector('.prl-sent-row')!.textContent).toContain('m******@zed.test');
    expect(el.querySelector('.prl-count')!.textContent).toBe('1');
    expect(el.querySelector('.prl-none')).toBeNull();
  });

  it('is in the MasterAdmin menu of every portal only', () => {
    for (const system of ['main', 'consultancy', 'surveillance'] as const) {
      expect(menuFor(StaffRole.MasterAdmin, [], system).map((i) => i.route)).toContain('/staff/users/password-reset');
      expect(menuFor(StaffRole.Agency, ['DesktopVerification', 'SiteVerification'], system).map((i) => i.route)).not.toContain('/staff/users/password-reset');
    }
  });
});
