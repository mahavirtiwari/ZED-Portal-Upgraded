import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LgdDirectoryPage } from './lgd-directory';
import { RegionsResponse, SubsidyRegionsPage } from './subsidy-regions';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

/** Each stat tile as "value label". */
const stats = (el: HTMLElement) => [...el.querySelectorAll('.stat')].map((s) => `${s.querySelector('.stat-value')!.textContent!.trim()} ${s.querySelector('.stat-label')!.textContent!.trim()}`);

const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim().startsWith(text)) as HTMLButtonElement;

describe('SubsidyRegionsPage', () => {
  let fixture: ComponentFixture<SubsidyRegionsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/masters/regions';
  const data: RegionsResponse = {
    categories: [
      { key: 'ASPIRATIONAL', name: 'Aspirational Districts', description: 'NITI Aayog', level: 'district' },
      { key: 'NER', name: 'North Eastern Region', description: 'Eight states', level: 'state' },
    ],
    regions: [
      { category: 'ASPIRATIONAL', stateCode: '9', districtCode: '170', enabled: true, updatedBy: null, updatedOn: null, stateName: 'UTTAR PRADESH', districtName: 'SONBHADRA' },
      { category: 'NER', stateCode: '18', districtCode: '', enabled: false, updatedBy: null, updatedOn: null, stateName: 'ASSAM', districtName: null },
    ],
    states: [{ code: '9', name: 'UTTAR PRADESH' }, { code: '18', name: 'ASSAM' }],
    subsidyDistricts: 112,
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [SubsidyRegionsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(SubsidyRegionsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(url).flush(data);
    await settle(fixture);
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('shows the counts, the categories with their level and counts, and the entries of the one picked', async () => {
    expect(stats(el)).toEqual(['112 Districts get the additional subsidy', '1/2 Entries enabled', '1 States / UTs with an enabled entry', '2 Region lists']);
    expect([...el.querySelectorAll('[role=tab]')].map((t) => [...t.children].map((c) => c.textContent!.trim()).join(' | '))).toEqual(['Aspirational Districts | By district | 1/1 enabled', 'North Eastern Region | By state | 0/1 enabled']);
    expect(el.querySelector('tbody')!.textContent).toContain('SONBHADRA');
    button(el, 'North Eastern Region').click();
    await settle(fixture);
    expect(el.querySelector('tbody')!.textContent).toContain('Whole state');
    expect(el.querySelector('tbody')!.textContent).toContain('Disabled');
  });

  it('says which other portals have different districts and updates them', async () => {
    expect(el.querySelector('.copy-bar')).toBeNull();
    fixture = TestBed.createComponent(SubsidyRegionsPage);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(url).flush({ ...data, otherPortals: [{ portal: 'Surveillance', districts: 3 }] });
    await settle(fixture);
    expect(el.querySelector('.copy-bar')!.textContent!.replace(/\s+/g, ' ')).toContain('Surveillance: 3 districts differ.');
    button(el, 'UPDATE THEM NOW').click();
    await settle(fixture);
    const copy = http.expectOne(`${url}/copy`);
    expect(copy.request.method).toBe('POST');
    copy.flush({ message: "The Consultancy and Surveillance portals' districts were updated too." });
    await settle(fixture);
    http.expectOne(url).flush({ ...data, otherPortals: [] });
    await settle(fixture);
    expect(el.querySelector('.copy-bar')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('districts were updated');
  });

  it('enables an entry and refreshes the count', async () => {
    button(el, 'North Eastern Region').click();
    await settle(fixture);
    (el.querySelector('[aria-label="Enable ASSAM"]') as HTMLInputElement).click();
    await settle(fixture);
    const put = http.expectOne((r) => r.method === 'PUT');
    expect(put.request.body).toEqual({ category: 'NER', stateCode: '18', districtCode: '', enabled: true });
    put.flush({ message: 'Enabled. 140 districts now get the additional subsidy.' });
    await settle(fixture);
    http.expectOne(url).flush({ ...data, subsidyDistricts: 140 });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('140 districts');
  });

  it('pages a long list and stays on the page after a switch', async () => {
    const many = Array.from({ length: 25 }, (_, i) => ({ ...data.regions[0], districtCode: String(100 + i), districtName: `DISTRICT ${i + 1}` }));
    button(el, 'North Eastern Region').click();
    await settle(fixture);
    http.expectNone(url);
    (fixture.componentInstance as unknown as { load(b: boolean): Promise<void> }).load(false);
    http.expectOne(url).flush({ ...data, regions: [...many, data.regions[1]] });
    await settle(fixture);
    button(el, 'Aspirational Districts').click();
    await settle(fixture);
    const names = () => [...el.querySelectorAll('tbody tr td:nth-child(2)')].map((c) => c.textContent!.trim());
    expect(names().length).toBe(10);
    expect(el.querySelector('.zed-pager')!.textContent).toContain('(25 records)');
    button(el, 'Next').click();
    await settle(fixture);
    expect(names()[0]).toBe('DISTRICT 11');
    (el.querySelector('[aria-label="Disable DISTRICT 11"]') as HTMLInputElement).click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'PUT').flush({ message: 'Disabled.' });
    await settle(fixture);
    http.expectOne(url).flush({ ...data, regions: [...many.map((r, i) => (i === 10 ? { ...r, enabled: false } : r)), data.regions[1]] });
    await settle(fixture);
    expect(names()[0]).toBe('DISTRICT 11');
  });

  it('adds a district after choosing the state, and asks for the district first', async () => {
    button(el, 'Add').click();
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('choose the state and the district');
    const state = el.querySelector('#sr-state') as HTMLSelectElement;
    state.value = '9';
    state.dispatchEvent(new Event('change'));
    await settle(fixture);
    http.expectOne((r) => r.url === `${url}/districts` && r.params.get('state') === '9').flush([{ code: '164', name: 'KANPUR NAGAR' }]);
    await settle(fixture);
    const district = el.querySelector('#sr-district') as HTMLSelectElement;
    district.value = '164';
    district.dispatchEvent(new Event('change'));
    await settle(fixture);
    button(el, 'Add').click();
    await settle(fixture);
    expect(http.expectOne((r) => r.method === 'POST').request.body).toEqual({ category: 'ASPIRATIONAL', stateCode: '9', districtCode: '164', enabled: true });
  });

  it('filters the entries by status and searches a state from its chip', async () => {
    const rows = [
      data.regions[0],
      { ...data.regions[0], districtCode: '171', districtName: 'MIRZAPUR', enabled: false },
      { ...data.regions[0], stateCode: '10', stateName: 'BIHAR', districtCode: '210', districtName: 'ARARIA' },
      data.regions[1],
    ];
    (fixture.componentInstance as unknown as { load(b: boolean): Promise<void> }).load(false);
    http.expectOne(url).flush({ ...data, regions: rows });
    await settle(fixture);
    const names = () => [...el.querySelectorAll('tbody tr td:nth-child(2)')].map((c) => c.textContent!.trim());
    const chips = () => [...el.querySelectorAll('.sr-chip')].map((c) => c.textContent!.replace(/\s+/g, ' ').trim());
    expect(names()).toEqual(['SONBHADRA', 'MIRZAPUR', 'ARARIA']);
    expect(chips()).toEqual(['BIHAR 1/1', 'UTTAR PRADESH 1/2']);
    expect([...el.querySelectorAll('.seg button')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['All 3', 'Enabled 2', 'Disabled 1']);

    button(el, 'Disabled').click();
    await settle(fixture);
    expect(names()).toEqual(['MIRZAPUR']);
    button(el, 'All').click();
    await settle(fixture);
    button(el, 'BIHAR').click();
    await settle(fixture);
    expect(names()).toEqual(['ARARIA']);
    expect(button(el, 'BIHAR').getAttribute('aria-pressed')).toBe('true');
    button(el, 'BIHAR').click();
    await settle(fixture);
    expect(names().length).toBe(3);

    button(el, 'Disabled').click();
    await settle(fixture);
    button(el, 'North Eastern Region').click();
    await settle(fixture);
    // Another category shows all its entries again.
    expect(el.querySelector('.seg button.active')!.textContent).toContain('All');
    expect(el.querySelector('tbody')!.textContent).toContain('ASSAM');
  });
});

describe('LgdDirectoryPage', () => {
  it('checks the uploaded LGD list, shows its counts, ticks the new and renamed entries and applies the ticked ones', async () => {
    await TestBed.configureTestingModule({ imports: [LgdDirectoryPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(LgdDirectoryPage);
    const http = TestBed.inject(HttpTestingController);
    const el = fixture.nativeElement as HTMLElement;
    await settle(fixture);

    const input = el.querySelector('#lgd-file') as HTMLInputElement;
    expect(el.querySelector('.lgd-drop')!.textContent).toContain('Choose the LGD district list');
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'districts.csv')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(el.querySelector('.lgd-drop')!.textContent).toContain('districts.csv (under 1 KB)');
    button(el, 'Check changes').click();
    await settle(fixture);
    http.expectOne('/api/staff/masters/lgd/preview').flush({
      statesInFile: 1, districtsInFile: 3,
      changes: [
        { kind: 'addDistrict', stateCode: '9', stateName: 'Uttar Pradesh', districtCode: '780', districtName: 'New District', oldName: null },
        { kind: 'renameDistrict', stateCode: '9', stateName: 'Uttar Pradesh', districtCode: '170', districtName: 'Sonbhadra', oldName: 'SONEBHADRA' },
        { kind: 'deactivateDistrict', stateCode: '9', stateName: 'UTTAR PRADESH', districtCode: '999', districtName: 'OLD DISTRICT', oldName: null },
      ],
    });
    await settle(fixture);
    const text = (sel: string) => [...el.querySelectorAll(sel)].map((t) => t.textContent!.replace(/\s+/g, ' ').trim());
    expect(stats(el)).toEqual(['1 States / UTs in the file', '3 Districts in the file', '3 Changes found']);
    expect([...el.querySelectorAll('.lgd-kind')].map((k) => `${k.querySelector('.lgd-kind-name')!.textContent} (${k.querySelector('.lgd-kind-count')!.textContent})`)).toEqual(['New district (1)', 'District renamed (1)', 'No longer in LGD (deactivate) (1)']);
    expect(text('tbody .lgd-badge.is-drop')).toEqual(['No longer in LGD (deactivate)']);
    expect(el.querySelector('.lgd-count')!.textContent!.replace(/\s+/g, ' ').trim()).toBe('2 of 3 ticked');
    expect(el.querySelectorAll('.lgd-step.is-now .lgd-no')[0].textContent).toBe('3');

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button(el, 'Apply ticked changes').click();
    await settle(fixture);
    const apply = http.expectOne('/api/staff/masters/lgd/apply');
    expect(apply.request.body.changes.map((c: { kind: string }) => c.kind)).toEqual(['addDistrict', 'renameDistrict']);
    apply.flush({ message: '2 change(s) applied to the states and districts.' });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('2 change(s) applied');
    http.verify();
    vi.restoreAllMocks();
  });
});
