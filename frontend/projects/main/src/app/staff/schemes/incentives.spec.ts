import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { IncentiveFormPage } from './incentive-form';
import { IncentiveMasterPage } from './incentive-master';
import { IncentiveSubmissionsPage } from './incentive-submissions';
import { IncentiveUploadPage } from './incentive-upload';

describe('incentive pages', () => {
  let fixture: ComponentFixture<unknown>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create<T>(component: Type<T>, query: Record<string, string> = {}, params: Record<string, string> = {}) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query), paramMap: convertToParamMap(params) }, queryParamMap: of(convertToParamMap(query)), paramMap: of(convertToParamMap(params)) } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(component);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement as HTMLElement;
    await settle();
  }

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement;

  function choose(input: HTMLInputElement, file: File) {
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  afterEach(() => http.verify());

  it('lists API incentive submissions and searches with the chosen filters', async () => {
    await create(IncentiveSubmissionsPage);
    http.expectOne((r) => r.url === '/api/staff/schemes/incentives/submissions' && r.params.keys().length === 0)
      .flush([{ PUnitName: 'Acme', PStateName: 'UP', UdyamNo: 'UDYAM-UP-29-0003915', DisbursedDate: '2026-01-05T00:00:00', DisbursedAmount: 1000 }]);
    await settle();
    expect(el.querySelector('tbody')!.textContent).toContain('05-01-2026');

    const state = el.querySelector('#incState') as HTMLSelectElement;
    state.value = '9';
    state.dispatchEvent(new Event('change'));
    const gender = el.querySelector('#incGender') as HTMLSelectElement;
    gender.value = 'female';
    gender.dispatchEvent(new Event('change'));
    await settle();
    button('Search').click();
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/schemes/incentives/submissions' && r.params.keys().length > 0);
    expect(req.request.params.get('state')).toBe('9');
    expect(req.request.params.get('gender')).toBe('female');
    expect(req.request.params.has('certification')).toBe(false);
    req.flush([]);
    await settle();
    expect(el.textContent).toContain('No Ministry of MSME Incentives available currently');
  });

  it('uploads an incentive workbook and lists the row errors the server finds', async () => {
    await create(IncentiveUploadPage);
    const input = el.querySelector('#incFile') as HTMLInputElement;

    choose(input, new File(['x'], 'old.xls'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('.xlsx');

    choose(input, new File(['PK'], 'incentives.xlsx'));
    await settle();
    button('Upload').click();
    await settle();
    const req = http.expectOne('/api/staff/schemes/incentives/upload');
    expect((req.request.body as FormData).get('file')).toBeTruthy();
    req.flush(
      { title: 'The file has errors; nothing was uploaded.', rowErrors: [{ row: 3, column: 'ServiceName', message: 'Contains characters or words that are not allowed.' }] },
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('nothing was uploaded');
    expect(el.querySelector('table')!.textContent).toContain('ServiceName');

    button('Upload').click();
    await settle();
    http.expectOne('/api/staff/schemes/incentives/upload').flush({
      message: 'Incentives Uploaded successfully.', inserted: 1,
      rows: [{ UdyamNo: 'UDYAM-UP-29-0003915', DisbursedDate: '20260105', ApplicationId: '20260105' }],
    });
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('(1 rows)');
    const cells = [...el.querySelectorAll('tbody tr td')].map((td) => td.textContent!.trim());
    expect(cells).toContain('05-01-2026');
    expect(cells).toContain('20260105'); // ApplicationId is not a date
  });

  it('lists the rows that were uploaded before and were skipped', async () => {
    await create(IncentiveUploadPage);
    choose(el.querySelector('#incFile') as HTMLInputElement, new File(['PK'], 'incentives.xlsx'));
    await settle();
    button('Upload').click();
    await settle();
    http.expectOne('/api/staff/schemes/incentives/upload').flush({
      message: 'Nothing new to upload: all 1 row(s) were uploaded before.', inserted: 0, rows: [],
      skipped: [{ row: 2, udyamNo: 'UDYAM-UP-29-0003915', uploadedOn: '2026-01-06T10:00:00' }],
    });
    await settle();
    expect(el.querySelector('.alert-info')!.textContent).toContain('Nothing new to upload');
    const skipped = el.querySelector('#skippedRows')!.textContent!;
    expect(skipped).toContain('UDYAM-UP-29-0003915');
    expect(skipped).toContain('06-01-2026');
    // Nothing was saved, so the file chooser stays available.
    expect(el.querySelector('#incFile')).toBeTruthy();
  });

  const typeIn = (id: string, value: string) => {
    const input = el.querySelector(`#${id}`) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const link = (text: string) => [...el.querySelectorAll('a.btn')].find((a) => a.textContent!.includes(text));

  const names = () => [...el.querySelectorAll('.inc-card .inc-name')].map((n) => n.textContent!.trim());
  const filter = (attr: string, value: string) => el.querySelector(`[data-${attr}="${value}"]`) as HTMLButtonElement;

  it('lists the incentives of a group with their counts, a status filter and Edit pages', async () => {
    await create(IncentiveMasterPage, {}, { group: 'financial' });
    http.expectOne((r) => r.url === '/api/staff/schemes/incentive-master' && r.params.get('type') === 'Financial').flush([
      { incentive: { Id: 41, Incentive: 'Scheme A', MinistryOrDepartment: 'SIDBI', WebLink: 'javascript:alert(1)', ApplicableForBronze: true, ActiveStatus: true }, hasDocument1: true, hasDocument2: false },
      { incentive: { Id: 42, Incentive: 'Scheme B', WebLink: 'https://x.in', ApplicableForGold: true, ActiveStatus: false, DisplayOn: 'Dashboard', CardHighlight: 'Rs. 1,000/-' }, hasDocument1: false, hasDocument2: false },
    ]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Financial Institution Incentives');
    expect([...el.querySelectorAll('.inc-tile')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim()))
      .toEqual(['2Incentives', '1Active', '1Inactive', '1On the main dashboard']);
    expect(el.querySelector('.inc-group-tab.active')!.textContent).toContain('Financial Institution');
    // Each incentive as a card: department (with the group's label), levels, where it appears, highlight.
    const [a, b] = [...el.querySelectorAll('.inc-card')] as HTMLElement[];
    expect(a.querySelector('small')!.textContent).toContain('Financial Institution: SIDBI');
    expect(a.querySelector('.lv-chip')!.textContent).toBe('Bronze');
    expect(a.querySelector('.inc-where')!.textContent).toContain('In the Financial Institutions card');
    expect(b.querySelector('.inc-where')!.textContent).toContain('Main dashboard');
    expect(b.querySelector('.inc-highlight')!.textContent).toContain('Rs. 1,000/-');
    expect(b.classList).toContain('is-off');
    // Non-http links are not rendered as links.
    expect(el.querySelector('.inc-list a[target="_blank"][href^="javascript"]')).toBeNull();
    expect(el.querySelector('a[aria-label="Document 1"]')!.getAttribute('href')).toBe('/api/staff/schemes/incentive-master/41/documents/1');
    expect(el.querySelector('.inc-card a.inc-edit')!.getAttribute('href')).toBe('/staff/incentives/financial/41/edit');
    expect(link('Create New Incentive')!.getAttribute('href')).toBe('/staff/incentives/financial/new');

    expect(filter('status', 'inactive').querySelector('.seg-count')!.textContent).toBe('1');
    filter('status', 'inactive').click();
    await settle();
    expect(names()).toEqual(['Scheme B']);

    // The search box: any column, together with the status filter.
    filter('status', 'all').click();
    const search = el.querySelector('#inc-search') as HTMLInputElement;
    search.value = 'x.in';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(names()).toEqual(['Scheme B']);
    search.value = 'nothing like it';
    search.dispatchEvent(new Event('input'));
    await settle();
    expect(el.querySelector('.inc-list .no-data')!.textContent).toContain('No incentive matches "nothing like it".');
  });

  it('filters the incentives of a group by level, with the count per level', async () => {
    await create(IncentiveMasterPage, {}, { group: 'others' });
    http.expectOne((r) => r.params.get('type') === 'Other').flush([
      { incentive: { Id: 1, Incentive: 'Scheme A', ApplicableForBronze: true, ApplicableForSilver: true, ActiveStatus: true }, hasDocument1: false, hasDocument2: false },
      { incentive: { Id: 2, Incentive: 'Scheme B', ApplicableForSilver: true, ApplicableForGold: true, ActiveStatus: true }, hasDocument1: false, hasDocument2: false },
      { incentive: { Id: 3, Incentive: 'Scheme C', ApplicableForGold: true, ActiveStatus: false }, hasDocument1: false, hasDocument2: false },
    ]);
    await settle();
    expect(['all', 'bronze', 'silver', 'gold'].map((l) => filter('level', l).querySelector('.seg-count')!.textContent)).toEqual(['3', '1', '2', '2']);
    filter('level', 'gold').click();
    await settle();
    expect(names()).toEqual(['Scheme B', 'Scheme C']);
    // Together with the status filter.
    filter('status', 'active').click();
    await settle();
    expect(names()).toEqual(['Scheme B']);
    filter('level', 'bronze').click();
    await settle();
    expect(names()).toEqual(['Scheme A']);
  });

  it('asks for the state on the State Government page', async () => {
    await create(IncentiveMasterPage, {}, { group: 'state' });
    http.expectNone('/api/staff/schemes/incentive-master');
    expect(el.textContent).toContain('Choose a state to see its incentives.');
    expect(link('Create New Incentive')).toBeUndefined();
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    const select = el.querySelector('#inc-state') as HTMLSelectElement;
    select.value = 'ASSAM';
    select.dispatchEvent(new Event('change'));
    expect(navigate).toHaveBeenCalledWith([], expect.objectContaining({ queryParams: { state: 'ASSAM' } }));
  });

  it('lists the incentives of the chosen state and creates one there', async () => {
    await create(IncentiveMasterPage, { state: 'ASSAM' }, { group: 'state' });
    http.expectOne((r) => r.params.get('type') === 'ASSAM').flush([]);
    await settle();
    expect(el.querySelector('section.inc-list h5')!.textContent).toContain('Assam Incentive Schemes');
    expect(link('Create New Incentive')!.getAttribute('href')).toBe('/staff/incentives/state/new?state=ASSAM');
  });

  it('refuses non-PDF documents in the list and uploads PDFs', async () => {
    await create(IncentiveMasterPage, {}, { group: 'ministry' });
    http.expectOne((r) => r.params.get('type') === 'Common').flush([
      { incentive: { Id: 41, Incentive: 'Scheme A' }, hasDocument1: false, hasDocument2: false },
    ]);
    await settle();
    const inputs = el.querySelectorAll('input[type="file"]');
    choose(inputs[0] as HTMLInputElement, new File(['<html>'], 'page.html'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('valid PDF');

    choose(inputs[1] as HTMLInputElement, new File(['%PDF'], 'doc.pdf'));
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/schemes/incentive-master/41/documents/2');
    expect(req.request.params.get('type')).toBe('Common');
    req.flush({ message: 'Document Uploaded Successfully.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush([]);
    await settle();
  });

  it('creates a state incentive with the wording of its group and attaches its documents', async () => {
    await create(IncentiveFormPage, { state: 'ASSAM' }, { group: 'state' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    expect(el.querySelector('h3')!.textContent).toContain('Create New Incentive');
    expect(el.querySelector('label[for="inc-ministryOrDepartment"]')!.textContent).toContain('State Department');
    expect((el.querySelector('#inc-state') as HTMLSelectElement).value).toBe('ASSAM');
    expect(el.querySelector('.save-bar')!.classList).not.toContain('is-dirty');

    button('Save Incentive').click();
    await settle();
    http.expectNone('/api/staff/schemes/incentive-master');
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Incentive title required.');

    const values: Record<string, string> = {
      'inc-incentive': 'Scheme B', 'inc-details': 'd', 'inc-ministryOrDepartment': 'Industries', 'inc-contactPerson': 'c', 'inc-email': 'a@b.in',
      'inc-mobileNo': '011', 'inc-webLink': 'https://x.in',
    };
    for (const [k, v] of Object.entries(values)) typeIn(k, v);
    await settle();
    expect(el.querySelector('.save-bar.is-dirty')!.textContent).toContain('Not saved yet.');
    button('Save Incentive').click();
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('levels');
    (el.querySelector('#inc-applicableForSilver') as HTMLInputElement).click();
    choose(el.querySelector('#inc-doc1') as HTMLInputElement, new File(['%PDF'], 'guide.pdf'));
    await settle();
    // Where it appears: inside the stakeholder card by default; Main dashboard asks for the card's highlight.
    expect((el.querySelector('#inc-where-Card') as HTMLInputElement).checked).toBe(true);
    expect(el.querySelector('.where-option.is-on')!.textContent).toContain('States/UTs card');
    expect(el.querySelector('#inc-cardHighlight')).toBeNull();
    // The preview: inside the States/UTs card, then its own card on the main dashboard.
    const preview = () => el.querySelector('.inc-preview') as HTMLElement;
    expect(preview().querySelector('.pv-where')!.textContent).toContain('States/UTs card');
    expect(preview().querySelector('.pv-row')!.textContent).toContain('Scheme B');
    expect(preview().querySelector('.lv-chip')!.textContent).toBe('Silver');
    (el.querySelector('#inc-where-Dashboard') as HTMLInputElement).click();
    await settle();
    typeIn('inc-cardHighlight', 'Up to Rs. 5,00,000/-');
    await settle();
    expect(preview().querySelector('.pv-title')!.textContent).toContain('Scheme B');
    expect(preview().querySelector('.pv-spot')!.textContent).toContain('Up to Rs. 5,00,000/-');

    button('Save Incentive').click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/schemes/incentive-master');
    expect(post.request.body).toEqual(expect.objectContaining({
      incentiveType: 'ASSAM', incentive: 'Scheme B', ministryOrDepartment: 'Industries', applicableForSilver: true,
      displayOn: 'Dashboard', cardHighlight: 'Up to Rs. 5,00,000/-',
    }));
    post.flush({ message: 'Incentive saved.', id: 77 });
    await settle();
    const doc = http.expectOne((r) => r.url === '/api/staff/schemes/incentive-master/77/documents/1');
    expect(doc.request.params.get('type')).toBe('ASSAM');
    doc.flush({ message: 'Document Uploaded Successfully.' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/staff/incentives', 'state'], { queryParams: { state: 'ASSAM' }, state: { message: 'Incentive saved. Documents attached.' } });
  });

  it('edits an incentive on its page, keeping its group and levels', async () => {
    await create(IncentiveFormPage, {}, { group: 'ministry', id: '41' });
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    http.expectOne((r) => r.params.get('type') === 'Common').flush([
      { incentive: { Id: 41, Incentive: 'Scheme A', Details: 'd', MinistryOrDepartment: 'm', ContactPerson: 'c', Email: 'a@b.in', MobileNo: '011',
        WebLink: 'https://x.in', ApplicableForGold: true, ActiveStatus: true }, hasDocument1: true, hasDocument2: false },
    ]);
    await settle();
    expect(el.querySelector('h3')!.textContent).toContain('Edit Incentive');
    expect((el.querySelector('#inc-incentive') as HTMLInputElement).value).toBe('Scheme A');
    expect((el.querySelector('#inc-group') as HTMLSelectElement).disabled).toBe(true);
    expect((el.querySelector('#inc-applicableForGold') as HTMLInputElement).checked).toBe(true);
    expect(el.querySelector('a[aria-label="Current document 1"]')!.getAttribute('href')).toBe('/api/staff/schemes/incentive-master/41/documents/1');
    expect(el.querySelector('.save-bar')!.classList).not.toContain('is-dirty');

    typeIn('inc-incentive', 'Scheme A2');
    (el.querySelector('#inc-active') as HTMLInputElement).click();
    await settle();
    expect(el.querySelector('.save-bar')!.classList).toContain('is-dirty');
    expect(el.querySelector('.inc-preview .pv-card')!.classList).toContain('is-off');
    button('Save Incentive').click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/schemes/incentive-master/41');
    expect(post.request.body).toEqual(expect.objectContaining({ incentiveType: 'Common', incentive: 'Scheme A2', activeStatus: false }));
    post.flush({ message: 'Incentive updated.' });
    await settle();
    expect(navigate).toHaveBeenCalledWith(['/staff/incentives', 'ministry'], { queryParams: null, state: { message: 'Incentive updated.' } });
  });
});
