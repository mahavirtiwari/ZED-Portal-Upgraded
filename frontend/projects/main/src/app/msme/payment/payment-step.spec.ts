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
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(label)) as HTMLButtonElement;

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
    button('APPLY REWARD').click();
    await settle();
    expect(el.textContent).toContain('Reward Applied');
    expect(el.textContent).toContain('1,800.00');

    button('REMOVE').click();
    choose('tdsDeductible', 'Yes');
    await settle();
    choose('tds', '7.5');
    await settle();
    expect(el.textContent).toContain('TDS Deducted (10%)');
    expect(el.textContent).toContain('2,160.00');
  });

  it('requires the options before calling the API', async () => {
    button('PROCEED TO PAY').click();
    await settle();
    expect(el.textContent).toContain('Please enter required data.');
    http.expectNone('/api/msme/payments/Bronze/checkout');
  });

  it('asks for the PAN when the GSTIN belongs to another PAN, then checks out', async () => {
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    choose('unitGstin', 'Yes');
    await settle();
    type('input[name="gstin"]', '09PQRST6789K1Z2');
    choose('tdsDeductible', 'No');
    button('APPLY REWARD').click();
    await settle();

    button('PROCEED TO PAY').click();
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
    button('APPLY REWARD').click();
    await settle();

    button('PROCEED TO PAY').click();
    await settle();
    const req = http.expectOne('/api/msme/payments/Bronze/checkout');
    expect(req.request.body).toEqual({ useReward: true, gstinApplicable: false, gstin: null, tdsDeductible: false, tds: null, tan: null });
    req.flush({ status: 'paid' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/msme/payment/result'], { queryParams: { status: 'success', certification: 'Bronze' } });
  });
});
