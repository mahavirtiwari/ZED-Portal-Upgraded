import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { NeftTransactionsPage } from './neft-transactions';

describe('NeftTransactionsPage', () => {
  let fixture: ComponentFixture<NeftTransactionsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const tx = (id: number, extra: Record<string, unknown> = {}) => ({
    TransactionId: id, ZedId: `ZEDMSME0000${id}`, PUnitName: `Unit ${id}`, CategoryOfCertificate: 'Quality', AmountPaid: '50000',
    AccountNo: '123456789012', IfscCode: 'SBIN0001234', BranchAddress: 'MG Road', ApproverReferenceNo: null, ApproverAmount: null,
    ApproverDateOfReceiptOfPayment: null, Comments: null, ...extra,
  });

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;

  async function type(selector: string, value: string) {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function create(list: string) {
    await TestBed.configureTestingModule({
      imports: [NeftTransactionsPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ActivatedRoute, useValue: { snapshot: { data: { list } } } }],
    }).compileComponents();
    fixture = TestBed.createComponent(NeftTransactionsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  it('lists new transactions and approves one with the payment details', async () => {
    await create('new');
    const req = http.expectOne((r) => r.url === '/api/staff/neft/transactions');
    expect(req.request.params.get('list')).toBe('new');
    req.flush({ transactions: [tx(11), tx(12)] });
    await settle();

    expect(el.querySelector('h3')!.textContent).toContain('New Transactions');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);

    (el.querySelectorAll('tbody tr button')[0] as HTMLButtonElement).click();
    await settle();
    expect((el.querySelector('#neftZedId') as HTMLInputElement).value).toBe('ZEDMSME000011');

    // Required fields are checked before calling the API.
    button('SUBMIT')!.click();
    await settle();
    http.expectNone('/api/staff/neft/transactions/11/approve');
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please enter all the required details.');

    await type('#neftDate', '2026-01-05');
    await type('#neftRef', ' UTR123 ');
    await type('#neftAmount', '40000');
    button('SUBMIT')!.click();
    await settle();

    const approve = http.expectOne('/api/staff/neft/transactions/11/approve');
    expect(approve.request.method).toBe('POST');
    expect(approve.request.body).toEqual({ zedId: 'ZEDMSME000011', dateOfReceiptOfPayment: '2026-01-05', referenceNo: 'UTR123', amount: '40000' });
    approve.flush({ message: 'Transaction Approved.' });
    await settle();

    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Transaction Approved.');
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('keeps the dialog open with the API message when the approval is refused', async () => {
    await create('new');
    http.expectOne((r) => r.url === '/api/staff/neft/transactions').flush({ transactions: [tx(11)] });
    await settle();
    (el.querySelector('tbody tr button') as HTMLButtonElement).click();
    await settle();
    await type('#neftDate', '2026-01-05');
    await type('#neftRef', 'UTR1');
    await type('#neftAmount', '90000');
    button('SUBMIT')!.click();
    await settle();
    http.expectOne('/api/staff/neft/transactions/11/approve')
      .flush({ title: 'The amount cannot be more than the amount paid by the unit (Rs. 50000).' }, { status: 400, statusText: 'Bad Request' });
    await settle();

    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('amount paid by the unit');
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('shows approved transactions with the approver details and no actions', async () => {
    await create('approved');
    const req = http.expectOne((r) => r.url === '/api/staff/neft/transactions');
    expect(req.request.params.get('list')).toBe('approved');
    req.flush({ transactions: [tx(14, { ApproverReferenceNo: 'UTR9', ApproverAmount: 40000, ApproverDateOfReceiptOfPayment: '05 Jan 2026' })] });
    await settle();

    expect(el.querySelector('h3')!.textContent).toContain('Approved Transactions');
    expect(el.querySelector('tbody')!.textContent).toContain('UTR9');
    expect(button('Approve')).toBeUndefined();
  });

  it('shows rejected transactions with the columns of the old Rejected Transaction page', async () => {
    await create('rejected');
    http.expectOne((r) => r.url === '/api/staff/neft/transactions').flush({
      transactions: [tx(15, {
        EnterpriseName: 'Acme', UdyogAadharNo: 'UDYAM-UP-01', TotalEmp: 12, Gender: 'Male', SocialCategoryName: 'General', IsCouponUsed: true,
        GstinNumber: '09ABCDE1234F1Z5', TanNumber: 'DELA12345B', UtrNumber: 'UTR42', Comments: 'Bank details mismatch',
      })],
    });
    await settle();
    expect([...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual([
      'ZED ID', 'EnterpriseName', 'UAM/ Udyam Number', 'TotalEmp', 'Gender and Social category', 'Coupon', 'GSTIN/ TAN Number', 'Amount Paid',
      'UTR Number', 'Reason for Rejection',
    ]);
    const cells = [...el.querySelectorAll('tbody td')].map((td) => td.textContent!.replace(/\s+/g, ' ').trim());
    expect(cells).toEqual([
      'ZEDMSME000015', 'Acme', 'UDYAM-UP-01', '12', 'MaleGeneral', 'Yes', '09ABCDE1234F1Z5 DELA12345B', '50000', 'UTR42', 'Bank details mismatch',
    ]);
    expect(button('Approve')).toBeUndefined();
  });

  it('shows "No Data" and API errors', async () => {
    await create('rejected');
    http.expectOne((r) => r.url === '/api/staff/neft/transactions').flush({ title: 'Failed' }, { status: 500, statusText: 'Error' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Failed');
    expect(el.querySelector('.no-data')).not.toBeNull();
  });
});
