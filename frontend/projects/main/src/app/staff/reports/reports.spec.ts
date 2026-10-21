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
      providers: [provideHttpClient(), provideHttpClientTesting()],
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
    expect(rows).toEqual([['1', 'List Of ZED Cases In-Progress', 'DOWNLOAD'], ['2', 'List Of ZED Certified MSME', 'DOWNLOAD']]);
  });

  it('downloads by report id only', async () => {
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    (el.querySelector('tbody tr button') as HTMLButtonElement).click();
    await settle();
    expect(el.textContent).toContain('PLEASE WAIT');

    const req = http.expectOne('/api/staff/reports/list-of-registered-msme/download');
    expect(req.request.method).toBe('GET');
    expect(req.request.params.keys()).toEqual([]);
    req.flush(new Blob(['xlsx']));
    await settle();
    expect(click).toHaveBeenCalled();
    expect(el.textContent).not.toContain('PLEASE WAIT');
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
