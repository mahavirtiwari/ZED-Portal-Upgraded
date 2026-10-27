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
      { category: 'ASPIRATIONAL', stateCode: '9', districtCode: '170', enabled: true, source: 'Before V4', updatedBy: null, updatedOn: null, stateName: 'UTTAR PRADESH', districtName: 'SONBHADRA' },
      { category: 'NER', stateCode: '18', districtCode: '', enabled: false, source: 'North Eastern Region', updatedBy: null, updatedOn: null, stateName: 'ASSAM', districtName: null },
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

  it('shows the categories with their counts and the entries of the one picked', async () => {
    expect(el.textContent).toContain('112 districts get the additional subsidy');
    expect([...el.querySelectorAll('[role=tab]')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['Aspirational Districts 1/1', 'North Eastern Region 0/1']);
    expect(el.querySelector('tbody')!.textContent).toContain('SONBHADRA');
    button(el, 'North Eastern Region').click();
    await settle(fixture);
    expect(el.querySelector('tbody')!.textContent).toContain('Whole state');
    expect(el.querySelector('tbody')!.textContent).toContain('Disabled');
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
});

describe('LgdDirectoryPage', () => {
  it('checks the uploaded LGD list, ticks the new and renamed entries and applies the ticked ones', async () => {
    await TestBed.configureTestingModule({ imports: [LgdDirectoryPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(LgdDirectoryPage);
    const http = TestBed.inject(HttpTestingController);
    const el = fixture.nativeElement as HTMLElement;
    await settle(fixture);

    const input = el.querySelector('#lgd-file') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File(['x'], 'districts.csv')], configurable: true });
    input.dispatchEvent(new Event('change'));
    await settle(fixture);
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
    expect(el.textContent).toContain('2 of 3 ticked');
    expect(el.textContent).toContain('No longer in LGD (deactivate) (1)');

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
