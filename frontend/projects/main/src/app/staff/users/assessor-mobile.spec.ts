import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ADMIN_PORTAL } from '../admin-portal';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { AssessorFormPage } from './assessor-form';
import { AssessorMobilePanel, asUtc, canSeeAssessorMobile } from './assessor-mobile';
import { SurveillanceUsersPage } from './surveillance-users';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function signIn(roleId: number) {
  TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'Someone', roleId, role: 'x', subRoles: [] });
}

const URL = '/api/staff/assessor-mobile/ZEDAS0001';

const device = {
  deviceId: 'dev-1', model: 'Samsung SM-A515F', osVersion: '13', firstSeenAt: '2026-10-01T09:30:00',
  lastLoginAt: '2026-11-02T18:05:00', lastSeenAt: '2026-11-02T18:40:00', lastIp: '10.1.2.3',
};

const signIns = [
  { at: '2026-11-02T12:35:00', result: 'Success', reason: null, deviceId: 'dev-1', deviceModel: 'Samsung SM-A515F', osVersion: '13', appVersion: '4.0.1', ipAddress: '10.1.2.3' },
  {
    at: '2026-11-01T08:00:00', result: 'Failed', reason: 'Your account is registered on another mobile (Samsung SM-A515F).', deviceId: 'dev-2',
    deviceModel: 'Redmi Note 12', osVersion: '14', appVersion: '4.0.1', ipAddress: '10.9.9.9',
  },
];

describe('AssessorMobilePanel', () => {
  let fixture: ComponentFixture<AssessorMobilePanel>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function create(system: 'main' | 'surveillance' = 'main', own: 'main' | 'surveillance' = 'main') {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: STAFF_SYSTEM, useValue: own }] });
    fixture = TestBed.createComponent(AssessorMobilePanel);
    fixture.componentRef.setInput('userId', 'ZEDAS0001');
    fixture.componentRef.setInput('system', system);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  const releaseButton = () => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Release phone') as HTMLButtonElement | undefined;

  it('shows the registered phone, the recent sign-ins and Release phone', async () => {
    await create();
    const get = http.expectOne(URL);
    expect(get.request.method).toBe('GET');
    expect(get.request.context.get(ADMIN_PORTAL)).toBeNull();
    get.flush({ userId: 'ZEDAS0001', device, signIns });
    await settle(fixture);

    expect(el.querySelector('.am-title')!.textContent).toContain('Registered mobile · site assessor app');
    expect(el.querySelector('.am-hint')!.textContent).toContain('ZEDAS0001 can sign in only on this phone.');
    expect(releaseButton()).toBeTruthy();
    const tiles = [...el.querySelectorAll('.am-tile')].map((t) =>
      [t.querySelector('.am-label')!, t.querySelector('.am-value')!].map((s) => s.textContent!.replace(/\s+/g, ' ').trim()).join(': '),
    );
    expect(tiles).toEqual(['Make and model: Samsung SM-A515F', 'Android: 13', 'Registered on: 01-10-2026', 'Last sign-in · IP: 02-11-2026 18:05 · 10.1.2.3']);

    const rows = [...el.querySelectorAll('.am-table tbody tr')];
    expect(rows.length).toBe(2);
    // UTC from the server, shown in local time.
    const local = new Date('2026-11-02T12:35:00Z');
    const pad = (n: number) => String(n).padStart(2, '0');
    expect(rows[0].querySelector('td')!.textContent!.trim()).toBe(
      `${pad(local.getDate())}-${pad(local.getMonth() + 1)}-${local.getFullYear()} ${pad(local.getHours())}:${pad(local.getMinutes())}`,
    );
    expect(rows[0].querySelector('.status-badge')!.classList).toContain('is-success');
    expect(rows[0].querySelector('.am-reason')).toBeNull();
    expect(rows[1].querySelector('.status-badge')!.classList).toContain('is-rejected');
    expect(rows[1].querySelector('.am-reason')!.textContent).toContain('registered on another mobile');
    expect(rows[1].textContent).toContain('Redmi Note 12');
    expect(rows[1].textContent).toContain('10.9.9.9');
    expect(rows[1].textContent).toContain('4.0.1');
  });

  it('says no mobile is registered yet, without Release phone, and no sign-ins yet', async () => {
    await create();
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
    await settle(fixture);
    expect(el.textContent).toContain('No mobile registered yet — the next sign-in registers the phone.');
    expect(el.querySelector('.am-tile')).toBeNull();
    expect(releaseButton()).toBeUndefined();
    expect(el.textContent).toContain('No sign-ins yet.');
    expect(el.querySelector('.am-table')).toBeNull();
  });

  it('releases the phone after the confirmation, shows the message and reloads', async () => {
    await create();
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device, signIns });
    await settle(fixture);

    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    releaseButton()!.click();
    await settle(fixture);
    expect(confirm).toHaveBeenCalledWith('Release the registered mobile of ZEDAS0001? The next sign-in will register the phone it comes from.');
    http.expectNone(URL);

    confirm.mockReturnValue(true);
    releaseButton()!.click();
    const del = http.expectOne((r) => r.url === URL && r.method === 'DELETE');
    del.flush({ message: 'Mobile released. The assessor can now sign in on a new mobile; that mobile is then registered.' });
    await settle(fixture);
    const reload = http.expectOne((r) => r.url === URL && r.method === 'GET');
    reload.flush({ userId: 'ZEDAS0001', device: null, signIns });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Mobile released.');
    expect(el.textContent).toContain('No mobile registered yet');
    expect(releaseButton()).toBeUndefined();
  });

  it('shows the error of a refused release', async () => {
    await create();
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device, signIns: [] });
    await settle(fixture);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    releaseButton()!.click();
    http.expectOne((r) => r.method === 'DELETE').flush({ title: 'No mobile is registered for this assessor.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('No mobile is registered for this assessor.');
  });

  it('says so when the user is not a site assessor of the portal', async () => {
    await create();
    http.expectOne(URL).flush(null, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el.textContent).toContain('ZEDAS0001 is not a site assessor of this portal.');
    expect(releaseButton()).toBeUndefined();
  });

  it('from the main build, sends a Surveillance assessor\'s calls to the Surveillance portal', async () => {
    await create('surveillance', 'main');
    const get = http.expectOne(URL);
    expect(get.request.context.get(ADMIN_PORTAL)).toBe('surveillance');
    get.flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
  });

  it('on the Surveillance build, calls its own API', async () => {
    await create('surveillance', 'surveillance');
    const get = http.expectOne(URL);
    expect(get.request.context.get(ADMIN_PORTAL)).toBeNull();
    get.flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
  });

  it('reads a time without a zone as UTC', () => {
    expect(asUtc('2026-11-02T12:35:00')).toBe('2026-11-02T12:35:00Z');
    expect(asUtc('2026-11-02T12:35:00Z')).toBe('2026-11-02T12:35:00Z');
    expect(asUtc('2026-11-02T12:35:00+05:30')).toBe('2026-11-02T12:35:00+05:30');
    expect(asUtc(null)).toBeNull();
  });

  it('is for the Admin and the MasterAdmin only', () => {
    expect(canSeeAssessorMobile(StaffRole.Admin)).toBe(true);
    expect(canSeeAssessorMobile(StaffRole.MasterAdmin)).toBe(true);
    expect(canSeeAssessorMobile(StaffRole.Agency)).toBe(false);
    expect(canSeeAssessorMobile(StaffRole.DesktopAssessor)).toBe(false);
    expect(canSeeAssessorMobile(undefined)).toBe(false);
  });
});

describe('Registered mobile on the assessor page', () => {
  const options = { states: [], sectors: [], areasOfKnowledge: [] };
  const assessor = {
    userId: 'ZEDAS0001', userName: 'Asha', emailId: 'a@z.test', mobileNo: '9000000001', address: 'Street', pinCode: '560001',
    assessorType: 'Assessor', certificateNo: 'AS1', idProofType: 'Aadhaar Card', idProofNumberMasked: 'XXXXXXXX9012', states: [],
    nicSectors: [], areasOfKnowledge: [], reasonForRejection: null, isActive: true, agencyUserId: 'AGENCY1', canEdit: false,
  };

  async function open(roleId: number, system: 'main' | 'consultancy' = 'main') {
    TestBed.configureTestingModule({
      imports: [AssessorFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: STAFF_SYSTEM, useValue: system },
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ userId: 'ZEDAS0001' }) } } },
      ],
    });
    signIn(roleId);
    const fixture = TestBed.createComponent(AssessorFormPage);
    const http = TestBed.inject(HttpTestingController);
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/options').flush(options);
    await settle(fixture);
    http.expectOne('/api/staff/users/assessors/ZEDAS0001').flush({ ...assessor, canEdit: roleId === StaffRole.Agency });
    await settle(fixture);
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the panel to the MasterAdmin as a card at the end of the page', async () => {
    const { fixture, http, el } = await open(StaffRole.MasterAdmin);
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device, signIns: [] });
    await settle(fixture);
    const panel = el.querySelector('zed-assessor-mobile')!;
    expect(panel).toBeTruthy();
    expect(panel.previousElementSibling!.tagName).toBe('FORM');
    expect(panel.querySelector('.zed-card')).toBeTruthy();
    expect(panel.textContent).toContain('Samsung SM-A515F');
    http.verify();
  });

  it('is not shown to an agency and nothing is asked of the API', async () => {
    const { http, el } = await open(StaffRole.Agency);
    expect(el.querySelector('zed-assessor-mobile')).toBeNull();
    http.expectNone(URL);
    http.verify();
  });

  it('is not shown on the Consultancy portal', async () => {
    const { http, el } = await open(StaffRole.MasterAdmin, 'consultancy');
    expect(el.querySelector('zed-assessor-mobile')).toBeNull();
    http.expectNone(URL);
    http.verify();
  });
});

describe('Registered mobile of a surveillance assessor', () => {
  const row = {
    userId: 'ZEDAS0001', userName: 'Asr', email: null, mobileNo: null, isActive: true, reasonForRejection: null, desktopVerification: true,
    siteVerification: true, allowBronzeSurveillance: false, agencyUserId: 'AGENCY1', agencyUserName: 'Acme',
  };

  async function open(roleId: number) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(), provideHttpClientTesting(), { provide: STAFF_SYSTEM, useValue: 'surveillance' },
        { provide: ActivatedRoute, useValue: { snapshot: { data: { kind: 'assessors' } } } },
      ],
    });
    signIn(roleId);
    const fixture = TestBed.createComponent(SurveillanceUsersPage);
    const http = TestBed.inject(HttpTestingController);
    http.expectOne('/api/staff/surveillance-users/assessors').flush([row]);
    await settle(fixture);
    const mobile = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Mobile');
    return { fixture, http, el: fixture.nativeElement as HTMLElement, mobile };
  }

  it('opens the panel of the assessor in a pop-up for the MasterAdmin', async () => {
    const { fixture, http, el, mobile } = await open(StaffRole.MasterAdmin);
    mobile()!.click();
    await settle(fixture);
    const get = http.expectOne(URL);
    expect(get.request.context.get(ADMIN_PORTAL)).toBeNull();
    get.flush({ userId: 'ZEDAS0001', device, signIns });
    await settle(fixture);
    const dialog = el.querySelector('.modal')!;
    expect(dialog.querySelector('#mobile-title')!.textContent).toContain('Registered Mobile – ZEDAS0001');
    expect(dialog.querySelector('zed-assessor-mobile .zed-card')).toBeNull();
    expect(dialog.textContent).toContain('Samsung SM-A515F');
    ([...dialog.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Close') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();
    http.verify();
  });

  it('offers no Mobile action to an agency', async () => {
    const { http, mobile } = await open(StaffRole.Agency);
    expect(mobile()).toBeUndefined();
    http.verify();
  });
});
