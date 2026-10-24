import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ProfilePage } from './profile';

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
  };

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

  async function loaded() {
    await settle();
    http.expectOne('/api/msme/profile').flush(profile);
    await settle();
  }

  async function openEditor() {
    await loaded();
    button('Edit Activity')!.click();
    await settle();
    http.expectOne('/api/msme/profile/activities').flush(activities);
    await settle();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ProfilePage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
    expect(text).toContain('12');
    expect(text).toContain('Plot 4, KANPUR NAGAR, UTTAR PRADESH, 208022');
    expect(text).toContain('24311');
    expect(el.querySelector('.loadingdiv')).toBeNull();
  });

  it('shows the API message when the profile cannot be loaded', async () => {
    await settle();
    http.expectOne('/api/msme/profile').flush({ title: 'Session expired' }, { status: 400, statusText: 'Bad Request' });
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
    expect(button('UPDATE')).toBeUndefined();

    radios[1].click();
    await settle();
    button('UPDATE')!.click();
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
    expect(button('Edit Activity')).toBeDefined();
  });

  it('keeps the editor open and shows the reason when the update is refused', async () => {
    await openEditor();
    el.querySelectorAll<HTMLInputElement>('input[name="Activity"]')[1].click();
    await settle();
    button('UPDATE')!.click();
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
    button('CANCEL')!.click();
    await settle();
    expect(el.querySelector('input[name="Activity"]')).toBeNull();
    expect(button('Edit Activity')).toBeDefined();
  });
});
