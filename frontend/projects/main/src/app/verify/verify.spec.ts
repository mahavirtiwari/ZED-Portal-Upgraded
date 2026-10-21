import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, UrlSegment, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { LegacyReportRedirect, OPEN_FILE } from './legacy-report';
import { VerifyPage, VerifyResponse } from './verify';
import { VERIFY_ROUTES } from './verify.routes';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

describe('VerifyPage', () => {
  let fixture: ComponentFixture<VerifyPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const text = () => el.textContent!.replace(/\s+/g, ' ');

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [VerifyPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(VerifyPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
  });

  afterEach(() => http.verify());

  async function open(type: string, code: string, response?: VerifyResponse) {
    fixture.componentRef.setInput('type', type);
    fixture.componentRef.setInput('code', code);
    await settle(fixture);
    if (response) http.expectOne(`/api/verify/${type.toLowerCase()}/${code}`).flush(response);
    await settle(fixture);
  }

  it('shows a Bronze certificate with its surveillance due date', async () => {
    await open('BC', 'P12abcd', {
      certification: 'Bronze',
      details: {
        EnterpriseName: 'ACME UNIT 1', UdyogAadharNo: 'UDYAM-UP-29-0003915', Address: 'Plot 4, Kanpur', DateOfCertification: 'October 21, 2026',
        DateOfExpiry: 'October 21, 2029', CertificateNo: '21102026_1234', CertificationPhase: 'ACTIVE', FirstSurveDueDate: 'January 14, 2028',
        SurveillanceCompletionDate: null, OldSurveillanceDate: null,
      },
    });
    expect(text()).toContain('Bronze Certification Details');
    expect(text()).toContain('Unit Name: ACME UNIT 1');
    expect(text()).toContain('Certificate Valid upto: October 21, 2029');
    expect(text()).toContain('Surveillance Due Date: January 14, 2028');
  });

  it('shows both surveillance rounds of a Gold certificate', async () => {
    await open('gc', 'P14wxyz', {
      certification: 'Gold',
      details: { EnterpriseName: 'ACME', SurveillanceCompletionDate: 'May 1, 2026', OldSurveillanceDate: 'May 1, 2025', FirstSurveDueDate: null },
    });
    expect(text()).toContain('Surveillance 1 completed on: May 1, 2025');
    expect(text()).toContain('Surveillance 2 completed on: May 1, 2026');
  });

  it('shows a pledge certificate', async () => {
    await open('pc', 'Q1', { certification: 'Pledge', details: { EnterpriseName: 'ACME', DateOfPledge: 'May 1, 2024', CertificateNo: 'P-1' } });
    expect(text()).toContain('Pledge Certification Details');
    expect(text()).toContain('Date of Pledge: May 1, 2024');
    expect(text()).not.toContain('Certificate Valid upto');
  });

  it('refuses a malformed link without calling the API', async () => {
    await open('xc', 'P12abcd');
    await open('bc', "P1'--");
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Invalid verification link.');
  });

  it('shows the message for an unknown code', async () => {
    await open('sc', 'nope');
    http.expectOne('/api/verify/sc/nope').flush({ title: 'No certificate was found for this code.' }, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('No certificate was found for this code.');
  });
});

describe('VERIFY_ROUTES', () => {
  const seg = (...p: string[]) => p.map((s) => new UrlSegment(s, {}));
  const [verify, report, surveillance, consultancy] = VERIFY_ROUTES;

  it('matches the QR code addresses in any case', () => {
    const m = verify.matcher!(seg('Verify', 'BC', 'P12abcd'), null!, verify)!;
    expect(m.posParams!['type'].path).toBe('BC');
    expect(m.posParams!['code'].path).toBe('P12abcd');
    expect(verify.matcher!(seg('verify', 'gc', 'x'), null!, verify)).toBeTruthy();
    expect(verify.matcher!(seg('verify', 'gc'), null!, verify)).toBeNull();
    expect(verify.matcher!(seg('msme', 'gc', 'x'), null!, verify)).toBeNull();
  });

  it('matches the old report address', () => {
    const m = report.matcher!(seg('SA', 'ReportSummary', 'ZEDMSME000001'), null!, report)!;
    expect(m.posParams!['id'].path).toBe('ZEDMSME000001');
    expect(report.matcher!(seg('sa', 'summary1', 'ZEDMSME000001'), null!, report)).toBeNull();
  });

  it('matches the old surveillance and consultancy report addresses', () => {
    const m = surveillance.matcher!(seg('surveillance', 'SA', 'ReportSummary', 'ZEDMSME000001'), null!, surveillance)!;
    expect(m.posParams!['id'].path).toBe('ZEDMSME000001');
    expect(surveillance.data).toEqual({ system: 'surveillance' });
    expect(consultancy.matcher!(seg('Consultancy', 'sa', 'reportsummary', 'ZEDMSME000001'), null!, consultancy)).toBeTruthy();
    expect(consultancy.data).toEqual({ system: 'consultancy' });
    expect(consultancy.matcher!(seg('surveillance', 'SA', 'ReportSummary', 'ZEDMSME000001'), null!, consultancy)).toBeNull();
    expect(surveillance.matcher!(seg('SA', 'ReportSummary', 'ZEDMSME000001'), null!, surveillance)).toBeNull();
  });
});

describe('LegacyReportRedirect', () => {
  let opened: string[];
  let user: { userId: string; roleId: number } | null;
  let navigated: string[];

  async function run(id: string, certification: string, system?: 'surveillance' | 'consultancy', milestone?: string) {
    opened = [];
    navigated = [];
    await TestBed.configureTestingModule({
      imports: [LegacyReportRedirect],
      providers: [
        provideRouter([]),
        { provide: OPEN_FILE, useValue: (url: string) => opened.push(url) },
        { provide: AuthService, useValue: { ensureLoaded: () => Promise.resolve(), currentUser: () => user } },
      ],
    }).compileComponents();
    const router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockImplementation(async (u) => { navigated.push(String(u)); return true; });
    const fixture = TestBed.createComponent(LegacyReportRedirect);
    fixture.componentRef.setInput('id', id);
    fixture.componentRef.setInput('certification', certification);
    if (system) fixture.componentRef.setInput('system', system);
    if (milestone) fixture.componentRef.setInput('milestone', milestone);
    await settle(fixture);
    return fixture.nativeElement as HTMLElement;
  }

  it('opens the MSME report, with the rejected record when the link names one', async () => {
    user = { userId: 'ZEDMSME000001', roleId: 5 };
    await run('ZEDMSME000001', 'bronze');
    expect(opened).toEqual(['/api/msme/certification-documents/Bronze/report']);
    TestBed.resetTestingModule();
    await run('ZEDMSME000001_D_45', 'Bronze');
    expect(opened).toEqual(['/api/msme/certification-documents/Bronze/report?record=ZEDMSME000001_D_45']);
  });

  it('opens the staff report for staff and sends visitors to the login page', async () => {
    user = { userId: 'ADMIN1', roleId: 7 };
    await run('ZEDMSME000001', 'Gold');
    expect(opened).toEqual(['/api/staff/certification-documents/ZEDMSME000001/Gold/report']);
    TestBed.resetTestingModule();
    user = null;
    await run('ZEDMSME000001', 'Gold');
    expect(opened).toEqual([]);
    expect(navigated).toEqual(['/msme/login']);
  });

  it('opens the surveillance report drawn by this portal', async () => {
    user = { userId: 'ZEDMSME000001', roleId: 5 };
    await run('ZEDMSME000001', 'gold', 'surveillance');
    expect(opened).toEqual(['/api/msme/certification-documents/GoldSurveillance/report']);
    TestBed.resetTestingModule();
    user = { userId: 'ADMIN1', roleId: 7 };
    await run('ZEDMSME000001', 'Gold', 'surveillance');
    expect(opened).toEqual(['/api/staff/certification-documents/ZEDMSME000001/Gold/report']);
  });

  it('opens the handholding milestone report and checks the milestone', async () => {
    user = { userId: 'ZEDMSME000001', roleId: 5 };
    await run('ZEDMSME000001', 'Silver', 'consultancy', '2');
    expect(opened).toEqual(['/api/msme/certification-documents/Silver/report?milestone=2']);
    TestBed.resetTestingModule();
    user = { userId: 'AGENCY1', roleId: 2 };
    await run('ZEDMSME000001', 'Gold', 'consultancy', '3');
    expect(opened).toEqual(['/api/staff/certification-documents/ZEDMSME000001/Gold/report?milestone=3']);
    TestBed.resetTestingModule();
    user = { userId: 'ZEDMSME000001', roleId: 5 };
    const el = await run('ZEDMSME000001', 'Silver', 'consultancy', '4');
    expect(opened).toEqual([]);
    expect(el.textContent).toContain('This report link is not valid.');
    TestBed.resetTestingModule();
    const other = await run('ZEDMSME000002', 'Silver', 'consultancy', '1');
    expect(opened).toEqual([]);
    expect(other.textContent).toContain('This report link is not valid.');
  });

  it('refuses an invalid link', async () => {
    user = { userId: 'ZEDMSME000001', roleId: 5 };
    const el = await run('../x', 'Bronze');
    expect(opened).toEqual([]);
    expect(el.textContent).toContain('This report link is not valid.');
  });
});

