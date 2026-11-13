import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfessionalVerificationPage } from './professional-verification';

const URL = '/api/staff/settings/professional-verification';

const api = {
  url: null, method: 'POST', keyHeader: null, keySet: false, keyReadable: true, certificateField: 'certificateNo', panField: 'pan',
  nameField: 'name', emailField: 'email', mobileField: 'mobile', successField: null,
};

describe('ProfessionalVerificationPage', () => {
  let fixture: ComponentFixture<ProfessionalVerificationPage>;
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
      imports: [ProfessionalVerificationPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfessionalVerificationPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(URL).flush(settings);
    await settle();
  }

  async function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  const radio = (id: string) => el.querySelector(`#${id}`) as HTMLInputElement;
  const submit = async () => {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
  };

  afterEach(() => http.verify());

  it('shows the three options with the current one (off by default) and saves the training portal', async () => {
    await create({ mode: 'Off', api, portal: 'main' });
    expect(el.querySelector('.card-title')!.textContent).toContain('ZED Certification');
    expect([...el.querySelectorAll('.pv-title')].map((t) => t.textContent!.replace('Current', '').trim())).toEqual([
      'Off: the agency enters the details', 'Training portal: certificate number and e-mail', 'Other portal API: certificate number and PAN',
    ]);
    expect(el.textContent).toContain('Certificate number, PAN, name, e-mail and mobile are typed on the Add form.');
    expect(el.textContent).toContain("The current check against the training portal's candidates.");
    expect(radio('pv-Off').checked).toBe(true);
    expect(el.querySelector('.pv-option.is-on .status-badge')!.textContent!.trim()).toBe('Current');
    expect(el.querySelector('#pv-url')).toBeNull();

    radio('pv-TrainingPortal').click();
    await settle();
    await submit();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === URL);
    expect(put.request.body).toEqual({ mode: 'TrainingPortal' });
    put.flush({ message: 'Saved.' });
    await settle();
    http.expectOne(URL).flush({ mode: 'TrainingPortal', api, portal: 'main' });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Saved.');
    expect(radio('pv-TrainingPortal').checked).toBe(true);
  });

  it('sets up the other portal API, keeps the saved key unless a new one is typed, and tests it', async () => {
    await create({
      mode: 'Api', portal: 'consultancy',
      api: { ...api, url: 'https://pro.example.test/verify', keyHeader: 'x-api-key', keySet: true, nameField: 'data.name' },
    });
    expect(el.querySelector('.card-title')!.textContent).toContain('Consultancy');
    const key = el.querySelector('#pv-key') as HTMLInputElement;
    expect(key.type).toBe('password');
    expect(key.value).toBe('');
    expect(key.placeholder).toBe('Key is set — leave blank to keep');
    expect((el.querySelector('#pv-url') as HTMLInputElement).value).toBe('https://pro.example.test/verify');

    await type('#pv-test-cert', 'BA1234');
    await type('#pv-test-pan', 'abcde1234f');
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Test') as HTMLButtonElement).click();
    await settle();
    const test = http.expectOne((r) => r.method === 'POST' && r.url === `${URL}/test`);
    expect(test.request.body).toMatchObject({ certificateNo: 'BA1234', pan: 'ABCDE1234F', url: 'https://pro.example.test/verify', keyHeader: 'x-api-key', key: null, nameField: 'data.name' });
    test.flush({ ok: true, name: 'Api Pro', email: 'api@zed.test', mobileNo: '9333333333', error: null });
    await settle();
    expect(el.querySelector('.pv-test .alert-success')!.textContent).toContain('Api Pro');
    expect(el.querySelector('.pv-test .alert-success')!.textContent).toContain('9333333333');

    await submit();
    let put = http.expectOne((r) => r.method === 'PUT' && r.url === URL);
    expect(put.request.body).toMatchObject({ mode: 'Api', url: 'https://pro.example.test/verify', method: 'POST', key: null, removeKey: false });
    put.flush({ message: 'Saved.' });
    await settle();
    http.expectOne(URL).flush({ mode: 'Api', portal: 'consultancy', api: { ...api, url: 'https://pro.example.test/verify', keyHeader: 'x-api-key', keySet: true } });
    await settle();

    await type('#pv-key', 'new-key');
    await submit();
    put = http.expectOne((r) => r.method === 'PUT' && r.url === URL);
    expect(put.request.body).toMatchObject({ key: 'new-key' });
    put.flush({ title: 'The API address must be a full https:// address (up to 500 characters).' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('https://');
  });

  it('shows what failed when the API test does not answer the professional', async () => {
    await create({ mode: 'Off', api, portal: 'main' });
    radio('pv-Api').click();
    await settle();
    await type('#pv-url', 'https://pro.example.test/verify');
    await type('#pv-test-cert', 'BA1234');
    await type('#pv-test-pan', 'ABCDE1234F');
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Test') as HTMLButtonElement).click();
    await settle();
    http.expectOne(`${URL}/test`).flush({ ok: false, name: null, email: null, mobileNo: null, error: 'No certified professional was found for this certificate number and PAN.' });
    await settle();
    expect(el.querySelector('.pv-test .alert-warning')!.textContent).toContain('No certified professional was found');
  });
});
