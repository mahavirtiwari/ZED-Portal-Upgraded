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
  const settingsApi = '/api/staff/settings/schemes/cards';
  const settings = () => ({
    financialAssistance: { activatesAfter: ['Bronze', 'Silver', 'Gold'] },
    technologyUpgradation: { recommendationRequired: true, directSchemeCode: null, schemes: [{ code: 'TU_DIRECT', name: 'Technology Upgradation (direct)', active: false }] },
  });
  const cards = (handholdingShown: boolean) => ({
    builtIn: [
      { id: 2, card: 'HANDHOLDING', title: 'Handholding Support', highlight: 'Rs. 2,00,000/-', details: 'for improving systems', active: handholdingShown },
      { id: 3, card: 'JOINING_REWARD', title: 'Joining Reward', highlight: 'Rs. 10,000/-', details: 'Limited purpose reward', active: true },
      { id: 4, card: 'FINANCIAL_ASSISTANCE', title: 'Financial Assistance', highlight: null, details: 'For certification', active: true },
      { id: 5, card: 'TECHNOLOGY_UPGRADATION', title: 'Technology Upgradation', highlight: null, details: 'Zero effect', active: true },
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
    http.expectOne(settingsApi).flush(settings());
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the built-in cards and the incentives on the main dashboard', () => {
    expect(el.querySelector('#dc-builtin-h')!.textContent).toContain('4 of 4 shown');
    expect(builtIn('Handholding Support').querySelector('.status-badge')!.textContent!.trim()).toBe('Shown');
    const card = el.querySelector('.dc-inc') as HTMLElement;
    expect(card.querySelector('h6')!.textContent).toContain('Export Booster');
    expect(card.textContent).toContain('State Government: ASSAM');
    expect(card.querySelector('.lv-chip')!.textContent).toBe('Silver');
    expect(card.querySelector('a')!.getAttribute('href')).toBe('/staff/incentives/state/57/edit?state=ASSAM');
    // The four stakeholder cards close the list and open their incentive pages.
    expect([...el.querySelectorAll('.dc-stake-card')].map((a) => a.getAttribute('href'))).toEqual(
      ['/staff/incentives/ministry', '/staff/incentives/state', '/staff/incentives/financial', '/staff/incentives/others']);
  });

  it('counts the cards MSMEs see and filters the incentive cards by level', () => {
    const stats = [...el.querySelectorAll('.dc-stats .stat-value')].map((v) => v.textContent!.replace(/\s+/g, ''));
    expect(stats).toEqual(['9', '4/4', '1/1', '0']);
    (el.querySelector('[data-level="bronze"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelector('.dc-inc')).toBeNull();
    expect(el.querySelector('[aria-labelledby="dc-inc-h"] .no-data')!.textContent).toContain('No incentive card applies to this level.');
    (el.querySelector('[data-level="silver"]') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(el.querySelectorAll('.dc-inc').length).toBe(1);
  });

  it('previews the card beside the fields of the Edit pop-up', async () => {
    button(builtIn('Joining Reward'), 'Edit').click();
    await settle();
    const preview = el.querySelector('.modal .dc-preview') as HTMLElement;
    expect(preview.querySelector('h6')!.textContent).toBe('Joining Reward');
    expect(preview.querySelector('.clr-spot')!.textContent).toBe('Rs. 10,000/-');
    const title = el.querySelector('#dc-title') as HTMLInputElement;
    title.value = 'Welcome Reward';
    title.dispatchEvent(new Event('input'));
    (el.querySelector('#dc-active') as HTMLInputElement).click();
    await settle();
    expect(preview.querySelector('h6')!.textContent).toBe('Welcome Reward');
    expect(preview.querySelector('.pv-card')!.classList).toContain('is-faded');
    expect(preview.textContent).toContain('MSMEs do not see this card.');
    button(el.querySelector('.modal')!, 'Cancel').click();
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('hides a built-in card and edits another', async () => {
    button(builtIn('Handholding Support'), 'Hide').click();
    await settle();
    const hide = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/HANDHOLDING`);
    expect(hide.request.body).toEqual({ title: 'Handholding Support', highlight: 'Rs. 2,00,000/-', details: 'for improving systems', active: false });
    hide.flush({ message: 'Card saved. It is hidden from the MSME dashboard.' });
    await settle();
    http.expectOne(api).flush(cards(false));
    await settle();
    expect(builtIn('Handholding Support').classList).toContain('is-off');
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

  it('sets when Financial Assistance opens and the Technology Upgradation flow', async () => {
    const fa = builtIn('Financial Assistance');
    (fa.querySelector('[data-level="Bronze"]') as HTMLInputElement).click();
    await settle();
    const tu = builtIn('Technology Upgradation');
    expect(tu.textContent).toContain('as today');
    (tu.querySelector('#cs-recommendation') as HTMLInputElement).click();
    await settle();
    expect(tu.textContent).toContain('apply directly');
    const select = tu.querySelector('#cs-direct') as HTMLSelectElement;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await settle();
    button(tu, 'Save setting').click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === settingsApi);
    expect(put.request.body).toEqual({
      financialAssistance: { activatesAfter: ['Silver', 'Gold'] },
      technologyUpgradation: { recommendationRequired: false, directSchemeCode: 'TU_DIRECT' },
    });
    put.flush({ message: 'Card settings saved. Technology Upgradation (direct) is off: switch it on so units can apply.' });
    await settle();
    expect(tu.textContent).toContain('switch it on');
    expect(fa.textContent).not.toContain('switch it on');
  });
});
