import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { menuFor, StaffRole } from '../staff-menu';
import { ToastService } from '../toast';
import { PasswordResetLinkPage } from './password-reset-link';
import { ResetTarget } from './users.api';

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

  const target = (extra: Partial<ResetTarget> = {}): ResetTarget => ({
    userId: 'MASTER2', userName: 'Second Master', roleId: 7, role: 'Master Admin', isActive: true, maskedEmail: 'm******@zed.test',
    canSend: true, reason: null, ...extra,
  });
  const sentAnswer = { message: "A password reset link has been sent to the user's registered e-mail address (m******@zed.test)." };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PasswordResetLinkPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(PasswordResetLinkPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;
  const steps = () => [...el.querySelectorAll('.st-step')];
  const current = () => steps().findIndex((s) => s.classList.contains('st-now'));

  async function find(userId: string) {
    const input = el.querySelector('#resetUserId') as HTMLInputElement;
    input.value = userId;
    input.dispatchEvent(new Event('input'));
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
  }

  it('looks the user up first and sends nothing until "Send reset link"', async () => {
    const confirm = vi.spyOn(window, 'confirm');
    expect(steps().map((s) => s.querySelector('.st-label')!.textContent)).toEqual(['Enter the User ID', 'Confirm', 'Link e-mailed']);
    expect(current()).toBe(0);
    await find('master2');
    const lookup = http.expectOne('/api/staff/password-reset/master2');
    expect(lookup.request.method).toBe('GET');
    lookup.flush(target());
    await settle();
    http.expectNone({ method: 'POST' });
    expect(current()).toBe(1);
    const who = el.querySelector('.prl-who')!;
    expect(who.textContent).toContain('Second Master');
    expect(who.textContent).toContain('Master Admin · MASTER2');
    expect(who.textContent).toContain('Link will go to m******@zed.test');
    expect(who.textContent).toContain('Active');
    expect((el.querySelector('#resetUserId') as HTMLInputElement).readOnly).toBe(true);

    button('Send reset link')!.click();
    await settle();
    const req = http.expectOne('/api/staff/password-reset/MASTER2');
    expect(req.request.method).toBe('POST');
    req.flush(sentAnswer);
    await settle();
    expect(current()).toBe(-1);
    expect(steps().every((s) => s.classList.contains('st-done'))).toBe(true);
    expect(el.querySelector('.prl-done')!.textContent).toContain('m******@zed.test');
    expect(TestBed.inject(ToastService).toasts().at(-1)).toMatchObject({ title: 'Reset link sent', message: 'E-mailed to m******@zed.test' });
    expect(el.querySelectorAll('.prl-sent-row').length).toBe(1);
    expect(el.querySelector('.prl-sent-id')!.textContent).toBe('MASTER2');
    expect(el.querySelector('.prl-sent-row')!.textContent).toContain('Second Master');
    expect(el.querySelector('.prl-count')!.textContent).toBe('1');
    expect(confirm).not.toHaveBeenCalled();

    button('Send another link')!.click();
    await settle();
    expect(current()).toBe(0);
    expect((el.querySelector('#resetUserId') as HTMLInputElement).value).toBe('');
  });

  it('says up front why a link cannot be sent', async () => {
    await find('BLOCKED1');
    http.expectOne('/api/staff/password-reset/BLOCKED1').flush(target({
      userId: 'BLOCKED1', userName: 'Desktop Assessor', roleId: 3, role: 'Assessor', isActive: false, canSend: false,
      reason: 'This user is blocked. Unblock the account first.',
    }));
    await settle();
    const who = el.querySelector('.prl-who')!;
    expect(who.classList).toContain('is-blocked');
    expect(who.querySelector('.prl-why')!.textContent).toContain('This user is blocked. Unblock the account first.');
    expect(who.textContent).toContain('Blocked');
    expect(button('Send reset link')!.disabled).toBe(true);

    button('Change')!.click();
    await settle();
    expect(current()).toBe(0);
    expect(el.querySelector('.prl-who')).toBeNull();
  });

  it('names an unknown user and asks for the User ID', async () => {
    await find('   ');
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter the User ID.');
    await find('NOBODY');
    http.expectOne('/api/staff/password-reset/NOBODY').flush(null, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('User not found.');
    expect(current()).toBe(0);
    expect(el.querySelector('.prl-none')!.textContent).toContain('Links you send are listed here');
  });

  it('shows a refusal of the send and stays on the confirmation', async () => {
    await find('MASTER2');
    http.expectOne('/api/staff/password-reset/MASTER2').flush(target());
    await settle();
    button('Send reset link')!.click();
    await settle();
    http.expectOne({ method: 'POST', url: '/api/staff/password-reset/MASTER2' })
      .flush({ title: 'The reset link could not be e-mailed. Please try again.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('could not be e-mailed');
    expect(current()).toBe(1);
    expect(el.querySelectorAll('.prl-sent-row').length).toBe(0);
  });

  it('is in the MasterAdmin menu of every portal only', () => {
    for (const system of ['main', 'consultancy', 'surveillance'] as const) {
      expect(menuFor(StaffRole.MasterAdmin, [], system).map((i) => i.route)).toContain('/staff/users/password-reset');
      expect(menuFor(StaffRole.Agency, ['DesktopVerification', 'SiteVerification'], system).map((i) => i.route)).not.toContain('/staff/users/password-reset');
    }
  });
});
