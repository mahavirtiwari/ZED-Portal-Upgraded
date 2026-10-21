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
    const list = http.expectOne((r) => r.url === '/api/staff/consultancy/tu/submissions');
    expect(list.request.params.get('status')).toBe('2');
    list.flush({ rows: [row(), row({ Id: 2, ZedId: 'ZEDMSME000501', FinancialAssessorId: 'DFO1', TechUpgradeStatus: 4 })], counts: { New: 2 } });
    await settle();

    expect(el.textContent).toContain('TU ALLOTMENT 2');
    expect(button('ACCEPT').length).toBe(1);
    expect(button('RE-ALLOT').length).toBe(1);
    const links = [...el.querySelectorAll('a')].map((a) => a.getAttribute('href'));
    expect(links).toContain('/staff/consultancy/technology/verification/ZEDMSME000500/Silver');

    button('ACCEPT')[0].click();
    await settle();
    http.expectOne('/api/staff/consultancy/tu/assessors').flush([{ userId: 'DFO1', userName: 'Dfo One' }]);
    await settle();
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

  const application = (extra: Record<string, unknown> = {}) => ({
    certification: 'Silver', stage: 'Approved, payout pending',
    details: { EligibleSubsidyPer: 80, TotalPaidAfterQc: '125000.00', EligibleAmount: '100000.00', AccountNo: '123456789012', IfscCode: 'SBIN0001234', BranchAddress: 'X', BankName: 'SBI' },
    technologies: [{ id: 301, isEligible: true, details: { TechnologyCode: '12', TechnologyName: 'Solar dryer', AmountPaid: '125000', MsmeAmountPaid: '125000' } }],
    documents: [{ id: 7001, photoType: 'Purchased Technology', technologyCode: '12', timeStamp: null, isPdf: true, url: '/api/doc', opened: true, isVerified: 'Yes', sourceOfValidation: null, assessorRemarks: null, needsScreenshot: true, screenshots: [] }],
    meeting: null, recommended: [{ code: '12', name: 'Solar dryer' }],
    canValidate: false, canDecide: false, canApprove: false, canEditAmounts: true, canEditAccount: true, hasReport: true, ...extra,
  });

  it('lets the state coordinator correct a verified amount and links the report', async () => {
    await create(TuVerificationPage, StaffRole.StateCoordinator, { zedId: 'ZEDMSME000500', level: 'Silver' });
    http.expectOne('/api/staff/consultancy/tu/ZEDMSME000500').flush([application()]);
    await settle();

    expect(el.textContent).toContain('Solar dryer');
    expect(el.textContent).toContain('100000.00');
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
});
