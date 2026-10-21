import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { AgenciesPage } from './agencies';
import { AgencyRow } from './users.api';

describe('AgenciesPage', () => {
  let fixture: ComponentFixture<AgenciesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const agency = (id: string, extra: Partial<AgencyRow> = {}): AgencyRow => ({
    Id: 1, UserId: id, UserName: `${id} Pvt Ltd`, Address: 'Plot 1', Pincode: '110001', SpocName: 'Spoc', MobileNo: '9876543210',
    Email: 'spoc@a.test', IsActive: true, IdStatus: 'Active', DesktopVerfi: 'Desktop', SiteVerifi: '', FinanceVerfi: '', NoOfUsers: 4,
    NoOfBronzeAssessors: 2, AllowBronzeAssessments: true, ...extra,
  });

  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;

  async function create(mode: string) {
    await TestBed.configureTestingModule({
      imports: [AgenciesPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: { mode } } } }],
    }).compileComponents();
    fixture = TestBed.createComponent(AgenciesPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('sends an active agency a password reset link after confirmation', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001'), agency('ZEDAA0002', { IsActive: false, IdStatus: 'In-Active' })]);
    await settle();
    expect([...el.querySelectorAll('button')].filter((b) => b.textContent!.trim() === 'Reset Link').length).toBe(1);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Reset Link')!.click();
    http.expectOne({ method: 'POST', url: '/api/staff/users/agencies/ZEDAA0001/password-reset' }).flush({ message: 'A password reset link has been sent.' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001')]);
    await settle();
    expect(el.textContent).toContain('A password reset link has been sent.');
  });

  it('lists agencies, filters them and blocks one with a reason', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001'), agency('ZEDAA0002', { IsActive: false, IdStatus: 'In-Active' })]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Assessment Agencies');
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    expect(el.textContent).toContain('+ Add New');

    const search = el.querySelector('.search-input input') as HTMLInputElement;
    search.value = 'aa0002';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await settle();

    button('Block')!.click();
    await settle();
    expect(el.querySelector('.modal')!.textContent).toContain('Reason for Block the Agency');
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('This is required.');

    const reason = el.querySelector('#dialog-reason') as HTMLTextAreaElement;
    reason.value = 'Complaint received';
    reason.dispatchEvent(new Event('input'));
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const req = http.expectOne('/api/staff/users/agencies/ZEDAA0001/block');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'Complaint received' });
    req.flush({ message: 'User Blocked successful' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([]);
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('User Blocked successful');
  });

  it('unblocks after confirmation and shows API errors', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0002', { IsActive: false })]);
    await settle();
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    button('UnBlock')!.click();
    await settle();
    http.expectNone('/api/staff/users/agencies/ZEDAA0002/unblock');

    confirm.mockReturnValue(true);
    button('UnBlock')!.click();
    await settle();
    http.expectOne('/api/staff/users/agencies/ZEDAA0002/unblock').flush({ title: 'This user is not blocked.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('This user is not blocked.');
  });

  it('switches Bronze assessments in bronze mode and has no add or edit', async () => {
    await create('bronze');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001', { AllowBronzeAssessments: false })]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Bronze Assessment Agencies');
    expect(el.textContent).not.toContain('+ Add New');
    expect(el.textContent).not.toContain('Edit');
    expect(el.querySelector('tbody td:nth-child(6)')!.textContent).toContain('2');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Enable Bronze Assessments')!.click();
    await settle();
    const req = http.expectOne('/api/staff/users/agencies/ZEDAA0001/bronze-assessments');
    expect(req.request.body).toEqual({ allow: true, reason: '' });
    req.flush({ message: 'Bronze assessments enabled successfully.' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([]);
  });
});
