import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MyInvoices } from './expenditure.api';
import { MyInvoicesPage } from './my-invoices';

const data = (): MyInvoices => ({
  partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', kind: 'Agency',
  months: [
    { month: '2026-10', label: 'Oct 2026', completed: 41, rejected: 3, surveillance: 14, milestones: 0, cases: 58, amount: 420000, gstPercent: 18, total: 495600,
      invoice: null, canUpload: true },
    { month: '2026-08', label: 'Aug 2026', completed: 40, rejected: 0, surveillance: 14, milestones: 0, cases: 54, amount: 390000, gstPercent: 18, total: 460200,
      invoice: {
        id: 3, partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', month: '2026-08', monthLabel: 'Aug 2026', invoiceNo: 'MA/26-27/017', invoiceDate: '2026-09-03',
        invoiceAmount: 460200, portalCompleted: 40, portalRejected: 0, portalSurveillance: 14, portalMilestones: 0, portalCases: 54, portalAmount: 390000,
        gstPercent: 18, portalTotal: 460200, difference: 0, status: 'Returned', remarks: 'Wrong GSTIN', submittedOn: null, reviewedBy: null, reviewedOn: null,
        erpExport: null, canReview: false,
      }, canUpload: true },
  ],
});

describe('MyInvoicesPage', () => {
  let fixture: ComponentFixture<MyInvoicesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MyInvoicesPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(MyInvoicesPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/expenditure/my').flush(data());
    await settle();
  });

  afterEach(() => http.verify());

  it("lists the months with the portal's figures and the returned invoice's remarks", () => {
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows[0].textContent).toContain('₹ 4,95,600');
    expect(rows[0].textContent).toContain('41 completed · 3 rejected · 14 surveillance');
    expect(rows[1].textContent).toContain('Wrong GSTIN');
    expect(button('Upload again', rows[1])).toBeTruthy();
  });

  it('uploads the invoice PDF with its number, date and amount', async () => {
    button('+ Upload invoice')!.click();
    await settle();
    const form = el.querySelector('form')!;
    const set = (name: string, value: string) => {
      const i = form.querySelector(`input[name="${name}"]`) as HTMLInputElement;
      i.value = value;
      i.dispatchEvent(new Event('input'));
    };
    set('invoiceNo', 'MA/26-27/031');
    set('invoiceDate', '2026-11-05');
    set('amount', '495600');
    form.dispatchEvent(new Event('submit'));
    await settle();
    expect(form.textContent).toContain('Please choose the invoice PDF.');

    const file = new File(['%PDF-1.4 %%EOF'], 'invoice.pdf', { type: 'application/pdf' });
    const input = form.querySelector('input[type="file"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new Event('change'));
    form.dispatchEvent(new Event('submit'));
    await settle();
    const req = http.expectOne({ method: 'POST', url: '/api/staff/expenditure/my/invoices' });
    const body = req.request.body as FormData;
    expect([body.get('month'), body.get('invoiceNo'), body.get('invoiceDate'), body.get('invoiceAmount')]).toEqual(['2026-10', 'MA/26-27/031', '2026-11-05', '495600']);
    expect((body.get('file') as File).name).toBe('invoice.pdf');
    req.flush({ message: 'Invoice for Oct 2026 submitted.' });
    await settle();
    http.expectOne('/api/staff/expenditure/my').flush(data());
    await settle();
    expect(el.querySelector('form')).toBeNull();
  });
});
