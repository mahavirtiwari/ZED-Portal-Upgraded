import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { PortalSystem } from '../portal-system';
import { StaffDashboardPage } from './dashboard/staff-dashboard';
import { PaymentsReceivedPage } from './dashboard/payments-received';
import { NeftTransactionsPage } from './neft/neft-transactions';
import { STAFF_SYSTEM } from './staff-menu';
import { AgenciesPage } from './users/agencies';
import { AssessorListPage } from './users/assessor-list';
import { MyAssessorsPage } from './users/my-assessors';

/** The Consultancy and Surveillance variants of the shared staff pages (STAFF_SYSTEM), against their live templates. */
describe('staff pages per system', () => {
  let fixture: ComponentFixture<unknown>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create<T>(component: Type<T>, system: PortalSystem, data: Record<string, unknown> = {}) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: STAFF_SYSTEM, useValue: system },
        { provide: ActivatedRoute, useValue: { snapshot: { data, paramMap: convertToParamMap({}), queryParamMap: convertToParamMap({}) } } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(component);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  const headers = () => [...el.querySelectorAll('thead th')].map((th) => th.textContent!.replace(/\s+/g, ' ').trim());

  afterEach(() => http.verify());

  it('shows Consultancy MasterAdmin the organisation and consultant tiles and the TI counts', async () => {
    await create(StaffDashboardPage, 'consultancy');
    http.expectOne('/api/staff/dashboard').flush({ AssessmentAgencies: 12, SiteAssessors: 340, SilverTotal: 5, FaTotal: 2 });
    http.expectOne('/api/staff/dashboard/counts').flush({ total: 40, bronze: 3, silver: 20, gold: 17 });
    await settle();

    const tiles = [...el.querySelectorAll('.dashboard-consultant-block .panel-heading')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(tiles).toEqual(['Empanelled Consultant Organisations12', 'Consultants340']);
    expect(el.querySelectorAll('.dashboard-cert-block .item').length).toBe(3);
    expect(el.textContent).toContain('Technology Intervention');
    expect(el.querySelector('.registered p')!.textContent).toBe('Application');
    expect(el.querySelector('.bronzeVerified p')!.textContent).toBe('TI');
  });

  it('leaves the tiles out when the API sends no organisation counts (not the master admin)', async () => {
    await create(StaffDashboardPage, 'consultancy');
    http.expectOne('/api/staff/dashboard').flush({ SilverTotal: 5 });
    http.expectOne('/api/staff/dashboard/counts').flush({ total: 0, bronze: 0, silver: 0, gold: 0 });
    await settle();
    expect(el.querySelector('.dashboard-consultant-block')).toBeNull();
  });

  it('labels the Surveillance cards as the live dashboard', async () => {
    await create(StaffDashboardPage, 'surveillance');
    http.expectOne('/api/staff/dashboard').flush({ BronzeTotal: 4, BronzePending: 1, SaSilverNcRaised: 2 });
    http.expectOne('/api/staff/dashboard/counts').flush({ total: 0, bronze: 0, silver: 0, gold: 0 });
    await settle();
    const bronze = [...el.querySelectorAll('.panel-bronze p')].map((p) => p.textContent!.replace(/\s+/g, ' ').trim());
    expect(bronze).toEqual(['Total Application: 4', 'Surveillance Pending: 1', 'Surveillance Completed: 0', 'NC Raised: 0', 'Rejected: 0']);
    expect(el.querySelector('.panel-silver')!.textContent).toContain('NC Raised: 2');
  });

  it('lists Consultant Organisations with the live columns', async () => {
    await create(AgenciesPage, 'consultancy', { mode: 'all' });
    http.expectOne('/api/staff/users/agencies').flush([
      { UserId: 'ZEDCO0001', UserName: 'CO One', IdStatus: 'Active', IsActive: true, NoOfUsers: 7, DesktopVerfi: 'DA', SpocName: 'Spoc' },
    ]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toBe('Consultant Organisations');
    expect(headers()).toEqual(['Status', 'User Id', 'Consultant Organisation Details', 'Spoc Details', 'No. of Consultant', 'Actions']);
    expect(el.querySelector('tbody tr')!.querySelectorAll('td').length).toBe(6);
    expect(el.textContent).not.toContain('DA');
  });

  it('lists Consultants with the consultings completed per milestone', async () => {
    await create(AssessorListPage, 'consultancy');
    http.expectOne('/api/staff/users/assessors').flush([{ RowNumber: 1, IdStatus: 'Active', UserId: 'ZEDCC0001', UserName: 'Lead', AgencyUserName: 'CO One', AgencyUserId: 'ZEDCO0001', IsActive: true }]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toBe('Consultants');
    expect(headers()).toEqual(['S.No', 'Status', 'Consultant ID', 'Consultant Details', 'Consultant Organisation Details', 'No. Of Consulting Completed', 'Action(s)']);
    expect(el.querySelector('tbody')!.textContent).toContain('Milestone 1: 0');
  });

  it("lists the CO's Consultants/Experts with the live columns", async () => {
    await create(MyAssessorsPage, 'consultancy');
    http.expectOne('/api/staff/users/assessors/mine').flush([{ UserId: 'ZEDCC0001', UserName: 'Lead', UserType: 'Consultant', IdStatus: 'Active', IsActive: true }]);
    await settle();
    expect(headers()).toEqual([
      'Status', 'User Type', 'Consultant/Expert ID', 'Consultant/Expert Details', 'Consultant/Expert Contact Details',
      'No. Of Assignments Completed', 'Reason for Block', 'Action(s)',
    ]);
    expect(el.querySelector('tbody tr')!.querySelectorAll('td').length).toBe(8);
  });

  it('shows the milestone of a Consultancy payment', async () => {
    await create(PaymentsReceivedPage, 'consultancy');
    http.expectOne((r) => r.url === '/api/staff/dashboard/payments-received').flush([{ RowNumber: 1, ZedId: 'ZEDMSME000001', MileStoneNum: 2, IsCouponUsed: true }]);
    await settle();
    expect(headers()).toContain('Milestone');
    expect(headers()).not.toContain('Joining Reward');
    expect([...el.querySelectorAll('tbody td')].map((td) => td.textContent!.trim())).toContain('2');
  });

  it('lists Consultancy NEFT transactions per technology with Approve, View Details and Visit Report', async () => {
    await create(NeftTransactionsPage, 'consultancy', { list: 'new' });
    http.expectOne((r) => r.url === '/api/staff/neft/transactions').flush({
      transactions: [{
        TransactionId: 9, ZedId: 'ZEDMSME000500', PUnitName: 'Acme', CertificationType: 'Silver', TechnologyName: 'Solar dryer', NameOfTheManufacturer: 'Maker',
        TotalPaidAfterQc: '125000', EligibleAmount: '100000', AccountNo: '1234', IfscCode: 'SBIN0001', VerificationStatus: 4,
      }],
    });
    await settle();
    expect(headers()).toEqual([
      '', 'ZED ID', 'Plant Name', 'TechnologyName', 'Name Of The ManufacturerMake Or Model NameAgency or Supplier', 'Amount PaidEligible Amount',
      'Account No.IFSC Code', 'Branch Address',
    ]);
    const links = [...el.querySelectorAll('tbody a')].map((a) => [a.textContent!.trim(), a.getAttribute('href')]);
    expect(links).toEqual([
      ['View Details', '/staff/consultancy/technology/verification/ZEDMSME000500/Silver'],
      ['Visit Report', '/api/staff/consultancy/tu/ZEDMSME000500/Silver/report'],
    ]);
    expect([...el.querySelectorAll('tbody button')].map((b) => b.textContent!.trim())).toEqual(['Approve']);
  });

  it('titles the Consultancy approved list as the live page', async () => {
    await create(NeftTransactionsPage, 'consultancy', { list: 'approved' });
    http.expectOne((r) => r.url === '/api/staff/neft/transactions').flush({ transactions: [] });
    await settle();
    expect(el.querySelector('h3')!.textContent).toBe('Approved Transaction');
    expect(headers()).toContain('Payment receipt DateApprover Ref No.Approver Amount');
    expect(el.querySelector('.no-data')).toBeTruthy();
  });
});
