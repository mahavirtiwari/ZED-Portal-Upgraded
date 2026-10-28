import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { DashboardCardsPage } from './dashboard-cards';

describe('DashboardCardsPage', () => {
  let fixture: ComponentFixture<DashboardCardsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const api = '/api/staff/schemes/incentive-master/dashboard';
  const cards = (kawachShown: boolean) => ({
    builtIn: [
      { id: 2, card: 'KAWACH', title: 'MSME KAWACH', highlight: 'Free', details: 'WASH Certification', active: kawachShown },
      { id: 3, card: 'JOINING_REWARD', title: 'Joining Reward', highlight: 'Rs. 10,000/-', details: 'Limited purpose reward', active: true },
    ],
    incentives: [
      { id: 57, incentiveType: 'ASSAM', title: 'Export Booster', highlight: null, active: true, applicableForBronze: false, applicableForSilver: true, applicableForGold: false },
    ],
  });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const button = (scope: Element, label: string) =>
    [...scope.querySelectorAll('button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
  const builtIn = (title: string) => [...el.querySelectorAll('.dc-card')].find((c) => c.querySelector('h6')!.textContent!.trim() === title) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DashboardCardsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(DashboardCardsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(api).flush(cards(true));
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the built-in cards and the incentives on the main dashboard', () => {
    expect(el.querySelector('#dc-builtin-h')!.textContent).toContain('2 of 2 shown');
    expect(builtIn('MSME KAWACH').querySelector('.status-badge')!.textContent!.trim()).toBe('Shown');
    const row = el.querySelector('tbody tr') as HTMLElement;
    expect(row.textContent).toContain('Export Booster');
    expect(row.textContent).toContain('State Government: ASSAM');
    expect(row.querySelector('a')!.getAttribute('href')).toBe('/staff/incentives/state/57/edit?state=ASSAM');
  });

  it('hides a built-in card and edits another', async () => {
    button(builtIn('MSME KAWACH'), 'Hide').click();
    await settle();
    const hide = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/KAWACH`);
    expect(hide.request.body).toEqual({ title: 'MSME KAWACH', highlight: 'Free', details: 'WASH Certification', active: false });
    hide.flush({ message: 'Card saved. It is hidden from the MSME dashboard.' });
    await settle();
    http.expectOne(api).flush(cards(false));
    await settle();
    expect(builtIn('MSME KAWACH').classList).toContain('is-off');
    expect(el.querySelector('.alert-success')!.textContent).toContain('hidden from the MSME dashboard');

    button(builtIn('Joining Reward'), 'Edit').click();
    await settle();
    const title = el.querySelector('#dc-title') as HTMLInputElement;
    expect(title.value).toBe('Joining Reward');
    title.value = '';
    title.dispatchEvent(new Event('input'));
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('title and description');
    http.expectNone((r) => r.method === 'PUT');

    title.value = 'Welcome Reward';
    title.dispatchEvent(new Event('input'));
    await settle();
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/JOINING_REWARD`);
    expect(put.request.body).toEqual(expect.objectContaining({ title: 'Welcome Reward', active: true }));
    put.flush({ message: 'Card saved. MSMEs see it on their dashboard.' });
    await settle();
    http.expectOne(api).flush(cards(false));
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });
});
