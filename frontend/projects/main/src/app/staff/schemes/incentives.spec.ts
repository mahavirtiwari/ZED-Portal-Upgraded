import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
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

  async function create<T>(component: Type<T>, query: Record<string, string> = {}) {
    await TestBed.configureTestingModule({
      imports: [component],
      providers: [
        provideRouter([]), provideHttpClient(), provideHttpClientTesting(),
        { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap(query), paramMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap(query)), paramMap: of(convertToParamMap({})) } },
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

  it('adds incentives of the chosen type and uploads PDF documents', async () => {
    await create(IncentiveMasterPage, { type: 'Financial' });
    http.expectOne((r) => r.url === '/api/staff/schemes/incentive-master' && r.params.get('type') === 'Financial').flush([
      { incentive: { Id: 41, Incentive: 'Scheme A', WebLink: 'javascript:alert(1)', ApplicableForBronze: true }, hasDocument1: true, hasDocument2: false },
    ]);
    await settle();
    expect(el.textContent).toContain('Incentives (Financial Institution)');
    // Non-http links are not rendered as links.
    expect(el.querySelector('tbody a[target="_blank"][href^="javascript"]')).toBeNull();
    expect(el.querySelector('a[aria-label="Document 1"]')!.getAttribute('href')).toBe('/api/staff/schemes/incentive-master/41/documents/1');

    button('SAVE').click();
    await settle();
    http.expectNone('/api/staff/schemes/incentive-master');
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Incentive required.');

    const values: Record<string, string> = {
      incentive: 'Scheme B', details: 'd', ministryOrDepartment: 'm', contactPerson: 'c', email: 'a@b.in', mobileNo: '011', webLink: 'https://x.in',
    };
    for (const [k, v] of Object.entries(values)) {
      const input = el.querySelector(`#inc-${k}`) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    }
    await settle();
    button('SAVE').click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/schemes/incentive-master');
    expect(post.request.body).toEqual(expect.objectContaining({ incentiveType: 'Financial', incentive: 'Scheme B', webLink: 'https://x.in' }));
    post.flush({ message: 'Incentive saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush([]);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Incentive saved.');
  });

  it('edits an incentive in the Edit Incentive pop-up, as the live page', async () => {
    await create(IncentiveMasterPage, { type: 'Common' });
    http.expectOne((r) => r.params.get('type') === 'Common').flush([
      { incentive: { Id: 41, Incentive: 'Scheme A', Details: 'd', MinistryOrDepartment: 'm', ContactPerson: 'c', Email: 'a@b.in', MobileNo: '011',
        WebLink: 'https://x.in', ActiveStatus: true }, hasDocument1: false, hasDocument2: false },
    ]);
    await settle();
    // No type select: the menu's Incentives drop-down chooses the type.
    expect(el.querySelector('select[aria-label="Incentive type"]')).toBeNull();
    expect(el.querySelector('.modal')).toBeNull();

    button('Edit').click();
    await settle();
    expect(el.querySelector('#edit-incentive-title')!.textContent).toBe('Edit Incentive');
    expect((el.querySelector('#edit-incentive') as HTMLInputElement).value).toBe('Scheme A');
    // The add form above stays empty.
    expect((el.querySelector('#inc-incentive') as HTMLInputElement).value).toBe('');

    const input = el.querySelector('#edit-incentive') as HTMLInputElement;
    input.value = 'Scheme A2';
    input.dispatchEvent(new Event('input'));
    await settle();
    button('UPDATE').click();
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/schemes/incentive-master/41');
    expect(post.request.body).toEqual(expect.objectContaining({ incentiveType: 'Common', incentive: 'Scheme A2', activeStatus: true }));
    post.flush({ message: 'Incentive updated.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush([]);
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Incentive updated.');
  });

  it('refuses non-PDF documents before uploading', async () => {
    await create(IncentiveMasterPage);
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
});
