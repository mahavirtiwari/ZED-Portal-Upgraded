import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { FaSubmissionsPage } from './fa-submissions';

describe('FaSubmissionsPage', () => {
  let fixture: ComponentFixture<FaSubmissionsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const counts = { New: 2, InProgress: 1, Qc: 0, Approved: 4, Rejected: 0 };
  const row = (id: number, extra: Record<string, unknown> = {}) => ({
    Id: id, ZedId: `ZEDMSME0000${id}`, EnterpriseName: `Unit ${id}`, CertificationType: 'Bronze', UnitAddress: 'Kanpur',
    CertificationBodyUserId: null, CertificationBodyName: null, FinancialAssessorId: null, FaAssessorName: null, ReasonForRejection: null,
    ...extra,
  });

  const text = (b: Element) => b.textContent!.replace(/\s+/g, ' ').trim();
  /** Buttons and links whose text is exactly the label. */
  const button = (label: string) => [...el.querySelectorAll('button, a')].filter((b) => text(b) === label) as HTMLElement[];
  /** Tab buttons ("FA ALLOTMENT 2"). */
  const tab = (label: string) => [...el.querySelectorAll('button')].filter((b) => text(b).startsWith(label + ' ')) as HTMLElement[];

  async function create(roleId: number) {
    await TestBed.configureTestingModule({
      imports: [FaSubmissionsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'User', roleId, role: 'x', subRoles: ['FinancialVerification'] });
    fixture = TestBed.createComponent(FaSubmissionsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  function expectList(status: string) {
    const req = http.expectOne((r) => r.url === '/api/staff/schemes/fa/submissions');
    expect(req.request.params.get('status')).toBe(status);
    return req;
  }

  afterEach(() => http.verify());

  it('lets the master admin allot a new application to an agency', async () => {
    await create(StaffRole.MasterAdmin);
    expectList('1').flush({ rows: [row(11), row(12, { CertificationBodyUserId: 'AG1', ReasonForRejection: 'Busy' })], counts });
    await settle();

    expect(el.textContent).toContain('FA ALLOTMENT 2');
    expect(button('ALLOT').length).toBe(1);
    expect(button('RE-ALLOT').length).toBe(1);
    expect(el.textContent).toContain('Rejected');

    button('ALLOT')[0].click();
    await settle();
    const agencies = http.expectOne((r) => r.url === '/api/staff/schemes/fa/agencies');
    expect(agencies.request.params.get('zedId')).toBe('ZEDMSME000011');
    agencies.flush([{ userId: 'AG1', userName: 'Agency One' }, { userId: 'AG2', userName: 'Agency Two' }]);
    await settle();

    // Nothing chosen yet.
    button('ALLOT').at(-1)!.click();
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please select assessment agency.');

    const select = el.querySelector('#faChoice') as HTMLSelectElement;
    select.value = 'AG2';
    select.dispatchEvent(new Event('change'));
    await settle();
    button('ALLOT').at(-1)!.click();
    await settle();

    const allot = http.expectOne('/api/staff/schemes/fa/allot');
    expect(allot.request.body).toEqual({ zedId: 'ZEDMSME000011', certification: 'Bronze', agencyUserId: 'AG2' });
    allot.flush({ message: 'Application allotted.' });
    await settle();
    expectList('1').flush({ rows: [], counts });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Application allotted.');
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('lets an agency accept with one of its assessors or reject with a reason', async () => {
    await create(StaffRole.Agency);
    expectList('1').flush({ rows: [row(11, { CertificationBodyUserId: 'U1' })], counts });
    await settle();
    expect(button('ALLOT').length).toBe(0);

    button('REJECT')[0].click();
    await settle();
    const reason = el.querySelector('#faReason') as HTMLTextAreaElement;
    expect(reason.maxLength).toBe(100);
    reason.value = 'Not our sector';
    reason.dispatchEvent(new Event('input'));
    await settle();
    button('REJECT').at(-1)!.click();
    await settle();
    const reject = http.expectOne('/api/staff/schemes/fa/reject');
    expect(reject.request.body).toEqual({ zedId: 'ZEDMSME000011', certification: 'Bronze', reason: 'Not our sector' });
    reject.flush({ title: 'This application has already been processed.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('already been processed');
  });

  it('switches tabs and links assigned applications to the verification page', async () => {
    await create(StaffRole.Agency);
    expectList('1').flush({ rows: [], counts });
    await settle();
    tab('IN-PROGRESS')[0].click();
    await settle();
    expectList('2').flush({ rows: [row(13, { CertificationBodyUserId: 'U1', FinancialAssessorId: 'DA1', FaAssessorName: 'Assessor' })], counts });
    await settle();

    const link = button('View Details')[0] as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('/staff/financial-assistance/ZEDMSME000013?certification=Bronze');
    expect(button('ACCEPT').length).toBe(0);
  });

  it('shows assessors their in-progress list without tabs', async () => {
    await create(StaffRole.DesktopAssessor);
    expectList('2').flush({ rows: [row(14, { FinancialAssessorId: 'U1' })], counts: null });
    await settle();
    expect(tab('FA ALLOTMENT').length).toBe(0);
    expect(button('ASSESS').length).toBe(1);
    expect(el.querySelector('thead')!.textContent).not.toContain('Assessor Details');
  });
});
