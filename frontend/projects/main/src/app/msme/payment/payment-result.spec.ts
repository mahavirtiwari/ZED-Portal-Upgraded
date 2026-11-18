import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { PaymentResultPage } from './payment-result';

describe('PaymentResultPage (2026-11-17 confirmation design)', () => {
  let fixture: ComponentFixture<PaymentResultPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(query: Record<string, string>) {
    await TestBed.configureTestingModule({
      imports: [PaymentResultPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(PaymentResultPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    for (const [k, v] of Object.entries(query)) fixture.componentRef.setInput(k, v);
    await settle();
  }

  const confirmation = (more: object = {}) => ({
    certification: 'Silver', amount: 5000, orderId: 'ZED-SLV-2026-000123', transactionId: 'TXN26111706250042', paidOn: '2026-11-17T06:25:00',
    method: 'UPI', receiptUrl: '/api/msme/payments/Silver/receipt', invoiceUrl: null, invoiceNo: null, email: 'kavita@gmail.com', ...more,
  });
  const button = (label: string) => [...el.querySelectorAll('button, a')].find((b) => b.textContent!.includes(label)) as HTMLElement;

  afterEach(() => http.verify());

  it('shows the paid amount, IDs, receipt, the pending invoice note, what happens next and the application card', async () => {
    await render({ status: 'success', certification: 'Silver' });
    http.expectOne('/api/msme/payments/Silver/confirmation').flush(confirmation());
    await settle();

    expect(el.querySelector('.ph-title')!.textContent).toBe('Payment confirmation');
    expect(el.querySelector('.ph-sub')!.textContent).toBe('Step 4 of 4: your Silver application has been created.');
    expect(el.querySelectorAll('.st-done').length).toBe(4);
    expect(el.textContent).toContain('₹ 5,000.00 received for Silver Certification.');
    const facts = el.querySelector('.pr-facts')!.textContent!;
    for (const t of ['TXN26111706250042', 'ZED-SLV-2026-000123', '17 Nov 2026, 06:25 AM', 'UPI']) expect(facts).toContain(t);
    expect(button('Download receipt').getAttribute('href')).toBe('/api/msme/payments/Silver/receipt');
    // No invoice yet: the button is disabled with the note.
    expect((el.querySelector('[data-invoice]') as HTMLButtonElement).disabled).toBe(true);
    expect(el.textContent).toContain('The tax invoice is issued shortly; it will be in My Documents.');
    // What happens next: the app, basic information, desktop verification, the site visit of Silver.
    expect([...el.querySelectorAll('.pr-next b')].map((b) => b.textContent)).toEqual([
      'Download the ZED MSME mobile app', 'Fill Basic Information and upload documents', 'Desktop verification', 'Site visit and certification',
    ]);
    expect(el.querySelector('.pr-rail')!.textContent).toContain('Application created');
    expect(button('Go to my Silver application').getAttribute('href')).toBe('/msme/certification/Silver');
  });

  it('offers the tax invoice once issued and e-mails a copy to the registered e-mail', async () => {
    await render({ status: 'success', certification: 'Silver' });
    http.expectOne('/api/msme/payments/Silver/confirmation').flush(confirmation({ invoiceUrl: '/api/msme/files/ReceiptInvoice/ZED/2526/41_Z_Invoice.pdf' }));
    await settle();
    expect(button('Download tax invoice').getAttribute('href')).toBe('/api/msme/files/ReceiptInvoice/ZED/2526/41_Z_Invoice.pdf');
    expect(el.textContent).not.toContain('The tax invoice is issued shortly');

    button('E-mail a copy').click();
    await settle();
    const req = http.expectOne('/api/msme/payments/Silver/email-copy');
    expect(req.request.method).toBe('POST');
    req.flush({ sentTo: 'kavita@gmail.com' });
    await settle();
    expect(el.querySelector('.pr-sent')!.textContent).toBe('Sent to kavita@gmail.com');
  });

  it('uses the surveillance endpoints and hides the certification steps', async () => {
    await render({ status: 'success', certification: 'Gold', kind: 'surveillance' });
    http.expectOne('/api/msme/surveillance-payments/Gold/confirmation').flush(confirmation({ certification: 'Gold', receiptUrl: null }));
    await settle();
    expect(el.querySelector('.pr-next')).toBeNull();
    expect(button('Download receipt')).toBeUndefined();
    expect(button('Go to my Gold surveillance').getAttribute('href')).toBe('/msme/certification/GoldSurveillance');
  });

  it('pending: one action to check the status (shown as paid once recorded) and the helpdesk', async () => {
    await render({ status: 'pending', certification: 'Silver' });
    expect(el.querySelector('.ph-title')!.textContent).toBe('Payment pending');
    expect(el.textContent).toContain('Please do not pay again.');
    expect(button('Contact helpdesk').getAttribute('href')).toBe('/msme/contact');

    button('Check status').click();
    await settle();
    http.expectOne('/api/msme/payments/Silver/confirmation').flush({ title: 'Not found' }, { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.textContent).toContain('Not confirmed yet. Please check again in a few minutes.');

    button('Check status').click();
    await settle();
    http.expectOne('/api/msme/payments/Silver/confirmation').flush(confirmation());
    await settle();
    expect(el.querySelector('.ph-title')!.textContent).toBe('Payment confirmation');
    expect(el.textContent).toContain('TXN26111706250042');
  });

  it('failed: Try again opens the apply flow of the level', async () => {
    await render({ status: 'failure', certification: 'Silver', message: 'Card declined' });
    expect(el.querySelector('.ph-title')!.textContent).toBe('Payment failed');
    expect(el.textContent).toContain('Card declined');
    expect(button('Try again').getAttribute('href')).toBe('/msme/dashboard?apply=Silver');
    expect(button('Contact helpdesk').getAttribute('href')).toBe('/msme/contact');
  });
});
