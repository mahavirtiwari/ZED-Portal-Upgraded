import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ResetPasswordPage } from './reset-password';

const TOKEN = 'B'.repeat(40) + '_-7';

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

describe('ResetPasswordPage (MSME)', () => {
  let fixture: ComponentFixture<ResetPasswordPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  afterEach(() => http.verify());

  async function create(fragment: string | null) {
    await TestBed.configureTestingModule({
      imports: [ResetPasswordPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { fragment } } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ResetPasswordPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.match('/api/msme/auth/banner').forEach((r) => r.flush({ imageUrl: null }));
  }

  it('checks the link, then sets the password with the token in the body', async () => {
    await create(`token=${TOKEN}`);
    const check = http.expectOne('/api/msme/auth/reset-password/check');
    expect(check.request.method).toBe('POST');
    expect(check.request.body).toEqual({ token: TOKEN });
    check.flush({ message: 'Valid' });
    await settle(fixture);

    type(el, '#newPassword', 'New#Pass123');
    type(el, '#confirmPassword', 'New#Pass123');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const reset = http.expectOne('/api/msme/auth/reset-password');
    expect(reset.request.body).toEqual({ token: TOKEN, newPassword: 'New#Pass123', confirmPassword: 'New#Pass123' });
    reset.flush({ message: 'Password reset successful.' });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Password reset successful');
  });

  it('explains how to get a new link when the link is used or expired', async () => {
    await create(`token=${TOKEN}`);
    http.expectOne('/api/msme/auth/reset-password/check')
      .flush({ title: 'This reset link is invalid, has expired or has already been used. Please request a new one.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('has expired');
    expect(el.textContent).toContain('Forgot Password');
    expect(el.querySelector('a[href="/msme/login"]')).not.toBeNull();
  });

  it('needs no server call without a token (old ?code= links)', async () => {
    await create(null);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('invalid');
  });
});
