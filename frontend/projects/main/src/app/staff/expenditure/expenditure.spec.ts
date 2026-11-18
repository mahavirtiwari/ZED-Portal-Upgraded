import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ADMIN_PORTAL } from '../admin-portal';
import { STAFF_SYSTEM } from '../staff-menu';
import { TableExport } from '../table-export';
import { ExpenditurePage } from './expenditure';
import { ExpenditureSummary, Invoice, InvoiceDetail, TaxDetails, caseText, poPill, rateLineText, rupees, rupeesShort } from './expenditure.api';

const summary = (kind: 'Agency' | 'Consultant' = 'Agency'): ExpenditureSummary => ({
  kind,
  parties: [{ code: 'ZEDAA0080', name: 'Mahavir Agency' }],
  levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Gold', name: 'Gold' }],
  states: ['GUJARAT'],
  cards: { poCases: 540, completed: 336, rejected: 16, surveillance: 36, milestones: 0, payable: 4160000, approved: 2820000 },
  rows: [
    { partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', level: 'Bronze', levelName: 'Bronze', poLabel: 'QCI/ZED/PO/2026/114', poCases: 500, completed: 300,
      rejected: 12, surveillance: 31, milestones: 0, used: 312, inProgress: 0, balance: 188, poState: 'Open', payable: 980000, invoiced: 720000, outstanding: 260000 },
    { partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', level: 'Gold', levelName: 'Gold', poLabel: 'QCI/ZED/PO/2026/116', poCases: 40, completed: 36,
      rejected: 4, surveillance: 5, milestones: 0, used: 40, inProgress: 0, balance: 0, poState: 'Stopped', payable: 950000, invoiced: 480000, outstanding: 470000 },
  ],
});

const invoice = (extra: Partial<Invoice> = {}): Invoice => ({
  id: 5, partyId: 'ZEDAA0080', partyName: 'Mahavir Agency', month: '2026-10', monthLabel: 'Oct 2026', invoiceNo: 'MA/26-27/031', invoiceDate: '2026-11-05',
  invoiceAmount: 495600, portalCompleted: 41, portalRejected: 3, portalSurveillance: 14, portalMilestones: 0, portalCases: 58, portalAmount: 420000,
  gstPercent: 18, portalTotal: 495600, difference: 0, status: 'Submitted', remarks: null, submittedOn: null, reviewedBy: null, reviewedOn: null,
  erpExport: null, canReview: true, ...extra,
});

const gstin: TaxDetails = {
  available: true, submitted: true, gstin: '27AAPFU0939F1ZV', pan: 'AAPFU0939F', hasGstFile: true, hasPanFile: true, submittedOn: '2026-11-18T05:00:00',
  submittedBy: 'ZEDAA0080', suggestedGstin: null,
};

describe('ExpenditurePage', () => {
  let fixture: ComponentFixture<ExpenditurePage>;
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

  async function create(roleId: number, system: 'main' | 'consultancy' = 'main') {
    await TestBed.configureTestingModule({
      imports: [ExpenditurePage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: STAFF_SYSTEM, useValue: system },
        { provide: AuthService, useValue: { currentUser: () => ({ roleId }) } }],
    }).compileComponents();
    fixture = TestBed.createComponent(ExpenditurePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  function flushLoad(s = summary(), invoices: Invoice[] = [invoice()]) {
    http.expectOne((r) => r.url === '/api/staff/expenditure/summary').flush(s);
    http.expectOne((r) => r.url === '/api/staff/expenditure/invoices').flush(invoices);
  }

  afterEach(() => http.verify());

  it('shows the cards, a row per agency and level with its PO balance, and the invoices', async () => {
    await create(7);
    flushLoad();
    await settle();
    expect(el.querySelector('.xp-tabs')).toBeNull(); // a master admin of main: its agencies only
    expect(el.textContent).toContain('₹ 41.6 L');
    expect(el.textContent).toContain('Rejected after assessment');
    const rows = [...el.querySelectorAll('.xp-table')[0].querySelectorAll('tbody tr')];
    expect(rows.length).toBe(2);
    expect(rows[0].textContent).toContain('₹ 9,80,000');
    expect(rows[1].querySelector('.status-badge')!.textContent!.trim()).toBe('0 · stopped');
    expect(el.textContent).toContain('MA/26-27/031');
    expect(button('Review')).toBeTruthy();
  });

  it('filters by agency and opens the cases of a row', async () => {
    await create(7);
    flushLoad();
    await settle();
    const select = el.querySelector('select[name="party"]') as HTMLSelectElement;
    select.value = 'ZEDAA0080';
    select.dispatchEvent(new Event('change'));
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/expenditure/summary');
    expect(req.request.params.get('partyId')).toBe('ZEDAA0080');
    req.flush({ ...summary(), tax: gstin });
    http.expectOne((r) => r.url === '/api/staff/expenditure/invoices').flush([]);
    await settle();
    // 2026-11-18: the chosen agency's one-time GSTIN and PAN, read-only.
    const tax = el.querySelector('zed-tax-details')!;
    expect(tax.textContent).toContain('27AAPFU0939F1ZV');
    expect(tax.textContent).toContain('Locked');
    expect(tax.querySelector('input')).toBeNull();

    button('Cases', el.querySelectorAll('.xp-table tbody tr')[0])!.click();
    await settle();
    const cases = http.expectOne((r) => r.url === '/api/staff/expenditure/cases');
    expect(cases.request.params.get('level')).toBe('Bronze');
    cases.flush([{ zedId: 'ZEDMSME000001', unitName: 'Unit 1', state: 'GUJARAT', level: 'Bronze', kind: 'Rejected', milestone: null, countedOn: '2026-10-04', rate: 1500 }]);
    await settle();
    expect(el.querySelector('zed-expenditure-cases')!.textContent).toContain('Rejected after assessment');
    expect(el.querySelector('zed-expenditure-cases')!.textContent).toContain('04 Oct 2026');
  });

  it('gives the Admin both views; the consultant organisations come from the Consultancy portal', async () => {
    await create(1);
    flushLoad();
    await settle();
    button('Consultant organisations')!.click();
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/expenditure/summary');
    expect(req.request.context.get(ADMIN_PORTAL)).toBe('consultancy');
    req.flush({ ...summary('Consultant'), rows: [] });
    http.expectOne((r) => r.url === '/api/staff/expenditure/invoices').flush([]);
    await settle();
    expect(el.textContent).toContain('Milestones counted');
  });

  it('reviews an invoice: return needs remarks, approve sends them', async () => {
    await create(7);
    flushLoad();
    await settle();
    button('Review')!.click();
    await settle();
    const detail: InvoiceDetail = {
      invoice: invoice(), liveDifference: 0,
      live: { month: '2026-10-01', completed: 41, rejected: 3, surveillance: 14, milestones: 0, amount: 420000, gst: 18, total: 495600 },
      lines: [{ kind: 'Completed', level: 'Bronze', levelName: 'Bronze', milestone: null, rate: 3000, rateFrom: '2026-11-01', cases: 41, amount: 123000 }],
      tax: gstin,
    };
    http.expectOne('/api/staff/expenditure/invoices/5').flush(detail);
    await settle();
    const dialog = el.querySelector('zed-invoice-review')!;
    expect(dialog.textContent).toContain('matches');
    expect(dialog.textContent).toContain('27AAPFU0939F1ZV');
    expect(dialog.textContent).toContain('AAPFU0939F');
    expect(dialog.textContent).toContain('41 completed × ₹ 3,000 (Bronze, from 01-11-2026)');
    button('Return', dialog)!.click();
    await settle();
    expect(dialog.textContent).toContain('Please enter the remarks');
    button('Approve', dialog)!.click();
    await settle();
    http.expectOne({ method: 'POST', url: '/api/staff/expenditure/invoices/5/approve' }).flush({ message: 'Invoice MA/26-27/031 approved.' });
    await settle();
    flushLoad();
    await settle();
    expect(el.querySelector('zed-invoice-review')).toBeNull();
  });

  it('exports the table and the invoices to Excel', async () => {
    await create(7);
    flushLoad();
    await settle();
    const xlsx = vi.spyOn(TestBed.inject(TableExport), 'xlsx').mockResolvedValue();
    button('Export')!.click();
    await settle();
    const [name, sheets] = xlsx.mock.calls[0];
    expect(name).toBe('expenditure-assessment-agencies');
    expect(sheets.map((s) => s.name)).toEqual(['Expenditure', 'Invoices']);
    expect(sheets[0].rows[1]).toContain('QCI/ZED/PO/2026/116');
  });

  it('formats rupees, pills and rate lines', () => {
    expect(rupees(2049000)).toBe('₹ 20,49,000');
    expect(rupeesShort(28200000)).toBe('₹ 2.8 Cr');
    expect(poPill('Low', 9)).toEqual({ text: '9 left', tone: 'is-pending' });
    expect(poPill('NoPo', null).text).toBe('No PO');
    expect(rateLineText({ kind: 'Milestone', level: 'Silver', levelName: 'Silver', milestone: 2, rate: 30000, rateFrom: null, cases: 3, amount: 90000 }))
      .toBe('3 milestone 2 × ₹ 30,000 (Silver)');
  });

  it('says when a milestone counted: the next payment, or the certificate for the last one', () => {
    const m = { zedId: 'Z1', unitName: null, state: null, level: 'Silver', kind: 'Milestone', countedOn: '2026-10-12', rate: 30000 };
    expect(caseText({ ...m, milestone: 1 })).toBe('M1 · counted when M2 was paid on 12 Oct 2026');
    expect(caseText({ ...m, milestone: 3, lastMilestone: true })).toBe('M3 · counted when the unit was certified on 12 Oct 2026');
    expect(caseText({ ...m, kind: 'Rejected', milestone: null })).toBe('Rejected after assessment');
  });
});
