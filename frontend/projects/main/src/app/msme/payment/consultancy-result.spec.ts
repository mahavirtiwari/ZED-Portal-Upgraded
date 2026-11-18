import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ConsultancyConfirmation } from './consultancy-payment.api';
import { ConsultancyResultPage } from './consultancy-result';

const API = '/api/msme/consultancy-payments';

function confirmation(overrides: Partial<ConsultancyConfirmation> = {}): ConsultancyConfirmation {
  return {
    certification: 'Silver', milestone: 2, amount: 23600, orderId: '200002', transactionId: '114000000077', paidOn: '2026-11-17T09:05:00',
    method: 'Net Banking', receiptUrl: `${API}/Silver/receipt`, invoiceUrl: '/api/msme/files/ReceiptInvoice/HH/2526/12_ZEDMSME000001_Invoice.pdf',
    invoiceNo: 'HH/2526/12', email: 'pledge@acme.test', ...overrides,
  };
}

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('ConsultancyResultPage', () => {
  let fixture: ComponentFixture<ConsultancyResultPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function render(inputs: Record<string, string>) {
    fixture = TestBed.createComponent(ConsultancyResultPage);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    el = fixture.nativeElement;
    await settle(fixture);
  }

  const link = (label: string) => [...el.querySelectorAll('a, button')].find((a) => a.textContent!.trim().includes(label)) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ConsultancyResultPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('names the milestone paid, closes the four steps and shows the payment details', async () => {
    await render({ status: 'success', certification: 'silver', milestone: '2' });
    const req = http.expectOne(`${API}/Silver/confirmation?milestone=2`);
    expect(req.request.method).toBe('GET');
    req.flush(confirmation());
    await settle(fixture);

    expect(el.querySelector('.ph-title')!.textContent).toContain('Payment confirmation');
    expect(el.textContent).toContain('Step 4 of 4: your handholding milestone payment is complete.');
    expect(el.querySelectorAll('.st-done').length).toBe(4);
    const crumbs = [...el.querySelectorAll('.ph-crumb a, .ph-crumb [aria-current]')].map((c) => c.textContent!.trim());
    expect(crumbs).toEqual(['Home', 'Incentives', 'Handholding support', 'Payment']);

    expect(el.textContent).toContain('Payment successful');
    expect(el.textContent).toContain('Milestone 2 : Implementation & Progress Review 1');
    expect(el.textContent).toContain('₹ 23,600.00 received for Silver Handholding support, Milestone 2.');
    const facts = el.querySelector('.pr-facts')!.textContent!;
    expect(facts).toContain('114000000077');
    expect(facts).toContain('200002');
    expect(facts).toContain('17 Nov 2026, 09:05 AM');
    expect(facts).toContain('Net Banking');

    expect(link('Download receipt').getAttribute('href')).toBe(`${API}/Silver/receipt`);
    expect(el.querySelector('a[data-invoice]')!.getAttribute('href')).toBe('/api/msme/files/ReceiptInvoice/HH/2526/12_ZEDMSME000001_Invoice.pdf');
    expect(el.textContent).not.toContain('The tax invoice is issued shortly');

    // The rail: the milestone paid and the way back to Handholding support.
    const rail = el.querySelector('.pr-rail')!.textContent!;
    expect(rail).toContain('Silver Handholding support, Milestone 2');
    expect(rail).toContain('PAYMENT RECEIVED');
    expect(link('Go to Handholding support').getAttribute('href')).toBe('/msme/handholding?level=Silver');
  });

  it('keeps the tax invoice disabled until the ERP has sent it', async () => {
    await render({ status: 'success', certification: 'Gold', milestone: '1' });
    http.expectOne(`${API}/Gold/confirmation?milestone=1`).flush(confirmation({ certification: 'Gold', milestone: 1, invoiceUrl: null, invoiceNo: null }));
    await settle(fixture);

    expect(el.textContent).toContain('ZED Handholding Support Milestone 1: Baseline Diagnostic Study and Handholding Action Plan');
    const invoice = el.querySelector('button[data-invoice]') as HTMLButtonElement;
    expect(invoice.disabled).toBe(true);
    expect(el.querySelector('#invoiceNote')!.textContent).toBe('The tax invoice is issued shortly; it will be in My Documents.');
    expect(invoice.getAttribute('aria-describedby')).toBe('invoiceNote');
  });

  it('e-mails a copy to the registered address and shows where it went', async () => {
    await render({ status: 'success', certification: 'Silver', milestone: '2' });
    http.expectOne(`${API}/Silver/confirmation?milestone=2`).flush(confirmation());
    await settle(fixture);
    expect(el.textContent).toContain('A confirmation has been sent to your registered e-mail.');

    link('E-mail a copy').click();
    await settle(fixture);
    const req = http.expectOne(`${API}/Silver/email-copy?milestone=2`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({});
    req.flush({ sentTo: 'pledge@acme.test' });
    await settle(fixture);
    expect(el.querySelector('.pr-sent')!.textContent).toContain('Sent to pledge@acme.test');

    link('E-mail a copy').click();
    await settle(fixture);
    http.expectOne(`${API}/Silver/email-copy?milestone=2`).flush({ title: 'Too many requests. Please try again later.' }, { status: 429, statusText: 'Too Many Requests' });
    await settle(fixture);
    expect(el.querySelector('.pr-err')).not.toBeNull();
  });

  it('still shows the success when the details cannot be read, without the actions', async () => {
    await render({ status: 'success', certification: 'Silver', milestone: '9' });
    http.expectOne(`${API}/Silver/confirmation`).flush(null, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el.textContent).toContain('Payment successful');
    expect(el.textContent).toContain('Your payment is successful.');
    expect(el.querySelector('[data-invoice]')).toBeNull();
    expect(el.textContent).not.toContain('E-mail a copy');
  });

  it('shows the failure with the message as text, Try again and the way back', async () => {
    await render({ status: 'failure', certification: 'Silver', milestone: '2', message: '<b>Cancelled</b>' });
    http.expectNone(() => true);
    expect(el.querySelector('.ph-title')!.textContent).toContain('Payment failed');
    expect(el.textContent).toContain('Step 3 of 4: the payment did not go through.');
    expect(el.querySelector('.pr-state h2')!.textContent).toContain('Payment failed');
    expect(el.textContent).toContain('<b>Cancelled</b>');
    expect(el.querySelector('.pr-msg span b')).toBeNull();
    expect(link('Try again').getAttribute('href')).toBe('/msme/handholding/Silver/payment');
    expect(link('Back to dashboard').getAttribute('href')).toBe('/msme/dashboard');
    expect(link('Contact helpdesk').getAttribute('href')).toBe('/msme/contact');
    expect(el.querySelector('.pr-rail')).toBeNull();
  });
});
