import { provideRouter } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReportsPage } from './reports';

describe('ReportsPage', () => {
  let fixture: ComponentFixture<ReportsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ReportsPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(ReportsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    URL.createObjectURL ??= () => 'blob:x';
    URL.revokeObjectURL ??= () => undefined;
    await settle();
    http.expectOne('/api/staff/reports').flush([
      { id: 'list-of-registered-msme', name: 'List Of ZED Cases In-Progress' },
      { id: 'list-of-certified-msme', name: 'List Of ZED Certified MSME' },
    ]);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the reports of the role', () => {
    const rows = [...el.querySelectorAll('tbody tr')].map((r) => [...r.querySelectorAll('td')].map((td) => td.textContent!.trim()));
    expect(rows).toEqual([['1', 'List Of ZED Cases In-Progress', 'Download'], ['2', 'List Of ZED Certified MSME', 'Download']]);
  });

  it('downloads by report id only', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (el.querySelector('tbody tr button') as HTMLButtonElement).click();
    await settle();
    expect(el.textContent).toContain('Please wait');

    const req = http.expectOne('/api/staff/reports/list-of-registered-msme/download');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush(new Blob(['xlsx']));
    await settle();
    expect(click).toHaveBeenCalled();
    expect(el.textContent).not.toContain('Please wait');
    click.mockRestore();
  });

  it('sends the chosen filters with the download (2026-11-26)', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    const pick = (sel: string, value: string) => {
      const box = el.querySelector(sel) as HTMLSelectElement | HTMLInputElement;
      box.value = value;
      box.dispatchEvent(new Event(box.tagName === 'SELECT' ? 'change' : 'input'));
    };
    // One box at a time, as a person does (the bar reads the page's filter after each change).
    pick('#f-gender', 'female');
    await settle();
    pick('#f-size', 'Micro');
    await settle();
    pick('#rp-status', 'Certified');
    pick('#rp-from', '2026-11-01');
    await settle();
    expect(el.textContent).toContain('Filters sheet');
    (el.querySelector('tbody tr button') as HTMLButtonElement).click();
    await settle();
    const req = http.expectOne((r) => r.url === '/api/staff/reports/list-of-registered-msme/download');
    expect(req.request.params.get('gender')).toBe('female');
    expect(req.request.params.get('size')).toBe('Micro');
    expect(req.request.params.get('status')).toBe('Certified');
    expect(req.request.params.get('from')).toBe('2026-11-01');
    expect(req.request.params.get('dateOf')).toBe('registration');
    expect(req.request.params.has('state')).toBe(false);
    req.flush(new Blob(['xlsx']));
    await settle();
    click.mockRestore();
  });

  it('shows the API message when a report fails', async () => {
    (el.querySelectorAll('tbody tr button')[1] as HTMLButtonElement).click();
    await settle();
    http.expectOne('/api/staff/reports/list-of-certified-msme/download').flush(
      new Blob([JSON.stringify({ title: 'This report is not available.' })], { type: 'application/problem+json' }),
      { status: 400, statusText: 'Bad Request' },
    );
    await settle();
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('This report is not available.');
  });
});
