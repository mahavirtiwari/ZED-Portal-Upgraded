import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { routes } from '../../app.routes';
import { DashboardPage } from '../dashboard/dashboard';
import { PaymentResultPage } from './payment-result';
import { SurveillancePaymentPage } from './surveillance-payment';
import { SurveillanceOptions } from './surveillance-payment.api';

const API = '/api/msme/surveillance-payments';

function options(overrides: Partial<SurveillanceOptions> = {}): SurveillanceOptions {
  return {
    certification: 'Bronze',
    rewardAvailable: true,
    udyamPan: 'ABCDE1234F',
    withReward: { Total: 2360, Coupon: 2000, TotalAfterCoupon: 360, ApplicantContributionAfterSubsidy: 0, SubsidyLabel: '(50%)' },
    withoutReward: { Total: 2360, ApplicantContributionAfterSubsidy: 1180, NetPaybleTds15: 1156.4, NetPaybleTds75: 1092.5, Tds75: 87.5, SubsidyLabel: '(50%)', Subsidy: 1180 },
    prefill: { unitGstin: null, gstin: null, tdsDeductible: null, tds: null, tan: null },
    ...overrides,
  };
}

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('SurveillancePaymentPage', () => {
  let fixture: ComponentFixture<SurveillancePaymentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let router: Router;

  const settled = () => settle(fixture);
  const button = (label: string) =>
    [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement;
  const choose = (name: string, value: string) => (el.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement).click();
  const type = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function open(level: string, eligible = true) {
    fixture = TestBed.createComponent(SurveillancePaymentPage);
    fixture.componentRef.setInput('certification', level);
    el = fixture.nativeElement;
    await settled();
    http.expectOne(`${API}/${level.charAt(0).toUpperCase() + level.slice(1).toLowerCase()}/status`).flush({ certification: level, eligible });
    await settled();
  }

  /** Disclaimer and instructions accepted, fee summary loaded. */
  async function toPayment(o: SurveillanceOptions = options()) {
    await open('bronze');
    button('ACCEPT & PROCEED').click();
    await settled();
    expect(el.textContent).toContain('INSTRUCTIONS');
    expect(el.querySelector('[data-key="msme.surveillance.payment.instructions"]')).not.toBeNull();
    button('ACCEPT & PROCEED').click();
    await settled();
    http.expectOne(`${API}/Bronze/options`).flush(o);
    await settled();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [SurveillancePaymentPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    window.scrollTo = () => undefined;
  });

  afterEach(() => http.verify());

  it('sends an MSME whose surveillance cannot be paid back to the dashboard', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await open('Silver', false);
    expect(navigate).toHaveBeenCalledWith(['/msme/dashboard']);
    expect(el.textContent).not.toContain('DISCLAIMER');
  });

  it('rejects an unknown level without calling the API', async () => {
    fixture = TestBed.createComponent(SurveillancePaymentPage);
    fixture.componentRef.setInput('certification', 'Platinum');
    el = fixture.nativeElement;
    await settled();
    expect(el.textContent).toContain('Invalid certification.');
    http.expectNone(() => true);
  });

  it('shows the surveillance disclaimer and instructions, then the surveillance fee summary', async () => {
    await open('bronze');
    expect(el.querySelector('[data-key="msme.surveillance.payment.disclaimer"]')).not.toBeNull();
    await toPaymentFromDisclaimer();
    expect(el.textContent).toContain('Surveillance Assessment Fee');
    expect(el.textContent).toContain('1,180.00');
    expect(el.textContent).not.toContain('Andhra Pradesh');
    expect(el.querySelector('.payment-reward-block [data-key="msme.surveillance.payment.joiningReward.note"]')).not.toBeNull();

    button('APPLY REWARD').click();
    await settled();
    expect(el.textContent).toContain('Reward Applied');
    expect(el.textContent).toContain('Final Certification Fee');
    button('REMOVE').click();
    choose('tdsDeductible', 'Yes');
    await settled();
    choose('tds', '7.5');
    await settled();
    expect(el.textContent).toContain('TDS Deducted (10%)');
    expect(el.textContent).toContain('1,092.50');
  });

  async function toPaymentFromDisclaimer() {
    button('ACCEPT & PROCEED').click();
    await settled();
    button('ACCEPT & PROCEED').click();
    await settled();
    http.expectOne(`${API}/Bronze/options`).flush(options());
    await settled();
  }

  it('fills the form with the choices made for the certification payment', async () => {
    await toPayment(options({ prefill: { unitGstin: 'Yes', gstin: '09ABCDE1234F1Z5', tdsDeductible: 'Yes', tds: '7.5', tan: 'ABCD12345E' } }));
    expect((el.querySelector('input[name="unitGstin"][value="Yes"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('input[name="gstin"]') as HTMLInputElement).value).toBe('09ABCDE1234F1Z5');
    expect((el.querySelector('input[name="tds"][value="7.5"]') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('input[name="tan"]') as HTMLInputElement).value).toBe('ABCD12345E');
  });

  it('requires the options before calling the API', async () => {
    await toPayment();
    button('PROCEED TO PAY').click();
    await settled();
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Error!');
    expect(dialog.textContent).toContain('Please enter required data.');
    http.expectNone(`${API}/Bronze/checkout`);
  });

  it('sends only the choices and goes to the surveillance result when nothing is left to pay', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await toPayment();
    choose('unitGstin', 'No');
    choose('tdsDeductible', 'No');
    button('APPLY REWARD').click();
    await settled();

    button('PROCEED TO PAY').click();
    await settled();
    const req = http.expectOne(`${API}/Bronze/checkout`);
    expect(req.request.body).toEqual({ useReward: true, gstinApplicable: false, gstin: null, tdsDeductible: false, tds: null, tan: null });
    req.flush({ status: 'paid' });
    await settled();
    expect(navigate).toHaveBeenCalledWith(['/msme/payment/result'], { queryParams: { status: 'success', certification: 'Bronze', kind: 'surveillance' } });
  });

  it('asks for the PAN when the GSTIN belongs to another PAN, then checks out', async () => {
    vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await toPayment();
    choose('unitGstin', 'Yes');
    await settled();
    type('input[name="gstin"]', '09PQRST6789K1Z2');
    choose('tdsDeductible', 'No');
    await settled();

    button('PROCEED TO PAY').click();
    await settled();
    const verify = http.expectOne(`${API}/gstin`);
    expect(verify.request.body).toEqual({ certification: 'Bronze', gstin: '09PQRST6789K1Z2' });
    verify.flush({ message: 'ok', panMatches: false, gstinPan: 'PQRST6789K', udyamPan: 'ABCDE1234F' });
    await settled();
    expect(el.textContent).toContain('PAN Mismatch Detected');

    type('#correctedPan', 'ZZZZZ9999Z');
    button('Save & Proceed').click();
    await settled();
    expect(el.textContent).toContain('Please enter the correct PAN associated with that GSTIN.');

    type('#correctedPan', 'pqrst6789k');
    button('Save & Proceed').click();
    await settled();
    const pan = http.expectOne(`${API}/pan`);
    expect(pan.request.body).toEqual({ certification: 'Bronze', gstin: '09PQRST6789K1Z2', pan: 'PQRST6789K' });
    pan.flush({ message: 'ok' });
    await settled();
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain('PAN updated successfully. Proceeding...');

    const checkout = http.expectOne(`${API}/Bronze/checkout`);
    expect(checkout.request.body.gstin).toBe('09PQRST6789K1Z2');
    checkout.flush({ status: 'paid' });
    await settled();
  });

  it('posts the encrypted request to the gateway', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    await toPayment();
    choose('unitGstin', 'No');
    choose('tdsDeductible', 'No');
    await settled();
    button('PROCEED TO PAY').click();
    await settled();
    http.expectOne(`${API}/Bronze/checkout`).flush({ status: 'gateway', gatewayUrl: 'https://test.ccavenue.com/t', encRequest: 'abc123', accessCode: 'AV1' });
    await settled();

    expect(submit).toHaveBeenCalled();
    const form = submit.mock.contexts[0] as HTMLFormElement;
    expect(form.action).toBe('https://test.ccavenue.com/t');
    expect((form.querySelector('input[name="encRequest"]') as HTMLInputElement).value).toBe('abc123');
    expect((form.querySelector('input[name="access_code"]') as HTMLInputElement).value).toBe('AV1');
    form.remove();
  });

  it('shows the API message when the server refuses', async () => {
    await toPayment();
    choose('unitGstin', 'No');
    choose('tdsDeductible', 'No');
    await settled();
    button('PROCEED TO PAY').click();
    await settled();
    http.expectOne(`${API}/Bronze/checkout`).flush(
      { title: 'Surveillance payment is not available for this certification.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settled();
    expect(el.textContent).toContain('Surveillance payment is not available for this certification.');
  });
});

describe('Surveillance payment entry points', () => {
  it('redirects the old SurveillancePay/Index address to the new page', () => {
    const redirect = routes.find((r) => r.path === 'SurveillancePay/Index/:certification');
    expect(redirect?.redirectTo).toBe('msme/surveillance-payment/:certification');
    const msme = routes.find((r) => r.path === 'msme')!;
    expect(msme.children!.some((r) => r.path === 'surveillance-payment/:certification')).toBe(true);
  });

  it('links the dashboard SURVEILLANCE entry and its APPLY button to the new page', async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(DashboardPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://old.example' });
    http.expectOne('/api/msme/dashboard').flush({
      msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme', IsBronzePaymentDone: 1, BronzeDashboardSurStatus: 1, SilverDashboardSurStatus: 0, GoldDashboardSurStatus: 0 },
      basicInfo: { ReCertification: 0 },
      certStatus: { BronzeStatus: 6, SilverStatus: 0, GoldStatus: 0 },
    });
    await settle(fixture);

    const el = fixture.nativeElement as HTMLElement;
    const links = [...el.querySelectorAll('a')].filter((a) => a.getAttribute('href') === '/msme/surveillance-payment/Bronze');
    expect(links.map((a) => a.textContent!.trim())).toEqual(['SURVEILLANCE', 'APPLY']);
    expect(el.querySelector('a[href*="SurveillancePay"]')).toBeNull();
    http.verify();
  });
});

describe('PaymentResultPage for surveillance', () => {
  async function render(query: Record<string, string>) {
    await TestBed.configureTestingModule({ imports: [PaymentResultPage], providers: [provideRouter([])] }).compileComponents();
    const fixture = TestBed.createComponent(PaymentResultPage);
    for (const [k, v] of Object.entries(query)) fixture.componentRef.setInput(k, v);
    await settle(fixture);
    return (fixture.nativeElement as HTMLElement).textContent!;
  }

  it('uses the surveillance wording', async () => {
    const text = await render({ status: 'success', certification: 'Bronze', kind: 'surveillance' });
    expect(text).toContain('Your payment towards ZED Surveillance has been successful.');
    expect(text).not.toContain('Basic Information and Document Upload');
  });

  it('keeps the certification wording without kind', async () => {
    const text = await render({ status: 'success', certification: 'Bronze' });
    expect(text).toContain('Your payment towards ZED Certification has been successful.');
  });

  it('shows the gateway message on failure', async () => {
    const text = await render({ status: 'failure', certification: 'Bronze', kind: 'surveillance', message: 'Card declined' });
    expect(text).toContain('Payment Failed');
    expect(text).toContain('Card declined');
  });
});
