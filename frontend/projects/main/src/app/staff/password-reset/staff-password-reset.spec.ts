import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ClientConfigService } from '@zed/shared';
import { StaffForgotPasswordPage } from './staff-forgot-password';
import { StaffResetPasswordPage, tokenFromFragment } from './staff-reset-password';

const TOKEN = 'A'.repeat(40) + '_-9';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function type(el: HTMLElement, selector: string, value: string) {
  const input = el.querySelector(selector) as HTMLInputElement;
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

describe('staff password reset', () => {
  let http: HttpTestingController;

  afterEach(() => http.verify());

  describe('StaffForgotPasswordPage', () => {
    let fixture: ComponentFixture<StaffForgotPasswordPage>;
    let el: HTMLElement;

    beforeEach(async () => {
      await TestBed.configureTestingModule({
        imports: [StaffForgotPasswordPage],
        providers: [
          provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
          { provide: ClientConfigService, useValue: { get: () => Promise.resolve({ captchaEnabled: false, captchaSiteKey: '' }) } },
        ],
      }).compileComponents();
      fixture = TestBed.createComponent(StaffForgotPasswordPage);
      http = TestBed.inject(HttpTestingController);
      el = fixture.nativeElement;
      await settle(fixture);
    });

    it('asks for the User ID, then shows the server answer whatever the account', async () => {
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle(fixture);
      expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter your User ID.');

      type(el, '#userId', ' ZEDAA0001 ');
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      const req = http.expectOne('/api/staff/auth/password-reset/request');
      expect(req.request.body).toEqual({ userId: 'ZEDAA0001', captchaToken: 'disabled' });
      req.flush({ message: 'If the User ID belongs to an active account, a link has been sent.' });
      await settle(fixture);
      expect(el.querySelector('.alert-success')!.textContent).toContain('a link has been sent');
      expect(el.querySelector('form')).toBeNull();
    });

    it('shows a refusal (switched off, rate limit) and keeps the form', async () => {
      type(el, '#userId', 'ZEDAA0001');
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      http.expectOne('/api/staff/auth/password-reset/request').flush(null, { status: 429, statusText: 'Too Many Requests' });
      await settle(fixture);
      expect(el.querySelector('.alert-danger')!.textContent).toContain('Too many attempts');
      expect(el.querySelector('form')).not.toBeNull();
    });
  });

  describe('StaffResetPasswordPage', () => {
    let fixture: ComponentFixture<StaffResetPasswordPage>;
    let el: HTMLElement;

    async function create(fragment: string | null) {
      await TestBed.configureTestingModule({
        imports: [StaffResetPasswordPage],
        providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { fragment } } }],
      }).compileComponents();
      fixture = TestBed.createComponent(StaffResetPasswordPage);
      http = TestBed.inject(HttpTestingController);
      el = fixture.nativeElement;
      await settle(fixture);
    }

    it('reads the token from the fragment', () => {
      expect(tokenFromFragment(`token=${TOKEN}`)).toBe(TOKEN);
      expect(tokenFromFragment(null)).toBe('');
      expect(tokenFromFragment('other=1')).toBe('');
    });

    it('checks the link, then sets the password with the token in the body', async () => {
      await create(`token=${TOKEN}`);
      const check = http.expectOne('/api/staff/auth/password-reset/check');
      expect(check.request.body).toEqual({ token: TOKEN });
      check.flush({ message: 'Valid' });
      await settle(fixture);

      type(el, '#newPassword', 'New#Pass123');
      type(el, '#confirmPassword', 'Other#Pass1');
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle(fixture);
      expect(el.querySelector('.alert-danger')!.textContent).toContain('should be same');

      type(el, '#confirmPassword', 'New#Pass123');
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      const reset = http.expectOne('/api/staff/auth/password-reset/reset');
      expect(reset.request.body).toEqual({ token: TOKEN, newPassword: 'New#Pass123', confirmPassword: 'New#Pass123' });
      reset.flush({ message: 'Your password has been changed. Please log in with your new password.' });
      await settle(fixture);
      expect(el.querySelector('.alert-success')!.textContent).toContain('Your password has been changed');
      expect(el.querySelector('a[href="/login"]')).not.toBeNull();
    });

    it('offers a new link when the link is used or expired', async () => {
      await create(`token=${TOKEN}`);
      http.expectOne('/api/staff/auth/password-reset/check').flush({ title: 'This reset link is invalid, has expired or has already been used.' }, { status: 400, statusText: 'Bad Request' });
      await settle(fixture);
      expect(el.querySelector('.alert-danger')!.textContent).toContain('has expired');
      expect(el.querySelector('a[href="/forgot-password"]')).not.toBeNull();
    });

    it('needs no server call without a token', async () => {
      await create(null);
      expect(el.querySelector('.alert-danger')!.textContent).toContain('invalid');
    });
  });
});
