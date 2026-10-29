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
  // The Upload of the add pop-up.
  const upload = (el: HTMLElement) => el.querySelector('[aria-labelledby="doc-add-title"] .modal-footer .btn-primary') as HTMLButtonElement;
  const openAdd = async (fixture: ComponentFixture<unknown>, el: HTMLElement) => {
    button(el, '+ Add document').click();
    await settle(fixture);
  };
  const tick = (el: HTMLElement, label: string) =>
    ([...el.querySelectorAll('label.doc-role')].find((l) => l.textContent!.trim() === label)!.querySelector('input') as HTMLInputElement).click();
  const type = (el: HTMLElement, selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
  };
  const names = (el: HTMLElement) => [...el.querySelectorAll('.doc-item strong')].map((s) => s.textContent);
  const pill = (el: HTMLElement, role: string) => el.querySelector(`.role-pill[data-role="${role}"]`) as HTMLButtonElement;

  it('uploads a file with its description and the roles ticked, and refuses other file types', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [doc(4, 'ZED Guidelines')], roles });
    await settle(fixture);
    expect([...el.querySelectorAll('.doc-item a')].map((a) => a.getAttribute('href'))).toEqual(['/api/staff/masters/documents/4/file']);
    expect(el.querySelector('.doc-chip')!.textContent).toBe('MSME Enterprises');
    expect(el.querySelector('.doc-item .doc-icon')!.textContent!.trim()).toBe('PDF');

    expect(el.querySelector('[role=dialog]')).toBeNull();
    await openAdd(fixture, el);
    const fileInput = el.querySelector('#fileControl') as HTMLInputElement;
    chooseFile(fileInput, new File(['MZ'], 'tool.exe', { type: 'application/octet-stream' }));
    await settle(fixture);
    expect(el.querySelector('[role=dialog] .alert-danger')!.textContent).toContain('valid document');

    type(el, '#documentName', 'Checklist');
    type(el, '#documentDescription', 'What to keep ready');
    chooseFile(fileInput, new File(['%PDF-1.4'], 'checklist.pdf', { type: 'application/pdf' }));
    await settle(fixture);
    expect(el.textContent).toContain('checklist.pdf');
    upload(el).click();
    await settle(fixture);
    expect(el.querySelector('[role=dialog] .alert-danger')!.textContent).toContain('at least one role');
    http.expectNone((r) => r.method === 'POST');

    tick(el, 'Assessors');
    tick(el, 'MSME Enterprises');
    await settle(fixture);
    expect(el.textContent).toContain('2 of 3 selected');
    expect([...el.querySelectorAll('label.doc-role.on')].map((l) => l.textContent!.trim())).toEqual(['MSME Enterprises', 'Assessors']);
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
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Document saved.');
    http.verify();
  });

  it('adds a video link instead of a file', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [], roles });
    await settle(fixture);
    expect(el.querySelector('.no-data')!.textContent).toContain('No documents published yet');
    await openAdd(fixture, el);
    ([...el.querySelectorAll('.kind-card')].find((b) => b.textContent!.includes('Video link')) as HTMLButtonElement).click();
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

  it('shows the counts and filters by file or video and by role', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({
      documents: [
        doc(4, 'Guidelines', { roles: ['msme', 'assessor'] }),
        doc(5, 'Tour', { videoUrl: 'https://www.youtube.com/watch?v=t', downloadUrl: null, fileName: null, roles: ['assessor'] }),
        doc(6, 'Sheet', { fileName: 'Document_2.xlsx', roles: [] }),
      ],
      roles,
    });
    await settle(fixture);
    // Documents, files, videos and the roles given at least one document.
    expect([...el.querySelectorAll('.stat-value')].map((v) => v.textContent!.trim())).toEqual(['3', '2', '1', '2/3']);
    expect([...el.querySelectorAll('.doc-icon')].map((i) => i.className.match(/tone-(\w+)/)![1])).toEqual(['pdf', 'video', 'sheet']);
    // A document from before roles were set goes to the MSMEs.
    expect(el.querySelectorAll('.doc-item')[2].textContent).toContain('MSMEs only (no roles set)');
    expect(pill(el, 'assessor').textContent!.replace(/\s+/g, ' ').trim()).toBe('Assessors 2');
    expect(pill(el, 'ministry').classList).toContain('none');

    button(el, 'Videos').click();
    await settle(fixture);
    expect(names(el)).toEqual(['Tour']);
    button(el, 'Files').click();
    await settle(fixture);
    expect(names(el)).toEqual(['Guidelines', 'Sheet']);
    pill(el, 'assessor').click();
    await settle(fixture);
    expect(names(el)).toEqual(['Guidelines']);
    expect(pill(el, 'assessor').getAttribute('aria-pressed')).toBe('true');
    pill(el, 'ministry').click();
    await settle(fixture);
    expect(names(el)).toEqual([]);
    expect(el.querySelector('.no-data')!.textContent).toContain('Nothing matches');
    (el.querySelector('.role-pill') as HTMLButtonElement).click();
    button(el, 'All').click();
    await settle(fixture);
    expect(names(el)).toEqual(['Guidelines', 'Tour', 'Sheet']);
    http.verify();
  });

  it('searches and filters by role, edits the roles and deletes after confirmation', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({
      documents: [doc(4, 'Old'), doc(5, 'Tour', { videoUrl: 'https://www.youtube.com/watch?v=t', downloadUrl: null, roles: ['assessor'], description: 'Site visit' })],
      roles,
    });
    await settle(fixture);
    pill(el, 'assessor').click();
    await settle(fixture);
    expect(names(el)).toEqual(['Tour']);
    expect(el.querySelector('.doc-item a')!.textContent!.trim()).toBe('Watch');
    (el.querySelector('.role-pill') as HTMLButtonElement).click();
    type(el, 'input[aria-label="Search documents"]', 'site');
    await settle(fixture);
    expect(names(el)).toEqual(['Tour']);

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

  it('shows a failed edit inside the pop-up', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush({ documents: [doc(4, 'Old')], roles });
    await settle(fixture);
    (el.querySelector('[aria-label="Edit Old"]') as HTMLButtonElement).click();
    await settle(fixture);
    const dialog = el.querySelector('[role=dialog]') as HTMLElement;
    expect(dialog.querySelector('#editVideo')).toBeNull();
    expect(dialog.querySelector('.file-note')!.textContent).toContain('Document_1.pdf');
    button(dialog, 'Save').click();
    await settle(fixture);
    http.expectOne((r) => r.method === 'PUT').flush({ title: 'Document name required.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('[role=dialog] .alert-danger')!.textContent).toContain('Document name required.');
    http.verify();
  });
});

describe('PageSettingsPage', () => {
  it('shows the current banner and only uploads PNG files', async () => {
    const { fixture, http, el } = await setup(PageSettingsPage);
    http.expectOne('/api/staff/masters/page-settings').flush({ hasBanner: true, fileName: 'Banner_1.png', updatedOn: '01-10-2026 09:30', imageUrl: '/api/staff/masters/page-settings/banner?v=1' });
    await settle(fixture);
    expect(el.querySelector('img')!.getAttribute('src')).toBe('/api/staff/masters/page-settings/banner?v=1');
    const meta = el.querySelector('.img-meta')!.textContent!.replace(/\s+/g, ' ');
    expect(meta).toContain('Home (login) page');
    expect(meta).toContain('Banner_1.png');
    expect(meta).toContain('01-10-2026 09:30');
    expect(el.querySelector('#ps-upload-h')!.textContent).toBe('Replace the banner');

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

  it('previews the chosen image beside the current one and Cancel drops it', async () => {
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });
    try {
      const { fixture, http, el } = await setup(PageSettingsPage);
      http.expectOne('/api/staff/masters/page-settings').flush({ hasBanner: false, fileName: null, updatedOn: null, imageUrl: null });
      await settle(fixture);
      expect(el.querySelector('.img-empty')!.textContent).toContain('No banner saved');
      expect(el.querySelector('#ps-upload-h')!.textContent).toBe('Add a banner');

      chooseFile(el.querySelector('#fileControl') as HTMLInputElement, new File(['png'], 'new.png', { type: 'image/png' }));
      await settle(fixture);
      expect(el.querySelector('img[alt="Selected banner (not saved yet)"]')!.getAttribute('src')).toBe('blob:preview');
      expect(el.querySelector('.picked-name')!.textContent).toContain('new.png');
      expect(el.textContent).toContain('Not saved yet');

      ([...el.querySelectorAll('button')].find((b) => b.textContent!.trim() === 'Cancel') as HTMLButtonElement).click();
      await settle(fixture);
      expect(el.querySelector('img')).toBeNull();
      (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle(fixture);
      expect(el.querySelector('.alert-danger')!.textContent).toContain('Please enter valid data.');
      http.verify();
    } finally {
      Object.assign(URL, { createObjectURL: original.create, revokeObjectURL: original.revoke });
    }
  });
});

/** Opens the add pop-up of the sectors / categories page. */
async function openCodeNameAdd(fixture: ComponentFixture<unknown>, el: HTMLElement) {
  ([...el.querySelectorAll('.page-head button')].find((b) => b.textContent!.includes('+ ADD')) as HTMLButtonElement).click();
  await settle(fixture);
}

describe('CodeNamesPage', () => {
  it('adds and renames categories', async () => {
    const { fixture, http, el } = await setup(CodeNamesPage, { snapshot: { data: { kind: 'categories' } } });
    http.expectOne('/api/staff/masters/categories').flush([{ id: 5, code: 'C1', name: 'Energy' }]);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Categories');
    expect(el.querySelector('.code-badge')!.textContent).toBe('C1');
    // No sector counts or type filter on categories.
    expect(el.querySelector('.stat')).toBeNull();
    expect(el.querySelector('.seg')).toBeNull();

    expect(el.querySelector('form.add-form')).toBeNull();
    await openCodeNameAdd(fixture, el);
    for (const [sel, v] of [['#code', 'C2'], ['#name', 'Water']]) {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    (el.querySelector('form.add-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const add = http.expectOne('/api/staff/masters/categories');
    expect(add.request.body).toEqual({ code: 'C2', name: 'Water' });
    add.flush({ message: 'Category saved.' });
    await settle(fixture);
    expect(el.querySelector('form.add-form')).toBeNull();
    http.expectOne('/api/staff/masters/categories').flush([{ id: 5, code: 'C1', name: 'Energy' }]);
    await settle(fixture);

    (el.querySelector('tbody button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('.modal .code-badge')!.textContent).toBe('C1');
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

  it('shows a failed add inside the pop-up', async () => {
    const { fixture, http, el } = await setup(CodeNamesPage, { snapshot: { data: { kind: 'categories' } } });
    http.expectOne('/api/staff/masters/categories').flush([]);
    await settle(fixture);
    expect(el.querySelector('.no-data')!.textContent).toContain('No categories yet');
    await openCodeNameAdd(fixture, el);
    for (const [sel, v] of [['#code', 'C1'], ['#name', 'Energy']]) {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    (el.querySelector('form.add-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    http.expectOne((r) => r.method === 'POST').flush({ title: 'Category Code already exists.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.modal [role=alert]')!.textContent).toContain('Category Code already exists.');
    http.verify();
  });
});

// Angular's radio [value] is not written to the element, so the radio is found by its choice card (name and a note).
const radio = (el: HTMLElement, name: string, label: string) =>
  [...el.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((i) => i.closest('label')!.querySelector('strong')!.textContent!.trim() === label)!;

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

    await openCodeNameAdd(fixture, el);
    for (const [sel, v] of [['#code', '63'], ['#name', 'Information services']]) {
      const i = el.querySelector(sel) as HTMLInputElement;
      i.value = v;
      i.dispatchEvent(new Event('input'));
    }
    await settle(fixture);
    (el.querySelector('form.add-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    http.expectNone('/api/staff/masters/sectors');
    expect(el.textContent).toContain('Please select Manufacturing or Services.');

    radio(el, 'activity', 'Services').click();
    await settle(fixture);
    expect(radio(el, 'activity', 'Services').closest('label')!.classList).toContain('active');
    (el.querySelector('form.add-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
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

  it('counts the sectors by type and filters by type', async () => {
    const { fixture, http, el } = await setup(CodeNamesPage, { snapshot: { data: { kind: 'sectors' } } });
    http.expectOne('/api/staff/masters/sectors').flush([
      { id: 1, code: '10', name: 'Manufacture of food products', activity: 'Manufacturing' },
      { id: 2, code: '13', name: 'Manufacture of textiles', activity: 'Manufacturing' },
      { id: 3, code: '62', name: 'Computer programming', activity: 'Services' },
      { id: 4, code: '22', name: 'Rubber products', activity: null },
    ]);
    await settle(fixture);
    // All, Manufacturing, Services, type not set.
    expect([...el.querySelectorAll('.stat-value')].map((v) => v.textContent!.trim())).toEqual(['4', '2', '1', '1']);
    expect(el.querySelector('.stat-warn .stat-label')!.textContent).toBe('Type not set');
    const codes = () => [...el.querySelectorAll('tbody .code-badge')].map((c) => c.textContent);
    const seg = (label: string) => [...el.querySelectorAll('.seg button')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement;
    expect([...el.querySelectorAll('.seg button')].map((b) => b.textContent!.trim())).toEqual(['All', 'Manufacturing', 'Services', 'Not set']);

    seg('Manufacturing').click();
    await settle(fixture);
    expect(codes()).toEqual(['10', '13']);
    seg('Not set').click();
    await settle(fixture);
    expect(codes()).toEqual(['22']);
    seg('Services').click();
    const search = el.querySelector('input[aria-label="Search sectors"]') as HTMLInputElement;
    search.value = 'food';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(codes()).toEqual([]);
    expect(el.querySelector('.no-data')!.textContent).toContain('No sector matches the search');
    seg('All').click();
    await settle(fixture);
    expect(codes()).toEqual(['10']);
    http.verify();
  });
});

describe('ParametersPage', () => {
  /** The level box (Administration → Certification Levels) and the NIC sectors of the picker. */
  function flushLevels(http: HttpTestingController) {
    http.expectOne('/api/staff/masters/parameter-levels').flush([
      { code: 'Bronze', name: 'Bronze', isEnabled: true }, { code: 'ZEDX', name: 'ZED-X', isEnabled: false },
    ]);
    http.expectOne('/api/staff/masters/sectors').flush([{ id: 1, code: '24', name: 'Basic metals' }, { id: 2, code: '62', name: 'IT services' }]);
  }

  it('limits a ZED-X parameter to NIC sectors and shows the sectors of each', async () => {
    const { fixture, http, el } = await setup(ParametersPage, { snapshot: { paramMap: convertToParamMap({ sectionType: 'ZEDX' }) } });
    http.expectOne('/api/config').flush({ legacyPortalUrl: '' });
    flushLevels(http);
    http.expectOne('/api/staff/masters/parameters/ZEDX').flush([
      { id: 7, sectionType: 'ZEDX', sectionCode: 'X1', sectionName: 'Digital', description: '', nicSectors: ['62'], inSurveillance: true },
      { id: 8, sectionType: 'ZEDX', sectionCode: 'X2', sectionName: 'Energy', description: '', nicSectors: [] },
    ]);
    await settle(fixture);
    expect(el.querySelector('h3')!.textContent).toContain('Parameters (ZED-X)');
    expect(el.querySelector('.level-tab.active')!.textContent).toContain('ZED-X');
    expect(el.querySelector('.level-tab.active .tab-note')!.textContent).toContain('Not open to MSMEs yet');
    // The level's counts: 2 parameters, 1 in surveillance, 1 limited to NIC sectors.
    expect([...el.querySelectorAll('.stat-value')].map((v) => v.textContent!.trim())).toEqual(['2', '1', '1']);
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' '));
    expect(rows[0]).toContain('62');
    expect(rows[1]).toContain('All sectors');
    expect(rows[0]).toContain('Yes');
    expect(rows[1]).toContain('No');

    // The filter beside the search box.
    ([...el.querySelectorAll('.seg button')].find((b) => b.textContent!.trim() === 'In surveillance') as HTMLButtonElement).click();
    await settle(fixture);
    expect([...el.querySelectorAll('tbody tr')].map((r) => r.querySelector('td')!.textContent!.trim())).toEqual(['X1']);
    ([...el.querySelectorAll('.seg button')].find((b) => b.textContent!.trim() === 'All') as HTMLButtonElement).click();
    await settle(fixture);

    // Add Parameter opens the pop-up.
    expect(el.querySelector('form.add-form')).toBeNull();
    ([...el.querySelectorAll('button')].find((b) => b.textContent!.includes('ADD PARAMETER')) as HTMLButtonElement).click();
    await settle(fixture);
    (el.querySelector('#sectionCode') as HTMLInputElement).value = 'X3';
    el.querySelector('#sectionCode')!.dispatchEvent(new Event('input'));
    (el.querySelector('#sectionName') as HTMLInputElement).value = 'Water';
    el.querySelector('#sectionName')!.dispatchEvent(new Event('input'));
    const box = [...el.querySelectorAll('.zed-multi label')].find((l) => l.textContent!.includes('24 - Basic metals'))!.querySelector('input') as HTMLInputElement;
    box.click();
    await settle(fixture);
    (el.querySelector('form.add-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/masters/parameters/ZEDX');
    // A new parameter is assessed in surveillance unless unticked.
    expect(post.request.body).toEqual({ sectionCode: 'X3', sectionName: 'Water', description: '', nicSectors: ['24'], inSurveillance: true });
    post.flush({ message: 'Parameter saved.' });
    await settle(fixture);
    expect(el.querySelector('form.add-form')).toBeNull();
    http.expectOne('/api/staff/masters/parameters/ZEDX').flush([
      { id: 8, sectionType: 'ZEDX', sectionCode: 'X2', sectionName: 'Energy', description: '', nicSectors: [], inSurveillance: true },
    ]);
    await settle(fixture);

    // Taken out of surveillance in the edit pop-up.
    [...el.querySelectorAll('tbody button')].find((b) => b.textContent!.trim() === 'Edit')!.dispatchEvent(new Event('click'));
    await settle(fixture);
    const tick = el.querySelector('#edit-inSurveillance') as HTMLInputElement;
    expect(tick.checked).toBe(true);
    tick.click();
    await settle(fixture);
    (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/masters/parameters/ZEDX/8');
    expect(put.request.body).toEqual(expect.objectContaining({ sectionName: 'Energy', inSurveillance: false }));
    put.flush({ message: 'Parameter data updated.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/parameters/ZEDX').flush([]);
    await settle(fixture);
    http.verify();
  });

  it('shows the description as text, not HTML', async () => {
    const { fixture, http, el } = await setup(ParametersPage, { snapshot: { paramMap: convertToParamMap({ sectionType: 'Bronze' }) } });
    http.expectOne('/api/config').flush({ legacyPortalUrl: 'https://old.example' });
    flushLevels(http);
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
    flushLevels(http);
    http.expectOne('/api/staff/masters/parameters/Bronze').flush(Array.from({ length: 23 }, (_, i) => (
      { id: i + 1, sectionType: 'Bronze', sectionCode: `P${i + 1}`, sectionName: i === 21 ? 'Waste management' : `Parameter ${i + 1}`, description: '' })));
    await settle(fixture);
    const codes = () => [...el.querySelectorAll('tbody tr td:first-child')].map((c) => c.textContent!.trim());
    expect(codes()).toEqual(['P1', 'P2', 'P3', 'P4', 'P5', 'P6', 'P7', 'P8', 'P9', 'P10']);
    expect(el.querySelector('.zed-pager')!.textContent).toContain('(23 records)');
    ([...el.querySelectorAll('.zed-pager button')].find((b) => b.textContent!.trim() === 'Last') as HTMLButtonElement).click();
    await settle(fixture);
    expect(codes()).toEqual(['P21', 'P22', 'P23']);
    const search = el.querySelector('input[aria-label="Search parameters"]') as HTMLInputElement;
    search.value = 'waste';
    search.dispatchEvent(new Event('input'));
    await settle(fixture);
    expect(codes()).toEqual(['P22']);
    http.verify();
  });
});
