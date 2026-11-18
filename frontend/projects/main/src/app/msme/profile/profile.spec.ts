import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePage, profileCompleteness, shortDate } from './profile';

describe('ProfilePage', () => {
  let fixture: ComponentFixture<ProfilePage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const profile = {
    msme: {
      ZedId: 'ZEDMSME000001', PUnitName: 'Acme Unit 1', PAddress: 'Plot 4', PDistrictName: 'KANPUR NAGAR', PStateName: 'UTTAR PRADESH', PPin: '208022',
      Activity: 'Manufacturing', TwoDigitActivity: '24 - Basic metals', FourDigitActivity: '2431 - Casting', FiveDigitActivity: '24311',
      IncorporationDate: '01/04/2015', WhetherProdCommenced: 'Yes',
    },
    basicInfo: { UdyogAadharNo: 'UDYAM-UP-29-0003915', EnterpriseName: 'Acme Castings', OwnerName: 'A Kumar', TotalEmp: 12, PanNo: null },
    registeredEmail: 'karan@example.com',
  };

  /** api/msme/dashboard, read for the header's chips (Bronze certified: status 6). */
  const dashboard = { msme: { PledgeOn: 'November 13, 2026', EnterpriseType: 'Micro' }, basicInfo: {}, certStatus: { BronzeStatus: 6, SilverStatus: 0 }, levels: [] };

  const activities = [
    { Activity: 'Manufacturing', Two_DigitActivity: '24 - Basic metals', Four_DigitActivity: '2431 - Casting', Five_DigitActivity: '24311' },
    { Activity: 'Manufacturing', Two_DigitActivity: '26 - Electronics', Four_DigitActivity: '2610 - Components', Five_DigitActivity: '26101' },
  ];

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement | undefined;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The header's chips and the menu's count (best effort). */
  function flushExtras(dash: object | null = dashboard, total = 3) {
    const d = http.expectOne('/api/msme/dashboard');
    if (dash) d.flush(dash);
    else d.flush({}, { status: 500, statusText: 'Server Error' });
    http.expectOne((r) => r.url === '/api/msme/edit-history').flush({ total, pageNo: 1, pageSize: 10, rows: [] });
  }

  async function loaded(data: object = profile, dash: object | null = dashboard) {
    await settle();
    http.expectOne('/api/msme/profile').flush(data);
    flushExtras(dash);
    await settle();
  }

  async function openEditor() {
    await loaded();
    button('Edit activity')!.click();
    await settle();
    http.expectOne('/api/msme/profile/activities').flush(activities);
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ProfilePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    window.scrollTo = () => undefined;
  });

  afterEach(() => http.verify());

  it('shows the basic information, selected unit and activity', async () => {
    await loaded();
    const text = el.textContent!;
    expect(text).toContain('ZEDMSME000001');
    expect(text).toContain('UDYAM-UP-29-0003915');
    expect(text).toContain('Acme Castings');
    expect(text).toContain('Plot 4, KANPUR NAGAR, UTTAR PRADESH, 208022');
    expect(el.querySelector('zed-page-head')!.textContent).toContain('Enterprise profile');
    // The rest of the Udyam details (here the employees, 12) under "Show all details".
    expect(text).not.toContain('Total Employee');
    button('Show all details')!.click();
    fixture.detectChanges();
    expect(el.textContent).toContain('12');
    expect(text).toContain('24311');
    expect(el.querySelector('.loadingdiv')).toBeNull();
  });

  it('shows the API message when the profile cannot be loaded', async () => {
    await settle();
    http.expectOne('/api/msme/profile').flush({ title: 'Session expired' }, { status: 400, statusText: 'Bad Request' });
    flushExtras(null);
    await settle();
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Error!');
    expect(dialog.textContent).toContain('Session expired');
  });

  it('edits the activity: lists the Udyam activities, offers UPDATE only for a different one, and reloads', async () => {
    await openEditor();
    const radios = el.querySelectorAll<HTMLInputElement>('input[name="Activity"]');
    expect(radios.length).toBe(2);
    expect(radios[0].checked).toBe(true);
    expect(button('Update')).toBeUndefined();

    radios[1].click();
    await settle();
    button('Update')!.click();
    await settle();

    const req = http.expectOne('/api/msme/profile/activity');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ fiveDigitActivity: '26101' });
    req.flush({ message: 'Activity updated successfully.' });
    await settle();

    http.expectOne('/api/msme/profile').flush({ ...profile, msme: { ...profile.msme, FiveDigitActivity: '26101' } });
    await settle();
    const dialog = el.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain('Success!');
    expect(dialog.textContent).toContain('Activity updated successfully.');
    expect(el.querySelector('input[name="Activity"]')).toBeNull();
    expect(button('Edit activity')).toBeDefined();
  });

  it('keeps the editor open and shows the reason when the update is refused', async () => {
    await openEditor();
    el.querySelectorAll<HTMLInputElement>('input[name="Activity"]')[1].click();
    await settle();
    button('Update')!.click();
    await settle();

    http.expectOne('/api/msme/profile/activity').flush(
      { title: 'Currently this scheme is not applicable for the selected plant activity.' },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    expect(el.querySelector('[role="dialog"]')!.textContent).toContain('not applicable');
    expect(el.querySelectorAll('input[name="Activity"]').length).toBe(2);
  });

  it('CANCEL returns to the current activity without saving', async () => {
    await openEditor();
    button('Cancel')!.click();
    await settle();
    expect(el.querySelector('input[name="Activity"]')).toBeNull();
    expect(button('Edit activity')).toBeDefined();
  });

  it('shows the header chips from the dashboard, the menu counts and the pledge link', async () => {
    await loaded();
    const hero = el.querySelector('.hero')!;
    expect(hero.textContent).toContain('Acme Castings');
    expect(hero.textContent).toContain('Bronze certified');
    // 2026-11-18 (the user's applicant designs): the procedure's "November 13, 2026" as 13 Nov 2026.
    expect(hero.textContent).toContain('Pledge taken 13 Nov 2026');
    expect(hero.querySelector('a')!.getAttribute('href')).toBe('/msme/pledge-certificate');
    const nav = el.querySelector('nav[aria-label="Profile sections"]')!;
    expect(nav.textContent).toContain('1 unit');
    expect(nav.textContent).toContain('3 changes');
    expect(nav.querySelector('a[href="/msme/change-password"]')).not.toBeNull();
    expect(nav.querySelector('a[href="/msme/edit-history"]')).not.toBeNull();
    expect(el.querySelector('.unit')!.textContent).toContain('Bronze certified');
  });

  it('hides the certification and pledge chips when the dashboard does not answer', async () => {
    await loaded(profile, null);
    const hero = el.querySelector('.hero')!;
    expect(hero.textContent).not.toContain('certified');
    expect(hero.textContent).not.toContain('Pledge taken');
  });

  it('shows the PAN, e-mail and mobile in full, with no Show / Hide', async () => {
    // 2026-11-18 (the user): e-mail, mobile and PAN are never masked on signed-in pages.
    await loaded({ ...profile, basicInfo: { ...profile.basicInfo, PanNo: 'ABCDE1234F', MobileNo: '9876543133' } });
    expect(el.querySelector('[data-testid="pan"]')!.textContent).toBe('ABCDE1234F');
    expect(el.querySelector('[data-testid="registered-email"]')!.textContent).toBe('karan@example.com');
    expect(el.querySelector('[data-testid="mobile"]')!.textContent).toBe('9876543133');
    expect(el.textContent).not.toContain('•');
    expect(button('Show')).toBeFalsy();
    expect(button('Hide')).toBeFalsy();
  });

  it('shows the activity as the 2 > 4 > 5-digit hierarchy', async () => {
    await loaded();
    const items = [...el.querySelectorAll('.tree li')].map((li) => li.textContent!.replace(/\s+/g, ' ').trim());
    expect(items).toEqual(['Manufacturing', '24 Basic metals', '2431 Casting', '24311']);
  });

  it('shows Verified after the mobile only when it is the Udyam record’s', async () => {
    await loaded({ ...profile, basicInfo: { ...profile.basicInfo, MobileNo: '9876543133' }, mobileVerified: true });
    const mobile = el.querySelector('[data-testid="mobile"]')!.parentElement!;
    expect(mobile.textContent).toContain('9876543133');
    expect(mobile.querySelector('.ok')!.textContent).toContain('Verified');
  });

  it('shows no Verified after a mobile the API does not vouch for', async () => {
    await loaded({ ...profile, basicInfo: { ...profile.basicInfo, MobileNo: '9876543133' } });
    expect(el.querySelector('[data-testid="mobile"]')!.parentElement!.querySelector('.ok')).toBeNull();
  });

  it('shows the profile completeness under the menu with the first missing detail', async () => {
    // The sample has the e-mail, activity, unit and no PAN, mobile or address: 3 of 6.
    await loaded();
    const card = el.querySelector('[data-testid="completeness"]')!;
    expect(card.closest('.ps-side')).not.toBeNull();
    expect(card.textContent).toContain('Profile completeness');
    expect(card.textContent).toContain('50%');
    expect(card.querySelector('[role="progressbar"]')!.getAttribute('aria-valuenow')).toBe('50');
    expect(card.textContent).toContain('Add your mobile number on the Udyam portal; 2 more details missing.');
  });

  it('Edit contact opens the change of the registered e-mail', async () => {
    await loaded();
    button('Edit contact')!.click();
    await settle();
    expect(el.querySelector('[data-testid="email-change"]')).not.toBeNull();
    expect(button('Edit contact')).toBeUndefined();
  });
});

// 2026-11-18 (the user's applicant designs): the pure helpers (no page, so no requests to flush).
describe('ProfilePage helpers', () => {
  it('computes the completeness from the six facts the page reads', () => {
    const all = { email: true, activity: true, unit: true, mobile: true, pan: true, address: true };
    expect(profileCompleteness(all)).toEqual({ percent: 100, hint: 'All your profile details are in place.' });
    expect(profileCompleteness({ ...all, pan: false })).toEqual({ percent: 83, hint: 'Add your PAN on the Udyam portal to reach 100%.' });
    expect(profileCompleteness({ ...all, email: false, address: false }).percent).toBe(66);
    expect(profileCompleteness({ ...all, email: false, address: false }).hint).toBe('Verify a registered e-mail under Contact; 1 more detail missing.');
    expect(profileCompleteness({ email: false, activity: false, unit: false, mobile: false, pan: false, address: false }).percent).toBe(0);
  });

  it('writes the pledge date as d MMM yyyy', () => {
    expect(shortDate('November 13, 2026')).toBe('13 Nov 2026');
    expect(shortDate('13/11/2026')).toBe('13 Nov 2026');
    expect(shortDate('2026-11-05')).toBe('5 Nov 2026');
    expect(shortDate('soon')).toBe('soon');
  });
});
