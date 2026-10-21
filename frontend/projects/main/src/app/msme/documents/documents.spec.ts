import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DocumentsPage } from './documents';
import { MyDocuments } from './documents.api';

describe('DocumentsPage', () => {
  let fixture: ComponentFixture<DocumentsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const rows = () =>
    [...el.querySelectorAll('.alert-document')].map((d) => ({
      text: d.querySelector('p')!.textContent!.replace(/\s+/g, ' ').trim(),
      href: d.querySelector('a')?.getAttribute('href') ?? null,
      target: d.querySelector('a')?.getAttribute('target') ?? null,
    }));

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DocumentsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(DocumentsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => http.verify());

  it('lists guidelines, the highest certificate and invoices with links to the files API', async () => {
    const docs: MyDocuments = {
      Guidelines: [
        { DocumentName: 'ZED Guidelines', DocumentPath: '/api/msme/files/Uploads/Documents/Guide.pdf' },
        { DocumentName: 'Checklist', DocumentPath: '/api/msme/files/Uploads/Documents/Checklist.docx' },
      ],
      Certificates: [
        {
          Pledge: '/api/msme/files/Certificates/ZEDMSME000001/Pledge.pdf',
          Bronze: '/api/msme/files/Certificates/DA/ZEDMSME000001/Bronze.pdf',
          Silver: '/api/msme/files/Certificates/SA/ZEDMSME000001/Silver.pdf',
          Gold: null,
          Wash: 'https://msmekawach.org.in/Certificates/DA/K1/Bronze.pdf',
          Webinar: null,
        },
      ],
      Invoices: [
        { TadaInvoiceNo: 'I1', InvoicePath: '/api/msme/files/ReceiptInvoice/I1_ZEDMSME000001_Invoice.pdf', DocumentType: 'Invoice', ModuleName: 'HANDHOLDING', Certification: 'Silver', SubModuleName: null, MileStoneNo: '2' },
        { TadaInvoiceNo: 'I2', InvoicePath: null, DocumentType: 'Receipt', ModuleName: 'ZED', Certification: 'Bronze', SubModuleName: 'Assessment', MileStoneNo: null },
      ],
    };
    http.expectOne('/api/msme/documents').flush(docs);
    await settle();

    expect(el.querySelector('.loadingdiv')).toBeNull();
    expect(rows()).toEqual([
      { text: 'ZED Guidelines', href: '/api/msme/files/Uploads/Documents/Guide.pdf', target: '_blank' },
      { text: 'Checklist', href: '/api/msme/files/Uploads/Documents/Checklist.docx', target: null },
      { text: 'Pledge Certificate', href: '/api/msme/files/Certificates/ZEDMSME000001/Pledge.pdf', target: '_blank' },
      { text: 'Silver Certificate', href: '/api/msme/files/Certificates/SA/ZEDMSME000001/Silver.pdf', target: '_blank' },
      { text: 'WASH Certificate', href: 'https://msmekawach.org.in/Certificates/DA/K1/Bronze.pdf', target: '_blank' },
      { text: 'HANDHOLDING - Silver milestone 2 Invoice', href: '/api/msme/files/ReceiptInvoice/I1_ZEDMSME000001_Invoice.pdf', target: '_blank' },
      { text: 'ZED - Bronze Assessment Receipt', href: null, target: null },
    ]);
  });

  it('still shows the pledge row, without a link, when nothing is available', async () => {
    http.expectOne('/api/msme/documents').flush({ Guidelines: [], Certificates: [], Invoices: [] });
    await settle();

    expect(rows()).toEqual([{ text: 'Pledge Certificate', href: null, target: null }]);
    expect(el.textContent).not.toContain('Guidelines');
    expect(el.textContent).not.toContain('Invoices and Receipts');
  });

  it('shows the API error', async () => {
    http.expectOne('/api/msme/documents').flush({ title: 'Something failed' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Something failed');
  });
});
