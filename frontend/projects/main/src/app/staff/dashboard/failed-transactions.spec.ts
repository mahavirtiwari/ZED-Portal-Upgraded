import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { FailedTransactionsPage } from './failed-transactions';

describe('FailedTransactionsPage', () => {
  let fixture: ComponentFixture<FailedTransactionsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const base = {
    RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Silver', TransactionDate: 'Mar 4 2026', PUnitName: 'Acme',
    TransactionId: 'TX1', IsCouponUsed: 0, UseCoupon: 'No', AllowManualUpdate: 1, Gstin: null, PanNo: 'ABCDE1234F',
  };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FailedTransactionsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(FailedTransactionsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne((r) => r.url === '/api/staff/dashboard/failed-transactions').flush([
      base,
      { ...base, RowNumber: 2, ZedId: 'ZEDMSME000002', TransactionId: 'TX2', IsCouponUsed: 1, UseCoupon: 'Yes' },
      { ...base, RowNumber: 3, ZedId: 'ZEDMSME000003', TransactionId: 'TX3', AllowManualUpdate: 0 },
    ]);
    await settle();
  });

  afterEach(() => http.verify());

  it('offers the update only where the old page did', () => {
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(3);
    expect(rows.map((r) => !!r.querySelector('button'))).toEqual([true, false, false]);
  });

  it('validates the pop-up and posts the payment details', async () => {
    (el.querySelector('tbody tr button') as HTMLButtonElement).click();
    await settle();
    expect((el.querySelector('#panNo') as HTMLInputElement).value).toBe('ABCDE1234F');
    const submit = el.querySelector('.modal button[type="submit"]') as HTMLButtonElement;

    type('#pgType', 'Unified Payments');
    type('#trackingId', '12345');
    type('#bankRefNumber', 'BR1');
    type('#paymentReceivedDate', '2026-03-04');
    type('#paymentRemarks', 'Bank confirmed');
    await settle();
    expect(el.textContent).toContain('Must be exactly 12 numeric digits.');
    expect(submit.disabled).toBe(true);

    type('#trackingId', '123456789012');
    type('#gstin', '22AAAAA0000A1Z5');
    await settle();
    expect(submit.disabled).toBe(false);
    submit.click();
    await settle();

    const req = http.expectOne('/api/staff/dashboard/failed-transactions/update-payment');
    expect(req.request.body).toEqual({
      zedId: 'ZEDMSME000001', transactionId: 'TX1', certification: 'Silver', pgType: 'Unified Payments', trackingId: '123456789012',
      bankRefNumber: 'BR1', bankCode: '', paymentReceivedDate: '2026-03-04', gstNumber: '22AAAAA0000A1Z5', paymentRemarks: 'Bank confirmed',
    });
    req.flush({ message: 'Payment status updated.' });
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('tbody tr')!.textContent).toContain('SUCCESS');
  });

  it('keeps the pop-up open with the API message on failure', async () => {
    (el.querySelector('tbody tr button') as HTMLButtonElement).click();
    await settle();
    type('#pgType', 'Debit Card');
    type('#trackingId', '123456789012');
    type('#bankRefNumber', 'BR1');
    type('#paymentReceivedDate', '2026-03-04');
    type('#paymentRemarks', 'x');
    await settle();
    (el.querySelector('.modal button[type="submit"]') as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/staff/dashboard/failed-transactions/update-payment')
      .flush({ title: 'The payment status of this transaction cannot be updated.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.modal')!.textContent).toContain('cannot be updated');
  });
});
