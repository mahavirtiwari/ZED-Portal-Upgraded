import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TableExport } from '../table-export';
import { ExpenditureSummary, Invoice, MyInvoices, PoView, TaxDetails } from './expenditure.api';
import { MyInvoicesPage, monthRange } from './my-invoices';

const tax = (submitted: boolean): TaxDetails => submitted
  ? { available: true, submitted: true, gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', hasGstFile: true, hasPanFile: true, submittedOn: '2026-11-18T05:00:00',
      submittedBy: 'ZEDAA0080', suggestedGstin: null }
  : { available: true, submitted: false, gstin: null, pan: null, hasGstFile: false, hasPanFile: false, submittedOn: null, submittedBy: null,
      suggestedGstin: '27AAPFU0939F1ZV' };

const returned: Invoice = {
  id: 3, partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', month: '2026-08', monthLabel: 'Aug 2026', invoiceNo: 'MA/26-27/017', invoiceDate: '2026-09-03',
  invoiceAmount: 460200, portalCompleted: 40, portalRejected: 0, portalSurveillance: 14, portalMilestones: 0, portalCases: 54, portalAmount: 390000,
  gstPercent: 18, portalTotal: 460200, difference: 0, status: 'Returned', remarks: 'Wrong amount', submittedOn: null, reviewedBy: null, reviewedOn: null,
  erpExport: null, canReview: false,
};

const my = (submitted = true): MyInvoices => ({
  partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', kind: 'Agency', tax: tax(submitted),
  months: [
    { month: '2026-11', label: 'Nov 2026', completed: 2, rejected: 0, surveillance: 0, milestones: 0, cases: 2, amount: 6000, gstPercent: 18, gstAmount: 1080,
      total: 7080, invoice: null, ended: false, canUpload: false },
    { month: '2026-10', label: 'Oct 2026', completed: 41, rejected: 3, surveillance: 14, milestones: 0, cases: 58, amount: 420000, gstPercent: 18, gstAmount: 75600,
      total: 495600, invoice: null, ended: true, canUpload: true },
    { month: '2026-08', label: 'Aug 2026', completed: 40, rejected: 0, surveillance: 14, milestones: 0, cases: 54, amount: 390000, gstPercent: 18, gstAmount: 70200,
      total: 460200, invoice: returned, ended: true, canUpload: true },
  ],
});

const summary = (): ExpenditureSummary => ({
  kind: 'Agency', parties: [{ code: 'ZEDAA0080', name: 'Mahavir Agency' }], levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Gold', name: 'Gold' }], states: [],
  cards: { poCases: 540, completed: 336, rejected: 16, surveillance: 36, milestones: 0, payable: 4160000, approved: 2820000, invoiced: 3000000, outstanding: 1160000 },
  rows: [
    { partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', level: 'Bronze', levelName: 'Bronze', poLabel: 'QCI/ZED/PO/2026/114', poCases: 500, completed: 300,
      rejected: 12, surveillance: 31, milestones: 0, used: 312, inProgress: 0, balance: 188, poState: 'Open', payable: 980000, invoiced: 720000, outstanding: 260000 },
    { partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', level: 'Gold', levelName: 'Gold', poLabel: 'QCI/ZED/PO/2026/116', poCases: 40, completed: 36,
      rejected: 4, surveillance: 5, milestones: 0, used: 40, inProgress: 0, balance: 0, poState: 'Stopped', payable: 950000, invoiced: 480000, outstanding: 470000 },
  ],
});

const po = (): PoView => ({
  partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', canEdit: false, levelOptions: [],
  levels: [
    { level: 'Bronze', name: 'Bronze', cases: 500, used: 300, inProgress: 12, left: 188, percent: 62, state: 'Open', pos: [{ id: 1, poNumber: 'QCI/ZED/PO/2026/114', poDate: '2026-04-02', cases: 500 }] },
    { level: 'Silver', name: 'Silver', cases: 120, used: 106, inProgress: 5, left: 9, percent: 93, state: 'Low', pos: [{ id: 2, poNumber: 'QCI/ZED/PO/2026/115', poDate: '2026-04-02', cases: 120 }] },
    { level: 'Gold', name: 'Gold', cases: 40, used: 36, inProgress: 4, left: 0, percent: 100, state: 'Stopped', pos: [{ id: 3, poNumber: 'QCI/ZED/PO/2026/116', poDate: '2026-04-02', cases: 40 }] },
  ],
});

describe('MyInvoicesPage (the agency\'s Expenditure page)', () => {
  let fixture: ComponentFixture<MyInvoicesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let sheets: { name: string; columns: string[]; rows: unknown[][] }[][];
  let files: string[];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (label: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;
  const section = (title: string) =>
    [...el.querySelectorAll('section')].find((s) => s.querySelector('h2')?.textContent?.trim().startsWith(title)) as HTMLElement;

  async function flushLoad(data = my()) {
    http.expectOne('/api/staff/expenditure/my').flush(data);
    await settle();
    http.expectOne((r) => r.url === '/api/staff/expenditure/summary').flush(summary());
    http.expectOne((r) => r.url === '/api/staff/expenditure/po' && r.params.get('partyId') === 'ZEDAA0080').flush(po());
    await settle();
  }

  async function create(data = my()) {
    sheets = [];
    files = [];
    await TestBed.configureTestingModule({
      imports: [MyInvoicesPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: TableExport, useValue: { xlsx: (name: string, s: never[]) => { files.push(name); sheets.push(s); return Promise.resolve(); } } }],
    }).compileComponents();
    fixture = TestBed.createComponent(MyInvoicesPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    await flushLoad(data);
  }

  afterEach(() => http.verify());

  it('shows its performance: the headline cards, its POs (read-only) and a row per level', async () => {
    await create();
    const cards = el.querySelector('zed-list-counts')!.textContent!;
    for (const t of ['Cases in POs', '540', 'Completed', '336', 'Rejected after assessment', 'Surveillance visits', 'Payable', '₹ 41.6 L', 'Invoiced', '₹ 30.0 L',
      'Approved', '₹ 28.2 L', 'Outstanding', '₹ 11.6 L']) expect(cards).toContain(t);

    const pos = [...section('Purchase orders').querySelectorAll('tbody tr')];
    expect(pos.length).toBe(3);
    expect(pos[0].textContent).toContain('QCI/ZED/PO/2026/114');
    expect(pos[0].textContent).toContain('02 Apr 2026');
    expect(pos[0].textContent).toContain('+12 in progress');
    expect(pos[0].textContent).toContain('62%');
    expect(pos[0].querySelector('.status-badge')!.textContent!.trim()).toBe('Open');
    expect(pos[1].querySelector('.status-badge')!.textContent!.trim()).toBe('9 left');
    expect(pos[2].querySelector('.status-badge')!.textContent!.trim()).toBe('Stopped');
    // Read-only: no PO action for the agency.
    for (const label of ['+ Add PO', 'Edit', 'Reopen', 'History']) expect(button(label)).toBeUndefined();

    const levels = [...section('By level').querySelectorAll('tbody tr')];
    expect(levels.length).toBe(2);
    expect(levels[0].textContent).toContain('₹ 9,80,000');
    button('Cases', levels[1])!.click();
    await settle();
    const cases = http.expectOne((r) => r.url === '/api/staff/expenditure/cases');
    expect([cases.request.params.get('partyId'), cases.request.params.get('level')]).toEqual(['ZEDAA0080', 'Gold']);
    cases.flush([]);
    await settle();
    expect(el.querySelector('zed-expenditure-cases')).toBeTruthy();
  });

  it('filters by level and by month', async () => {
    await create();
    const gold = [...el.querySelectorAll('zed-chip-filter button')].find((b) => b.textContent!.trim() === 'Gold') as HTMLButtonElement;
    gold.click();
    await settle();
    let req = http.expectOne((r) => r.url === '/api/staff/expenditure/summary');
    expect(req.request.params.get('level')).toBe('Gold');
    req.flush(summary());
    await settle();
    expect(section('Purchase orders').querySelectorAll('tbody tr').length).toBe(1);

    const month = el.querySelector('select[name="month"]') as HTMLSelectElement;
    month.value = [...month.options].find((o) => o.text === 'Oct 2026')!.value;
    month.dispatchEvent(new Event('change'));
    await settle();
    req = http.expectOne((r) => r.url === '/api/staff/expenditure/summary');
    expect([req.request.params.get('from'), req.request.params.get('to')]).toEqual(['2026-10-01', '2026-10-31']);
    req.flush(summary());
    await settle();
    expect(monthRange('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
  });

  it("lists the months with cases, amount, GST, total and the invoice's status", async () => {
    await create();
    const rows = [...section('Monthly invoices').querySelectorAll('tbody tr')];
    expect(rows.length).toBe(3);
    // The current month: its figures, no upload until it has ended.
    expect(rows[0].textContent).toContain('Month in progress');
    expect(button('Upload Invoice', rows[0])).toBeUndefined();
    // An ended month: excl. GST, GST, total; not uploaded yet.
    expect(rows[1].textContent).toContain('41 completed · 3 rejected · 14 surveillance');
    expect(rows[1].textContent).toContain('₹ 4,20,000');
    expect(rows[1].textContent).toContain('₹ 75,600');
    expect(rows[1].textContent).toContain('₹ 4,95,600');
    expect(rows[1].textContent).toContain('Not uploaded');
    expect(button('Upload Invoice', rows[1])!.disabled).toBe(false);
    // Returned with remarks: View and Upload Again.
    expect(rows[2].textContent).toContain('Returned');
    expect(rows[2].textContent).toContain('Wrong amount');
    expect(button('Upload Again', rows[2])).toBeTruthy();
    button('View', rows[2])!.click();
    await settle();
    http.expectOne('/api/staff/expenditure/invoices/3').flush({
      invoice: returned, live: { month: '2026-08-01', completed: 40, rejected: 0, surveillance: 14, milestones: 0, amount: 390000, gst: 18, total: 460200 },
      liveDifference: 0, lines: [], tax: tax(true),
    });
    await settle();
    const review = el.querySelector('zed-invoice-review')!;
    expect(review.textContent).toContain('27AAPFU0939F1ZV');
    expect(button('Approve', review)).toBeUndefined();
  });

  it("exports a month's cases to Excel, and everything for the filtered period", async () => {
    await create();
    const oct = [...section('Monthly invoices').querySelectorAll('tbody tr')][1];
    button('Export Excel', oct)!.click();
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/expenditure/cases');
    expect([req.request.params.get('partyId'), req.request.params.get('from'), req.request.params.get('to')]).toEqual(['ZEDAA0080', '2026-10-01', '2026-10-31']);
    req.flush([{ zedId: 'ZEDMSME000001', unitName: 'Unit 1', state: 'GOA', level: 'Bronze', kind: 'Completed', milestone: null, countedOn: '2026-10-03', rate: 3000 }]);
    await settle();
    expect(files).toEqual(['expenditure-ZEDAA0080-2026-10']);
    const [cases, months] = sheets[0];
    expect(cases.columns).toEqual(['ZED ID', 'Unit', 'State', 'Level', 'Case', 'Counted on', 'Rate (₹, excl. GST)', 'Amount (₹, excl. GST)']);
    expect(cases.rows[0]).toEqual(['ZEDMSME000001', 'Unit 1', 'GOA', 'Bronze', 'Completed', '2026-10-03', 3000, 3000]);
    expect(months.rows[0]).toEqual(['Oct 2026', 41, 3, 14, 58, 420000, 18, 75600, 495600, undefined, undefined, undefined, 'Not uploaded', undefined]);

    button('Export All')!.click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/expenditure/cases' && !r.params.get('from')).flush([]);
    await settle();
    expect(files[1]).toBe('expenditure-ZEDAA0080');
    expect(sheets[1].map((s) => s.name)).toEqual(['Cases', 'Levels', 'Purchase orders', 'Months']);
    expect(sheets[1][3].rows.length).toBe(3);
  });

  it('uploads the invoice PDF with its number, date and amount once the tax details are in', async () => {
    await create();
    button('Upload Invoice')!.click();
    await settle();
    const form = el.querySelector('form.xd')!;
    expect(form.textContent).toContain('Billed with GSTIN 27AAPFU0939F1ZV · PAN AAPFU0939F');
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
    await flushLoad();
    expect(el.querySelector('form.xd')).toBeNull();
  });

  it('keeps the uploads disabled until the GSTIN and PAN are submitted', async () => {
    await create(my(false));
    expect(section('Monthly invoices').textContent).toContain('Submit your GSTIN and PAN above (once) to upload invoices.');
    const upload = button('Upload Invoice')!;
    expect(upload.disabled).toBe(true);
    expect(button('Upload Again')!.disabled).toBe(true);
    upload.click();
    await settle();
    expect(el.querySelector('form.xd')).toBeNull();
    // The one-time form is on the page, the GSTIN pre-filled from the agency's record.
    expect((el.querySelector('input[name="gstin"]') as HTMLInputElement).value).toBe('27AAPFU0939F1ZV');
    expect((el.querySelector('input[name="pan"]') as HTMLInputElement).value).toBe('AAPFU0939F');
  });
});
