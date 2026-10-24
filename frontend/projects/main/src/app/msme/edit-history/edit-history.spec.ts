import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EditHistoryPage, submittedValues } from './edit-history';

describe('EditHistoryPage', () => {
  let fixture: ComponentFixture<EditHistoryPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const row = (id: number, extra: object = {}) => ({
    id, at: '2026-10-24T05:00:00Z', channel: 'Web', action: 'Financial assistance: document uploaded', result: 'Success', message: null,
    data: '{"req":{"Type":"Invoice Copy"},"file":{"file":"invoice.pdf","bytes":42}}', ipAddress: '203.0.113.9', deviceId: 'abc', ...extra,
  });

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [EditHistoryPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(EditHistoryPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the applicant changes, shows what was submitted and pages on the server', async () => {
    const req = http.expectOne((r) => r.url === '/api/msme/edit-history');
    expect(req.request.params.get('pageNo')).toBe('1');
    req.flush({ total: 25, pageNo: 1, pageSize: 10, rows: [row(9), row(8, { channel: 'Mobile', action: 'App: photos submitted', result: 'Failed', message: 'Please try again.' })] });
    await settle();
    const text = el.querySelector('tbody')!.textContent!;
    expect(text).toContain('Financial assistance: document uploaded');
    expect(text).toContain('MSME app');
    expect(text).toContain('Not saved');
    expect(text).toContain('Please try again.');
    // The applicant does not see the IP address column note.
    expect(text).not.toContain('203.0.113.9');

    (el.querySelector('tbody button') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.values')!.textContent).toContain('Type: Invoice Copy');
    expect(el.querySelector('.values')!.textContent).toContain('File: invoice.pdf (1 KB)');

    const next = Array.from(el.querySelectorAll('button')).find((b) => b.textContent!.trim() === 'Next')!;
    next.click();
    await settle();
    http.expectOne((r) => r.url === '/api/msme/edit-history' && r.params.get('pageNo') === '2').flush({ total: 25, pageNo: 2, pageSize: 10, rows: [] });
    await settle();
  });

  it('flattens the submitted values', () => {
    http.expectOne((r) => r.url === '/api/msme/edit-history').flush({ total: 0, pageNo: 1, pageSize: 10, rows: [] });
    expect(submittedValues('{"req":{"Gstin":"09AA","Account":{"Ifsc":"SBIN0"},"Password":"***"},"ct":null}')).toEqual([
      'Gstin: 09AA', 'Account.Ifsc: SBIN0', 'Password: ***',
    ]);
    expect(submittedValues(null)).toEqual([]);
    expect(submittedValues('not json')).toEqual(['not json']);
  });
});
