import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { CertificationLevel, CertificationLevelsPage, formatCertificateNo } from './certification-levels';

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
      { level: level('Bronze', 'Bronze', { assessmentMode: 'Desktop', firstSurveillanceMonths: 15 }), sample: '29102026_129350', logoUrl: '/Images/Dashboard/bronze.png' },
      { level: level('ZEDX', 'ZED-X', { isEnabled: zedxEnabled, fee: 75000, description: 'Open to every MSME' }), sample: '29102026_129350', logoUrl: null },
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
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
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
  });

  it('shows each level as a box with its certificate settings and enables ZED-X', async () => {
    const zedx = box('ZED-X');
    expect(zedx.classList).toContain('is-off');
    expect(zedx.querySelector('h5')!.textContent).toContain('ZED-X CERTIFICATION');
    expect(zedx.textContent).toContain('75,000');
    expect(zedx.textContent).toContain('3 years');
    expect(box('Bronze').textContent).toContain('Desktop');
    expect(box('Bronze').textContent).toContain('after 15 months');

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
    expect(el.querySelector('.modal-body')!.textContent).toContain(`ZXM/${new Date().getFullYear()}/129350`);
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
    expect(post.request.body).toEqual(expect.objectContaining({ code: 'Platinum', name: 'Platinum', isEnabled: false, assessmentMode: 'Site' }));
    post.flush({ message: 'Platinum added.' });
    await settle();
    http.expectOne(api).flush(response(false));
    await settle();
  });
});
