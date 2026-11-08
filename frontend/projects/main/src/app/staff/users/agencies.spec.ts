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

    const search = el.querySelector('input[aria-label="Search agencies"]') as HTMLInputElement;
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

  it('shows the counts and filters by status and sector type', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([
      agency('ZEDAA0001', { SectorActivity: 'Manufacturing', NoOfUsers: 10 }),
      agency('ZEDAA0002', { IsActive: false, IdStatus: 'In-Active', SectorActivity: 'Services', NoOfUsers: 3 }),
      agency('ZEDAA0003', { SectorActivity: 'Both', NoOfUsers: 5 }),
      agency('ZEDAA0004', { SectorActivity: null, NoOfUsers: null }),
    ]);
    await settle();
    const stat = (k: string) => el.querySelector(`[data-stat="${k}"]`)!.textContent!.trim();
    expect([stat('total'), stat('on'), stat('off'), stat('assessors')]).toEqual(['4', '3', '1', '18']);
    const ids = () => [...el.querySelectorAll('tbody tr .ag-id')].map((s) => s.textContent!.trim());
    const filterButton = (group: string, label: string) =>
      [...el.querySelectorAll(`[data-filter="${group}"] button`)].find((b) => b.textContent!.trim().startsWith(label)) as HTMLButtonElement;

    expect(filterButton('sector', 'Manufacturing').textContent).toContain('1');
    filterButton('status', 'In-Active').click();
    await settle();
    expect(ids()).toEqual(['ZEDAA0002']);
    filterButton('status', 'Active').click();
    await settle();
    expect(ids()).toEqual(['ZEDAA0001', 'ZEDAA0003', 'ZEDAA0004']);
    filterButton('sector', 'Not set').click();
    await settle();
    expect(ids()).toEqual(['ZEDAA0004']);
    expect(el.querySelector('tbody tr')!.textContent).toContain('Sector type not set');
    filterButton('sector', 'Services').click();
    await settle();
    expect(ids()).toEqual([]);
    expect(el.querySelector('.no-data')!.textContent).toContain('No agency matches the search or filter.');
    button('Clear filters')!.click();
    await settle();
    expect(ids().length).toBe(4);
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

  it('switches each level of an agency on the Agency Level Allocation page and has no add or edit (2026-11-08)', async () => {
    await create('levels');
    http.expectOne('/api/staff/users/agencies').flush([
      agency('ZEDAA0001', { AllowBronzeAssessments: false, AllowGoldAssessments: false, LevelReasons: { Gold: 'Pending re-empanelment' } }),
      agency('ZEDAA0002', { AllowSilverAssessments: true, AllowGoldAssessments: true, AllowZedxAssessments: true }),
    ]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Agency Level Allocation');
    expect(el.textContent).not.toContain('+ Add New');
    expect(el.textContent).not.toContain('Edit');
    // Per level: enabled and off.
    expect(el.querySelector('[data-stat="level-Gold"]')!.textContent!.replace(/\s+/g, ' ')).toContain('1· 1 off');
    expect(el.querySelector('[data-stat="level-Silver"]')!.textContent!.replace(/\s+/g, ' ')).toContain('2· 0 off');
    const first = el.querySelector('tbody tr')!;
    const lv = (code: string) => first.querySelector(`button[data-level="${code}"]`) as HTMLButtonElement;
    expect(lv('Bronze').classList).toContain('off');
    expect(lv('Silver').classList).toContain('on');
    expect(lv('Gold').classList).toContain('off');
    expect(first.textContent).toContain('Gold off: “Pending re-empanelment”');

    // "Any level off": only the first agency.
    [...el.querySelectorAll('[data-filter="status"] button')].find((b) => b.textContent!.trim() === 'Any level off')!.dispatchEvent(new Event('click'));
    await settle();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);

    // Enabling asks to confirm.
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    lv('Bronze').click();
    await settle();
    const enable = http.expectOne('/api/staff/users/agencies/ZEDAA0001/level-assessments');
    expect(enable.request.body).toEqual({ level: 'Bronze', allow: true, reason: '' });
    enable.flush({ message: 'Bronze assessments enabled successfully.' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001', { AllowGoldAssessments: false })]);
    await settle();

    // Disabling asks for a reason.
    (el.querySelector('tbody tr button[data-level="ZEDX"]') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('#agency-dialog-title')!.textContent).toContain('Disable ZED-X Assessments');
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.modal')!.textContent).toContain('This is required.');
    const reason = el.querySelector('#dialog-reason') as HTMLTextAreaElement;
    reason.value = 'Assessor shortage';
    reason.dispatchEvent(new Event('input'));
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const disable = http.expectOne('/api/staff/users/agencies/ZEDAA0001/level-assessments');
    expect(disable.request.body).toEqual({ level: 'ZEDX', allow: false, reason: 'Assessor shortage' });
    disable.flush({ message: 'ZED-X assessments disabled successfully.' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([]);
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });
});
