import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { FinancialAssistancePage } from './financial-assistance';
import { FaPage } from './schemes.api';

describe('FinancialAssistancePage', () => {
  let fixture: ComponentFixture<FinancialAssistancePage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const unit = { ZedId: 'ZEDMSME000001', EnterpriseName: 'Acme Castings', EnterpriseType: 'Micro', UdyogAadharNo: 'UDYAM-UP-29-0003915', PUnitName: 'Unit 1' };
  const open: FaPage = { unit, canApply: true, message: null, certification: 'Silver', applications: [] };

  function click(selector: string) {
    (el.querySelector(selector) as HTMLElement).click();
  }

  function buttons(text: string): HTMLButtonElement[] {
    return [...el.querySelectorAll('button')].filter((b) => b.textContent!.trim() === text) as HTMLButtonElement[];
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [FinancialAssistancePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(FinancialAssistancePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => http.verify());

  it('shows the own applications and the reason when the MSME cannot apply', async () => {
    http.expectOne('/api/msme/schemes/fa').flush({
      ...open,
      canApply: false,
      message: 'Data already submitted.',
      applications: [{
        certification: 'Silver',
        details: { NameOfCertficate: 'ISO 9001', AmountPaid: '40000', EligibleAmount: '30000', AccountNo: '123456789012', VerificationStatus: 2 },
        documents: [{ fileName: 'a.pdf', type: 'Copy of Certificate', timeStamp: null, isPdf: true, url: '/api/msme/schemes/fa/files/a.pdf' }],
      }],
    } satisfies FaPage);
    await settle();

    expect(el.querySelector('#faMessage')!.textContent).toContain('Data already submitted.');
    expect(el.textContent).toContain('ISO 9001');
    expect(el.textContent).toContain('Rs.30000');
    expect(el.textContent).toContain('Under verification');
    expect(el.querySelector('a[href="/api/msme/schemes/fa/files/a.pdf"]')).not.toBeNull();
    expect(el.textContent).not.toContain('DISCLAIMER');
  });

  it('walks through disclaimer, instructions and unit confirmation to the form', async () => {
    http.expectOne('/api/msme/schemes/fa').flush(open);
    await settle();

    expect(el.textContent).toContain('DISCLAIMER');
    buttons('ACCEPT & PROCEED')[0].click();
    await settle();
    expect(el.textContent).toContain('Instructions');
    buttons('ACCEPT & PROCEED')[0].click();
    await settle();

    expect(el.textContent).toContain('UDYAM-UP-29-0003915');
    expect((el.querySelector('#faConfirmProceed') as HTMLButtonElement).disabled).toBe(true);
    click('#faConfirm');
    await settle();
    click('#faConfirmProceed');
    await settle();
    expect(el.querySelector('#faForm')).not.toBeNull();
    expect(el.textContent).toContain('Certification Details (Silver)');
  });

  it('checks the form in the browser, uploads documents and submits them by name', async () => {
    http.expectOne('/api/msme/schemes/fa').flush(open);
    await settle();
    const page = fixture.componentInstance as unknown as {
      go(s: number | string): void;
      form: Record<string, unknown> & { account: Record<string, string> };
      upload(type: string, file: File): Promise<void>;
    };
    page.go(4);
    await settle();

    (el.querySelector('#faForm') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.textContent).toContain('Please enter required data.');

    Object.assign(page.form, {
      categoryOfCertificate: 'Quality', nameOfCertficate: 'ISO 9001', certificationAgency: 'BIS', certficateNumber: 'C-1',
      dateOfIssue: '2024-01-01', validityOfCertificate: 3, invoiceNo: 'I-1', invoiceBillDate: '2024-01-02', amountPaid: 100000,
      modeOfPayment: 'Online', declaration: true,
    });
    Object.assign(page.form.account, { accountNo: '123456789012', confirmAccountNo: '123456789012', ifscCode: 'SBIN0001234', branchAddress: 'MG Road', bankName: 'SBI' });

    const types = ['Copy of Certificate', 'CA certificate of expenditure', 'Copy of Invoice', 'Copy of Cancelled Cheque'];
    for (const [i, t] of types.entries()) {
      const pending = page.upload(t, new File(['%PDF-1.4'], `d${i}.pdf`, { type: 'application/pdf' }));
      const req = http.expectOne('/api/msme/schemes/fa/documents');
      expect((req.request.body as FormData).get('type')).toBe(t);
      req.flush({ fileName: `2024010110000000${i}aaaaaaaa.pdf`, type: t, timeStamp: null, isPdf: true, url: `/api/msme/schemes/fa/files/f${i}.pdf` });
      await pending;
    }
    await settle();

    (el.querySelector('#faForm') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('#faSummary')!.textContent).toContain('50,000.00');

    click('#faSubmit');
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/msme/schemes/fa');
    expect(req.request.body.documents.map((d: { type: string }) => d.type)).toEqual(types);
    expect(req.request.body.amountPaid).toBe(100000);
    expect(req.request.body.eligibleAmount).toBeUndefined();
    req.flush({ message: 'ok', amountPaid: 100000, eligibleAmount: 50000 });
    await settle();
    expect(el.querySelector('#faDone')!.textContent).toContain('submitted successfully');
  });

  it('refuses a large or non-document file before uploading', async () => {
    http.expectOne('/api/msme/schemes/fa').flush(open);
    await settle();
    const page = fixture.componentInstance as unknown as { upload(type: string, file: File): Promise<void> };
    await page.upload('Copy of Invoice', new File(['x'], 'run.exe', { type: 'application/x-msdownload' }));
    await settle();
    expect(el.textContent).toContain('Please upload valid document');
    http.expectNone('/api/msme/schemes/fa/documents');
  });
});
