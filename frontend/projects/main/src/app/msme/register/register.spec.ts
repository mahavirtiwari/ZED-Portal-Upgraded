import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { RegisterPage } from './register';

describe('RegisterPage', () => {
  let fixture: ComponentFixture<RegisterPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLButtonElement;

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

  /** The captcha widget asks the API whether it is enabled; answer "disabled" so it emits a token. */
  function answerCaptchaConfig() {
    for (const req of http.match('/api/config')) req.flush({ captchaEnabled: false, captchaSiteKey: '' });
  }

  async function goToUdyamStep() {
    await settle();
    button('PROCEED').click();
    await settle();
    answerCaptchaConfig();
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(RegisterPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    window.scrollTo = () => undefined;
  });

  it('validates the Udyam number format before calling the API', async () => {
    await goToUdyamStep();
    type('#regNo', '12345');
    type('#mobileNo', '9999999999');
    button('PROCEED').click();
    await settle();

    http.expectNone('/api/msme/registration/lookup');
    expect(el.querySelector('.alert-danger')!.textContent).toContain('valid Udyam Registration Number');
  });

  it('upper-cases the Udyam number and shows the plants returned by the lookup', async () => {
    await goToUdyamStep();
    type('#regNo', 'udyam-up-29-0003915');
    type('#mobileNo', '9999999999');
    button('PROCEED').click();
    await settle();

    const req = http.expectOne('/api/msme/registration/lookup');
    expect(req.request.body).toEqual({ registrationNo: 'UDYAM-UP-29-0003915', mobileNo: '9999999999', captchaToken: 'disabled' });
    req.flush({
      registrationId: 'r1',
      basicDetails: { EnterpriseName: 'Acme Castings', UdyogAadharNo: 'UDYAM-UP-29-0003915', EnterpriseType: 'Micro' },
      plants: [{ UnitName: 'Unit 1', PAddress: 'Plot 4', DISTRICT_NAME: 'KANPUR', state_name: 'UP', PPin: '208001' }],
      activities: [{ Activity: 'Manufacturing', Two_DigitActivity: '24' }],
    });
    await settle();

    expect(el.textContent).toContain('Unit and Activity');
    expect(el.textContent).toContain('Acme Castings');
    expect(el.textContent).toContain('Plot 4, KANPUR, UP, 208001');
  });

  it('shows the API message when the lookup is rejected', async () => {
    await goToUdyamStep();
    type('#regNo', 'UDYAM-UP-29-0003915');
    type('#mobileNo', '9999999999');
    button('PROCEED').click();
    await settle();

    http.expectOne('/api/msme/registration/lookup').flush(
      { title: 'It seems that the Plant Details are missing in your Udyam file.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();

    expect(el.querySelector('.alert-danger')!.textContent).toContain('Plant Details are missing');
    expect(el.textContent).toContain('Udyam Registration Validation');
  });

  afterEach(() => {
    answerCaptchaConfig();
    http.verify();
  });
});
