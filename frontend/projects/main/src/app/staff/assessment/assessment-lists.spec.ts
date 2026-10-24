import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { AllotPage } from './allot';
import { AssessmentResultsPage } from './assessment-results';
import { ClientPager } from '../pager';
import { DaAllotmentPage } from './da-allotment';
import { DaVerificationPage } from './da-verification';
import { NonConformancesPage } from './non-conformances';

describe('assessment list pages', () => {
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

  function buttons(el: HTMLElement, label: string): HTMLElement[] {
    return Array.from(el.querySelectorAll<HTMLElement>('button, input[type=button]')).filter(
      (b) => (b instanceof HTMLInputElement ? b.value : b.textContent?.trim()) === label,
    );
  }

  async function create<T>(type: Type<T>) {
    const fixture = TestBed.createComponent(type);
    await settle(fixture);
    flushConfig();
    return fixture;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('Allot: lists records, loads the eligible agencies and allots', async () => {
    const fixture = await create(AllotPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({
      rows: [
        { ZedId: 'ZEDMSME000001', Certification: 'Bronze', PUnitName: 'Unit 1', CertificationStatus: 2 },
        { ZedId: 'ZEDMSME000002', Certification: 'Silver', PUnitName: 'Unit 2', CertificationStatus: 3, CertificationBodyUserId: 'AGENCY1', ReasonForRejection: 'Busy' },
      ],
    });
    await settle(fixture);
    expect(el.textContent).toContain('Allotment Pending');
    expect(el.textContent).toContain('Agency Rejected');
    expect(el.querySelector('a[href="staff/msme-profile/ZEDMSME000001"]')).toBeTruthy();
    expect(el.querySelector('a[href="/staff/assessment/da-details/ZEDMSME000001/Bronze"]')).toBeTruthy();
    expect(buttons(el, 'RE-ALLOT').length).toBe(1);

    buttons(el, 'ALLOT')[0].click();
    await settle(fixture);
    const agencies = http.expectOne((r) => r.url === '/api/staff/assessment/allot/agencies');
    expect(agencies.request.params.get('zedId')).toBe('ZEDMSME000001');
    expect(agencies.request.params.get('certification')).toBe('Bronze');
    agencies.flush([{ userId: 'AGENCY1', userName: 'Agency One' }]);
    await settle(fixture);

    const select = el.querySelector<HTMLSelectElement>('.modal select')!;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    buttons(el, 'ALLOT').find((b) => b instanceof HTMLInputElement)!.click();
    await settle(fixture);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/assessment/allot');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', agencyUserId: 'AGENCY1' });
    post.flush({ message: 'Assessment allotted.' });
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: [] });
    await settle(fixture);
    expect(el.querySelector('.alert-success')).toBeTruthy();
  });

  it('DA Allotment: offers Bronze assessors for Bronze records and posts the choice', async () => {
    const fixture = await create(DaAllotmentPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/staff/assessment/da-allotment').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze', PUnitName: 'Unit 1' }],
      assessors: [{ userId: 'ASSESSOR9', userName: 'Silver assessor' }],
      bronzeAssessors: [{ userId: 'ASSESSOR1', userName: 'Bronze assessor' }],
    });
    await settle(fixture);
    buttons(el, 'ACCEPT')[0].click();
    await settle(fixture);
    const select = el.querySelector<HTMLSelectElement>('#daAssessor')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['--Select--', 'Bronze assessor']);
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    buttons(el, 'ACCEPT').find((b) => b instanceof HTMLInputElement)!.click();
    await settle(fixture);
    const post = http.expectOne('/api/staff/assessment/da-allotment/allot');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', desktopAssessorId: 'ASSESSOR1' });
    post.flush({ message: 'ok' });
    await settle(fixture);
    http.expectOne('/api/staff/assessment/da-allotment').flush({ rows: [], assessors: [], bronzeAssessors: [] });
  });

  it('DA Allotment: shows the API message when a rejection is refused', async () => {
    const fixture = await create(DaAllotmentPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/staff/assessment/da-allotment').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze' }], assessors: [], bronzeAssessors: [],
    });
    await settle(fixture);
    buttons(el, 'REJECT')[0].click();
    await settle(fixture);
    buttons(el, 'REJECT').find((b) => b instanceof HTMLInputElement)!.click();
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please enter reason for rejection.');
    const reason = el.querySelector<HTMLTextAreaElement>('#daRejectReason')!;
    reason.value = 'No capacity';
    reason.dispatchEvent(new Event('input'));
    await settle(fixture);
    buttons(el, 'REJECT').find((b) => b instanceof HTMLInputElement)!.click();
    await settle(fixture);
    http.expectOne('/api/staff/assessment/da-allotment/reject').flush({ title: 'This assessment is not allotted to your agency or can no longer be rejected.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('can no longer be rejected');
  });

  it('Desktop Verification: accept before assess', async () => {
    const fixture = await create(DaVerificationPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/staff/assessment/da-verification').flush({
      rows: [
        { ZedId: 'ZEDMSME000001', Certification: 'Bronze', DesktopAccepted: null },
        { ZedId: 'ZEDMSME000002', Certification: 'Bronze', DesktopAccepted: true },
      ],
    });
    await settle(fixture);
    expect(el.querySelectorAll('a[href^="/staff/assessment/da-details/"]').length).toBe(1);
    buttons(el, 'ACCEPT')[0].click();
    await settle(fixture);
    buttons(el, 'ACCEPT').find((b) => b instanceof HTMLInputElement)!.click();
    await settle(fixture);
    const post = http.expectOne('/api/staff/assessment/da-verification/accept');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze' });
    post.flush({ message: 'Unit accepted.' });
    await settle(fixture);
    http.expectOne('/api/staff/assessment/da-verification').flush({ rows: [] });
  });

  it('Non-Conformances: Bronze opens here, Silver/Gold on the current portal; filters reload', async () => {
    const fixture = await create(NonConformancesPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/non-conformances').flush({
      rows: [
        { ZedId: 'ZEDMSME000001', Certification: 'Bronze', DesktopAccepted: true, NcStatus: 2, CertificationStatus: 4, RowNumber: 1 },
        { ZedId: 'ZEDMSME000002', Certification: 'Silver', DesktopAccepted: true, ModeOfAssessment: 'Onsite Assessment', RowNumber: 2 },
      ],
    });
    await settle(fixture);
    expect(el.querySelector('a[href="/staff/assessment/da-details/ZEDMSME000001/Bronze"]')).toBeTruthy();
    expect(el.querySelector('a[href="/staff/assessment/sa-details/ZEDMSME000002/Silver"]')).toBeTruthy();
    expect(el.querySelector('tr.table-danger')).toBeTruthy();
    expect(el.textContent).toContain('Onsite');

    const level = el.querySelector<HTMLSelectElement>('#ncLevel')!;
    level.value = 'Gold';
    level.dispatchEvent(new Event('change'));
    await settle(fixture);
    const req = http.expectOne((r) => r.url === '/api/staff/assessment/non-conformances');
    expect(req.request.params.get('certification')).toBe('Gold');
    req.flush({ rows: [] });
  });

  it('Completed: pages on the server and hides columns by role', async () => {
    TestBed.inject(AuthService).setUser({ userId: 'ASSESSOR1', userName: 'A', roleId: 3, role: 'DesktopAssessor', subRoles: ['DesktopVerification'] });
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', 'completed');
    await settle(fixture);
    flushConfig();
    const el: HTMLElement = fixture.nativeElement;
    const first = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(first.request.params.get('pageNo')).toBe('1');
    expect(first.request.params.get('pageSize')).toBe('20');
    first.flush({ rows: [{ RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Bronze', DeskAssessment: 'D', DocVerifiAllot: 'May 1, 2024' }], totalCount: 45, pageNo: 1, pageSize: 20 });
    await settle(fixture);
    expect(el.textContent).toContain('Assessment Allocated On');
    expect(el.textContent).not.toContain('Assessors Details');
    expect(el.textContent).toContain('May 1, 2024');

    buttons(el, 'Last')[0].click();
    await settle(fixture);
    const last = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(last.request.params.get('pageNo')).toBe('3');
    last.flush({ rows: [], totalCount: 45, pageNo: 3, pageSize: 20 });
  });

  it('Rejected: master admin opens the rejected copy of a Bronze record', async () => {
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', 'rejected');
    await settle(fixture);
    flushConfig();
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/rejected').flush({
      rows: [{ RowNumber: 1, ZedId: 'ZEDMSME000001', RejectedZedId: 'ZEDMSME000001_D_45', Certification: 'Bronze' }], totalCount: 1, pageNo: 1, pageSize: 20,
    });
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Rejected Certification');
    expect(el.querySelector('a[href="/staff/assessment/da-details/ZEDMSME000001_D_45/Bronze"]')).toBeTruthy();
  });

  it('ClientPager searches any shown value and pages', () => {
    const pager = new ClientPager();
    pager.set(Array.from({ length: 25 }, (_, i) => ({ ZedId: `ZEDMSME${String(i).padStart(6, '0')}` })));
    expect(pager.lastPage()).toBe(3);
    pager.go('last');
    expect(pager.page().length).toBe(5);
    pager.setSearch('000024');
    expect(pager.page().map((r) => r['ZedId'])).toEqual(['ZEDMSME000024']);
    expect(pager.pageNo()).toBe(1);
  });
});
