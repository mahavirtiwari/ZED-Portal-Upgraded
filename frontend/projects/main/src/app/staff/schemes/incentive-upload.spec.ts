import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { INCENTIVE_APPLY_API, INCENTIVE_CHECK_API, INCENTIVE_TEMPLATE_API, IncentiveCheck, IncentiveUploadPage } from './incentive-upload';
import { TableExport } from '../table-export';

describe('IncentiveUploadPage (2026-11-17: check, then save the valid rows)', () => {
  let fixture: ComponentFixture<IncentiveUploadPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const text = (e: Element) => e.textContent!.replace(/\s+/g, ' ').trim();
  const button = (label: string) => [...el.querySelectorAll('button')].find((b) => text(b) === label) as HTMLButtonElement | undefined;

  function choose(file: File) {
    const input = el.querySelector('#incFile') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [file], configurable: true });
    input.dispatchEvent(new Event('change'));
  }

  const check: IncentiveCheck = {
    fileName: 'incentives-nov.xlsx', total: 4, valid: 2, alreadyUploaded: 1, invalid: 1, errorCount: 1,
    errors: [{ row: 3, column: 'DisbursedDate', message: 'Invalid date (dd-mm-yyyy).', value: '31-02-2026' }],
    rejected: [{ row: 3, cells: ['UDYAM-UP-29-0003915', null, '208001'], problems: 'DisbursedDate: Invalid date (dd-mm-yyyy).' }],
    skipped: [{ row: 2, udyamNo: 'UDYAM-UP-29-0000001', uploadedOn: '2026-01-06T10:00:00' }],
    columns: ['UdyamNo', 'Certificateno', 'Pin'],
  };

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [IncentiveUploadPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(IncentiveUploadPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => http.verify());

  it('shows the drop zone, the three steps and the required columns as chips', () => {
    expect([...el.querySelectorAll('.st-label')].map(text)).toEqual(['Choose the workbook', 'Check every row', 'Save']);
    expect(el.querySelectorAll('.iu-cols span').length).toBe(15);
    expect(button('Upload and check')!.disabled).toBe(true);
    expect(el.textContent).not.toContain('Recent uploads');
  });

  it('downloads the template with HttpClient as a blob, not by a link to the API (UI audit B5)', async () => {
    expect(el.querySelector('a[href*="/api/"]')).toBeNull();
    const createUrl = vi.fn(() => 'blob:template');
    const revoke = vi.fn();
    const was = { createObjectURL: URL.createObjectURL, revokeObjectURL: URL.revokeObjectURL };
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: revoke });
    const clicks = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    button('Download template')!.click();
    await settle();
    const req = http.expectOne(INCENTIVE_TEMPLATE_API);
    expect(req.request.responseType).toBe('blob');
    req.flush(new Blob(['PK'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
    await settle();
    expect(createUrl).toHaveBeenCalled();
    expect(clicks).toHaveBeenCalled();
    clicks.mockRestore();
    Object.assign(URL, was);
  });

  it('shows the error of a failed template download', async () => {
    button('Download template')!.click();
    await settle();
    http.expectOne(INCENTIVE_TEMPLATE_API).flush(new Blob([JSON.stringify({ title: 'The service is unavailable.' })]), { status: 503, statusText: 'Service Unavailable' });
    await settle();
    await new Promise((r) => setTimeout(r, 10));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('The service is unavailable.');
  });

  it('refuses a file that is not .xlsx before sending it', async () => {
    choose(new File(['x'], 'old.xls'));
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('.xlsx');
    expect(button('Upload and check')!.disabled).toBe(true);
  });

  it('checks the file, lists the errors by row, offers the rejected rows and saves only the valid ones', async () => {
    choose(new File(['PK'], 'incentives-nov.xlsx'));
    await settle();
    button('Upload and check')!.click();
    await settle();
    const req = http.expectOne(INCENTIVE_CHECK_API);
    expect((req.request.body as FormData).get('file')).toBeTruthy();
    req.flush(check);
    await settle();

    const pop = el.querySelector('.modal')!;
    expect([...pop.querySelectorAll('.iu-tiles > div')].map(text)).toEqual(['4 Rows read', '2 Ready to save', '1 Rows with errors']);
    expect([...pop.querySelectorAll('tbody tr td')].map(text)).toEqual(['3', 'DisbursedDate', '31-02-2026', 'Invalid date (dd-mm-yyyy).']);
    expect(pop.querySelector('#alreadyUploaded')!.textContent).toContain('1 row(s) were uploaded before');
    expect(el.querySelector('.st-now .st-label')!.textContent).toContain('Check every row');

    const csv = vi.spyOn(TestBed.inject(TableExport), 'xlsx').mockResolvedValue(undefined);
    button('Download the 1 rows (.xlsx)')!.click();
    const [name, [sheet]] = csv.mock.calls[0];
    expect(name).toBe('incentives-nov-rows-with-errors');
    expect(sheet.columns).toEqual(['Row', 'UdyamNo', 'Certificateno', 'Pin', 'Problems']);
    expect(sheet.rows[0]).toEqual([3, 'UDYAM-UP-29-0003915', null, '208001', 'DisbursedDate: Invalid date (dd-mm-yyyy).']);

    button('Save 2 rows')!.click();
    await settle();
    const apply = http.expectOne(INCENTIVE_APPLY_API);
    expect((apply.request.body as FormData).get('file')).toBeTruthy();
    apply.flush({
      message: '1 row(s) saved. 1 row(s) with errors were not saved. 1 row(s) were uploaded before and were skipped.', inserted: 1, rejected: 1,
      rows: [{ UdyamNo: 'UDYAM-MH-23-0006117', DisbursedDate: '20260105', ApplicationId: '20260105' }],
      skipped: [{ row: 2, udyamNo: 'UDYAM-UP-29-0000001', uploadedOn: '2026-01-06T10:00:00' }],
    });
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
    expect(el.querySelector('#savedResult .alert-success')!.textContent).toContain('1 row(s) saved.');
    const cells = [...el.querySelectorAll('.uploaded tbody td')].map((td) => td.textContent!.trim());
    expect(cells).toContain('05-01-2026');
    expect(cells).toContain('20260105'); // ApplicationId is not a date
    expect(el.querySelector('#skippedRows')!.textContent).toContain('06 Jan 2026');
    expect(el.querySelectorAll('.st-done').length).toBe(3);

    button('Upload another file')!.click();
    await settle();
    expect(el.querySelector('#incFile')).toBeTruthy();
  });

  it('shows the refusal of an unreadable file and an apply error in the pop-up', async () => {
    choose(new File(['PK'], 'incentives.xlsx'));
    await settle();
    button('Upload and check')!.click();
    await settle();
    http.expectOne(INCENTIVE_CHECK_API).flush({ title: 'Please upload valid excel (columns: …). Missing: ApprovedDate.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Missing: ApprovedDate');
    expect(el.querySelector('.modal')).toBeNull();

    button('Upload and check')!.click();
    await settle();
    http.expectOne(INCENTIVE_CHECK_API).flush({ ...check, valid: 1 });
    await settle();
    button('Save 1 row')!.click();
    await settle();
    http.expectOne(INCENTIVE_APPLY_API).flush({ title: 'No row can be saved: every row has errors.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('every row has errors');

    button('Cancel upload')!.click();
    await settle();
    expect(el.querySelector('.modal')).toBeNull();
  });

  it('cannot save when no row is valid', async () => {
    choose(new File(['PK'], 'incentives.xlsx'));
    await settle();
    button('Upload and check')!.click();
    await settle();
    http.expectOne(INCENTIVE_CHECK_API).flush({ ...check, valid: 0, alreadyUploaded: 0 });
    await settle();
    expect(button('Save 0 rows')!.disabled).toBe(true);
  });
});
