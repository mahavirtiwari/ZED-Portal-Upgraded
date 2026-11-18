import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { AllotPage } from './allot';
import { AssessmentResultsPage, searchKind } from './assessment-results';
import { ClientPager } from '../pager';
import { ToastService } from '../toast';
import { TableExport } from '../table-export';
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

  /** 2026-11-18: Completed / Rejected also ask for their count cards (not checked by every test). */
  const noCounts = { total: 0, certifiedThisMonth: 0, surveillanceDue90: 0, duplicates: 0, waitingReallot: null, reallotted: null };
  afterEach(() => {
    for (const r of http.match((r) => r.url.endsWith('/counts'))) r.flush(noCounts);
    http.verify();
  });

  /** An ISO date `days` before today (the API's PaidOn). */
  function daysAgo(days: number): string {
    const d = new Date();
    d.setDate(d.getDate() - days);
    return d.toISOString();
  }

  function flushAttention() {
    for (const r of http.match((r) => r.url === '/api/staff/attention')) r.flush({ total: 0, items: [] });
  }

  const allotRows = () => [
    { ZedId: 'ZEDMSME000001', Certification: 'Bronze', PUnitName: 'Unit 1', CertificationStatus: 2, PaidOn: daysAgo(3), PDistrictName: 'Pune', PStateName: 'Maharashtra', EnterpriseTypee: 'Small' },
    { ZedId: 'ZEDMSME000002', Certification: 'Silver', PUnitName: 'Unit 2', CertificationStatus: 3, CertificationBodyUserId: 'AGENCY1', AgencyName: 'Agency One', ReasonForRejection: 'Busy' },
    { ZedId: 'ZEDMSME000003', Certification: 'Gold', PUnitName: 'Unit 3', CertificationStatus: 2, PaidOn: daysAgo(10), UnitAddress: 'Plot 4, Kanpur' },
  ];

  const chip = (el: HTMLElement, label: string) => [...el.querySelectorAll<HTMLButtonElement>('.cf-chip')].find((b) => b.textContent!.includes(label))!;

  it('Allot: an agency whose PO for the level is used up is shown stopped and cannot be chosen (2026-11-18)', async () => {
    const fixture = await create(AllotPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: allotRows() });
    await settle(fixture);
    (el.querySelectorAll('tbody tr')[1].querySelector('.al-act') as HTMLButtonElement).click();
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/assessment/allot/agencies').flush([
      { userId: 'AGENCY1', userName: 'Agency One', poStopped: true, poMessage: 'Allotment to Agency One for Bronze has stopped.', poLeft: 0 },
      { userId: 'AGENCY2', userName: 'Agency Two', poStopped: false, poLeft: 4 },
    ]);
    await settle(fixture);
    const opts = [...el.querySelectorAll<HTMLElement>('.modal .ad-opt')];
    expect(opts[0].textContent).toContain('Agency Two');
    expect(opts[0].textContent).toContain('PO: 4 left');
    expect(opts[1].textContent).toContain('PO used up — allotment stopped');
    expect(opts[1].querySelector<HTMLInputElement>('input[type=radio]')!.disabled).toBe(true);
    expect(opts[1].getAttribute('title')).toContain('has stopped');
  });

  it('Allot: two tabs with counts, oldest payment first, the eligible agencies and the single allotment', async () => {
    const fixture = await create(AllotPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: allotRows() });
    await settle(fixture);
    expect(chip(el, 'To allot').textContent!.replace(/\s+/g, ' ').trim()).toBe('To allot 2');
    expect(chip(el, 'To re-allot').textContent!.replace(/\s+/g, ' ').trim()).toBe('To re-allot 1');
    let rows = el.querySelectorAll('tbody tr');
    // Waiting longest first; district and state, else the address.
    expect(rows[0].textContent).toContain('ZEDMSME000003');
    expect(rows[0].textContent).toContain('10 days');
    expect(rows[0].textContent).toContain('Plot 4, Kanpur');
    expect(rows[1].textContent).toContain('Pune, Maharashtra');
    expect(rows[1].textContent).toContain('3 days');
    expect(rows[1].textContent).toContain('Small');
    expect(el.textContent).toContain('Allotment Pending');
    const page = fixture.componentInstance as unknown as { href(s: object, k: string): string };
    expect(page.href(allotRows()[0], 'profile')).toBe('/staff/msme-profile/ZEDMSME000001');
    expect(page.href(allotRows()[0], 'details')).toBe('/staff/assessment/da-details/ZEDMSME000001/Bronze');

    (rows[1].querySelector('.al-act') as HTMLButtonElement).click();
    await settle(fixture);
    const agencies = http.expectOne((r) => r.url === '/api/staff/assessment/allot/agencies');
    expect(agencies.request.params.get('zedId')).toBe('ZEDMSME000001');
    expect(agencies.request.params.get('certification')).toBe('Bronze');
    agencies.flush([{ userId: 'AGENCY1', userName: 'Agency One' }]);
    await settle(fixture);
    expect(el.querySelector('.modal')!.textContent).toContain('Pune, Maharashtra');
    const radio = el.querySelector<HTMLInputElement>('.modal input[type=radio]')!;
    radio.click();
    await settle(fixture);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    buttons(el, 'Allot to agency')[0].click();
    await settle(fixture);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/assessment/allot');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', agencyUserId: 'AGENCY1' });
    post.flush({ message: 'Assessment allotted.' });
    await settle(fixture);
    flushAttention();
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: allotRows() });
    await settle(fixture);
    expect(toast).toHaveBeenCalled();
    expect(el.querySelector('.modal')).toBeNull();

    // The re-allot tab: the agency, its rejection and the reason.
    chip(el, 'To re-allot').click();
    await settle(fixture);
    rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('Agency Rejected');
    expect(rows[0].textContent).toContain('Busy');
    expect(rows[0].querySelector('.al-act')!.textContent!.trim()).toBe('Re-allot');
  });

  it('Allot: bulk allotment of the ticked units to one agency, with the refused ones and their reason', async () => {
    const fixture = await create(AllotPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: allotRows() });
    await settle(fixture);
    expect(el.querySelector('.al-bar')).toBeNull();
    for (const box of el.querySelectorAll<HTMLInputElement>('tbody input[type=checkbox]')) box.click();
    await settle(fixture);
    expect(el.querySelector('.al-bar')!.textContent).toContain('2 units selected');
    buttons(el, 'Allot 2 units')[0].click();
    await settle(fixture);
    const lists = http.match((r) => r.url === '/api/staff/assessment/allot/agencies');
    expect(lists.length).toBe(2);
    lists[0].flush([{ userId: 'AG1', userName: 'Agency One' }, { userId: 'AG2', userName: 'Agency Two' }]);
    lists[1].flush([{ userId: 'AG1', userName: 'Agency One' }]);
    await settle(fixture);
    const options = [...el.querySelectorAll('.ad-opt')].map((o) => o.textContent!.replace(/\s+/g, ' ').trim());
    expect(options[0]).toContain('May take 2 of 2');
    expect(options[1]).toContain('May take 1 of 2');
    el.querySelector<HTMLInputElement>('.modal input[type=radio]')!.click();
    await settle(fixture);
    buttons(el, 'Allot to agency')[0].click();
    await settle(fixture);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/assessment/allot/bulk');
    expect(post.request.body).toEqual({
      units: [{ zedId: 'ZEDMSME000003', certification: 'Gold' }, { zedId: 'ZEDMSME000001', certification: 'Bronze' }],
      agencyUserId: 'AG1',
    });
    post.flush({
      allotted: 1, refused: 1,
      results: [
        { zedId: 'ZEDMSME000003', certification: 'Gold', allotted: false, message: 'This assessment can no longer be allotted.' },
        { zedId: 'ZEDMSME000001', certification: 'Bronze', allotted: true, message: 'Assessment allotted.' },
      ],
    });
    await settle(fixture);
    flushAttention();
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: [] });
    await settle(fixture);
    expect(el.querySelector('.modal')!.textContent).toContain('This assessment can no longer be allotted.');
    expect(el.querySelector('.al-bar')).toBeNull();
    buttons(el, 'Close')[0].click();
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();
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
    buttons(el, 'Accept')[0].click();
    await settle(fixture);
    const select = el.querySelector<HTMLSelectElement>('#daAssessor')!;
    expect(Array.from(select.options).map((o) => o.textContent?.trim())).toEqual(['--Select--', 'Bronze assessor']);
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await settle(fixture);
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    buttons(el, 'Allot to assessor')[0].click();
    await settle(fixture);
    const post = http.expectOne('/api/staff/assessment/da-allotment/allot');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', desktopAssessorId: 'ASSESSOR1' });
    post.flush({ message: 'ok' });
    await settle(fixture);
    http.expectOne('/api/staff/assessment/da-allotment').flush({ rows: [], assessors: [], bronzeAssessors: [] });
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001 allotted', 'To Bronze assessor.');
  });

  it('DA Allotment: the tiles filter the list and the SPOC contact is masked', async () => {
    const fixture = await create(DaAllotmentPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/staff/assessment/da-allotment').flush({
      rows: [
        { ZedId: 'ZEDMSME000001', Certification: 'Bronze', UnitSpocMobileNo: '9876543210', UnitSpocEmailId: 'spoc@unit.in' },
        { ZedId: 'ZEDMSME000002', Certification: 'Bronze', DesktopAssessorId: 'AS1', DesktopReasonForRejection: 'Busy' },
      ],
      assessors: [], bronzeAssessors: [],
    });
    await settle(fixture);
    expect(el.querySelector('tbody')!.textContent).toContain('98•••••210');
    expect(el.querySelector('tbody')!.textContent).toContain('sp•••••@unit.in');
    expect(el.querySelector('tbody')!.textContent).not.toContain('9876543210');
    const tile = [...el.querySelectorAll<HTMLButtonElement>('.lc-btn')].find((b) => b.textContent!.includes('Rejected by the assessor'))!;
    tile.click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody')!.textContent).toContain('ZEDMSME000002');
    expect(tile.getAttribute('aria-pressed')).toBe('true');
  });

  it('DA Allotment: shows the API message when a rejection is refused', async () => {
    const fixture = await create(DaAllotmentPage);
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne('/api/staff/assessment/da-allotment').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze' }], assessors: [], bronzeAssessors: [],
    });
    await settle(fixture);
    (el.querySelector('tbody .rm-btn') as HTMLButtonElement).click();
    await settle(fixture);
    expect([...el.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim())).toEqual(['View MSME profile', 'Reject']);
    ([...el.querySelectorAll<HTMLButtonElement>('.rm-item')].find((b) => b.textContent!.trim() === 'Reject')!).click();
    await settle(fixture);
    expect(el.querySelector('.modal h3')!.textContent).toContain('Reject assessment?');
    el.querySelector<HTMLButtonElement>('.modal .cd-ok')!.click();
    await settle(fixture);
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('Please enter reason for rejection.');
    const reason = el.querySelector<HTMLTextAreaElement>('#daRejectReason')!;
    reason.value = 'No capacity';
    reason.dispatchEvent(new Event('input'));
    await settle(fixture);
    el.querySelector<HTMLButtonElement>('.modal .cd-ok')!.click();
    await settle(fixture);
    const post = http.expectOne('/api/staff/assessment/da-allotment/reject');
    expect(post.request.body.reasonForRejection).toBe('No capacity');
    post.flush({ title: 'This assessment is not allotted to your agency or can no longer be rejected.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('can no longer be rejected');
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
    buttons(el, 'Accept')[0].click();
    await settle(fixture);
    expect(el.querySelector('.modal')!.textContent).toContain('Accept assessment?');
    el.querySelector<HTMLButtonElement>('.modal .dv-ok')!.click();
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
    expect(first.request.params.get('pageSize')).toBe('10');
    first.flush({ rows: [{ RowNumber: 1, ZedId: 'ZEDMSME000001', Certification: 'Bronze', DeskAssessment: 'D', DocVerifiAllot: 'May 1, 2024' }], totalCount: 45, pageNo: 1, pageSize: 20 });
    await settle(fixture);
    const heads = [...el.querySelectorAll('thead th')].map((h) => h.textContent!.trim());
    expect(heads).toContain('Assessment allocated on');
    expect(heads).not.toContain('Assessor');
    expect(heads).not.toContain('Actions');
    expect(el.textContent).toContain('May 1, 2024');

    (el.querySelector('.zed-pager button[aria-label="Page 3"]') as HTMLButtonElement).click();
    await settle(fixture);
    const last = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(last.request.params.get('pageNo')).toBe('3');
    last.flush({ rows: [], totalCount: 45, pageNo: 3, pageSize: 20 });
  });

  it('Completed: the master admin has the five actions in the row menu, district and state, the surveillance due flag', async () => {
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', 'completed');
    await settle(fixture);
    flushConfig();
    const el: HTMLElement = fixture.nativeElement;
    const due = new Date();
    due.setDate(due.getDate() + 22);
    const row = {
      ZedId: 'ZEDMSME000008', Certification: 'Gold', CertificationStatus: 16, PUnitName: 'Lakshmi', PDistrictName: 'Chennai', PStateName: 'Tamil Nadu',
      UnitAddress: 'Plot 9, Guindy, Chennai', FirstSurveDueDate: due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
      ModeOfAssessment: 'Onsite Assessment', CertificationPhase: 'ACTIVE', SameUdyamAddress: 1,
    };
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({ rows: [row], totalCount: 1, pageNo: 1, pageSize: 20 });
    await settle(fixture);
    const tr = el.querySelector('tbody tr')!;
    expect(tr.textContent).toContain('Chennai, Tamil Nadu');
    expect(tr.textContent).not.toContain('Guindy');
    expect(tr.textContent).toContain('In 22 days');
    expect(tr.textContent).toContain('Onsite');
    (tr.querySelector('.rm-btn') as HTMLButtonElement).click();
    await settle(fixture);
    expect([...el.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim()))
      .toEqual(['Assessment details', 'View MSME profile', 'Pledge certificate', 'Download certificate', 'View report']);
    const page = fixture.componentInstance as unknown as { href(s: object, k: string): string };
    expect(page.href(row, 'details')).toBe('/staff/assessment/sa-details/ZEDMSME000008/Gold');
    expect(page.href(row, 'pledge')).toBe('/staff/pledge-certificate/ZEDMSME000008');
    expect(page.href(row, 'certificate')).toContain('/api/staff/certification-documents/ZEDMSME000008/Gold/certificate');
  });

  it('Completed: Export reads every page of the filter (200 at a time) into one workbook', async () => {
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const exporter = vi.spyOn(TestBed.inject(TableExport), 'xlsx').mockResolvedValue();
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', 'completed');
    await settle(fixture);
    flushConfig();
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({ rows: [{ ZedId: 'Z1', Certification: 'Bronze' }], totalCount: 201, pageNo: 1, pageSize: 20 });
    await settle(fixture);
    buttons(el, 'Export')[0].click();
    await settle(fixture);
    const p1 = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(p1.request.params.get('pageSize')).toBe('200');
    p1.flush({ rows: Array.from({ length: 200 }, (_, i) => ({ ZedId: 'Z' + i, Certification: 'Bronze' })), totalCount: 201, pageNo: 1, pageSize: 200 });
    await settle(fixture);
    const p2 = http.expectOne((r) => r.url === '/api/staff/assessment/completed');
    expect(p2.request.params.get('pageNo')).toBe('2');
    p2.flush({ rows: [{ ZedId: 'Z200', Certification: 'Bronze' }], totalCount: 201, pageNo: 2, pageSize: 200 });
    await settle(fixture);
    expect(exporter).toHaveBeenCalledTimes(1);
    const [name, sheets] = exporter.mock.calls[exporter.mock.calls.length - 1];
    expect(name).toBe('completed-assessment');
    expect(sheets[0].rows.length).toBe(201);
    expect(sheets[0].columns[0]).toBe('ZED ID');
  });

  it('Rejected: the reason column, the rejected copy of a Bronze record, Re-allot when the unit is on the Allot list', async () => {
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', 'rejected');
    await settle(fixture);
    flushConfig();
    const el: HTMLElement = fixture.nativeElement;
    const rejected = { RowNumber: 1, ZedId: 'ZEDMSME000001', RejectedZedId: 'ZEDMSME000001_D_45', Certification: 'Bronze', ReasonForRejection: 'NCs not closed in time' };
    http.expectOne((r) => r.url === '/api/staff/assessment/rejected').flush({
      rows: [rejected, { ZedId: 'ZEDMSME000002', Certification: 'Silver', ReasonForRejection: 'Documents incomplete' }], totalCount: 2, pageNo: 1, pageSize: 20,
    });
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({
      rows: [{ ZedId: 'ZEDMSME000001', Certification: 'Bronze', PUnitName: 'Unit 1', CertificationBodyUserId: 'AG1' }],
    });
    await settle(fixture);
    expect(el.querySelector('h2')!.textContent).toContain('Rejected Certification');
    expect(el.querySelector('thead')!.textContent).toContain('Reason for rejection');
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('NCs not closed in time');
    const page = fixture.componentInstance as unknown as { href(s: object, k: string): string };
    expect(page.href(rejected, 'details')).toBe('/staff/assessment/da-details/ZEDMSME000001_D_45/Bronze');
    expect(buttons(rows[1] as HTMLElement, 'Re-allot').length).toBe(0);

    buttons(rows[0] as HTMLElement, 'Re-allot')[0].click();
    await settle(fixture);
    const agencies = http.expectOne((r) => r.url === '/api/staff/assessment/allot/agencies');
    expect(agencies.request.params.get('zedId')).toBe('ZEDMSME000001');
    agencies.flush([{ userId: 'AG2', userName: 'Agency Two' }]);
    await settle(fixture);
    el.querySelector<HTMLInputElement>('.modal input[type=radio]')!.click();
    await settle(fixture);
    buttons(el, 'Allot to agency')[0].click();
    await settle(fixture);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/assessment/allot');
    expect(post.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Bronze', agencyUserId: 'AG2' });
    post.flush({ message: 'Assessment allotted.' });
    await settle(fixture);
    flushAttention();
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: [] });
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();
    expect(buttons(el, 'Re-allot').length).toBe(0);
  });

  // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-11's four and staff-12's three count cards.
  it('Completed and Rejected: the count cards of the filter', async () => {
    TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = TestBed.createComponent(AssessmentResultsPage);
    fixture.componentRef.setInput('kind', 'completed');
    await settle(fixture);
    flushConfig();
    const el: HTMLElement = fixture.nativeElement;
    http.expectOne((r) => r.url === '/api/staff/assessment/completed').flush({ rows: [], totalCount: 9, pageNo: 1, pageSize: 10 });
    const counts = http.expectOne((r) => r.url === '/api/staff/assessment/completed/counts');
    expect(counts.request.params.has('pageNo')).toBe(false);
    counts.flush({ ...noCounts, total: 9, certifiedThisMonth: 4, surveillanceDue90: 2, duplicates: 1 });
    await settle(fixture);
    const tiles = () => [...el.querySelectorAll('.lc-item')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(tiles()).toEqual(['9 Completed', '4 Certified this month', '2 Surveillance due in 90 days', '1 Duplicates flagged']);
    expect(el.querySelector('#resSearch')!.getAttribute('placeholder')).toBe('e.g. ZEDM000005');

    fixture.componentRef.setInput('kind', 'rejected');
    await settle(fixture);
    http.expectOne((r) => r.url === '/api/staff/assessment/rejected').flush({ rows: [], totalCount: 5, pageNo: 1, pageSize: 10 });
    http.expectOne((r) => r.url === '/api/staff/assessment/rejected/counts').flush({ ...noCounts, total: 5, waitingReallot: 2, reallotted: 3 });
    http.expectOne((r) => r.url === '/api/staff/assessment/allot').flush({ rows: [] });
    await settle(fixture);
    expect(tiles()).toEqual(['5 Rejected', '2 Waiting to be re-allotted', '3 Re-allotted']);
    // staff-12's own filter row: no labels, no Search button.
    expect(el.querySelectorAll('.rs-filters .form-label').length).toBe(0);
    expect(buttons(el, 'Search').length).toBe(0);
  });

  it('Rejected: the one search box picks ZED ID, Udyam number or unit name', () => {
    expect(searchKind('ZEDM000005')).toBe('Zed Id');
    expect(searchKind('UC3250522285')).toBe('Zed Id');
    expect(searchKind('UDYAM-MH-01-0000001')).toBe('Udyam Number');
    expect(searchKind('Pump Engineers')).toBe('Unit Name');
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
