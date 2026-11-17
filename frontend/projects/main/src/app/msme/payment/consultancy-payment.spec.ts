import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LevelState } from '../handholding/handholding.api';
import { ConsultancyPaymentPage } from './consultancy-payment';
import { ConsultancyOptions } from './consultancy-payment.api';

const API = '/api/msme/consultancy-payments';
const PROFILE = { msme: { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Pumps', PAddress: 'Plot 4', PDistrictName: 'Kanpur', PStateName: 'UP', PPin: '208001' }, basicInfo: {}, registeredEmail: null };

function status(overrides: Partial<LevelState> = {}): LevelState {
  return { certification: 'Silver', enabled: true, milestonesStarted: 1, nextMilestone: 2, canPay: true, refusal: null, awaitingAcceptance: null, ...overrides };
}

function options(overrides: Partial<ConsultancyOptions> = {}): ConsultancyOptions {
  const row = { Total: 200000, ApplicantContributionAfterSubsidy: 23600, NetPaybleTds15: 23200, NetPaybleTds75: 21600, Tds75: 2000, SubsidyLabel: '(80%)', Subsidy: 160000, GstAfterSubsidy: 3600, SubsidyAmount: 20000 };
  return {
    certification: 'Silver', milestone: 2, rewardAvailable: false, udyamPan: 'ABCDE1234F', stateSubsidy: false,
    withReward: null, withoutReward: row, ...overrides,
  };
}

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('ConsultancyPaymentPage', () => {
  let fixture: ComponentFixture<ConsultancyPaymentPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let router: Router;

  const settled = () => settle(fixture);
  const button = (label: string) =>
    [...el.querySelectorAll('button, a')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLElement;
  const payButton = () => el.querySelector('.pay-btn') as HTMLButtonElement;
  const accept = () => button('Accept & proceed') as HTMLButtonElement;
  /** Ticks the consent of the disclaimer and accepts it. */
  const acceptDisclaimer = async () => {
    (el.querySelector('input[name="consent"]') as HTMLInputElement).click();
    await settled();
    accept().click();
    await settled();
  };
  const choose = (name: string, value: string) => (el.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement).click();
  const type = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  async function open(level = 'silver', s: LevelState = status()) {
    fixture = TestBed.createComponent(ConsultancyPaymentPage);
    fixture.componentRef.setInput('certification', level);
    el = fixture.nativeElement;
    await settled();
    http.expectOne(`${API}/Silver/status`).flush(s);
    await settled();
    if (s.canPay) {
      http.expectOne('/api/msme/profile').flush(PROFILE);
      await settled();
    }
  }

  async function toPayment(o: ConsultancyOptions = options()) {
    await open();
    await acceptDisclaimer();
    expect(el.querySelector('[data-key="msme.handholding.payment.instructions"]')).not.toBeNull();
    accept().click();
    await settled();
    http.expectOne(`${API}/Silver/options`).flush(o);
    await settled();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultancyPaymentPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    window.scrollTo = () => undefined;
  });

  afterEach(() => http.verify());

  it('shows why a milestone cannot be paid instead of the disclaimer', async () => {
    await open('Silver', status({ canPay: false, refusal: 'Milestone 1 must be completed and accepted before Milestone 2 can be paid.' }));
    expect(el.textContent).toContain('Milestone 1 must be completed and accepted');
    expect(el.textContent).not.toContain('Disclaimer / declaration');
    expect(el.querySelector('zed-step-tracker')).toBeNull();
    expect(button('← Back to Handholding support').getAttribute('href')).toBe('/msme/handholding');
  });

  it('rejects Bronze or an unknown level without calling the API', async () => {
    fixture = TestBed.createComponent(ConsultancyPaymentPage);
    fixture.componentRef.setInput('certification', 'Bronze');
    el = fixture.nativeElement;
    await settled();
    expect(el.textContent).toContain('Invalid certification.');
    http.expectNone(() => true);
  });

  it('shows the page head, the four steps, and the disclaimer with the consent and the milestone being paid for', async () => {
    await open();
    const crumbs = [...el.querySelectorAll('.ph-crumb a, .ph-crumb [aria-current]')];
    expect(crumbs.map((c) => c.textContent!.trim())).toEqual(['Home', 'Incentives', 'Handholding support', 'Payment']);
    expect(crumbs[1].getAttribute('href')).toBe('/msme/dashboard#incentives');
    expect(crumbs[2].getAttribute('href')).toBe('/msme/handholding');
    expect(el.textContent).toContain('Step 1 of 4: read and accept the disclaimer before payment.');
    expect([...el.querySelectorAll('.st-label')].map((x) => x.textContent!.trim())).toEqual(['Disclaimer', 'Fee & tax details', 'Payment', 'Confirmation']);
    const rail = el.querySelector('.pd-rail')!.textContent!;
    expect(rail).toContain('Silver Handholding support');
    expect(rail).toContain('Acme Pumps · ZEDMSME000001');
    expect(rail).toContain('Milestone 2');
    expect(rail).toContain('Implementation & Progress Review 1');
    expect(accept().disabled).toBe(true);
    (el.querySelector('input[name="consent"]') as HTMLInputElement).click();
    await settled();
    expect(accept().disabled).toBe(false);
  });

  it('shows the handholding disclaimer, instructions and fee summary of the milestone due', async () => {
    await open();
    expect(el.querySelector('[data-key="msme.handholding.payment.disclaimer"]')).not.toBeNull();
    expect(button('← Back to Handholding support').getAttribute('href')).toBe('/msme/handholding?level=Silver');
    await acceptDisclaimer();
    expect(button('← Back to Handholding support').getAttribute('href')).toBe('/msme/handholding?level=Silver');
    accept().click();
    await settled();
    http.expectOne(`${API}/Silver/options`).flush(options());
    await settled();

    expect(el.textContent).toContain('Step 2 of 4: confirm tax details and the amount before you pay.');
    expect(el.querySelector('.pst-level')!.textContent).toContain('Milestone 2: Implementation & Progress Review 1');
    expect(el.querySelector('.pst-bill')!.textContent).toContain('Acme Pumps');
    expect(el.textContent).toContain('Handholding Fee');
    expect(el.textContent).toContain('On the handholding fee');
    expect(el.textContent).toContain('23,600.00');
    expect(button('Back to Handholding support').getAttribute('href')).toBe('/msme/handholding?level=Silver');
    expect(el.textContent).not.toContain('Apply reward');
    expect(el.textContent).not.toContain('Andhra Pradesh');

    choose('tdsDeductible', 'Yes');
    await settled();
    choose('tds', '7.5');
    await settled();
    expect(el.textContent).toContain('TDS Deducted (10%)');
    expect(el.textContent).toContain('21,600.00');
  });

  it('shows the Andhra Pradesh subsidy line for a state fee row', async () => {
    await toPayment(options({ stateSubsidy: true, withoutReward: { ...options().withoutReward, StateSubsidyLabel: '(20%)', StateContributionAfterSubsidy: 23600, ApplicantContributionAfterSubsidy: 0 } }));
    expect(el.textContent).toContain('Andhra Pradesh Govt. subsidy');
    expect(el.textContent).toContain('(20%)');
  });

  it('says when milestone 1 covers all three milestones, and when a milestone was paid with it', async () => {
    await toPayment(options({ milestone: 1, coversAllMilestones: true }));
    expect(el.querySelector('[data-testid="covers-all"]')!.textContent).toContain('covers all three milestones of Silver');
    expect(el.textContent).toContain('Milestones 1, 2 and 3');
    expect(el.querySelector('[data-testid="paid-at-1"]')).toBeNull();
  });

  it('says a milestone paid at milestone 1 has nothing to pay', async () => {
    await toPayment(options({ paidAtMilestone1: true, withoutReward: { Total: 0, ApplicantContributionAfterSubsidy: 0, SubsidyLabel: '(80%)' } }));
    expect(el.querySelector('[data-testid="paid-at-1"]')!.textContent).toContain('Milestone 2 was paid with milestone 1');
    expect(el.querySelector('[data-testid="covers-all"]')).toBeNull();
    // 2026-11-17: nothing to pay: the button confirms instead (no gateway).
    expect(el.querySelector('[data-zero-payment]')).not.toBeNull();
    expect(payButton().textContent!.trim()).toBe('CONFIRM (NOTHING TO PAY)');
  });

  it('checks the form, then sends only the choices and the milestone shown to checkout', async () => {
    await toPayment();
    payButton().click();
    await settled();
    expect(el.textContent).toContain('Please enter required data.');

    choose('unitGstin', 'No');
    choose('tdsDeductible', 'No');
    await settled();
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(() => undefined);
    payButton().click();
    await settled();

    const req = http.expectOne(`${API}/Silver/checkout`);
    expect(req.request.body).toEqual({ useReward: false, gstinApplicable: false, gstin: null, tdsDeductible: false, tds: null, tan: null, milestone: 2 });
    req.flush({ status: 'gateway', gatewayUrl: 'https://test.ccavenue.com/transaction', encRequest: 'abc', accessCode: 'AV' });
    await settled();
    expect(submit).toHaveBeenCalled();
    const form = document.querySelector('form[action="https://test.ccavenue.com/transaction"]') as HTMLFormElement;
    expect((form.querySelector('input[name="encRequest"]') as HTMLInputElement).value).toBe('abc');
    form.remove();
    submit.mockRestore();
  });

  it('verifies the GSTIN, corrects a mismatched PAN, and goes to the result page for a zero payment', async () => {
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    await toPayment();
    choose('unitGstin', 'Yes');
    await settled();
    type('input[name="gstin"]', '09pqrst6789k1z2');
    choose('tdsDeductible', 'No');
    await settled();
    payButton().click();
    await settled();

    http.expectOne(`${API}/gstin`).flush({ message: 'ok', panMatches: false, gstinPan: 'PQRST6789K', udyamPan: 'ABCDE1234F' });
    await settled();
    expect(el.textContent).toContain('PAN Mismatch Detected');
    type('#correctedPan', 'zzzzz9999z');
    await settled();
    button('Save & Proceed').click();
    await settled();
    expect(el.querySelector('zed-alert-dialog')!.textContent).toContain('Please enter the correct PAN associated with that GSTIN.');
    button('OK').click();
    await settled();
    type('#correctedPan', 'pqrst6789k');
    await settled();
    button('Save & Proceed').click();
    await settled();

    const pan = http.expectOne(`${API}/pan`);
    expect(pan.request.body).toEqual({ certification: 'Silver', gstin: '09PQRST6789K1Z2', pan: 'PQRST6789K' });
    pan.flush({ message: 'PAN updated successfully.' });
    await settled();
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain('PAN updated successfully. Proceeding...');
    const req = http.expectOne(`${API}/Silver/checkout`);
    expect(req.request.body.gstin).toBe('09PQRST6789K1Z2');
    req.flush({ status: 'paid' });
    await settled();
    expect(navigate).toHaveBeenCalledWith(['/msme/payment/consultancy-result'], { queryParams: { status: 'success', certification: 'Silver', milestone: 2 } });
  });

  it('shows the API refusal at checkout', async () => {
    await toPayment();
    choose('unitGstin', 'No');
    choose('tdsDeductible', 'No');
    await settled();
    payButton().click();
    await settled();
    http.expectOne(`${API}/Silver/checkout`).flush({ title: 'The milestone due has changed. Please open the payment page again.' }, { status: 400, statusText: 'Bad Request' });
    await settled();
    expect(el.textContent).toContain('The milestone due has changed.');
  });
});
