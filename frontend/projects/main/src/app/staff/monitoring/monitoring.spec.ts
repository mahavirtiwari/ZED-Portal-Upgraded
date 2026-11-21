import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { MonitoringPage } from './monitoring';
import { ToastService } from '../toast';
import { AuthService } from '@zed/shared';

/** A date `days` from today in the procedures' "MMMM d, yyyy" form. */
function inDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

describe('MonitoringPage', () => {
  let fixture: ComponentFixture<MonitoringPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const counts = { NotStarted: 1, InProgress: 2, Qc: 3, Nc: 4, Rj: 5 };
  const unit = (n: number, extra: Record<string, unknown> = {}) => ({
    RowNumber: n, ZedId: `ZEDMSME${String(n).padStart(6, '0')}`, Certification: 'Silver', PUnitName: `Unit ${n}`,
    CertificationStatus: 14, NcStatus: 0, NcCount: 2, SameUdyamAddress: 0, NcFinalClosureDt: 'October 30, 2026', ...extra,
  });

  const tile = (label: string) =>
    [...el.querySelectorAll<HTMLButtonElement>('.lc-btn')].find((b) => b.textContent!.includes(label))!;

  function listRequest(): TestRequest {
    return http.expectOne((r) => r.method === 'GET' && r.url === '/api/staff/monitoring');
  }

  /** The open page's first list (every level, in progress), then the NC tile. */
  async function openNcTab(canManage: boolean, units = [unit(1), unit(2, { NcStatus: 2, SameUdyamAddress: 3 })]) {
    listRequest().flush({ units: [], counts, canManage });
    await settle();
    tile('Non-conformance').click();
    await settle();
    const req = listRequest();
    expect(req.request.params.has('certification')).toBe(false);
    expect(req.request.params.get('status')).toBe('4');
    req.flush({ units, counts, canManage });
    await settle();
  }

  async function openMenu(row: Element): Promise<string[]> {
    (row.querySelector('.rm-btn') as HTMLButtonElement).click();
    await settle();
    return [...row.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim());
  }

  async function pick(label: string) {
    ([...el.querySelectorAll<HTMLButtonElement>('.rm-item')].find((b) => b.textContent!.trim().startsWith(label))!).click();
    await settle();
  }

  async function setup(status: string | null = null, roleId: number | null = null) {
    await TestBed.configureTestingModule({
      imports: [MonitoringPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(status ? { status } : {}) } } },
        ...(roleId ? [{ provide: AuthService, useValue: { currentUser: () => ({ roleId }) } }] : [])],
    }).compileComponents();
    fixture = TestBed.createComponent(MonitoringPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  afterEach(() => http.verify());

  it('opens on every level, in progress, with the stage tiles', async () => {
    await setup();
    const req = listRequest();
    expect(req.request.params.has('certification')).toBe(false);
    expect(req.request.params.get('status')).toBe('3');
    req.flush({ units: [unit(1, { CertificationStatus: 9 })], counts, canManage: false });
    await settle();
    expect(tile('Assessment in progress').getAttribute('aria-pressed')).toBe('true');
    expect(tile('Non-conformance').textContent).toContain('4');
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
  });

  it('the header bell opens the asked stage (?status=4)', async () => {
    await setup('4');
    expect(listRequest().request.params.get('status')).toBe('4');
  });

  it('a chosen level is sent; "All levels" is not', async () => {
    await setup();
    listRequest().flush({ units: [], counts, canManage: false });
    await settle();
    const s = el.querySelector('#certification') as HTMLSelectElement;
    s.value = 'Gold';
    s.dispatchEvent(new Event('change'));
    await settle();
    expect(listRequest().request.params.get('certification')).toBe('Gold');
  });

  it('shows agencies the list without NC dates or admin actions', async () => {
    await setup();
    await openNcTab(false);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(2);
    expect(el.querySelector('thead')!.textContent).not.toContain('NC closure');
    expect(rows[1].classList).toContain('mo-nc-open');
    expect(rows[1].querySelector('.mo-dup')!.textContent!.trim()).toBe('3');
    expect(await openMenu(rows[0])).toEqual(['Assessment details', 'View MSME profile']);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigateByUrl').mockResolvedValue(true);
    await pick('Assessment details');
    expect(navigate).toHaveBeenCalledWith('/staff/assessment/sa-details/ZEDMSME000001/Silver');
    await openMenu(rows[0]);
    await pick('View MSME profile');
    expect(navigate).toHaveBeenCalledWith('/staff/msme-profile/ZEDMSME000001');
  });

  it('filters by agency and mode and searches the loaded list on the client', async () => {
    await setup();
    listRequest().flush({
      units: [
        unit(1, { CertificationBodyUserId: 'AG1', AgencyName: 'Agency One', ModeOfAssessment: 'Onsite Assessment' }),
        unit(2, { CertificationBodyUserId: 'AG2', AgencyName: 'Agency Two', ModeOfAssessment: 'Remote Assessment' }),
        ...Array.from({ length: 23 }, (_, i) => unit(i + 3, { CertificationBodyUserId: 'AG1', AgencyName: 'Agency One' })),
      ],
      counts,
      canManage: false,
    });
    await settle();
    expect(el.querySelectorAll('tbody tr').length).toBe(10);
    const agency = el.querySelector('#monitoringAgency') as HTMLSelectElement;
    expect([...agency.options].map((o) => o.text.trim())).toEqual(['All agencies', 'Agency One', 'Agency Two']);
    agency.value = 'AG2';
    agency.dispatchEvent(new Event('change'));
    await settle();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    expect(el.querySelector('tbody')!.textContent).toContain('Remote');
    agency.value = '';
    agency.dispatchEvent(new Event('change'));
    const mode = el.querySelector('#monitoringMode') as HTMLSelectElement;
    mode.value = 'Onsite Assessment';
    mode.dispatchEvent(new Event('change'));
    await settle();
    expect(el.querySelectorAll('tbody tr').length).toBe(1);
    mode.value = '';
    mode.dispatchEvent(new Event('change'));
    const search = el.querySelector('#monitoringSearch') as HTMLInputElement;
    search.value = 'ZEDMSME000017';
    search.dispatchEvent(new Event('input'));
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('ZEDMSME000017');
  });

  it('Due: days left or overdue to the NC final closure date, soonest first, sortable', async () => {
    await setup();
    await openNcTab(true, [
      unit(1, { NcFinalClosureDt: inDays(8) }),
      unit(2, { NcFinalClosureDt: inDays(-2) }),
      unit(3, { NcFinalClosureDt: null }),
    ]);
    const due = () => [...el.querySelectorAll('tbody tr')].map((r) => r.querySelectorAll('td')[7].textContent!.trim());
    // 2026-11-21 (audit item 7): a unit without a due date says so.
    expect(due()).toEqual(['Overdue 2 days', '8 days left', 'No TAT set']);
    (el.querySelector('.mo-due-h') as HTMLButtonElement).click();
    await settle();
    expect(due()).toEqual(['8 days left', 'Overdue 2 days', 'No TAT set']);
  });

  it('lets master admin extend the NC closure date and reloads', async () => {
    await setup();
    await openNcTab(true);
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-10's header reads "Assessment dates" for everyone; the
    // master admin's column still shows the NC closure date (below).
    expect(el.querySelector('thead')!.textContent).toContain('Assessment dates');
    expect(el.querySelector('thead')!.textContent).not.toContain('NC closure');
    const row = el.querySelector('tbody tr')!;
    expect(await openMenu(row)).toEqual(['Assessment details', 'View MSME profile', 'Extend NC final closure date', 'Step back to NC1']);
    await pick('Extend NC');
    expect(el.querySelector('.modal')!.textContent).toContain('October 30, 2026');
    const days = el.querySelector('#noOfDays') as HTMLSelectElement;
    // As the old pop-up: 0 to 30 days, 0 first.
    expect([...days.options].map((o) => o.text.trim())).toEqual(Array.from({ length: 31 }, (_, i) => String(i)));
    expect(days.options[days.selectedIndex].text.trim()).toBe('0');
    days.value = [...days.options].find((o) => o.text.trim() === '7')!.value;
    days.dispatchEvent(new Event('change'));
    await settle();
    const toast = vi.spyOn(TestBed.inject(ToastService), 'success');
    ([...el.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent!.trim() === 'Submit')!).click();
    await settle();
    const req = http.expectOne('/api/staff/monitoring/extend-nc-closure');
    expect(req.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Silver', noOfDays: 7 });
    req.flush({ message: 'NC final closure date extended.' });
    await settle();
    listRequest().flush({ units: [unit(1)], counts, canManage: true });
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(toast).toHaveBeenCalledWith('ZEDMSME000001', 'NC final closure date extended.');
  });

  it('asks for at least one day before extending', async () => {
    await setup();
    await openNcTab(true);
    await openMenu(el.querySelector('tbody tr')!);
    await pick('Extend NC');
    ([...el.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent!.trim() === 'Submit')!).click();
    await settle();
    http.expectNone('/api/staff/monitoring/extend-nc-closure');
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('1 to 30');
  });

  it('shows the API message when an action is refused', async () => {
    await setup();
    await openNcTab(true);
    await openMenu(el.querySelector('tbody tr')!);
    await pick('Step back to NC1');
    ([...el.querySelectorAll<HTMLButtonElement>('.modal button')].find((b) => b.textContent!.trim() === 'Submit')!).click();
    await settle();
    http.expectOne('/api/staff/monitoring/step-back-nc').flush({ title: 'Invalid Details.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Invalid Details.');
  });

  it('offers send back to agency on scheduled units only, never for Bronze', async () => {
    await setup();
    listRequest().flush({ units: [], counts, canManage: true });
    await settle();
    tile('Scheduled, not started').click();
    await settle();
    listRequest().flush({
      units: [
        unit(1, { Certification: 'Gold', CertificationStatus: 8 }),
        unit(2, { Certification: 'Gold', CertificationStatus: 9 }),
        unit(3, { Certification: 'Bronze', CertificationStatus: 8 }),
      ],
      counts,
      canManage: true,
    });
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(await openMenu(rows[0])).toContain('Send back to agency');
    expect(await openMenu(rows[1])).not.toContain('Send back to agency');
    expect(await openMenu(rows[2])).not.toContain('Send back to agency');
  });

  it('renders unit data as text', async () => {
    await setup();
    await openNcTab(false, [unit(1, { PUnitName: '<img src=x onerror=alert(1)>' })]);
    expect(el.querySelector('tbody img')).toBeNull();
    expect(el.querySelector('tbody')!.textContent).toContain('<img src=x onerror=alert(1)>');
  });
  // ----- 2026-11-18 (approved monitoring design) -----

  const stages = [
    { status: 2, total: 3, delayed: 0, tracks: { desktop: 2, site: 1 } },
    { status: 3, total: 4, delayed: 0, tracks: { desktop: 1, site: 3 } },
    { status: 5, total: 5, delayed: 4, tracks: { desktop: 2, site: 3 } },
    { status: 4, total: 0, delayed: 0, tracks: { desktop: 0, site: 0 } },
    { status: 7, total: 0, delayed: 0, tracks: { desktop: 0, site: 0 } },
  ];
  const tab = (key: string) => el.querySelector(`[data-track="${key}"]`) as HTMLButtonElement;
  const chip = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.cf-chip')].find((b) => b.textContent!.trim().startsWith(label))!;
  const rowIds = () => [...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('.mo-id')?.textContent?.trim());

  it('stage cards show desktop and site counts and the delayed cases; sub-tabs split the list', async () => {
    await setup();
    listRequest().flush({
      units: [unit(1, { CertificationStatus: 3, Track: 'desktop' }), unit(2, { CertificationStatus: 9, Track: 'site' }), unit(3, { CertificationStatus: 13, Track: 'site' })],
      counts, canManage: false, stages,
    });
    await settle();
    // 2026-11-21 (audit item 7): each count on its own row at every width.
    expect([...tile('Quality check').querySelectorAll('.lc-part')].map((p) => p.textContent!.trim())).toEqual(['Desktop 2', 'Site 3', '4 delayed']);
    expect(tile('Assessment in progress').textContent).toContain('4');
    expect(tab('desktop').textContent).toContain('1');
    expect(tab('site').textContent).toContain('2');
    // The first sub-section with cases; a case at desktop is never listed under site.
    expect(tab('desktop').getAttribute('aria-selected')).toBe('true');
    expect(rowIds()).toEqual(['ZEDMSME000001']);
    expect(el.querySelector('#monitoringMode')).toBeNull();
    tab('site').click();
    await settle();
    expect(rowIds()).toEqual(['ZEDMSME000002', 'ZEDMSME000003']);
    expect(el.querySelector('#monitoringMode')).not.toBeNull();
  });

  it('in progress, site: the app steps as chips, the pending submission and the row steps', async () => {
    await setup();
    listRequest().flush({
      units: [
        unit(1, { CertificationStatus: 9, Track: 'site', Step: 'distributed', SubmissionPending: true }),
        unit(2, { CertificationStatus: 9, Track: 'site', Step: 'opening', SubmissionPending: false }),
        unit(3, { CertificationStatus: 13, Track: 'site', Step: 'submitted', SubmissionPending: false }),
      ],
      counts, canManage: false, stages,
    });
    await settle();
    expect(chip('Parameters distributed').textContent).toContain('1');
    expect(chip('Submission pending through mobile app').textContent).toContain('1');
    expect(el.querySelector('thead')!.textContent).toContain('Progress');
    const steps = [...el.querySelectorAll('tbody tr')[1].querySelectorAll('.mo-steps > span')].map((x) => x.className);
    expect(steps).toEqual(['done', 'current', 'todo']);
    expect(el.querySelectorAll('tbody tr')[0].textContent).toContain('Submission pending through mobile app');
    chip('Submission pending through mobile app').click();
    await settle();
    expect(rowIds()).toEqual(['ZEDMSME000001']);
    chip('Assessment submitted through mobile app').click();
    await settle();
    expect(rowIds()).toEqual(['ZEDMSME000003']);
  });

  it('quality check: delay chips from the TAT, rows highlighted, most delayed first', async () => {
    await setup('5');
    listRequest().flush({
      units: [
        unit(1, { CertificationStatus: 5, Track: 'desktop', TatBucket: 'on-time', TatLateHours: -48, TatLabel: 'On time · 2 days left', TatRule: 'Days allowed in Desktop assessment quality check' }),
        unit(2, { CertificationStatus: 5, Track: 'desktop', TatBucket: 'gt10', TatLateHours: 312, TatLabel: '13 days late' }),
        unit(3, { CertificationStatus: 5, Track: 'desktop', TatBucket: 'lt1', TatLateHours: 18, TatLabel: '18 hours late' }),
      ],
      counts, canManage: false, stages,
    });
    await settle();
    expect(rowIds()).toEqual(['ZEDMSME000002', 'ZEDMSME000003', 'ZEDMSME000001']);
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].classList).toContain('mo-d4');
    expect(rows[1].classList).toContain('mo-d1');
    expect(rows[0].textContent).toContain('13 days late');
    expect(rows[2].textContent).toContain('On time · 2 days left');
    expect(el.querySelector('thead')!.textContent).toContain('Delay');
    expect(chip('More than 10 days').textContent).toContain('1');
    chip('Delayed less than 1 day').click();
    await settle();
    expect(rowIds()).toEqual(['ZEDMSME000003']);
  });

  it('the date range follows the stage, is sent to the API and is cleared with Clear All', async () => {
    await setup();
    listRequest().flush({ units: [], counts, canManage: false, stages });
    await settle();
    expect(el.querySelector('label[for="monitoringFrom"]')!.textContent).toBe('Assessment between');
    tile('Quality check').click();
    await settle();
    listRequest().flush({ units: [], counts, canManage: false, stages });
    await settle();
    expect(el.querySelector('label[for="monitoringFrom"]')!.textContent).toBe('Submitted between');
    const from = el.querySelector('#monitoringFrom') as HTMLInputElement;
    from.value = '2026-11-01';
    from.dispatchEvent(new Event('input'));
    await settle();
    let req = listRequest();
    expect(req.request.params.get('from')).toBe('2026-11-01');
    expect(req.request.params.get('status')).toBe('5');
    req.flush({ units: [], counts, canManage: false, stages });
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Clear All') as HTMLButtonElement).click();
    await settle();
    req = listRequest();
    expect(req.request.params.has('from')).toBe(false);
    req.flush({ units: [], counts, canManage: false, stages });
    await settle();
  });

  it('exports the filtered list to Excel with the contacts in full', async () => {
    await setup();
    listRequest().flush({
      units: [unit(1, { CertificationStatus: 9, Track: 'site', UnitSpocName: 'Ravi', UnitSpocMobileNo: '9876543210', UnitSpocEmailId: 'ravi@x.test' })],
      counts, canManage: false, stages,
    });
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Export') as HTMLButtonElement).click();
    await settle();
    const req = http.expectOne('/api/staff/export/xlsx');
    const sheet = req.request.body.sheets[0];
    expect(sheet.columns).toContain('Contact mobile');
    expect(sheet.rows[0]).toContain('9876543210');
    expect(sheet.rows[0]).toContain('Site assessment');
    // 2026-11-21 (audit item 7): the button says it is working, then a toast says the file is ready.
    const button = [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Exporting…') as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    req.flush(new Blob(['x']));
    await settle();
    expect([...el.querySelectorAll('button')].some((b) => b.textContent!.trim() === 'Export')).toBe(true);
    expect(TestBed.inject(ToastService).toasts().map((x) => x.title)).toContain('Export ready');
  });

  it('keeps ?status= in step with the chosen stage (audit item 7)', async () => {
    await setup();
    const router = TestBed.inject(Router);
    const navigate = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    listRequest().flush({ units: [], counts, canManage: false });
    await settle();
    tile('Non-conformance').click();
    await settle();
    listRequest().flush({ units: [], counts, canManage: false });
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { status: 4 }, queryParamsHandling: 'merge', replaceUrl: true }));
  });

  it('an agency login has no agency filter or Agency column, and no Due column without due dates (audit item 7)', async () => {
    await setup(null, 2);
    listRequest().flush({ units: [unit(1, { CertificationStatus: 9, NcFinalClosureDt: null })], counts, canManage: false });
    await settle();
    expect(el.querySelector('#monitoringAgency')).toBeNull();
    const heads = [...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim());
    expect(heads).not.toContain('Agency');
    expect(heads).not.toContain('Due');
    expect(el.querySelector('tbody .mo-name b')?.textContent ?? '').not.toContain('Agency');
  });
});

describe('MonitoringPage per system', () => {
  let http: HttpTestingController;

  async function create(system: 'consultancy' | 'surveillance') {
    await TestBed.configureTestingModule({
      imports: [MonitoringPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: ASSESSMENT_SYSTEM, useValue: system }],
    }).compileComponents();
    const fixture = TestBed.createComponent(MonitoringPage);
    http = TestBed.inject(HttpTestingController);
    const settle = async () => {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    await settle();
    const el: HTMLElement = fixture.nativeElement;
    const s = el.querySelector('#certification') as HTMLSelectElement;
    const tile = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.lc-btn')].find((b) => b.textContent!.includes(label))!;
    const menu = async (row: Element) => {
      (row.querySelector('.rm-btn') as HTMLButtonElement).click();
      await settle();
      return [...el.querySelectorAll<HTMLButtonElement>('.rm-item')];
    };
    return { fixture, el, settle, select: s, tile, menu };
  }

  const counts = { NotStarted: 1, InProgress: 2, Qc: 3, Nc: 4, Rj: 5 };
  const list = () => http.expectOne((r) => r.url === '/api/staff/monitoring');

  afterEach(() => http.verify());

  it('consultancy: Silver/Gold/ZED-X, three stages, milestone columns and no admin actions', async () => {
    const { el, settle, select, menu } = await create('consultancy');
    expect(el.textContent).toContain('Consultancy Monitoring');
    expect([...select.options].map((o) => o.text.trim())).toEqual(['All levels', 'Silver', 'Gold', 'ZED-X']);
    expect([...el.querySelectorAll('.lc-btn')].length).toBe(3);
    expect(el.textContent).toContain('Consultancy in progress');
    expect(el.textContent).not.toContain('Non-conformance');
    expect(el.querySelector('#monitoringMode')).toBeNull();
    list().flush({
      units: [
        { ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 8, NcCount: 1, BdsFromDate: 'May 1, 2026', HapFromDate: 'May 9, 2026', TechExpertName: 'Expert One' },
        { ZedId: 'ZEDMSME000002', Certification: 'Silver', CertificationStatus: 9, NcCount: 2, SaAssessmentDate: 'June 2, 2026', DocVerifiAllot: 'May 20, 2026' },
      ],
      counts,
      canManage: true,
    });
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows[0].textContent).toContain('Milestone 1');
    expect(rows[0].textContent).toContain('BDS: May 1, 2026');
    expect(rows[0].textContent).toContain('Expert One');
    expect(rows[1].textContent).toContain('PR1: June 2, 2026');
    expect(el.querySelector('thead')!.textContent).not.toContain('Duplicates');
    expect((await menu(rows[0])).map((b) => b.textContent!.trim())).toEqual(['View details', 'View MSME profile']);
  });

  it('surveillance: Surveillance No, no send back to the agency', async () => {
    const { el, settle, tile, menu } = await create('surveillance');
    expect(el.textContent).toContain('Surveillance Monitoring');
    list().flush({ units: [], counts, canManage: true });
    await settle();
    tile('Scheduled').click();
    await settle();
    list().flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Gold', CertificationStatus: 8, SurveillanceNo: '2nd Surveillance', ModeOfAssessment: 'Remote' }],
      counts,
      canManage: true,
    });
    await settle();
    const row = el.querySelector('tbody tr')!;
    expect(row.textContent).toContain('2nd Surveillance');
    expect(row.textContent).toContain('Remote');
    expect((await menu(row)).map((b) => b.textContent!.trim())).not.toContain('Send back to agency');
    expect(el.querySelector('thead')!.textContent).toContain('Surveillance dates');
  });

  it('surveillance: Extend NC final closure date on the Rejected stage as well, step back only in NC', async () => {
    const { el, settle, tile, menu } = await create('surveillance');
    list().flush({ units: [], counts, canManage: true });
    await settle();
    tile('Rejected').click();
    await settle();
    http.expectOne((r) => r.url === '/api/staff/monitoring' && r.params.get('status') === '7').flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 17, NcCount: 2, NcFinalClosureDt: 'October 30, 2026' }],
      counts,
      canManage: true,
    });
    await settle();
    const items = await menu(el.querySelector('tbody tr')!);
    expect(items.map((b) => b.textContent!.trim())).not.toContain('Step back to NC1');
    items.find((b) => b.textContent!.includes('Extend NC'))!.click();
    await settle();
    const days = el.querySelector('#noOfDays') as HTMLSelectElement;
    days.value = [...days.options].find((o) => o.text.trim() === '1')!.value;
    days.dispatchEvent(new Event('change'));
    await settle();
    ([...el.querySelectorAll('.modal button')].find((b) => b.textContent!.trim() === 'Submit') as HTMLButtonElement).click();
    await settle();
    const req = http.expectOne('/api/staff/monitoring/extend-nc-closure');
    expect(req.request.body).toEqual({ zedId: 'ZEDMSME000001', certification: 'Silver', noOfDays: 1 });
    req.flush({ message: 'NC final closure date extended.' });
    await settle();
    for (const r of http.match((r) => r.url === '/api/staff/monitoring')) r.flush({ units: [], counts, canManage: true });
  });

  it('surveillance: open NC rows marked; the agency sees the allotment date before the assessment date', async () => {
    const { el, settle } = await create('surveillance');
    list().flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 14, NcStatus: 2, DocVerifiAllot: 'May 20, 2026', SaAssessmentDate: 'June 2, 2026' }],
      counts,
      canManage: false,
    });
    await settle();
    const row = el.querySelector('tbody tr')!;
    expect(row.classList).toContain('mo-nc-open');
    // The two dates are one line each, the allotment date first.
    const cell = row.querySelectorAll('td')[5];
    expect([...cell.querySelectorAll('div')].map((d) => d.textContent!.trim())).toEqual(['May 20, 2026', 'June 2, 2026']);
  });

  it('surveillance: the master admin sees the assessment and NC closure dates only', async () => {
    const { el, settle } = await create('surveillance');
    list().flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 9, DocVerifiAllot: 'May 20, 2026', SaAssessmentDate: 'June 2, 2026', NcFinalClosureDt: 'July 1, 2026' }],
      counts,
      canManage: true,
    });
    await settle();
    const dates = [...el.querySelectorAll('tbody tr td')[5].querySelectorAll('div')].map((d) => d.textContent!.trim());
    expect(dates).toEqual(['June 2, 2026', 'July 1, 2026']);
  });
  it('consultancy: the stages split by milestone, all milestones first', async () => {
    const { el, settle, tile } = await create('consultancy');
    list().flush({
      units: [{ ZedId: 'ZEDMSME000001', Certification: 'Silver', CertificationStatus: 15, NcCount: 1, Track: 'm1' },
              { ZedId: 'ZEDMSME000002', Certification: 'Gold', CertificationStatus: 15, NcCount: 2, Track: 'm2', TatLabel: '3 days late', TatBucket: '1-5', TatLateHours: 72 }],
      counts, canManage: true,
      stages: [{ status: 2, total: 0, delayed: 0, tracks: {} }, { status: 3, total: 2, delayed: 1, tracks: { m1: 1, m2: 1 } }, { status: 5, total: 0, delayed: 0, tracks: {} }],
    });
    await settle();
    expect([...tile('Consultancy in progress').querySelectorAll('.lc-part')].map((p) => p.textContent!.trim())).toEqual(['M1 1', 'M2 1', 'M3 0']);
    const tabs = [...el.querySelectorAll('[data-track]')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(tabs).toEqual(['All milestones 2', 'Milestone 1 1', 'Milestone 2 1', 'Milestone 3 0']);
    expect(el.querySelectorAll('tbody tr').length).toBe(2);
    (el.querySelector('[data-track="m2"]') as HTMLButtonElement).click();
    await settle();
    const rows = el.querySelectorAll('tbody tr');
    expect(rows.length).toBe(1);
    expect(rows[0].textContent).toContain('3 days late');
  });
});
