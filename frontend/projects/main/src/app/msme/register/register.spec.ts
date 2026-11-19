import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ContentService, ContentText } from '../../content/content-text';
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
    button('Start registration').click();
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

  it('shows the welcome text from the Texts', async () => {
    await settle();
    expect(el.querySelector('[data-key="msme.registration.welcome"]')).not.toBeNull();
  });

  // 2026-11-18 (the user approved the registration design): the 4-step tracker card, with the current step's note.
  it('shows the tracker with the current step from the Udyam check on', async () => {
    await settle();
    expect(el.querySelector('.reg-track')).toBeNull();
    await goToUdyamStep();
    const current = el.querySelector('.reg-track li.cur')!;
    expect(current.textContent).toContain('Udyam check');
    expect(current.textContent).toContain('You are here');
    expect(current.textContent).toContain('(current)');
  });

  it('validates the Udyam number format before calling the API', async () => {
    await goToUdyamStep();
    type('#regNo', '12345');
    type('#mobileNo', '9999999999');
    button('Check and proceed').click();
    await settle();

    http.expectNone('/api/msme/registration/lookup');
    expect(el.querySelector('[role="dialog"] .swal-text')!.textContent).toContain('valid Udyam Registration Number');
  });

  it('upper-cases the Udyam number and shows the plants returned by the lookup', async () => {
    await goToUdyamStep();
    type('#regNo', 'udyam-up-29-0003915');
    type('#mobileNo', '9999999999');
    button('Check and proceed').click();
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

    expect(el.textContent).toContain('Select one plant location');
    expect(el.textContent).toContain('Acme Castings');
    expect(el.textContent).toContain('Plot 4, KANPUR, UP, 208001');
    expect(el.querySelector('[data-key="msme.registration.plant.validatedNote"]')).not.toBeNull();
  });

  // 2026-11-19 (the user): a plant named N/A, NA, 1, 2, ... in Udyam cannot be chosen; the reason is shown on it.
  it('greys out a plant whose Udyam unit name is a placeholder, with the reason and no radio button', async () => {
    await goToUdyamStep();
    type('#regNo', 'UDYAM-UP-29-0003915');
    type('#mobileNo', '9999999999');
    button('Check and proceed').click();
    await settle();
    http.expectOne('/api/msme/registration/lookup').flush({
      registrationId: 'r1',
      basicDetails: { EnterpriseName: 'Acme Castings', UdyogAadharNo: 'UDYAM-UP-29-0003915' },
      plants: [
        { UnitName: 'N/A', PAddress: 'Plot 4', V4UnitNameRefused: 'not valid' },
        { UnitName: 'Acme Castings Unit', PAddress: 'Plot 9' },
      ],
      activities: [{ Activity: 'Manufacturing', Two_DigitActivity: '24' }],
    });
    await settle();

    const units = el.querySelectorAll('.reg-units label.reg-unit');
    expect(units[0].classList).toContain('off');
    expect(units[0].querySelector('input[name="plant"]')).toBeNull();
    expect(el.querySelector('[data-plant-bad-name="0"]')!.textContent).toContain('update the unit name of this plant on the Udyam portal');
    expect(units[1].classList).not.toContain('off');
    expect(units[1].querySelector('input[name="plant"]')).not.toBeNull();
  });

  it('shows the API message when the lookup is rejected', async () => {
    await goToUdyamStep();
    type('#regNo', 'UDYAM-UP-29-0003915');
    type('#mobileNo', '9999999999');
    button('Check and proceed').click();
    await settle();

    http.expectOne('/api/msme/registration/lookup').flush(
      { title: 'It seems that the Plant Details are missing in your Udyam file.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();

    expect(el.querySelector('[role="dialog"] .swal-text')!.textContent).toContain('Plant Details are missing');
    expect(el.textContent).toContain('Udyam Registration validation');
  });

  afterEach(() => {
    answerCaptchaConfig();
    http.verify();
  });
});

describe('RegisterPage pledge', () => {
  const texts = new Map<string, ContentText>();

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [RegisterPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ContentService, useValue: { text: (key: string) => texts.get(key) ?? null, loaded: () => true, failed: () => false, retry: () => undefined } }],
    }).compileComponents();
    window.scrollTo = () => undefined;
  });

  function pledgeLines(): string[] {
    const fixture = TestBed.createComponent(RegisterPage);
    (fixture.componentInstance as unknown as { step: { set(s: string): void } }).step.set('pledge');
    fixture.detectChanges();
    return [...fixture.nativeElement.querySelectorAll('.pledge-line')].map((l: Element) => l.innerHTML.trim());
  }

  it('fades in the Admin pledge line by line', () => {
    texts.set('msme.registration.pledge', { key: 'msme.registration.pledge', enabled: true, html: '<p>We undertake</p>\n<p>to give <b>back</b></p>' });
    expect(pledgeLines()).toEqual(['We undertake', 'to give <b>back</b>']);
  });

  it('shows no pledge when the Admin hid it', () => {
    texts.set('msme.registration.pledge', { key: 'msme.registration.pledge', enabled: false, html: '<p>We undertake</p>' });
    expect(pledgeLines()).toEqual([]);
  });
});
