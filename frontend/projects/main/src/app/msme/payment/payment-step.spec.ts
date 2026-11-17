import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { PaymentStep } from './payment-step';

describe('PaymentStep', () => {
  let fixture: ComponentFixture<PaymentStep>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim().includes(label)) as HTMLButtonElement;

  const choose = (name: string, value: string) => {
    const radio = el.querySelector(`input[name="${name}"][value="${value}"]`) as HTMLInputElement;
    radio.click();
  };

  const type = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentStep],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(PaymentStep);
    fixture.componentRef.setInput('certification', 'Bronze');
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    window.scrollTo = () => undefined;

    await settle();
    http.expectOne('/api/msme/payments/Bronze/options').flush({
      certification: 'Bronze',
      rewardAvailable: true,
      udyamPan: 'ABCDE1234F',
      withReward: { Total: 11800, Coupon: 10000, TotalAfterCoupon: 1800, ApplicantContributionAfterSubsidy: 0, SubsidyLabel: '(80%)' },
      withoutReward: { Total: 11800, ApplicantContributionAfterSubsidy: 2360, NetPaybleTds15: 2320, NetPaybleTds75: 2160, SubsidyLabel: '(80%)', Subsidy: 9440 },
    });
    await settle();
  });

  afterEach(() => http.verify());

  it('updates the summary for the reward and TDS choices', async () => {
    expect(el.textContent).toContain('2,360.00');
    // 2026-11-17 (the user's design): GSTIN and TAN unlock only when needed; the gateway and non-refundable lines.
    expect((el.querySelector('input[name="gstin"]') as HTMLInputElement).disabled).toBe(true);
    expect((el.querySelector('input[name="tan"]') as HTMLInputElement).disabled).toBe(true);
    expect(el.textContent).toContain('You will be taken to a secure payment gateway.');
    expect(el.textContent).toContain('The amount once remitted is non-refundable.');
    expect(el.querySelector('.payment-reward-block [data-key="msme.payment.joiningReward.note"]')).not.toBeNull();
    button('Apply reward').click();
    await settle();
    expect(el.textContent).toContain('Reward applied');
    expect(el.textContent).toContain('1,800.00');

    button('Remove').click();
    choose('tdsDeductible', 'Yes');
    await settle();
    choose('tds', '7.5');
    await settle();
    expect((el.querySelector('input[name="tan"]') as HTMLInputElement).disabled).toBe(false);
    expect(el.textContent).toContain('TDS Deducted (10%)');
    expect(el.textContent).toContain('2,160.00');
  });

  it('requires the options before calling the API', async () => {
    button('Save & proceed to pay').click();
    await settle();
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Error!');
    expect(dialog.textContent).toContain('Please enter required data.');
    http.expectNone('/api/msme/payments/Bronze/checkout');

    button('OK').click();
    await settle();
    expect(el.querySelector('[role="dialog"]')).toBeNull();
  });

  it('asks for the PAN when the GSTIN belongs to another PAN, then checks out', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    choose('unitGstin', 'Yes');
    await settle();
    type('input[name="gstin"]', '09PQRST6789K1Z2');
    choose('tdsDeductible', 'No');
    button('Apply reward').click();
    await settle();

    // 2026-11-17: nothing to pay: the button confirms instead (no gateway).
    expect(el.querySelector('[data-zero-payment]')).not.toBeNull();
    button('CONFIRM (NOTHING TO PAY)').click();
    await settle();
    http.expectOne('/api/msme/payments/gstin').flush({ message: 'ok', panMatches: false, gstinPan: 'PQRST6789K', udyamPan: 'ABCDE1234F' });
    await settle();
    expect(el.textContent).toContain('PAN Mismatch Detected');

    type('#correctedPan', 'pqrst6789k');
    button('Save & Proceed').click();
    await settle();
    const pan = http.expectOne('/api/msme/payments/pan');
    expect(pan.request.body).toEqual({ certification: 'Bronze', gstin: '09PQRST6789K1Z2', pan: 'PQRST6789K' });
    pan.flush({ message: 'ok' });
    await settle();
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain('PAN updated successfully. Proceeding...');

    const checkout = http.expectOne('/api/msme/payments/Bronze/checkout');
    expect(checkout.request.body.gstin).toBe('09PQRST6789K1Z2');
    checkout.flush({ status: 'paid' });
    await settle();
    expect(navigate).toHaveBeenCalled();
  });

  it('goes to the result page when nothing is left to pay', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    choose('unitGstin', 'No');
    choose('tdsDeductible', 'No');
    button('Apply reward').click();
    await settle();

    // 2026-11-17: nothing to pay: the button confirms instead (no gateway).
    expect(el.querySelector('[data-zero-payment]')).not.toBeNull();
    button('CONFIRM (NOTHING TO PAY)').click();
    await settle();
    const req = http.expectOne('/api/msme/payments/Bronze/checkout');
    expect(req.request.body).toEqual({ useReward: true, gstinApplicable: false, gstin: null, tdsDeductible: false, tds: null, tan: null });
    req.flush({ status: 'paid' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/msme/payment/result'], { queryParams: { status: 'success', certification: 'Bronze' } });
  });
});

describe('PaymentStep billing details', () => {
  it('shows the billing details and the way back to the disclaimer', async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentStep],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentStep);
    fixture.componentRef.setInput('certification', 'Silver');
    fixture.componentRef.setInput('billing', { name: 'Pump Enterprise Pvt Ltd', address: 'Pump Engineers, C2, New Delhi 110092', zedId: 'ZEDM000005', unit: 'Pump Enterprise Pvt Ltd · ZEDM000005' });
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    let previous = 0;
    fixture.componentInstance.previous.subscribe(() => previous++);
    fixture.detectChanges();
    http.expectOne('/api/msme/payments/Silver/options').flush({
      certification: 'Silver', withReward: null, rewardAvailable: false, udyamPan: 'ABCDE1234F',
      withoutReward: { Total: 5000, ApplicantContributionAfterSubsidy: 5000, SubsidyLabel: '(80%)' },
    });
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('#billTitle')!.closest('section')!.textContent).toContain('Pump Engineers, C2, New Delhi 110092');
    expect(el.querySelector('.pst-level')!.textContent).toContain('Pump Enterprise Pvt Ltd · ZEDM000005');
    expect(el.querySelector('.payment-reward-block')).toBeNull();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Back to disclaimer')) as HTMLButtonElement).click();
    expect(previous).toBe(1);
    http.verify();
  });
});

describe('PaymentStep without options', () => {
  it('keeps BACK TO DASHBOARD when the fee summary cannot load', async () => {
    await TestBed.configureTestingModule({
      imports: [PaymentStep],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    const fixture = TestBed.createComponent(PaymentStep);
    fixture.componentRef.setInput('certification', 'Bronze');
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    let back = 0;
    fixture.componentInstance.back.subscribe(() => back++);
    fixture.detectChanges();
    http.expectOne('/api/msme/payments/Bronze/options').flush({ title: 'Payment is not available.' }, { status: 400, statusText: 'Bad Request' });
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();

    expect(el.querySelector('[role="dialog"]')!.textContent).toContain('Payment is not available.');
    const backButton = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'BACK TO DASHBOARD') as HTMLButtonElement;
    backButton.click();
    expect(back).toBe(1);
    http.verify();
  });
});
