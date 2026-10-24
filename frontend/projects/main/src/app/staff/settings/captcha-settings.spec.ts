import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { CaptchaSettingsPage } from './captcha-settings';

describe('CaptchaSettingsPage', () => {
  let fixture: ComponentFixture<CaptchaSettingsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(settings: object) {
    await TestBed.configureTestingModule({
      imports: [CaptchaSettingsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(CaptchaSettingsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/settings/captcha').flush(settings);
    await settle();
  }

  const radio = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement;

  afterEach(() => http.verify());

  it('enables the 6-character captcha', async () => {
    await create({ mode: 'off', googleAvailable: false });
    expect(radio('captcha-off').checked).toBe(true);
    // Google is offered only when its keys are configured.
    expect(radio('captcha-google')).toBeNull();

    radio('captcha-text').click();
    await settle();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/settings/captcha');
    expect(put.request.body).toEqual({ mode: 'text' });
    put.flush({ message: 'Captcha setting saved.' });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Captcha setting saved.');
  });

  it('offers Google reCAPTCHA when the server has its keys and shows refusals', async () => {
    await create({ mode: 'google', googleAvailable: true });
    expect(radio('captcha-google').checked).toBe(true);
    radio('captcha-off').click();
    await settle();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ title: 'Please select a captcha option.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please select a captcha option.');
  });
});
