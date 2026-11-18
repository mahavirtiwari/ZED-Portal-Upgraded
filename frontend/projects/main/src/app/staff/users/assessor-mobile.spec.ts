import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ADMIN_PORTAL } from '../admin-portal';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { AssessorFormPage } from './assessor-form';
import { AssessorMobilePanel, asUtc, canSeeAssessorMobile, osLine } from './assessor-mobile';
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
const PHONES = '/api/staff/assessor-mobile';

const device = {
  app: 'SA', appName: 'Site assessment app', deviceId: 'dev-1', model: 'Samsung SM-A515F', make: 'Samsung', osVersion: '13', apiLevel: 33,
  appVersion: '2.0', firstSeenAt: '2026-10-01T09:30:00', lastLoginAt: '2026-11-02T18:05:00', lastSeenAt: '2026-11-02T18:40:00',
  lastIp: '10.1.2.3', firstIp: '10.1.0.1',
};

const signIns = [
  { at: '2026-11-02T12:35:00', result: 'Success', reason: null, deviceId: 'dev-1', deviceModel: 'Samsung SM-A515F', osVersion: '13', appVersion: '2.0', ipAddress: '10.1.2.3' },
  {
    at: '2026-11-01T08:00:00', result: 'Failed', reason: 'This account is registered on another phone (Samsung SM-A515F). Ask your Master Admin to release it.',
    deviceId: 'dev-2', deviceModel: 'Redmi Note 12', osVersion: '14', appVersion: '2.0', ipAddress: '10.9.9.9',
  },
];

const releases = [{ at: '2026-10-01T09:00:00', app: 'Site assessment app', deviceId: 'dev-0', model: 'Vivo V2050', releasedBy: 'MASTER1', reason: 'Phone lost', ip: '10.0.0.1' }];

describe('AssessorMobilePanel', () => {
  let fixture: ComponentFixture<AssessorMobilePanel>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function create(system: 'main' | 'surveillance' | 'consultancy' = 'main', own: 'main' | 'surveillance' | 'consultancy' = 'main') {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting(), { provide: STAFF_SYSTEM, useValue: own }] });
    fixture = TestBed.createComponent(AssessorMobilePanel);
    fixture.componentRef.setInput('userId', 'ZEDAS0001');
    fixture.componentRef.setInput('system', system);
    fixture.componentRef.setInput('name', 'Asha Rao');
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    fixture.detectChanges();
  }

  afterEach(() => http.verify());

  const releaseButton = () => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Release Mobile') as HTMLButtonElement | undefined;
  const facts = () => [...el.querySelectorAll('.am-facts > div')].map((d) =>
    [d.querySelector('dt')!, d.querySelector('dd')!].map((x) => x.textContent!.replace(/\s+/g, ' ').trim()).join(' '));

  it('shows the phone with make, OS, app version and IPs, the sign-ins with refusals, and the release history', async () => {
    await create();
    const get = http.expectOne(URL);
    expect(get.request.method).toBe('GET');
    expect(get.request.context.get(ADMIN_PORTAL)).toBeNull();
    get.flush({ userId: 'ZEDAS0001', device, devices: [device], signIns, releases, refusedToday: true });
    await settle(fixture);

    expect(el.querySelector('.am-head')!.textContent).toContain('Registered mobile');
    expect(releaseButton()).toBeTruthy();
    expect(el.querySelector('[data-refused]')!.textContent).toContain('refused today');
    expect(facts()).toEqual([
      'Make and model Samsung SM-A515F', 'OS Android 13 · API 33', 'App version 2.0', 'Registered on 01-10-2026',
      'Last sign-in 02-11-2026 18:05', 'IP address 10.1.2.3 · first 10.1.0.1',
    ]);
    const items = [...el.querySelectorAll('.am-list')[0].querySelectorAll('li')];
    expect(items.length).toBe(2);
    expect(items[0].querySelector('.status-badge')!.textContent!.trim()).toBe('Signed in');
    expect(items[1].querySelector('.status-badge')!.textContent!.trim()).toBe('Refused');
    expect(items[1].querySelector('.am-reason')!.textContent).toContain('registered on another phone');
    expect(items[1].textContent).toContain('Redmi Note 12 · 10.9.9.9');
    expect(el.querySelector('[data-releases]')!.textContent).toContain('Vivo V2050 released by MASTER1');
    expect(el.querySelector('[data-releases]')!.textContent).toContain('Phone lost');
  });

  it('says not registered, without Release Mobile, no sign-ins and never released', async () => {
    await create();
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device: null, devices: [], signIns: [], releases: [] });
    await settle(fixture);
    expect(el.textContent).toContain('Not registered: the next sign-in registers the phone it comes from.');
    expect(releaseButton()).toBeUndefined();
    expect(el.textContent).toContain('No sign-ins yet.');
    expect(el.textContent).toContain('Never released.');
  });

  it('releases the phone with a required reason, then reloads', async () => {
    await create();
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device, devices: [device], signIns, releases: [] });
    await settle(fixture);

    releaseButton()!.click();
    await settle(fixture);
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.textContent).toContain('Release the mobile of Asha Rao?');
    expect(dialog.textContent).toContain('ZEDAS0001 · Samsung SM-A515F');
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(dialog.textContent).toContain('Please enter the reason for releasing the mobile.');
    http.expectNone(URL + '/release');

    const text = dialog.querySelector('textarea') as HTMLTextAreaElement;
    text.value = 'Phone lost';
    text.dispatchEvent(new Event('input'));
    await settle(fixture);
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const post = http.expectOne((r) => r.url === URL + '/release' && r.method === 'POST');
    expect(post.request.body).toEqual({ reason: 'Phone lost' });
    post.flush({ message: 'Mobile released. The next sign-in registers the phone it comes from; only that phone can be used then.' });
    await settle(fixture);
    http.expectOne((r) => r.url === URL && r.method === 'GET').flush({ userId: 'ZEDAS0001', device: null, devices: [], signIns, releases });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(el.textContent).toContain('Not registered');
    expect(releaseButton()).toBeUndefined();
  });

  it('keeps a refused release in the pop-up', async () => {
    await create();
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device, signIns: [] });
    await settle(fixture);
    releaseButton()!.click();
    await settle(fixture);
    const dialog = el.querySelector('zed-confirm-dialog')!;
    const text = dialog.querySelector('textarea') as HTMLTextAreaElement;
    text.value = 'x';
    text.dispatchEvent(new Event('input'));
    await settle(fixture);
    (dialog.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne((r) => r.method === 'POST').flush({ title: 'No mobile is registered for this user.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')!.textContent).toContain('No mobile is registered for this user.');
  });

  it('says so when the user does not use an app of the portal', async () => {
    await create();
    http.expectOne(URL).flush(null, { status: 404, statusText: 'Not Found' });
    await settle(fixture);
    expect(el.textContent).toContain('ZEDAS0001 does not use an app of this portal.');
    expect(releaseButton()).toBeUndefined();
  });

  it('from the main build, sends another portal\'s calls through the hand-over', async () => {
    await create('consultancy', 'main');
    const get = http.expectOne(URL);
    expect(get.request.context.get(ADMIN_PORTAL)).toBe('consultancy');
    get.flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
  });

  it('on the Surveillance build, calls its own API', async () => {
    await create('surveillance', 'surveillance');
    const get = http.expectOne(URL);
    expect(get.request.context.get(ADMIN_PORTAL)).toBeNull();
    get.flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
  });

  it('reads a time without a zone as UTC and writes the OS line', () => {
    expect(asUtc('2026-11-02T12:35:00')).toBe('2026-11-02T12:35:00Z');
    expect(asUtc('2026-11-02T12:35:00+05:30')).toBe('2026-11-02T12:35:00+05:30');
    expect(asUtc(null)).toBeNull();
    expect(osLine({ ...device, apiLevel: null })).toBe('Android 13');
    expect(osLine({ ...device, osVersion: null, apiLevel: null })).toBe('—');
  });

  it('is for the Admin and the MasterAdmin only', () => {
    expect(canSeeAssessorMobile(StaffRole.Admin)).toBe(true);
    expect(canSeeAssessorMobile(StaffRole.MasterAdmin)).toBe(true);
    expect(canSeeAssessorMobile(StaffRole.Agency)).toBe(false);
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
    http.expectOne('/api/staff/users/assessors/ZEDAS0001/open-assessments').flush({ count: null });
    http.match((r) => r.url === '/api/staff/users/agencies').forEach((r) => r.flush([]));
    await settle(fixture);
    return { fixture, http, el: fixture.nativeElement as HTMLElement };
  }

  it('shows the card first in the right rail for the MasterAdmin', async () => {
    const { fixture, http, el } = await open(StaffRole.MasterAdmin);
    http.expectOne(URL).flush({ userId: 'ZEDAS0001', device, devices: [device], signIns: [], releases: [] });
    await settle(fixture);
    const panel = el.querySelector('aside.af-rail zed-assessor-mobile')!;
    expect(panel).toBeTruthy();
    expect(panel.previousElementSibling).toBeNull();
    expect(panel.querySelector('.zed-card')).toBeTruthy();
    expect(panel.textContent).toContain('Samsung SM-A515F');
    expect(el.querySelectorAll('zed-assessor-mobile').length).toBe(1);
    http.verify();
  });

  it('is shown on the Consultancy portal too, for its own consultant app', async () => {
    const { fixture, http, el } = await open(StaffRole.MasterAdmin, 'consultancy');
    const get = http.expectOne(URL);
    expect(get.request.context.get(ADMIN_PORTAL)).toBeNull();
    get.flush({ userId: 'ZEDAS0001', device: null, signIns: [] });
    await settle(fixture);
    expect(el.querySelector('aside.af-rail zed-assessor-mobile')).toBeTruthy();
    http.verify();
  });

  it('is not shown to an agency and nothing is asked of the API', async () => {
    const { http, el } = await open(StaffRole.Agency);
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
  const phone = { userId: 'ZEDAS0001', app: 'SURV', appName: 'Surveillance app', model: 'Samsung SM-A515F', make: 'Samsung', lastLoginAt: '2026-11-17T10:00:00', refusedToday: true, lastRefusedAt: null };

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
    if (canSeeAssessorMobile(roleId)) http.expectOne(PHONES).flush([phone]);
    await settle(fixture);
    const el = fixture.nativeElement as HTMLElement;
    const mobile = () => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Mobile');
    return { fixture, http, el, mobile };
  }

  it('shows the Phone chip and opens the card of the assessor in a pop-up for the MasterAdmin', async () => {
    const { fixture, http, el, mobile } = await open(StaffRole.MasterAdmin);
    expect(el.querySelector('zed-phone-chip [data-phone]')!.textContent!.trim()).toBe('Refused sign-in today');
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

  it('offers no Mobile action, chip or phone list to an agency', async () => {
    const { http, el, mobile } = await open(StaffRole.Agency);
    expect(mobile()).toBeUndefined();
    expect(el.querySelector('zed-phone-chip')).toBeNull();
    http.expectNone(PHONES);
    http.verify();
  });
});
