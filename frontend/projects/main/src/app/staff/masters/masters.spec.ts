import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
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

async function setup<T>(component: Type<T>, route: object = { snapshot: { data: {}, paramMap: convertToParamMap({}) } }) {
  await TestBed.configureTestingModule({
    imports: [component],
    providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([]), { provide: ActivatedRoute, useValue: route }],
  }).compileComponents();
  const fixture = TestBed.createComponent(component);
  const http = TestBed.inject(HttpTestingController);
  await settle(fixture);
  return { fixture, http, el: fixture.nativeElement as HTMLElement };
}

describe('DocumentsAdminPage', () => {
  it('uploads a document with its name in one request and refuses other file types', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush([{ id: 4, documentName: 'ZED Guidelines', fileName: 'Document_1.pdf', downloadUrl: '/api/staff/masters/documents/4/file' }]);
    await settle(fixture);
    expect(el.querySelector('tbody a')!.getAttribute('href')).toBe('/api/staff/masters/documents/4/file');

    const fileInput = el.querySelector('#fileControl') as HTMLInputElement;
    chooseFile(fileInput, new File(['MZ'], 'tool.exe', { type: 'application/octet-stream' }));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Please upload valid document.');

    const name = el.querySelector('#documentName') as HTMLInputElement;
    name.value = 'Checklist';
    name.dispatchEvent(new Event('input'));
    chooseFile(fileInput, new File(['%PDF-1.4'], 'checklist.pdf', { type: 'application/pdf' }));
    await settle(fixture);
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);

    const req = http.expectOne('/api/staff/masters/documents');
    expect(req.request.method).toBe('POST');
    const body = req.request.body as FormData;
    expect(body.get('documentName')).toBe('Checklist');
    expect((body.get('file') as File).name).toBe('checklist.pdf');
    req.flush({ message: 'Document saved.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/documents').flush([]);
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('Document saved.');
    http.verify();
  });

  it('deletes after confirmation', async () => {
    const { fixture, http, el } = await setup(DocumentsAdminPage);
    http.expectOne('/api/staff/masters/documents').flush([{ id: 4, documentName: 'Old', fileName: null, downloadUrl: null }]);
    await settle(fixture);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    (el.querySelector('tbody button') as HTMLButtonElement).click();
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/documents/4');
    expect(req.request.method).toBe('DELETE');
    req.flush({ message: 'Document deleted.' });
    await settle(fixture);
    http.expectOne('/api/staff/masters/documents').flush([]);
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
});
