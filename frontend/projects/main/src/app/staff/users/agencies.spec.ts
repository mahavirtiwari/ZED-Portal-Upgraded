import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ToastService } from '../toast';
import { AgenciesPage } from './agencies';
import { AgencyRow } from './users.api';

describe('AgenciesPage', () => {
  let fixture: ComponentFixture<AgenciesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let toasts: ToastService;

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

  const button = (label: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;
  const rows = () => [...el.querySelectorAll('tbody tr')];

  async function create(mode: string) {
    await TestBed.configureTestingModule({
      imports: [AgenciesPage],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: { snapshot: { data: { mode } } } }],
    }).compileComponents();
    fixture = TestBed.createComponent(AgenciesPage);
    http = TestBed.inject(HttpTestingController);
    toasts = TestBed.inject(ToastService);
    el = fixture.nativeElement;
    await settle();
    // The levels page reads the Admin's texts for the "turn off" pop-up.
    http.match('/api/content').forEach((r) => r.flush([]));
  }

  /** Opens a row's ⋮ menu and picks the item. */
  async function pick(row: Element, label: string) {
    (row.querySelector('.rm-btn') as HTMLButtonElement).click();
    await settle();
    button(label, row)!.click();
    await settle();
  }

  async function type(selector: string, text: string) {
    const box = el.querySelector(selector) as HTMLTextAreaElement;
    box.value = text;
    box.dispatchEvent(new Event('input'));
    await settle();
  }

  const submit = async () => {
    (el.querySelector('zed-confirm-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
  };

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('masks the SPOC mobile and e-mail and offers two buttons plus a menu per row', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001'), agency('ZEDAA0002', { IsActive: false, IdStatus: 'In-Active', MobileNo: null })]);
    await settle();
    expect(el.querySelector('h2')!.textContent).toContain('Assessment Agencies');
    expect(el.textContent).toContain('+ Add agency');
    const first = rows()[0];
    expect(first.textContent).toContain('98•••••210');
    expect(first.textContent).toContain('sp•••••@a.test');
    expect(first.textContent).not.toContain('9876543210');
    expect(first.textContent).not.toContain('spoc@a.test');
    expect(rows()[1].textContent).toContain('Mobile not saved');
    expect([...first.querySelectorAll('.acts > a')].map((a) => a.textContent!.trim())).toEqual(['Edit', 'Assessors']);

    (first.querySelector('.rm-btn') as HTMLButtonElement).click();
    await settle();
    expect([...first.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim())).toEqual(['Edit agency', 'View assessors', 'Send reset link', 'View history', 'Purchase orders', 'Block agency']);
    (rows()[1].querySelector('.rm-btn') as HTMLButtonElement).click();
    await settle();
    expect([...rows()[1].querySelectorAll('.rm-item')].map((b) => b.textContent!.trim())).toEqual(['Edit agency', 'View assessors', 'View history', 'Purchase orders', 'Unblock agency']);
  });

  it('sends a reset link only after the confirmation and confirms it with a toast', async () => {
    await create('all');
    const confirm = vi.spyOn(window, 'confirm');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001')]);
    await settle();
    await pick(rows()[0], 'Send reset link');
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.textContent).toContain('Send password reset link?');
    expect(dialog.textContent).toContain('sp•••••@a.test');
    http.expectNone('/api/staff/users/agencies/ZEDAA0001/password-reset');

    button('Send link', dialog)!.click();
    await settle();
    http.expectOne({ method: 'POST', url: '/api/staff/users/agencies/ZEDAA0001/password-reset' })
      .flush({ message: "A password reset link has been sent to the user's registered e-mail address (s***@a.test)." });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001')]);
    await settle();
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(toasts.toasts().at(-1)).toMatchObject({ tone: 'success', title: 'Reset link sent', message: 'E-mailed to s***@a.test' });
    expect(confirm).not.toHaveBeenCalled();
  });

  it('searches and blocks an agency with a required reason', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001'), agency('ZEDAA0002', { IsActive: false, IdStatus: 'In-Active' })]);
    await settle();
    const search = el.querySelector('input[aria-label="Search agencies"]') as HTMLInputElement;
    search.value = 'aa0002';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(rows().length).toBe(1);
    search.value = '';
    search.dispatchEvent(new Event('input'));
    await settle();

    await pick(rows()[0], 'Block agency');
    expect(el.querySelector('zed-confirm-dialog h3')!.textContent).toContain('Block ZEDAA0001 Pvt Ltd?');
    await submit();
    expect(el.querySelector('zed-confirm-dialog .help-block')!.textContent).toContain('Please enter the reason.');
    http.expectNone('/api/staff/users/agencies/ZEDAA0001/block');

    await type('zed-confirm-dialog textarea', 'Complaint received');
    await submit();
    const req = http.expectOne('/api/staff/users/agencies/ZEDAA0001/block');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'Complaint received' });
    req.flush({ message: 'User Blocked successful' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([]);
    await settle();
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(toasts.toasts().at(-1)).toMatchObject({ title: 'ZEDAA0001 Pvt Ltd blocked', message: 'User Blocked successful' });
  });

  it('shows the counts and filters by tile, status and sector type', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([
      agency('ZEDAA0001', { SectorActivity: 'Manufacturing', NoOfUsers: 10 }),
      agency('ZEDAA0002', { IsActive: false, IdStatus: 'In-Active', SectorActivity: 'Services', NoOfUsers: 3 }),
      agency('ZEDAA0003', { SectorActivity: 'Both', NoOfUsers: 5 }),
      agency('ZEDAA0004', { SectorActivity: null, NoOfUsers: null }),
    ]);
    await settle();
    const tiles = [...el.querySelectorAll('.lc-item')];
    expect(tiles.map((t) => t.querySelector('b')!.textContent!.trim())).toEqual(['4', '3', '1', '18']);
    const ids = () => rows().map((r) => r.querySelector('.ag-id')?.textContent!.trim()).filter(Boolean);
    const chip = (group: string, label: string) =>
      [...el.querySelectorAll(`[data-filter="${group}"] button`)].find((b) => b.textContent!.trim().startsWith(label)) as HTMLButtonElement;

    expect(chip('sector', 'Manufacturing').textContent).toContain('1');
    (tiles[2] as HTMLButtonElement).click();
    await settle();
    expect(ids()).toEqual(['ZEDAA0002']);
    expect(chip('status', 'In-active').getAttribute('aria-pressed')).toBe('true');
    chip('status', 'Active').click();
    await settle();
    expect(ids()).toEqual(['ZEDAA0001', 'ZEDAA0003', 'ZEDAA0004']);
    chip('sector', 'Not set').click();
    await settle();
    expect(ids()).toEqual(['ZEDAA0004']);
    expect(rows()[0].textContent).toContain('Sector type not set');
    chip('sector', 'Services').click();
    await settle();
    expect(ids()).toEqual([]);
    expect(el.querySelector('.no-data')!.textContent).toContain('No agency matches the search or filter.');
    button('Clear filters')!.click();
    await settle();
    expect(ids().length).toBe(4);
  });

  it('unblocks with a reason and keeps a refusal in the pop-up (2026-11-16)', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0002', { IsActive: false })]);
    await settle();
    await pick(rows()[0], 'Unblock agency');
    (el.querySelector('zed-reason-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('zed-reason-dialog')!.textContent).toContain('Please enter the reason.');
    http.expectNone('/api/staff/users/agencies/ZEDAA0002/unblock');
    await type('#reason-dialog-text', 'Re-empanelled');
    (el.querySelector('zed-reason-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const req = http.expectOne('/api/staff/users/agencies/ZEDAA0002/unblock');
    expect(req.request.body).toEqual({ reason: 'Re-empanelled' });
    req.flush({ title: 'This user is not blocked.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('zed-reason-dialog .help-block')!.textContent).toContain('This user is not blocked.');
  });

  it('shows the agency history in the side panel', async () => {
    await create('all');
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001')]);
    await settle();
    await pick(rows()[0], 'View history');
    expect(el.querySelector('zed-user-history')!.textContent).toContain('ZEDAA0001 Pvt Ltd · ZEDAA0001');
    http.expectOne('/api/staff/users/agencies/ZEDAA0001/history').flush([
      { action: 'Unblocked', reason: 'Documents verified', actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-08T10:15:00' },
      { action: 'Blocked', reason: 'ID proof unclear', actionBy: 'MASTER1', actionByRole: 7, actionDate: '2026-11-06T17:30:00' },
    ]);
    await settle();
    const items = [...el.querySelectorAll('zed-user-history .hp-list li')];
    expect(items.map((i) => i.querySelector('strong')!.textContent)).toEqual(['Unblocked', 'Blocked']);
    expect(items[1].textContent).toContain('By MASTER1 (Master Admin) · Reason: ID proof unclear');
    button('Close', el.querySelector('zed-user-history')!)!.click();
    await settle();
    expect(el.querySelector('zed-user-history')).toBeNull();
  });

  it('switches each level: on confirms, off asks for the reason (Agency Level Allocation, 2026-11-08)', async () => {
    await create('levels');
    const confirm = vi.spyOn(window, 'confirm');
    http.expectOne('/api/staff/users/agencies').flush([
      agency('ZEDAA0001', { AllowBronzeAssessments: false, AllowGoldAssessments: false, LevelReasons: { Gold: 'Pending re-empanelment' } }),
      agency('ZEDAA0002', { AllowSilverAssessments: true, AllowGoldAssessments: true, AllowZedxAssessments: true }),
    ]);
    await settle();
    expect(el.querySelector('h2')!.textContent).toContain('Agency Level Allocation');
    expect(el.textContent).not.toContain('+ Add');
    expect(el.querySelector('zed-row-menu')).toBeNull();
    const tile = (label: string) => [...el.querySelectorAll('.lc-item')].find((t) => t.textContent!.includes(label))!.textContent!.replace(/\s+/g, ' ');
    expect(tile('Gold enabled')).toContain('1 Gold enabled 1 off');
    expect(tile('Silver enabled')).toContain('2 Silver enabled 0 off');
    const lv = (code: string) => rows()[0].querySelector(`button[data-level="${code}"]`) as HTMLButtonElement;
    expect(lv('Bronze').getAttribute('aria-checked')).toBe('false');
    expect(lv('Silver').classList).toContain('on');
    expect(lv('Gold').classList).toContain('off');
    expect(rows()[0].textContent).toContain('Gold off: “Pending re-empanelment”');

    [...el.querySelectorAll('[data-filter="status"] button')].find((b) => b.textContent!.trim() === 'Any level off')!.dispatchEvent(new Event('click'));
    await settle();
    expect(rows().length).toBe(1);

    // On: a confirmation, no reason.
    lv('Bronze').click();
    await settle();
    expect(el.querySelector('zed-confirm-dialog h3')!.textContent).toContain('Turn on Bronze for this agency?');
    expect(el.querySelector('zed-confirm-dialog textarea')).toBeNull();
    button('Turn on Bronze')!.click();
    await settle();
    const enable = http.expectOne('/api/staff/users/agencies/ZEDAA0001/level-assessments');
    expect(enable.request.body).toEqual({ level: 'Bronze', allow: true, reason: '' });
    enable.flush({ message: 'Bronze assessments enabled successfully.' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([agency('ZEDAA0001', { AllowGoldAssessments: false })]);
    await settle();
    expect(toasts.toasts().at(-1)!.title).toBe('Bronze turned on');

    // Off: the Admin's note, a required reason (e-mailed to the agency).
    (el.querySelector('tbody tr button[data-level="ZEDX"]') as HTMLButtonElement).click();
    await settle();
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.querySelector('h3')!.textContent).toContain('Turn off ZED-X for this agency?');
    expect(dialog.textContent).toContain("won't be allotted new ZED-X assessments. Work already allotted continues.");
    expect(button('Keep ZED-X on', dialog)).toBeTruthy();
    await submit();
    expect(dialog.textContent).toContain('Please enter the reason.');
    await type('zed-confirm-dialog textarea', 'Assessor shortage');
    await submit();
    const disable = http.expectOne('/api/staff/users/agencies/ZEDAA0001/level-assessments');
    expect(disable.request.body).toEqual({ level: 'ZEDX', allow: false, reason: 'Assessor shortage' });
    disable.flush({ message: 'ZED-X assessments disabled successfully.' });
    await settle();
    http.expectOne('/api/staff/users/agencies').flush([]);
    await settle();
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
  });
});
