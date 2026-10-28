import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, ParamMap, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { CodeNamesPage } from './code-names';
import { DocumentsAdminPage } from './documents';
import { PageSettingsPage } from './page-settings';
import { ParametersPage } from './parameters';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

function chooseFile(input: HTMLInputElement, file: File) {
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

/** The route with paramMap / queryParamMap streams of its snapshot (pages that follow route changes subscribe to them). */
function withStreams(route: object): object {
  const snap = (route as { snapshot?: { paramMap?: ParamMap; queryParamMap?: ParamMap } }).snapshot ?? {};
  return { ...route, paramMap: of(snap.paramMap ?? convertToParamMap({})), queryParamMap: of(snap.queryParamMap ?? convertToParamMap({})) };
}

async function setup<T>(component: Type<T>, route: object = { snapshot: { data: {}, paramMap: convertToParamMap({}) } }) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: withStreams(route) }],
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  const http = TestBed.inject(HttpTestingController);
  await settle(fixture);
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

describe('DocumentsAdminPage', () => {
  const roles = [{ key: 'msme', label: 'MSME Enterprises' }, { key: 'assessor', label: 'Assessors' }, { key: 'ministry', label: 'Ministry of MSME' }];
  const doc = (id: number, name: string, more: Record<string, unknown> = {}) => ({
    id, documentName: name, fileName: 'Document_1.pdf', downloadUrl: `/api/staff/masters/documents/${id}/file`, description: null, videoUrl: null,
    roles: ['msme'], createdDate: '2026-10-01T10:00:00', ...more,
  });
  const button = (el: HTMLElement, text: string) => [...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;
  // The form's Upload (the one in the page head moves to the form).
  const upload = (el: HTMLElement) => el.querySelector('section[aria-labelledby="doc-upload-h"] .form-actions button') as HTMLButtonElement;
  const tick = (el: HTMLElement, label: string) =>
    ([...el.querySelectorAll('label.doc-role')].find((l) => l.textContent!.trim() === label)!.querySelector('input') as HTMLInputElement).click();
  const type = (el: HTMLElement, selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };

  it('uploads a file with its description and the roles ticked, and refuses other file types', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [doc(4, 'ZED Guidelines')], roles });
    await settle(fixture);
    expect([...el.querySelectorAll('.doc-item a')].map((a) => a.getAttribute('href'))).toEqual(['/api/staff/masters/documents/4/file']);
    expect(el.querySelector('.doc-chip')!.textContent).toBe('MSME Enterprises');

    const fileInput = el.querySelector('#fileControl') as HTMLInputElement;
    chooseFile(fileInput, new File(['MZ'], 'tool.exe', { type: 'application/octet-stream' }));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('valid document');

    type(el, '#documentName', 'Checklist');
    type(el, '#documentDescription', 'What to keep ready');
    chooseFile(fileInput, new File(['%PDF-1.4'], 'checklist.pdf', { type: 'application/pdf' }));
    await settle(fixture);
    expect(el.textContent).toContain('checklist.pdf');
    upload(el).click();
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('at least one role');
    http.expectNone((r) => r.method === 'POST');

    tick(el, 'Assessors');
    tick(el, 'MSME Enterprises');
    await settle(fixture);
    expect(el.textContent).toContain('2 of 3 selected');
    upload(el).click();
    await settle(fixture);
    const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/masters/documents');
    const body = req.request.body as FormData;
    expect(body.get('documentName')).toBe('Checklist');
    expect(body.get('description')).toBe('What to keep ready');
    // In the page's order of the roles.
    expect(body.get('roles')).toBe('msme,assessor');
    expect((body.get('file') as File).name).toBe('checklist.pdf');
    expect(body.get('videoUrl')).toBeNull();
    req.flush({ message: 'Document saved.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [], roles });
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Document saved.');
    http.verify();
  });

  it('adds a video link instead of a file', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [], roles });
    await settle(fixture);
    button(el, 'Video link').click();
    await settle(fixture);
    expect(el.querySelector('#fileControl')).toBeNull();
    type(el, '#documentName', 'How to apply');
    type(el, '#videoUrl', 'https://www.youtube.com/watch?v=abc');
    tick(el, 'Select all');
    await settle(fixture);
    expect(el.textContent).toContain('3 of 3 selected');
    upload(el).click();
    await settle(fixture);
    const body = http.expectOne((r) => r.method === 'POST').request.body as FormData;
    expect(body.get('videoUrl')).toBe('https://www.youtube.com/watch?v=abc');
    expect(body.get('file')).toBeNull();
    expect(body.get('roles')).toBe('msme,assessor,ministry');
  });

  it('searches and filters by role, edits the roles and deletes after confirmation', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({
      documents: [doc(4, 'Old'), doc(5, 'Tour', { videoUrl: 'https://www.youtube.com/watch?v=t', downloadUrl: null, roles: ['assessor'], description: 'Site visit' })],
      roles,
    });
    await settle(fixture);
    const names = () => [...el.querySelectorAll('.doc-item strong')].map((s) => s.textContent);
    const roleSelect = el.querySelector('select[aria-label="Role"]') as HTMLSelectElement;
    roleSelect.value = 'assessor';
    roleSelect.dispatchEvent(new Event('change'));
    await settle(fixture);
    expect(names()).toEqual(['Tour']);
    expect(el.querySelector('.doc-item a')!.textContent!.trim()).toBe('Watch');
    roleSelect.value = '';
    roleSelect.dispatchEvent(new Event('change'));
    type(el, 'input[aria-label="Search documents"]', 'site');
    await settle(fixture);
    expect(names()).toEqual(['Tour']);

    (el.querySelector('[aria-label="Edit Tour"]') as HTMLButtonElement).click();
    await settle(fixture);
    const dialog = el.querySelector('[role=dialog]') as HTMLElement;
    expect((dialog.querySelector('#editVideo') as HTMLInputElement).value).toBe('https://www.youtube.com/watch?v=t');
    tick(dialog, 'MSME Enterprises');
    button(dialog, 'Save').click();
    await settle(fixture);
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/masters/documents/5');
    expect(put.request.body).toEqual({ documentName: 'Tour', description: 'Site visit', videoUrl: 'https://www.youtube.com/watch?v=t', roles: ['msme', 'assessor'] });
    put.flush({ message: 'Document updated.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [doc(4, 'Old')], roles });
    await settle(fixture);

    vi.spyOn(window, 'confirm').mockReturnValue(true);
    type(el, 'input[aria-label="Search documents"]', '');
    await settle(fixture);
    (el.querySelector('[aria-label="Delete Old"]') as HTMLButtonElement).click();
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/documents/4');
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Document deleted.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [], roles });
    http.verify();
    vi.restoreAllMocks();
  });
});

describe('PageSettingsPage', () => {
  it('shows the current banner and only uploads PNG files', async () => {
    const { fixture, http, el } = await setup(PageSettingsPage);
    http.expectOne('/api/staff/masters/page-settings').flush({ hasBanner: true, fileName: 'Banner_1.png', updatedOn: '01-10-2026 09:30', imageUrl: '/api/staff/masters/page-settings/banner?v=1' });
    await settle(fixture);
    expect(el.querySelector('img')!.getAttribute('src')).toBe('/api/staff/masters/page-settings/banner?v=1');

    const input = el.querySelector('#fileControl') as HTMLInputElement;
    chooseFile(input, new File(['x'], 'banner.jpg', { type: 'image/jpeg' }));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please upload valid document.');

    chooseFile(input, new File(['png'], 'banner.png', { type: 'image/png' }));
    await settle(fixture);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/page-settings/banner');
    expect(((req.request.body as FormData).get('file') as File).name).toBe('banner.png');
    req.flush({ message: 'Document saved.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/page-settings').flush({ hasBanner: true, fileName: 'Banner_2.png', updatedOn: null, imageUrl: '/api/staff/masters/page-settings/banner?v=2' });
    http.verify();
  });
});

describe('CodeNamesPage', () => {
  it('adds and renames categories', async () => {
    const { fixture, http, el } = await setup(CodeNamesPage, { snapshot: { data: { kind: 'categories' } } });
    http.expectOne('/api/staff/masters/categories').flush([{ id: 5, code: 'C1', name: 'Energy' }]);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Categories');

    for (const [sel, v] of [['#code', 'C2'], ['#name', 'Water']]) {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const add = http.expectOne('/api/staff/masters/categories');
    expect(add.request.body).toEqual({ code: 'C2', name: 'Water' });
    add.flush({ message: 'Category saved.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/categories').flush([{ id: 5, code: 'C1', name: 'Energy' }]);
    await settle(fixture);

    (el.querySelector('tbody button') as HTMLButtonElement).click();
    await settle(fixture);
    const edit = el.querySelector('#edit-name') as HTMLInputElement;
    edit.value = 'Energy efficiency';
    edit.dispatchEvent(new Event('input'));
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const put = http.expectOne('/api/staff/masters/categories/5');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ name: 'Energy efficiency' });
    put.flush({ title: 'Category Name required (up to 200 characters).' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('Category Name required');
    http.verify();
  });
});

// Angular's radio [value] is not written to the element, so the radio is found by its label.
const radio = (el: HTMLElement, name: string, label: string) =>
  [...el.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((i) => i.closest('label')!.textContent!.trim() === label)!;

describe('CodeNamesPage (sectors)', () => {
  it('requires Manufacturing or Services and saves it with the sector', async () => {
    const { fixture, http, el } = await setup(CodeNamesPage, { snapshot: { data: { kind: 'sectors' } } });
    http.expectOne('/api/staff/masters/sectors').flush([
      { id: 1, code: '10', name: 'Manufacture of food products', activity: 'Manufacturing' },
      { id: 2, code: '62', name: 'Computer programming', activity: null },
    ]);
    await settle(fixture);
    const cells = [...el.querySelectorAll('tbody tr')].map((r) => r.children[2].textContent!.trim());
    expect(cells).toEqual(['Manufacturing', 'Not set']);

    for (const [sel, v] of [['#code', '63'], ['#name', 'Information services']]) {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    http.expectNone('/api/staff/masters/sectors');
    expect(el.textContent).toContain('Please select Manufacturing or Services.');

    radio(el, 'activity', 'Services').click();
    await settle(fixture);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const add = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/masters/sectors');
    expect(add.request.body).toEqual({ code: '63', name: 'Information services', activity: 'Services' });
    add.flush({ message: 'Sector saved.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/sectors').flush([{ id: 2, code: '62', name: 'Computer programming', activity: null }]);
    await settle(fixture);

    (el.querySelector('tbody button') as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    expect(el.querySelector('.modal .help-block')!.textContent).toContain('Please select Manufacturing or Services.');
    radio(el, 'editActivity', 'Services').click();
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const put = http.expectOne('/api/staff/masters/sectors/2');
    expect(put.request.body).toEqual({ name: 'Computer programming', activity: 'Services' });
    put.flush({ message: 'Sector data updated.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/sectors').flush([]);
    http.verify();
  });
});

describe('ParametersPage', () => {
  it('shows the description as text, not HTML', async () => {
    const { fixture, http, el } = await setup(ParametersPage, { snapshot: { paramMap: convertToParamMap({ sectionType: 'Bronze' }) } });
    http.expectOne('/api/config').flush({ legacyPortalUrl: 'https://old.example' });
    http.expectOne('/api/staff/masters/parameters/Bronze').flush([
      { id: 3, sectionType: 'Bronze', sectionCode: 'P1', sectionName: 'Leadership', description: '<img src=x onerror=alert(1)>' },
    ]);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Parameters (Bronze)');
    expect(el.querySelector('pre')!.textContent).toBe('<img src=x onerror=alert(1)>');
    expect(el.querySelector('pre img')).toBeNull();
    expect(el.querySelector('a.btn')!.getAttribute('href')).toBe('/staff/questionnaire/Bronze/P1');
    http.verify();
  });

  it('pages the parameters ten at a time and searches them', async () => {
    const { fixture, http, el } = await setup(ParametersPage, { snapshot: { paramMap: convertToParamMap({ sectionType: 'Bronze' }) } });
    http.expectOne('/api/config').flush({ legacyPortalUrl: '' });
    http.expectOne('/api/staff/masters/parameters/Bronze').flush(Array.from({ length: 23 }, (_, i) => (
      { id: i + 1, sectionType: 'Bronze', sectionCode: `P${i + 1}`, sectionName: i === 21 ? 'Waste management' : `Parameter ${i + 1}`, description: '' })));
    await settle(fixture);
    const codes = () => [...el.querySelectorAll('tbody tr td:first-child')].map((c) => c.textContent!.trim());
    expect(codes()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']);
    expect(el.querySelector('.zed-pager')!.textContent).toContain('(23 records)');
    ([...el.querySelectorAll('.zed-pager button')].find((b) => b.textContent!.trim() === 'Last') as HTMLButtonElement).click();
    await settle(fixture);
    expect(codes()).toEqual(['P21', 'P22', 'P23']);
    const search = el.querySelector('input[type=search]') as HTMLInputElement;
    search.value = 'waste';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(codes()).toEqual(['P22']);
    http.verify();
  });
});
