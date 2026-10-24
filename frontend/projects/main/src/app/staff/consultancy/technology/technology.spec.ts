import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffRole } from '../../staff-menu';
import { TechnologyRecommendationPage } from './technology-recommendation';
import { TuSubmissionsPage } from './tu-submissions';
import { TuVerificationPage } from './tu-verification';

describe('Consultancy technology pages', () => {
  let fixture: ComponentFixture<unknown>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim();
  const button = (label: string) => [...el.querySelectorAll('button, a')].filter((b) => text(b) === label) as HTMLElement[];

  async function create<T>(component: Type<T>, roleId: number, params: Record<string, string> = {}) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(params), queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'User', roleId, role: 'x', subRoles: ['FinancialVerification', 'SiteVerification'] });
    fixture = TestBed.createComponent(component);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  const row = (extra: Record<string, unknown> = {}) => ({
    Id: 1, ZedId: 'ZEDMSME000500', PUnitName: 'Acme', CertificationType: 'Silver', LastestCertification: 'Silver', UnitAddress: 'Kanpur',
    CertificationBodyUserId: 'CO1', CertificationBodyName: 'CO One', FinancialAssessorId: null, FaAssessorName: null,
    ReasonForRejection: null, TechUpgradeStatus: 2, ...extra,
  });

  it('lets the CO accept a new allotment with one of its DFOs and re-allot the DFO later', async () => {
    await create(TuSubmissionsPage, StaffRole.Agency);
    // The CO lands on 99 (the counts, as the old page's GetSections(99)), then opens TU ALLOTMENT.
    const landing = http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions');
    expect(landing.request.params.get('status')).toBe('99');
    landing.flush({ rows: [], counts: { New: 2 } });
    await settle();
    expect(el.textContent).toContain('TU ALLOTMENT 2');
    button('TU ALLOTMENT 2')[0].click();
    await settle();
    const list = http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions');
    expect(list.request.params.get('status')).toBe('2');
    list.flush({ rows: [row(), row({ Id: 2, ZedId: 'ZEDMSME000501', FinancialAssessorId: 'DFO1', TechUpgradeStatus: 4 })], counts: { New: 2 } });
    await settle();

    expect(button('ACCEPT').length).toBe(1);
    expect(button('RE-ALLOT').length).toBe(1);
    expect(button('View Profile').length).toBe(2);
    expect(el.textContent).toContain('CC Details');
    const links = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/staff/consultancy/technology/verification/ZEDMSME000500/Silver');
    expect(links).toContain('/staff/msme-profile/ZEDMSME000500');

    button('ACCEPT')[0].click();
    await settle();
    http.expectOne('/api/staff/consultancy/tu/assessors').flush([{ userId: 'DFO1', userName: 'Dfo One' }]);
    await settle();
    expect(el.querySelector('label[for="tuChoice"]')!.textContent).toContain('Consultant/Expert');
    const select = el.querySelector('#tuChoice') as HTMLSelectElement;
    select.value = 'DFO1';
    select.dispatchEvent(new Event('change'));
    await settle();
    button('ACCEPT').at(-1)!.click();
    await settle();
    const accept = http.expectOne('/api/staff/consultancy/tu/accept');
    expect(accept.request.body).toEqual({ zedId: 'ZEDMSME000500', certification: 'Silver', assessorUserId: 'DFO1' });
    accept.flush({ message: 'Application accepted.' });
    await settle();
    http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions').flush({ rows: [], counts: null });
    await settle();
    expect(el.textContent).toContain('Application accepted.');
  });

  it('opens the DFO on TU ALLOTMENT without tabs, CC details, reason or profile', async () => {
    await create(TuSubmissionsPage, StaffRole.DesktopAssessor);
    const list = http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions');
    expect(list.request.params.get('status')).toBe('2');
    list.flush({ rows: [row({ FinancialAssessorId: 'U1', ReasonForRejection: 'x' })], counts: { New: 1 } });
    await settle();
    expect(el.textContent).not.toContain('TU ALLOTMENT');
    expect(el.textContent).not.toContain('CC Details');
    expect(el.textContent).not.toContain('Reason For Rejection');
    expect(button('View Profile').length).toBe(0);
    expect(button('VIEW').length).toBe(1);
  });

  it('shows the master admin the Status and Reason columns and the red rows of the old page per tab', async () => {
    await create(TuSubmissionsPage, StaffRole.MasterAdmin);
    const landing = http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions');
    expect(landing.request.params.get('status')).toBe('99');
    landing.flush({ rows: [], counts: { Rejected: 1 } });
    await settle();
    const headers = () => [...el.querySelectorAll('th')].map((h) => text(h));
    expect(headers()).toContain('Status');

    button('REJECTED 1')[0].click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions' && r.params.get('status') === '9').flush({
      rows: [row({ FinancialAssessorId: 'DFO1', ReasonForRejection: 'Assessor comments: bad', ReasonForRejectionAgency: 'Agency comments: worse', TimeDuration: 'Reallot' })],
      counts: { Rejected: 1 },
    });
    await settle();
    expect(headers()).toEqual(['Action(s)', 'Status', 'Certification Level', 'Unit Details', 'CO Details', 'CC Details', 'Verification Date', 'Reason For Rejection']);
    expect(el.textContent).toContain('Alloted to Consultant');
    expect(el.textContent).toContain('Rejected');
    expect(el.textContent).toContain('Agency comments: worse');
    expect(el.textContent).not.toContain('Assessor comments: bad');
    expect(el.querySelector('tbody tr')!.classList).toContain('rejected');
    expect(el.querySelector('tbody td.actions')!.classList).toContain('late');
    expect(button('View Profile').length).toBe(1);

    button('TU ALLOTMENT 0')[0].click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions' && r.params.get('status') === '2').flush({ rows: [row()], counts: null });
    await settle();
    expect(headers()).not.toContain('Status');
    expect(headers()).toContain('Reason For Rejection');
    expect(el.querySelector('tbody tr')!.classList).not.toContain('rejected');
  });

  const application = (extra: Record<string, unknown> = {}) => ({
    certification: 'Silver', stage: 'Approved, payout pending',
    details: { EligibleSubsidyPer: 80, TotalPaidAfterQc: '125000.00', EligibleAmount: '100000.00', AccountNo: '123456789012', IfscCode: 'SBIN0001234', BranchAddress: 'X', BankName: 'SBI' },
    technologies: [{ id: 301, isEligible: true, details: { TechnologyCode: '12', TechnologyName: 'Solar dryer', AmountPaid: '125000', MsmeAmountPaid: '125000' } }],
    documents: [{ id: 7001, photoType: 'Purchased Technology', technologyCode: '12', timeStamp: null, isPdf: true, url: '/api/doc', opened: true, isVerified: 'Yes', sourceOfValidation: null, assessorRemarks: null, needsScreenshot: true, screenshots: [] }],
    meeting: null, recommended: [{ code: '12', name: 'Solar dryer', description: null }],
    canValidate: false, canDecide: false, canApprove: false, canEditAmounts: true, canEditAccount: true, hasReport: true,
    attendance: [], overview: null, location: null, ...extra,
  });

  /** Opens a collapsible section of the level's tab by its heading. */
  async function expand(title: string) {
    ([...el.querySelectorAll('.section-toggle')] as HTMLElement[]).find((h) => text(h) === title)!.click();
    await settle();
  }

  async function openTab(label: string) {
    ([...el.querySelectorAll('.nav-link')] as HTMLElement[]).find((b) => text(b) === label)!.click();
    await settle();
  }

  it('lets the state coordinator correct a verified amount and links the report', async () => {
    await create(TuVerificationPage, StaffRole.StateCoordinator, { zedId: 'ZEDMSME000500', level: 'Silver' });
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([application()]);
    await settle();

    expect(el.textContent).toContain('Solar dryer');
    // The sections start closed.
    expect(el.textContent).not.toContain('Technology Support Eligible Amount');
    await expand('Summary');
    expect(el.textContent).toContain('Technology Support Eligible Amount');
    expect(el.textContent).toContain('100000.00');
    expect(el.textContent).toContain('125000.00');
    await expand('Solar dryer');
    expect(el.textContent).toContain('CA certificate of expenditure');
    expect(el.textContent).toContain('Invoice Copy');
    const report = [...el.querySelectorAll('a')].find((a) => text(a).startsWith('Download TU Report'));
    expect(report?.getAttribute('href')).toBe('/api/staff/consultancy/tu/ZEDMSME000500/Silver/report');

    button('Edit')[0].click();
    await settle();
    const input = el.querySelector('input[aria-label="Verified amount"]') as HTMLInputElement;
    input.value = '120000.50';
    input.dispatchEvent(new Event('input'));
    await settle();
    button('Update')[0].click();
    await settle();
    const save = http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500/Silver/technologies/301/amount');
    expect(save.request.body).toEqual({ amountPaid: '120000.50' });
    save.flush({ message: 'Amount updated.' });
    await settle();
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([application()]);
    await settle();
    expect(el.textContent).toContain('Amount updated.');
  });

  it('offers the master admin only REJECT', async () => {
    await create(TuVerificationPage, StaffRole.MasterAdmin, { zedId: 'ZEDMSME000500', level: 'Silver' });
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([application({ canDecide: true, canApprove: false, canEditAmounts: false, canEditAccount: false, hasReport: false })]);
    await settle();
    expect(button('REJECT').length).toBe(1);
    expect(button('ACCEPT').length).toBe(0);
    expect(el.textContent).not.toContain('Download TU Report');
  });

  it('shows the DFO only the outcome, no ACCEPT / REJECT (decided from the app)', async () => {
    await create(TuVerificationPage, StaffRole.DesktopAssessor, { zedId: 'ZEDMSME000500', level: 'Silver' });
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([application({
      canValidate: true, canDecide: false, canEditAmounts: false, canEditAccount: false, hasReport: false, details: { IsApproved: 1 },
    })]);
    await settle();
    expect(button('ACCEPT').length).toBe(0);
    expect(button('REJECT').length).toBe(0);
    expect(el.textContent).toContain('ACCEPTED');
  });

  it('shows the Bronze certificate and its Details of Expenditure, and Gold under one accordion', async () => {
    await create(TuVerificationPage, StaffRole.MasterAdmin, { zedId: 'ZEDMSME000500', level: 'Bronze' });
    const bronze = application({
      certification: 'Bronze', canEditAmounts: false, canEditAccount: false, hasReport: false,
      technologies: [{ id: 301, isEligible: true, details: { TechnologyCode: '12', TechnologyName: 'ZED Bronze', CertficateNumber: 'C-77', AgencyOrSupplier: 'Supplier X' } }],
      documents: [
        { id: 7001, photoType: 'Copy of Certificate', technologyCode: '12', timeStamp: null, isPdf: true, url: '/api/cert', opened: true, isVerified: null, sourceOfValidation: null, assessorRemarks: null, needsScreenshot: true, screenshots: [] },
        { id: 7002, photoType: 'CA certificate of expenditure', technologyCode: '12', timeStamp: null, isPdf: true, url: '/api/ca', opened: true, isVerified: null, sourceOfValidation: null, assessorRemarks: null, needsScreenshot: false, screenshots: [] },
      ],
    });
    const gold = application({
      certification: 'Gold', canEditAmounts: false, canEditAccount: false, hasReport: false,
      technologies: [
        { id: 401, isEligible: true, details: { TechnologyCode: '21', TechnologyName: 'Heat pump', NameOfTheManufaturer: 'Maker' } },
        { id: 402, isEligible: true, details: { TechnologyCode: '22', TechnologyName: 'Solar roof' } },
      ],
      documents: [],
    });
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([bronze, gold]);
    await settle();
    await expand('ZED Bronze');
    expect(el.textContent).toContain('Category of Certificate');
    expect(el.textContent).toContain('Certificate Number');
    expect(el.textContent).toContain('C-77');
    expect(el.textContent).toContain('Details of Expenditure');
    expect(el.textContent).not.toContain('Name of Manufacturer');
    expect(el.textContent).toContain('Copy of Certificate');
    // The certificate copy is listed once, with the certificate.
    expect([...el.querySelectorAll('td.w-50')].filter((td) => text(td) === 'Copy of Certificate').length).toBe(1);
    expect(el.textContent).toContain('Supplier X');

    await openTab('Gold Certification');
    expect(el.textContent).not.toContain('Heat pump');
    await expand('New tech with live sectors');
    expect([...el.querySelectorAll('td.w-50')].filter((td) => text(td) === 'Technology Name').length).toBe(2);
    expect(el.textContent).toContain('Heat pump');
    expect(el.textContent).toContain('Solar roof');
    expect(el.textContent).toContain('Name of Manufacturer');
  });

  it('shows the unit overview, the recommended technologies and the DFO attendance', async () => {
    await create(TuVerificationPage, StaffRole.Agency, { zedId: 'ZEDMSME000500', level: 'Silver' });
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([application({
      overview: { ZedId: 'ZEDMSME000500', PUnitName: 'Acme Unit', UdyogAadharNo: 'UDYAM-UP-00-0000001', Milestone3Date: 'May 1, 2026' },
      location: { Latitude: '28.61', Longitude: '77.2' },
      recommended: [{ code: '12', name: 'Solar dryer', description: 'Dries produce' }, { code: '14', name: 'Heat pump', description: null }],
      attendance: [{ date: '05-Jan-2026', loginTime: '10:00:00', logoutTime: '17:30:00', hours: 7, minutes: 30, loginPhotoUrl: '/api/in.jpg', logoutPhotoUrl: null }],
      details: { VerificationStatus: 4, EligibleAmount: '1' },
    })]);
    await settle();
    expect(el.textContent).toContain('ACCEPTED');
    await expand('Attendance');
    expect(el.textContent).toContain('Day 1');
    expect(el.textContent).toContain('7 (30 Minutes)');
    expect((el.querySelector('img[alt="Login Selfie"]') as HTMLImageElement).getAttribute('src')).toBe('/api/in.jpg');

    await openTab('Overview');
    expect(el.textContent).toContain('UDYAM-UP-00-0000001');
    expect(el.textContent).toContain('Milestone 3 Completed on');
    expect([...el.querySelectorAll('a[target="_blank"]')].map((a) => a.getAttribute('href'))).toContain('https://www.google.com/maps?q=28.61,77.2');

    await openTab('Technologies Recommended');
    expect(el.textContent).toContain('Dries produce');
    expect(el.textContent).toContain('No detailed log summary description submitted.');
    expect(el.textContent).not.toContain('Technology Support Eligible Amount');
  });

  it('lets the lead consultant recommend selected technologies after confirming', async () => {
    await create(TechnologyRecommendationPage, StaffRole.DesktopAssessor, { zedId: 'ZEDMSME000600', level: 'Silver' });
    const techs = [1, 2, 3].map((i) => ({ code: String(i), name: `Tech ${i}`, description: 'd', selected: false }));
    http.expectOne('/api/staff/consultancy/technology/ZEDMSME000600/Silver')
      .flush({ zedId: 'ZEDMSME000600', certification: 'Silver', recommended: false, canRecommend: true, message: null, maxSelection: 2, technologies: techs });
    await settle();

    const boxes = [...el.querySelectorAll('input[type="checkbox"]')] as HTMLInputElement[];
    boxes[0].click();
    boxes[2].click();
    await settle();
    expect((el.querySelectorAll('input[type="checkbox"]')[1] as HTMLInputElement).disabled).toBe(true);
    button('PROCEED')[0].click();
    await settle();
    expect((button('Submit')[0] as HTMLButtonElement).disabled).toBe(true);
    expect(el.querySelector('label[for="recConfirm"] [data-key="staff.consultancy.technologyRecommendation.fairConfirm.checkbox"]')).not.toBeNull();
    (el.querySelector('#recConfirm') as HTMLInputElement).click();
    await settle();
    button('Submit')[0].click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/consultancy/technology/ZEDMSME000600/Silver');
    expect(post.request.body).toEqual({ codes: ['1', '3'], confirmed: true });
    post.flush({ message: 'Selected Technologies updated.' });
    await settle();
    http.expectOne('/api/staff/consultancy/technology/ZEDMSME000600/Silver').flush({
      zedId: 'ZEDMSME000600', certification: 'Silver', recommended: true, canRecommend: false, message: null, maxSelection: 2,
      technologies: [{ ...techs[0], selected: true }, { ...techs[2], selected: true }],
    });
    await settle();
    expect(el.textContent).toContain('Selected Technologies updated.');
    expect(el.textContent).toContain('Summary Of Recommended Technologies');
  });

  it('counts the selection and puts a previous recommendation in progress in place of PROCEED', async () => {
    await create(TechnologyRecommendationPage, StaffRole.DesktopAssessor, { zedId: 'ZEDMSME000600', level: 'Silver' });
    const techs = [1, 2].map((i) => ({ code: String(i), name: `Tech ${i}`, description: 'd', selected: false }));
    http.expectOne('/api/staff/consultancy/technology/ZEDMSME000600/Silver').flush({
      zedId: 'ZEDMSME000600', certification: 'Silver', recommended: false, canRecommend: false,
      message: 'Recommendation of Gold is in progress.', maxSelection: 10, technologies: techs,
    });
    await settle();
    expect(text(el.querySelector('.counter-block')!)).toBe('Selected: 0/10');
    (el.querySelector('input[type="checkbox"]') as HTMLInputElement).click();
    await settle();
    expect(text(el.querySelector('.counter-block')!)).toBe('Selected: 1/10');
    expect(button('PROCEED').length).toBe(0);
    expect(el.textContent).toContain('Recommendation of Gold is in progress.');
  });
});
