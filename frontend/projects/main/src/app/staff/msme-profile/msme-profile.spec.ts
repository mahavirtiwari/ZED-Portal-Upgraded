import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { StaffMsmeProfilePage, staffProfileLink } from './msme-profile';
import { apiBasePath, withApiBase } from '../../api-base';
import { systemLegacyTarget } from '../../app.routes';

describe('staff MSME profile', () => {
  function create(zedId: string) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ zedId }) } } },
      ],
    });
    const fixture = TestBed.createComponent(StaffMsmeProfilePage);
    return { fixture, http: TestBed.inject(HttpTestingController) };
  }

  it('shows the unit and enterprise fields of the API', async () => {
    const { fixture, http } = create('ZEDMSME000001');
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({
      unit: { ZedId: 'ZEDMSME000001', PUnitName: 'Unit One' },
      enterprise: { OwnerName: 'Owner', PanNo: 'XXXXXX234F' },
      certifications: ['Bronze'],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('[data-field="PUnitName"]')?.textContent).toContain('Unit One');
    expect(el.querySelector('[data-field="PanNo"]')?.textContent).toContain('XXXXXX234F');
    expect(el.querySelector('[data-field="EmailId"]')?.textContent).toContain('-');
  });

  it('says so when the unit is not allotted to the user', async () => {
    const { fixture, http } = create('ZEDMSME000009');
    http.expectOne('/api/staff/msme-profile/ZEDMSME000009').flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('not allotted to you');
  });

  it('links lists to the new page instead of the old portal', () => {
    expect(staffProfileLink('ZED 1')).toBe('/staff/msme-profile/ZED%201');
  });
});

describe('system hosting helpers', () => {
  it('prefixes API calls with the base path of the Consultancy and Surveillance builds only', () => {
    expect(apiBasePath('/')).toBe('');
    expect(apiBasePath('/Consultancy/')).toBe('/Consultancy');
    expect(withApiBase('/api/staff/dashboard', '/Consultancy')).toBe('/Consultancy/api/staff/dashboard');
    expect(withApiBase('/api/staff/dashboard', '')).toBe('/api/staff/dashboard');
    expect(withApiBase('https://x.test/api/a', '/surveillance')).toBe('https://x.test/api/a');
    expect(withApiBase('/apiary', '/surveillance')).toBe('/apiary');
  });

  it('maps the old staff addresses case-insensitively, with or without the system folder', () => {
    expect(systemLegacyTarget(['User', 'Login'])).toBe('/login');
    expect(systemLegacyTarget(['user', 'LOGIN'])).toBe('/login');
    expect(systemLegacyTarget(['surveillance', 'User', 'Login'])).toBe('/login');
    expect(systemLegacyTarget(['Dashboard', 'RegisteredMsme'])).toBe('/staff/registered-msme');
    expect(systemLegacyTarget(['Msme', 'Profile', 'ZEDMSME1'])).toBe('/staff/msme-profile/ZEDMSME1');
    expect(systemLegacyTarget(['Msme', 'Dashboard'])).toBeNull();
  });
});
