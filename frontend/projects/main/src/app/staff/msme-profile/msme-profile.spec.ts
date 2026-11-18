import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffMsmeProfilePage, staffProfileLink } from './msme-profile';
import { apiBasePath, withApiBase } from '../../api-base';
import { systemLegacyTarget } from '../../app.routes';

describe('staff MSME profile', () => {
  function create(zedId: string, roleId = 7) {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ zedId }) } } },
      ],
    });
    TestBed.inject(AuthService).setUser({ userId: 'U1', userName: 'U1', roleId, role: '' });
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
    // 2026-11-17 (design 15): PAN, e-mail and mobile are masked until Show.
    expect(el.querySelector('[data-field="PanNo"]')?.textContent).toContain('XX•••••34F');
    expect(el.querySelector('[data-field="PanNo"]')?.textContent).not.toContain('XXXXXX234F');
    el.querySelector<HTMLButtonElement>('[data-field="PanNo"] .pf-show')!.click();
    fixture.detectChanges();
    expect(el.querySelector('[data-field="PanNo"]')?.textContent).toContain('XXXXXX234F');
    expect(el.querySelector('[data-field="PanNo"] .pf-show')?.textContent?.trim()).toBe('Hide');
    // Nothing to show: a dash and no Show button.
    expect(el.querySelector('[data-field="EmailId"]')?.textContent).toContain('-');
    expect(el.querySelector('[data-field="EmailId"] .pf-show')).toBeNull();
  });

  it('opens with the identity header and its links (design 15)', async () => {
    const { fixture, http } = create('ZEDMSME000001');
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({
      unit: { ZedId: 'ZEDMSME000001', PUnitName: 'Pump Engineers' },
      enterprise: { EnterpriseName: 'Pump Enterprise', UdyogAadharNo: 'UDYAM-UP-16-0001476', EnterpriseTypee: 'Micro', EmailId: 'karan@mail.test', MobileNo: '9412345133' },
      certifications: ['Bronze'],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const head = el.querySelector('[data-identity]')!;
    expect(head.querySelector('.pf-name')?.textContent?.trim()).toBe('Pump Enterprise');
    expect(head.textContent!.replace(/\s+/g, ' ')).toContain('Udyam UDYAM-UP-16-0001476');
    expect(head.textContent).toContain('ZEDMSME000001');
    expect([...head.querySelectorAll('.pf-chip')].map((c) => c.textContent?.trim())).toEqual(['Micro', 'Bronze']);
    const links = [...head.querySelectorAll<HTMLAnchorElement>('.pf-links a')];
    expect(links.map((a) => a.textContent?.trim())).toEqual(['ZED ID history', 'Assessment details']);
    expect(links[0].getAttribute('href')).toBe('/staff/history?zedId=ZEDMSME000001');
    expect(links[1].getAttribute('href')).toBe('/staff/assessment/da-details/ZEDMSME000001/Bronze');
    expect(el.querySelector('[data-field="EmailId"]')?.textContent).toContain('ka•••••@mail.test');
    expect(el.querySelector('[data-field="MobileNo"]')?.textContent).toContain('94•••••133');
  });

  it('shows an agency no ZED ID history link', async () => {
    const { fixture, http } = create('ZEDMSME000001', 2);
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({ unit: { ZedId: 'ZEDMSME000001' }, enterprise: {}, certifications: ['Silver'] });
    await fixture.whenStable();
    fixture.detectChanges();
    const links = [...(fixture.nativeElement as HTMLElement).querySelectorAll('.pf-links a')].map((a) => a.textContent?.trim());
    expect(links).toEqual(['Assessment details']);
  });

  it('says so when the unit is not allotted to the user', async () => {
    const { fixture, http } = create('ZEDMSME000009');
    http.expectOne('/api/staff/msme-profile/ZEDMSME000009').flush(null, { status: 404, statusText: 'Not Found' });
    await fixture.whenStable();
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).textContent).toContain('not allotted to you');
  });

  it('lays the facts out as four cards, two fields per row', async () => {
    const { fixture, http } = create('ZEDMSME000001');
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({
      unit: { ZedId: 'ZEDMSME000001', PUnitName: 'Unit One', PAddress: 'Plot 1', PDistrictName: 'Agra', PStateName: 'UP', PPin: '282001' },
      enterprise: {}, certifications: [],
    });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    expect(el.querySelector('zed-page-head h2')?.textContent?.trim()).toBe('MSME Profile');
    expect([...el.querySelectorAll('h4.pf-bar')].map((h) => h.textContent?.trim()).slice(0, 4))
      .toEqual(['Owner and enterprise', 'Address and business', 'Selected unit', 'Selected unit activity (NIC)']);
    const labels = [...el.querySelector('.pf-grid dl')!.querySelectorAll('dt')].map((dt) => dt.textContent?.trim());
    expect(labels.slice(0, 4)).toEqual(['Owner name', 'Enterprise name', 'PAN', 'Enterprise type']);
    expect(el.querySelector('[data-identity]')?.textContent).toContain('Unit One');
    expect(el.querySelector('[data-field="PAddress"]')?.textContent).toContain('Plot 1, Agra, UP, 282001');
    expect(el.textContent).not.toContain('Edit Profile');
    expect(el.textContent).toContain('Edit history');
    // The other registration fields are kept, in a full-width card under the four.
    expect([...el.querySelectorAll('h4.pf-bar')].map((h) => h.textContent?.trim())).toContain('Other registration details');
  });

  it('lets the SuperAdmin edit the legacy fields and saves them', async () => {
    const { fixture, http } = create('ZEDMSME000001', 10);
    const profile = {
      unit: { ZedId: 'ZEDMSME000001', PUnitName: 'Unit One', TwoDigitActivity: '10-Food', FourDigitActivity: '1010', FiveDigitActivity: '10101' },
      enterprise: { OwnerName: 'Owner', EnterpriseName: 'Ent', EmailId: 'a@b.test' },
      certifications: [],
    };
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush(profile);
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-15's NIC line, the 5-digit code under it.
    expect(el.querySelector('[data-nic]')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('10-Food › 1010 10101');
    button('Edit Profile')!.click();
    http.expectOne('/api/staff/msme-profile/sectors').flush(['24-Basic metals']);
    await fixture.whenStable();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Owner Name, Enterprise Name, Email Id, unit name, NIC 4 and 5 digit; NIC 2 digit is the sector drop-down.
    expect(el.querySelectorAll('input.form-control').length).toBe(6);
    const options = [...el.querySelectorAll('select[name="twoDigitActivity"] option')].map((o) => o.textContent?.trim());
    expect(options).toEqual(['10-Food', '24-Basic metals']);
    const owner = el.querySelector<HTMLInputElement>('input[name="ownerName"]')!;
    expect(owner.value).toBe('Owner');
    owner.value = 'New Owner';
    owner.dispatchEvent(new Event('input'));
    expect(button('Cancel')).toBeTruthy();
    expect(button('Edit Profile')).toBeUndefined();

    button('Update')!.click();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/msme-profile/ZEDMSME000001');
    expect(put.request.body).toEqual({
      ownerName: 'New Owner', enterpriseName: 'Ent', emailId: 'a@b.test', pUnitName: 'Unit One',
      twoDigitActivity: '10-Food', fourDigitActivity: '1010', fiveDigitActivity: '10101',
    });
    put.flush({ message: 'Profile updated.' });
    await fixture.whenStable();
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({ ...profile, enterprise: { ...profile.enterprise, OwnerName: 'New Owner' } });
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
    expect(el.querySelector('.alert-success')?.textContent).toContain('Profile updated.');
    expect(el.querySelector('input[name="ownerName"]')).toBeNull();
    expect(el.querySelector('[data-field="OwnerName"]')?.textContent).toContain('New Owner');
  });

  it('cancels the edit without saving', async () => {
    const { fixture, http } = create('ZEDMSME000001', 10);
    http.expectOne('/api/staff/msme-profile/ZEDMSME000001').flush({ unit: { ZedId: 'ZEDMSME000001' }, enterprise: {}, certifications: [] });
    await fixture.whenStable();
    fixture.detectChanges();
    const el = fixture.nativeElement as HTMLElement;
    const button = (text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent?.trim() === text);
    button('Edit Profile')!.click();
    http.expectOne('/api/staff/msme-profile/sectors').flush([]);
    await fixture.whenStable();
    fixture.detectChanges();
    button('Cancel')!.click();
    fixture.detectChanges();
    expect(el.querySelector('input.form-control')).toBeNull();
    http.expectNone((r) => r.method === 'PUT');
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
