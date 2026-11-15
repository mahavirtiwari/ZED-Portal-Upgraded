import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Title } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';
import { PRINT_PAGE, ReportPageView } from './report-page';
import { ReportPage, reportApiUrl, reportRoute } from './report.api';

const base: ReportPage = {
  kind: 'assessment',
  title: 'Assessment Report',
  zedId: 'ZEDMSME000001',
  recordId: 'ZEDMSME000001',
  level: 'Silver',
  levelName: 'Silver',
  badge: null,
  draft: false,
  rejected: false,
  footer: 'ZEDMSME000001 / ASSESSMENT REPORT',
  fileName: 'ZEDMSME000001_Silver_Assessment_Report',
  unit: {
    name: 'Shree Precision Components', place: 'Pune, Maharashtra', udyam: 'UDYAM-MH-26-0000000', enterpriseType: 'Small', nic: '28',
    address: 'Plot 12, MIDC Bhosari', latitude: '18.6298', longitude: '73.8478', mapImage: null,
  },
  result: { tone: 'ok', heading: 'Certified: ZED Silver', detail: 'Certificate ZED/S/2026/000123 · valid till November 13, 2029' },
  facts: [
    { value: '3', label: 'Requirements assessed', tone: '' },
    { value: '2', label: 'Conformed', tone: 'g' },
    { value: '1', label: 'NCs raised', tone: 'r' },
    { value: '1', label: 'NC rounds', tone: 'a' },
  ],
  journey: [{ label: 'Certification date', value: 'November 14, 2026' }],
  sectionResults: [
    { code: '1', name: 'Leadership', conformed: 2, total: 2, exempted: false },
    { code: '2', name: 'Quality Management', conformed: 0, total: 1, exempted: false },
    { code: '3', name: 'Supplier quality', conformed: 0, total: 0, exempted: true },
  ],
  sitePhotos: [{ url: '/api/report-pages/photo?t=abc', caption: 'Site Exterior Picture' }],
  products: [{ name: 'CNC shafts', exported: 'Yes', photo: '/api/report-pages/photo?t=p1', descriptionPhoto: null, descriptionNote: null, verified: 'Yes', tone: 'y', remarks: '' }],
  unitInfo: [{ label: 'Energy sources', value: 'Grid, Solar' }],
  rawMaterials: [],
  findings: [
    {
      code: '2', name: 'Quality Management', exempted: false, ofi: 'Move the calibration register to the ERP.',
      requirements: [{
        code: '2.1', name: 'Calibration of measuring instruments', result: 'NC raised', tone: 'n', remarks: 'Two calipers past due date.',
        checkpoints: [{ code: '1', text: 'Calibration list kept', subOptions: [], answer: 'Yes' }, { code: '2', text: 'Due dates tracked', subOptions: [], answer: 'No' }],
      }],
    },
  ],
  ncRounds: [{ round: 1, products: [], items: [{ code: '2.1', requirement: 'Calibration of measuring instruments', remarks: 'Calibrated.', status: 'Closed', tone: 'y' }] }],
  ncClosed: true,
  milestone: null,
  wayForward: ['Apply for the ZED Gold level when ready.'],
  disclaimer: ['This is an electronically generated report.'],
  verify: { url: 'https://loginzed.msme.gov.in/Verify/SC/AB12', qrImage: 'data:image/png;base64,AAAA' },
  storedPdf: null,
  dated: { label: 'Certified on', value: 'November 14, 2026' },
};

async function settle(fixture: { detectChanges(): void; whenStable(): Promise<unknown> }) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('Report page', () => {
  let printed: number;
  /** The document title while the print dialog was open (the PDF's suggested file name). */
  let titles: string[];

  async function open(inputs: Record<string, string | undefined>) {
    printed = 0;
    titles = [];
    await TestBed.configureTestingModule({
      imports: [ReportPageView],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: PRINT_PAGE, useValue: () => { printed++; titles.push(document.title); } }],
    }).compileComponents();
    const fixture = TestBed.createComponent(ReportPageView);
    for (const [k, v] of Object.entries(inputs)) fixture.componentRef.setInput(k, v);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  it('opens when the router sets the inputs the address does not carry to undefined', async () => {
    // withComponentInputBinding: /msme/report/assessment/Bronze has no t, zedId, record or milestone.
    const { fixture, http, el } = await open({ kind: 'assessment', level: 'Bronze', t: undefined, zedId: undefined, record: undefined, milestone: undefined });
    http.expectOne('/api/msme/certification-documents/Bronze/report/page').flush(base);
    await settle(fixture);
    expect(el.textContent).not.toContain('This report address is not valid.');
    expect(el.querySelectorAll('.rp-sheet').length).toBeGreaterThan(0);
  });

  it('names ZED-X once in the title, never "ZED ZED-X"', async () => {
    const { fixture, http, el } = await open({ kind: 'assessment', level: 'ZEDX' });
    http.expectOne('/api/msme/certification-documents/ZEDX/report/page').flush({ ...base, level: 'ZEDX', levelName: 'ZED-X' });
    await settle(fixture);
    expect(el.querySelector('.rp-title')!.textContent).toContain('Assessment Report · ZED-X');
    expect(el.textContent).not.toContain('ZED ZED-X');
  });

  it('shows the MSME its assessment report as A4 sheets with the design sections', async () => {
    const { fixture, http, el } = await open({ kind: 'assessment', level: 'Silver' });
    http.expectOne('/api/msme/certification-documents/Silver/report/page').flush(base);
    await settle(fixture);

    expect(el.querySelector('.rp-title')!.textContent).toContain('Assessment Report · ZED Silver');
    expect([...el.querySelectorAll('.rp-toc button')].map((b) => b.textContent!.trim()))
      .toEqual(['Cover', 'Summary', 'Unit details', 'Findings', 'Non-conformances', 'Way forward']);
    expect(el.querySelectorAll('.rp-sheet').length).toBe(6);
    expect(el.querySelector('.rp-result b')!.textContent).toBe('Certified: ZED Silver');
    expect([...el.querySelectorAll('.rp-fact b')].map((b) => b.textContent)).toEqual(['3', '2', '1', '1']);
    expect(el.querySelectorAll('.rp-secrow').length).toBe(3);
    expect(el.querySelector('.rp-secrow .rp-chip')!.textContent).toBe('Exempted');
    // Findings: the checkpoint answered Yes highlighted, the assessor's remark, the colour chip.
    expect(el.querySelector('.rp-opts .sel')!.textContent).toContain('Calibration list kept');
    expect(el.querySelector('.rp-opts .no')!.textContent).toContain('Due dates tracked');
    expect(el.querySelector('#rp-findings .rp-remark')!.textContent).toContain('Assessor: Two calipers past due date.');
    expect(el.querySelector('#rp-findings .rp-chip.rp-c-n')!.textContent).toBe('NC raised');
    expect(el.querySelector('.rp-ofi')!.textContent).toContain('Move the calibration register');
    expect(el.querySelector('.rp-hd.rp-ok')!.textContent).toContain('All non-conformances closed');
    expect((el.querySelector('.rp-ph img') as HTMLImageElement).getAttribute('src')).toBe('/api/report-pages/photo?t=abc');
    expect((el.querySelector('.rp-qr') as HTMLImageElement).getAttribute('src')).toBe('data:image/png;base64,AAAA');
    expect(el.querySelector('.zed-report')!.classList).not.toContain('is-draft');
    http.verify();
  });

  it('prints, and downloads the PDF through the print dialog under the report file name', async () => {
    const { fixture, http, el } = await open({ kind: 'assessment', level: 'Silver' });
    http.expectOne('/api/msme/certification-documents/Silver/report/page').flush(base);
    await settle(fixture);
    const title = TestBed.inject(Title);

    const buttons = [...el.querySelectorAll('.rp-toolbar button')] as HTMLButtonElement[];
    expect(buttons.map((b) => b.textContent!.trim())).toEqual(['Print', '⬇ Download PDF']);
    expect(buttons[1].getAttribute('title')).toBe("Choose 'Save as PDF'");
    buttons[0].click();
    buttons[1].click();
    expect(printed).toBe(2);
    expect(titles).toEqual(['ZED | Assessment Report', 'ZEDMSME000001_Silver_Assessment_Report']);
    expect(title.getTitle()).toBe('ZED | Assessment Report');
  });

  it('marks a staff preview as DRAFT and asks the staff API of the record', async () => {
    const { fixture, http, el } = await open({ kind: 'surveillance', level: 'gold', zedId: 'ZEDMSME000001' });
    http.expectOne('/api/staff/certification-documents/ZEDMSME000001/gold/report/page').flush({
      ...base, kind: 'surveillance', title: 'Surveillance Assessment Report', level: 'Gold', levelName: 'Gold', draft: true,
      result: { tone: 'draft', heading: 'DRAFT: not yet final', detail: '' }, verify: null, dated: null, ncRounds: [], ncClosed: false,
    });
    await settle(fixture);
    expect(el.querySelector('.zed-report')!.classList).toContain('is-draft');
    expect(el.querySelector('.rp-title')!.textContent).toContain('Surveillance Report · ZED Gold');
    expect(el.querySelector('.rp-r-draft')).not.toBeNull();
    expect(el.querySelector('.rp-qr')).toBeNull();
    expect(el.querySelector('#rp-way')!.textContent).toContain('DRAFT');
  });

  it('opens an app link with its token, and says when it has expired', async () => {
    const { fixture, http, el } = await open({ t: 'tok/en' });
    http.expectOne('/api/report-pages/link?t=tok%2Fen').flush(null, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el.textContent).toContain('This report link has expired or is not valid.');
    expect(el.querySelector('.rp-sheet')).toBeNull();
  });

  it('shows the handholding milestone report: milestones, gaps and plan, meetings', async () => {
    const { fixture, http, el } = await open({ kind: 'milestone', level: 'Gold', milestone: '1' });
    http.expectOne('/api/msme/certification-documents/Gold/report/page?milestone=1').flush({
      ...base, kind: 'milestone', title: 'Handholding Report', level: 'Gold', levelName: 'Gold', findings: [], ncRounds: [], products: [],
      sectionResults: [], journey: [], verify: null,
      result: { tone: 'info', heading: 'Existing: Silver · Target: Gold', detail: 'Consultant: A. Deshmukh' },
      milestone: {
        number: 1, existing: 'Silver', target: 'Gold', consultant: 'A. Deshmukh', dates: 'BDSR: October 1, 2026',
        steps: [
          { number: 1, name: 'Milestone 1: BDSR / HAP', status: 'Done', tone: 'y', date: 'BDSR: October 1, 2026' },
          { number: 2, name: 'Milestone 2: Progress review 1', status: 'Later', tone: 'x', date: '' },
          { number: 3, name: 'Milestone 3: Progress review 2', status: 'Later', tone: 'x', date: '' },
        ],
        facts: [],
        gaps: [{ code: '4.2', requirement: 'Energy metering', conformance: 'No', gaps: ['No meter per line.'], plan: ['Install sub-meters.'], days: '20', technology: ['IoT meters'], rationale: 'Cuts idle running.' }],
        progress: null,
        meetings: [{ title: 'Opening meeting', remark: 'Held on site.', photo: null, participants: [{ label: '1. R. Patil', value: 'Owner' }] }],
      },
    });
    await settle(fixture);
    expect(el.querySelector('.rp-title')!.textContent).toContain('Handholding Report · Milestone 1 (BDSR / HAP)');
    expect([...el.querySelectorAll('.rp-toc button')].map((b) => b.textContent!.trim()))
      .toEqual(['Cover', 'Overview', 'Gaps and plan', 'Unit details', 'Meetings', 'Way forward']);
    expect(el.querySelector('#rp-plan')!.textContent).toContain('Install sub-meters.');
    expect(el.querySelector('#rp-plan .rp-remark')!.textContent).toContain('IoT meters');
    expect(el.querySelector('#rp-meetings')!.textContent).toContain('R. Patil');
  });

  it('links an earlier milestone stored as a PDF instead of drawing it', async () => {
    const { fixture, http, el } = await open({ kind: 'milestone', level: 'Silver', zedId: 'ZEDMSME000001', milestone: '1' });
    http.expectOne('/api/staff/certification-documents/ZEDMSME000001/Silver/report/page?milestone=1').flush({
      ...base, kind: 'milestone', storedPdf: '/api/staff/certification-documents/ZEDMSME000001/Silver/report?milestone=1',
      milestone: { number: 1, existing: '', target: 'Silver', consultant: '', dates: '', steps: [], facts: [], gaps: [], progress: null, meetings: [] },
    });
    await settle(fixture);
    expect(el.querySelector('.rp-sheet')).toBeNull();
    expect(el.querySelector('.rp-note')!.textContent).toContain('saved as a PDF when the milestone was completed');
    expect(el.querySelector('.rp-note a')!.getAttribute('href')).toBe('/api/staff/certification-documents/ZEDMSME000001/Silver/report?milestone=1');
    expect(el.querySelector('.rp-toolbar button')).toBeNull();
  });

  it('refuses an address that is not a report', async () => {
    const { http, el } = await open({ kind: 'certificate', level: 'Silver' });
    http.expectNone(() => true);
    expect(el.textContent).toContain('This report address is not valid.');
  });

  it('builds the routes and API addresses of each report', () => {
    expect(reportRoute({ kind: 'assessment', level: 'Bronze', record: 'ZEDMSME000001_D_45' })).toBe('/msme/report/assessment/Bronze?record=ZEDMSME000001_D_45');
    expect(reportRoute({ kind: 'milestone', level: 'Gold', zedId: 'ZEDMSME000001', milestone: 3 })).toBe('/staff/report/milestone/Gold/ZEDMSME000001?milestone=3');
    expect(reportApiUrl({ kind: 'surveillance', level: 'Silver' })).toBe('/api/msme/certification-documents/SilverSurveillance/report/page');
    expect(reportApiUrl({ kind: 'surveillance', level: 'Silver', zedId: 'Z1' })).toBe('/api/staff/certification-documents/Z1/Silver/report/page');
    expect(reportApiUrl({ kind: 'assessment', level: 'Bronze', record: 'Z1_D_4' })).toBe('/api/msme/certification-documents/Bronze/report/page?record=Z1_D_4');
  });
});
