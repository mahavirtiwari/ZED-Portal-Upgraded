import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CertificationLevel, CertificationLevelsPage, formatCertificateNo } from './certification-levels';
import { ADMIN_PORTAL, AdminPortalService } from '../admin-portal';

describe('CertificationLevelsPage', () => {
  let fixture: ComponentFixture<CertificationLevelsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const api = '/api/staff/settings/levels';
  const tokens = ['{DDMMYYYY}', '{DD}', '{MM}', '{YYYY}', '{YY}', '{ZEDID}', '{ZEDNO}', '{LEVEL}', '{CAT}'];
  const level = (code: string, name: string, extra: Partial<CertificationLevel> = {}): CertificationLevel => ({
    code, name, orderNo: 10, description: null, comment: null, logoPath: null, isEnabled: true, assessmentMode: 'Site', validityMonths: 36,
    surveillanceEnabled: true, firstSurveillanceMonths: 12, certNoFormat: '{DDMMYYYY}_{ZEDNO}', certNoFormatManufacturing: null,
    certNoFormatService: null, fee: null, updatedBy: null, updatedOn: null, ...extra,
  });
  const response = (zedxEnabled: boolean) => ({
    stored: true, tokens,
    levels: [
      { level: level('Bronze', 'Bronze', {
        assessmentMode: 'Desktop', firstSurveillanceMonths: 18, surveillanceCount: 1, surveillanceIntervalMonths: 12, surveillanceNoticeMonths: 4,
        surveillanceReminders: 2, surveillanceReminderEveryMonths: 1, surveillanceSuspendAfterMonths: 1, surveillanceWithdrawAfterDays: 64,
        surveillanceAutoApply: true, surveillanceSuspendRounds: 0, surveillanceScheduleFrom: '9999-12-31T00:00:00',
      }), sample: '29102026_129350', logoUrl: '/Images/Dashboard/bronze.png' },
      { level: level('ZEDX', 'ZED-X', { isEnabled: zedxEnabled, fee: 75000, description: 'Open to every MSME' }), sample: '29102026_129350', logoUrl: null,
        fees: [{ type: 'Micro', total: 75000 }, { type: 'Small', total: 90000 }],
        readiness: { questionnaire: true, parameterCount: 8, fees: true, artwork: true, agencies: true, columns: true, columnsMessage: null } },
    ],
  });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const box = (name: string) => [...el.querySelectorAll('.lv-box')].find((b) => b.getAttribute('aria-label') === name) as HTMLElement;
  const button = (scope: Element, label: string) => [...scope.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
  const typeIn = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [CertificationLevelsPage],
      // Main's levels only (saving on the surveillance portal too has its own test below).
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AdminPortalService, useValue: { enabled: false } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CertificationLevelsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(api).flush(response(false));
    await settle();
  });

  afterEach(() => http.verify());

  it('formats certificate numbers as the server does', () => {
    const d = new Date(2026, 9, 29);
    expect(formatCertificateNo('{DDMMYYYY}_{ZEDNO}', d, 'ZEDMSME129350', 'Bronze', null)).toBe('29102026_129350');
    expect(formatCertificateNo('ZX-{CAT}-{YY}{MM}-{ZEDID}', d, 'ZEDMSME129350', 'ZEDX', 'Services')).toBe('ZX-S-2610-ZEDMSME129350');
    // New ZED IDs (ZEDM / ZEDS): the serial keeps the sector letter.
    expect(formatCertificateNo('{DDMMYYYY}_{ZEDNO}', d, 'ZEDM000123', 'Silver', 'Manufacturing')).toBe('29102026_M000123');
    expect(formatCertificateNo('{DDMMYYYY}_{ZEDNO}', d, 'ZEDS000045', 'Gold', 'Services')).toBe('29102026_S000045');
  });

  it('shows each level as a box with its certificate settings and enables ZED-X', async () => {
    const zedx = box('ZED-X');
    expect(zedx.classList).toContain('is-off');
    expect(zedx.querySelector('h5')!.textContent).toContain('ZED-X CERTIFICATION');
    expect(zedx.textContent).toContain('75,000');
    expect(zedx.textContent).toContain('3 years');
    expect(box('Bronze').textContent).toContain('Desktop');
    expect(box('Bronze').textContent).toContain('1, after 18 months');

    button(zedx, 'Enable').click();
    await settle();
    const put = http.expectOne(`${api}/ZEDX/enabled`);
    expect(put.request.body).toEqual({ enabled: true });
    put.flush({ message: 'ZED-X is enabled: MSMEs see it.' });
    await settle();
    http.expectOne(api).flush(response(true));
    await settle();
    expect(box('ZED-X').classList).not.toContain('is-off');
    expect(el.querySelector('.alert-success')!.textContent).toContain('ZED-X is enabled');
  });

  it('edits the certificate number formats with a preview and checks them', async () => {
    button(box('ZED-X'), 'Edit').click();
    await settle();
    typeIn('#lv-format', 'ZX-{YYYY}');
    typeIn('#lv-format-m', 'ZXM/{YYYY}/{ZEDNO}');
    await settle();
    expect(el.querySelector('.modal-body')!.textContent).toContain(`ZXM/${new Date().getFullYear()}/M000123`);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('{ZEDID} or {ZEDNO}');
    http.expectNone((r) => r.method === 'PUT');

    typeIn('#lv-format', 'ZX/{ZEDNO}');
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne(`${api}/ZEDX`);
    expect(put.request.body).toEqual(expect.objectContaining({
      name: 'ZED-X', certNoFormat: 'ZX/{ZEDNO}', certNoFormatManufacturing: 'ZXM/{YYYY}/{ZEDNO}', certNoFormatService: '', fee: 75000, validityMonths: 36,
    }));
    put.flush({ message: 'ZED-X saved.' });
    await settle();
    http.expectOne(api).flush(response(false));
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('sets the surveillance schedule of Bronze as of ZED-X: applied by the portal, never suspended', async () => {
    button(box('Bronze'), 'Edit').click();
    await settle();
    expect((el.querySelector('#lv-count') as HTMLInputElement).value).toBe('1');
    expect((el.querySelector('#lv-autoapply') as HTMLInputElement).checked).toBe(true);
    expect((el.querySelector('#lv-suspend-in') as HTMLSelectElement).selectedOptions[0].textContent!.trim()).toBe('Never');
    expect(el.querySelector('#lv-withdraw')).toBeNull();
    expect(el.querySelector('.modal-body')!.textContent).toContain('apply from the day the new surveillance schedule is switched on');
    typeIn('#lv-first', '17');
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const bronze = http.expectOne(`${api}/Bronze`);
    expect(bronze.request.body).toEqual(expect.objectContaining({
      firstSurveillanceMonths: 17, surveillanceCount: 1, surveillanceReminders: 2, surveillanceAutoApply: true, surveillanceSuspendRounds: 0,
    }));
    bronze.flush({ message: 'Bronze saved.' });
    await settle();
    http.expectOne(api).flush(response(false));
    await settle();
  });

  it('sets the surveillance schedule of ZED-X', async () => {
    expect(box('ZED-X').textContent).toContain('2, after 12 months, then every 12');

    button(box('ZED-X'), 'Edit').click();
    await settle();
    expect(el.querySelector('.modal-body')!.textContent).toContain('Due at 12 and 24 months after certification.');
    // A site level: the portal does not apply for it.
    expect(el.querySelector('#lv-autoapply')).toBeNull();
    typeIn('#lv-count', '3');
    typeIn('#lv-interval', '12');
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    // 12 + 2 x 12 = 36: not before a 3-year certificate expires.
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('last surveillance must be due before');
    http.expectNone((r) => r.method === 'PUT');

    typeIn('#lv-interval', '10');
    typeIn('#lv-withdraw', '30');
    typeIn('#lv-reminders', '0');
    await settle();
    expect(el.querySelector('#lv-every')).toBeNull();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne(`${api}/ZEDX`);
    expect(put.request.body).toEqual(expect.objectContaining({
      surveillanceCount: 3, surveillanceIntervalMonths: 10, surveillanceNoticeMonths: 4, surveillanceReminders: 0,
      surveillanceSuspendAfterMonths: 1, surveillanceWithdrawAfterDays: 30, surveillanceAutoApply: false, surveillanceSuspendRounds: null,
    }));
    put.flush({ message: 'ZED-X saved.' });
    await settle();
    http.expectOne(api).flush(response(false));
    await settle();
  });

  it('edits in tabs beside a preview of the box, the numbers and the surveillance due dates', async () => {
    expect(el.querySelector('.lv-summary')!.textContent).toContain('1 shown to MSMEs');
    button(box('ZED-X'), 'Edit').click();
    await settle();
    const panes = () => [...el.querySelectorAll('.lv-fields > div')].map((p) => (p as HTMLElement).hidden);
    expect(panes()).toEqual([false, true, true]);
    typeIn('#lv-name', 'ZED-X Export');
    await settle();
    expect(el.querySelector('.pv-head')!.textContent).toContain('ZED-X EXPORT CERTIFICATION');
    expect(el.querySelector('.lv-preview')!.textContent).toContain('₹ 75,000');

    button(el.querySelector('.lv-tabs')!, 'Surveillance').click();
    await settle();
    expect(panes()).toEqual([true, true, false]);
    // 2 surveillances, at 12 and 24 months of 36.
    expect([...el.querySelectorAll('.tl-mark small')].map((m) => m.textContent!.trim())).toEqual(['12m', '24m']);
    typeIn('#lv-count', '1');
    await settle();
    expect(el.querySelectorAll('.tl-mark').length).toBe(1);
    button(el.querySelector('.modal-footer')!, 'CANCEL').click();
    await settle();
  });

  it('adds a level with a code', async () => {
    button(el, '+ Add level').click();
    await settle();
    typeIn('#lv-code', '9X');
    typeIn('#lv-name', 'Platinum');
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('2 to 20 letters');
    typeIn('#lv-code', 'Platinum');
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === api);
    expect(post.request.body).toEqual(expect.objectContaining({
      code: 'Platinum', name: 'Platinum', isEnabled: false, assessmentMode: 'Site', firstSurveillanceMonths: 15, surveillanceCount: 2, surveillanceWithdrawAfterDays: 64,
    }));
    post.flush({ message: 'Platinum added.' });
    await settle();
    http.expectOne(api).flush(response(false));
    await settle();
  });
});

describe('CertificationLevelsPage (one Admin)', () => {
  it('saves a change on the surveillance portal too, and says when that portal refused it', async () => {
    await TestBed.configureTestingModule({ imports: [CertificationLevelsPage], providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(CertificationLevelsPage);
    const http = TestBed.inject(HttpTestingController);
    const el: HTMLElement = fixture.nativeElement;
    const settle = async () => {
      fixture.detectChanges();
      await new Promise((r) => setTimeout(r));
      await fixture.whenStable();
      fixture.detectChanges();
    };
    const api = '/api/staff/settings/levels';
    const onSurv = (r: { context: { get: (t: typeof ADMIN_PORTAL) => string | null } }) => r.context.get(ADMIN_PORTAL) === 'surveillance';
    await settle();
    const levels = (zedxOn: boolean) => ({
      stored: true, tokens: ['{ZEDID}'],
      levels: [{
        level: {
          code: 'ZEDX', name: 'ZED-X', orderNo: 40, description: null, comment: null, logoPath: null, isEnabled: zedxOn, assessmentMode: 'Site', validityMonths: 36,
          surveillanceEnabled: true, firstSurveillanceMonths: 12, certNoFormat: '{ZEDID}', certNoFormatManufacturing: null, certNoFormatService: null, fee: 75000,
          updatedBy: null, updatedOn: null,
        } as CertificationLevel,
        sample: 'ZEDMSME1', logoUrl: null,
      }],
    });
    http.expectOne(api).flush(levels(false));
    await settle();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Enable') as HTMLButtonElement).click();
    await settle();
    http.expectOne((r) => r.url === `${api}/ZEDX/enabled` && !onSurv(r)).flush({ message: 'ZED-X is enabled: MSMEs see it.' });
    await settle();
    const mirrored = http.expectOne((r) => r.url === `${api}/ZEDX/enabled` && onSurv(r));
    expect(mirrored.request.body).toEqual({ enabled: true });
    mirrored.flush({ title: 'The levels cannot be saved. Please ask the administrator to apply database migrations 0028, 0032.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    http.expectOne(api).flush(levels(true));
    await settle();
    const message = el.querySelector('.alert-success')!.textContent!;
    expect(message).toContain('ZED-X is enabled');
    expect(message).toContain('Not saved on the Surveillance portal: The levels cannot be saved');
    http.verify();
  });
});

describe('CertificationLevelsPage (a level the Admin added)', () => {
  let fixture: ComponentFixture<CertificationLevelsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const api = '/api/staff/settings/levels';
  const ready = { questionnaire: true, parameterCount: 0, fees: true, artwork: true, agencies: true, columns: true, columnsMessage: null };
  const lv = (code: string, name: string, orderNo: number, isEnabled: boolean) => ({
    code, name, orderNo, description: null, comment: null, logoPath: null, isEnabled, assessmentMode: 'Site', validityMonths: 36,
    surveillanceEnabled: true, firstSurveillanceMonths: 12, certNoFormat: '{ZEDNO}', certNoFormatManufacturing: null, certNoFormatService: null, fee: null,
    updatedBy: null, updatedOn: null,
  }) as CertificationLevel;
  const platinum = (readiness: object, isEnabled = false) => ({
    stored: true, tokens: ['{ZEDID}', '{ZEDNO}'],
    levels: [
      { level: lv('Gold', 'Gold', 30, true), sample: '1', logoUrl: null, readiness: { ...ready, parameterCount: 20 } },
      { level: lv('PLATINUM', 'Platinum', 50, isEnabled), sample: '1', logoUrl: null, readiness: { ...ready, ...readiness } },
    ],
  });
  const notReady = { questionnaire: false, parameterCount: 0, fees: false, artwork: false, agencies: false, columns: false, columnsMessage: 'Ready after the next update' };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const box = (name: string) => [...el.querySelectorAll('.lv-box')].find((b) => b.getAttribute('aria-label') === name) as HTMLElement;
  const row = (key: string) => box('Platinum').querySelector(`[data-check="${key}"]`) as HTMLElement;

  async function open(readiness: object) {
    await TestBed.configureTestingModule({
      imports: [CertificationLevelsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting(), { provide: AdminPortalService, useValue: { enabled: false } }],
    }).compileComponents();
    fixture = TestBed.createComponent(CertificationLevelsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(api).flush(platinum(readiness));
    await settle();
  }

  afterEach(() => http.verify());

  it('shows the checklist of what the level still needs, "Off until ready", and none for the built-in levels', async () => {
    await open(notReady);
    expect(box('Gold').querySelector('[data-checklist]')).toBeNull();
    const list = box('Platinum').querySelector('[data-checklist]') as HTMLElement;
    expect(list.querySelector('.lv-ready-count')!.textContent).toBe('1 of 6');
    expect(row('settings').classList).toContain('ok');
    for (const key of ['questionnaire', 'fees', 'artwork', 'agencies', 'columns']) expect(row(key).classList).not.toContain('ok');
    expect(row('questionnaire').textContent).toContain('Questionnaire (0 parameters)');
    expect(row('questionnaire').textContent).toContain('missing');
    expect(row('questionnaire').querySelector('a')!.getAttribute('href')).toBe('/staff/masters/parameters/PLATINUM');
    expect(row('fees').querySelector('a')!.getAttribute('href')).toBe('/staff/fees?level=PLATINUM');
    expect(row('artwork').textContent).toContain('upload');
    expect(row('agencies').querySelector('a')!.getAttribute('href')).toBe('/staff/users/bronze-agencies');
    expect(row('columns').querySelector('[data-columns-message]')!.textContent).toContain('Ready after the next update');
    expect(box('Platinum').querySelector('[data-off-until-ready]')!.textContent).toContain('Off until ready');
    const why = box('Platinum').querySelector('[data-why]')!.textContent!;
    expect(why).toContain('the questionnaire');
    expect(why).toContain('the certificate and report artwork');
    expect(why).not.toContain('agenc');
    const enable = box('Platinum').querySelector('button[aria-label="Enable Platinum"]') as HTMLButtonElement;
    expect(enable.getAttribute('title')).toContain('Missing: the questionnaire');
  });

  it('uploads the certificate artwork as a file and reloads the checklist', async () => {
    await open(notReady);
    const input = box('Platinum').querySelector('input[data-artwork="certificate"]') as HTMLInputElement;
    const file = new File(['jpg'], 'platinum-certificate.jpg', { type: 'image/jpeg' });
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${api}/PLATINUM/artwork`);
    expect(post.request.params.get('kind')).toBe('certificate');
    expect(post.request.body instanceof FormData).toBe(true);
    expect(((post.request.body as FormData).get('file') as File).name).toBe('platinum-certificate.jpg');
    post.flush({ message: 'The certificate artwork of Platinum is saved.' });
    await settle();
    http.expectOne(api).flush(platinum({ ...notReady, artwork: true }));
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('certificate artwork of Platinum is saved');
    expect(row('artwork').classList).toContain('ok');

    // Too large: refused before sending.
    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'big.png', { type: 'image/png' });
    const report = box('Platinum').querySelector('input[data-artwork="report"]') as HTMLInputElement;
    Object.defineProperty(report, 'files', { value: [big], configurable: true });
    report.dispatchEvent(new Event('change'));
    await settle();
    http.expectNone((r) => r.method === 'POST');
    expect(el.querySelector('.alert-danger')!.textContent).toContain('JPG or PNG image of up to 2 MB');
  });

  it('shows the artwork from the server, or says there is none', async () => {
    await open(notReady);
    (box('Platinum').querySelector('button[data-view-artwork="report"]') as HTMLButtonElement).click();
    await settle();
    const get = http.expectOne((r) => r.method === 'GET' && r.url === `${api}/PLATINUM/artwork`);
    expect(get.request.params.get('kind')).toBe('report');
    expect(get.request.responseType).toBe('blob');
    get.flush(new Blob(['x']), { status: 404, statusText: 'Not Found' });
    await settle();
    expect(el.querySelector('[data-no-artwork]')!.textContent).toContain('No report artwork uploaded yet.');
  });

  it("asks the server to enable it and shows the server's refusal", async () => {
    await open(notReady);
    (box('Platinum').querySelector('button[aria-label="Enable Platinum"]') as HTMLButtonElement).click();
    await settle();
    const put = http.expectOne(`${api}/PLATINUM/enabled`);
    expect(put.request.body).toEqual({ enabled: true });
    put.flush({ title: 'Platinum cannot be enabled yet: it has no questionnaire, no fees and no certificate artwork.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Platinum cannot be enabled yet: it has no questionnaire');
    expect(box('Platinum').querySelector('[data-off-until-ready]')).not.toBeNull();
  });

  it('shows a ready level as all done, without "Off until ready"', async () => {
    await open({ parameterCount: 12 });
    expect(box('Platinum').querySelector('.lv-ready-count')!.textContent).toBe('6 of 6');
    expect(row('questionnaire').textContent).toContain('Questionnaire (12 parameters)');
    expect(box('Platinum').querySelector('[data-off-until-ready]')).toBeNull();
    expect(box('Platinum').querySelector('[data-why]')).toBeNull();
    expect(box('Platinum').querySelector('.status-badge')!.textContent).toContain('Disabled');
  });
});
