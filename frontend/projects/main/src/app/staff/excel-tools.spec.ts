import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ExcelToolsComponent, SheetApplied, SheetCheck } from './excel-tools';

async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

@Component({
  imports: [ExcelToolsComponent],
  template: `<div class="page-actions"><zed-excel-tools api="/api/staff/masters/sectors" title="Sectors" fileName="sectors" (applied)="applied.set($event)" /></div>`,
})
class Host {
  readonly applied = signal<SheetApplied | null>(null);
}

const button = (el: HTMLElement, text: string) =>
  [...el.querySelectorAll('button')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim().includes(text)) as HTMLButtonElement;

const check: SheetCheck = {
  columns: ['Code', 'Name', 'Type'],
  matchRule: 'Rows are matched by Code: a new code is added, an existing one is updated. Nothing is deleted.',
  new: 1, changed: 1, unchanged: 0, errors: 1,
  rows: [
    { row: 2, values: ['26', 'Electronics', 'Manufacturing'], result: 'new', changed: [], was: null, errors: [], notes: [] },
    { row: 3, values: ['24', 'Basic metals', 'Services'], result: 'changed', changed: ['Type'], was: ['24', 'Basic metals', 'Manufacturing'], errors: [], notes: [] },
    { row: 4, values: ['27', '', 'Trading'], result: 'error', changed: [], was: null, errors: ['Name required (up to 200 characters).', 'Type must be Manufacturing or Services.'], notes: [] },
  ],
};

function choose(el: HTMLElement, file: File) {
  const input = el.querySelector('input[type=file]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  input.dispatchEvent(new Event('change'));
}

describe('ExcelToolsComponent', () => {
  let fixture: ComponentFixture<Host>;
  let el: HTMLElement;
  let http: HttpTestingController;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [Host], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(Host);
    el = fixture.nativeElement;
    http = TestBed.inject(HttpTestingController);
    await settle(fixture);
  });

  it('exports the whole master as an Excel file', async () => {
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:x');
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    button(el, 'Export Excel').click();
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/sectors/excel');
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['x']));
    await settle(fixture);
    expect(create).toHaveBeenCalled();
    expect(click).toHaveBeenCalled();
    http.verify();
    vi.restoreAllMocks();
  });

  it('checks the chosen file, shows each row with its result, and applies the valid rows', async () => {
    button(el, 'Upload Excel').click();
    await settle(fixture);
    expect(el.querySelector('#xl-title')!.textContent).toContain('Upload Sectors from Excel');
    expect(el.querySelector('.xl-steps li.on')!.textContent).toContain('Choose file');

    choose(el, new File(['x'], 'sectors.csv'));
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('.xlsx');
    http.expectNone('/api/staff/masters/sectors/excel/check');

    choose(el, new File(['x'], 'sectors.xlsx'));
    await settle(fixture);
    const req = http.expectOne('/api/staff/masters/sectors/excel/check');
    expect((req.request.body as FormData).get('file')).toBeTruthy();
    req.flush(check);
    await settle(fixture);
    expect([...el.querySelectorAll('.xl-tile')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['1 New', '1 Changed', '0 No change', '1 With errors']);
    expect(el.querySelector('tbody tr:nth-child(2) .xl-was')!.textContent).toBe('Manufacturing');
    expect(el.querySelector('tbody tr.is-error .t-err')!.textContent).toContain('Type must be Manufacturing or Services.');

    // A tile filters the rows.
    button(el, 'With errors').click();
    await settle(fixture);
    expect(el.querySelectorAll('tbody tr').length).toBe(1);

    button(el, 'APPLY 2 ROWS').click();
    await settle(fixture);
    const result: SheetApplied = { message: '1 added, 1 updated; 1 row(s) with errors skipped.', added: 1, updated: 1, failed: 1, rows: check.rows };
    http.expectOne('/api/staff/masters/sectors/excel/apply').flush(result);
    await settle(fixture);
    expect(el.querySelector('.alert-success')!.textContent).toContain('1 added, 1 updated');
    expect(fixture.componentInstance.applied()).toEqual(result);
    expect(button(el, 'APPLY')).toBeUndefined();
    button(el, 'CLOSE').click();
    await settle(fixture);
    expect(el.querySelector('.modal')).toBeNull();
    http.verify();
  });

  it('shows the reason when the server refuses the file', async () => {
    button(el, 'Upload Excel').click();
    await settle(fixture);
    choose(el, new File(['x'], 'sectors.xlsx'));
    await settle(fixture);
    http.expectOne('/api/staff/masters/sectors/excel/check').flush(
      { title: 'The first row must have the template’s column headers; missing: Type.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('missing: Type');
    expect(el.querySelector('.xl-tile')).toBeNull();
  });
});
