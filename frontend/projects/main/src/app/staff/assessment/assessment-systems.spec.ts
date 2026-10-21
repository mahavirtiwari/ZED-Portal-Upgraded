import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { PortalSystem } from '../../portal-system';
import { AllotPage } from './allot';
import { AssessmentResultsPage } from './assessment-results';
import { ASSESSMENT_SYSTEM } from './assessment-shared';
import { DaAllotmentPage } from './da-allotment';

/** The consultancy and surveillance variants of the assessment pages (ASSESSMENT_SYSTEM). */
describe('assessment pages per system', () => {
  let http: HttpTestingController;

  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function flushConfig() {
    for (const r of http.match('/api/config')) r.flush({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: 'https://legacy.example.test' });
  }

  async function setup(system: PortalSystem) {
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ASSESSMENT_SYSTEM, useValue: system }],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  }

  async function create<T>(type: Type<T>, kind?: 'completed' | 'rejected') {
    const fixture = TestBed.createComponent(type);
    if (kind) fixture.componentRef.setInput('kind', kind);
    await settle(fixture);
    flushConfig();
    return fixture;
  }

  afterEach(() => http.verify());

  it('consultancy Allot: milestone column, CO wording, no assessment details link', async () => {
    await setup('consultancy');
    const fixture = await create(AllotPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', NcCount: 2, CertificationStatus: 6, CertificationBodyUserId: 'CO1', AgencyName: 'CO One' }],
    });
    await settle(fixture);
    expect(el.textContent).toContain('Allot Consultancy');
    expect(el.textContent).toContain('Milestone 2');
    expect(el.textContent).toContain('Allocated to CO');
    expect(el.querySelector('a[href^="/staff/assessment/"]')).toBeNull();
    const levels = [...el.querySelectorAll<HTMLOptionElement>('#allotLevel option')].map((o) => o.value);
    expect(levels).toEqual(['', 'Silver', 'Gold']);
  });

  it('surveillance Allot: Surveillance No and auto-allotment date', async () => {
    await setup('surveillance');
    const fixture = await create(AllotPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze', CertificationStatus: 1, SurveillanceNo: '1st Surveillance', CertificationBodyUserId: 'AG1', AutoAllocationDate: 'May 1, 2026' }],
    });
    await settle(fixture);
    expect(el.textContent).toContain('Allot Surveillance');
    expect(el.textContent).toContain('1st Surveillance');
    expect(el.textContent).toContain('Auto Alloted on:');
    expect(el.textContent).toContain('May 1, 2026');
  });

  it('surveillance DA allotment: re-allot until the app work starts, one assessor list', async () => {
    await setup('surveillance');
    const fixture = await create(DaAllotmentPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/staff/assessment/da-allotment').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze', CertificationStatus: 1, DesktopAssessorId: 'AS1', DesktopAccepted: true, LeadInCertification: 'LEAD1' }],
      assessors: [{ userId: 'AS1', userName: 'One' }],
      bronzeAssessors: [{ userId: 'AS1', userName: 'One' }],
    });
    await settle(fixture);
    expect(el.textContent).toContain('Allot Surveillance Assessments');
    expect(el.textContent).toContain('RE-ALLOT');
    expect(el.textContent).toContain('Original certification: LEAD1');
  });

  it('consultancy Completed: milestone reports and recommended technologies', async () => {
    await setup('consultancy');
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = await create(AssessmentResultsPage, 'completed');
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({
      rows: [
        { RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Silver', NcCount: 3, DisplayRecTech: 1, TuStatus: 1, CertificationStatus: 100 },
        { RowNumber: 2, ZedId: 'ZEDMSME000002', Certification: 'Gold', NcCount: 1, DisplayRecTech: 1, TuStatus: 0, CertificationStatus: 16 },
      ],
      totalCount: 2, pageNo: 1, pageSize: 20,
    });
    await settle(fixture);
    expect(el.textContent).toContain('Consultancy Completed');
    const rows = el.querySelectorAll('tbody tr');
    const links = (i: number) => [...rows[i].querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links(0)).toContain('/api/staff/certification-documents/ZEDMSME000001/Silver/report?milestone=3');
    expect(links(0)).toContain('/staff/consultancy/technology/ZEDMSME000001/Silver');
    expect(links(1)).toContain('/api/staff/certification-documents/ZEDMSME000002/Gold/report?milestone=1');
    expect(links(1).filter((h) => h?.includes('report?milestone')).length).toBe(1);
    expect(rows[1].textContent).not.toContain('Recommended Technologies');
  });

  it('consultancy Completed: the lead consultant recommends technologies after the MSME accepted milestone 3', async () => {
    await setup('consultancy');
    TestBed.inject(AuthService).setUser({ userId: 'C1', userName: 'C', roleId: 3, role: 'DesktopAssessor', subRoles: ['SiteVerification'] });
    const fixture = await create(AssessmentResultsPage, 'completed');
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({
      rows: [{ RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Silver', NcCount: 3, DisplayRecTech: 1, TuStatus: 0, CertificationStatus: 100 }],
      totalCount: 1, pageNo: 1, pageSize: 20,
    });
    await settle(fixture);
    expect(el.textContent).toContain('Recommend Technologies');
    expect(el.textContent).not.toContain('MileStone 1 Report');
  });

  it('surveillance Rejected: heading and Surveillance No in the completed list', async () => {
    await setup('surveillance');
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = await create(AssessmentResultsPage, 'completed');
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({
      rows: [{ RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Bronze', SurveillanceNo: '2nd Surveillance', ModeOfAssessment: 'Onsite', CertificationStatus: 6, PledgePath: 'Certificates' }],
      totalCount: 1, pageNo: 1, pageSize: 20,
    });
    await settle(fixture);
    expect(el.textContent).toContain('Completed Surveillance');
    expect(el.textContent).toContain('2nd Surveillance');
    expect(el.querySelector('thead')!.textContent).not.toContain('Duplicates');
    expect(el.textContent).not.toContain('Download Pledge Certificate');
  });
});
