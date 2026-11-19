import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { MaintenanceModePage, MaintenanceRow } from './maintenance-mode';
import { ConfirmService } from '../confirm-dialog';

describe('MaintenanceModePage', () => {
  let fixture: ComponentFixture<MaintenanceModePage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/maintenance';
  const row = (key: string, name: string, more: Partial<MaintenanceRow> = {}): MaintenanceRow => ({
    key, name, down: false, message: null, from: null, until: null, downNow: false, defaultMessage: 'Default', ...more,
  });
  const rows = [row('main', 'ZED Certification portal'), row('consultancy', 'Consultancy portal', { from: '2026-11-20T14:00', until: '2026-11-20T18:00' })];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [MaintenanceModePage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(MaintenanceModePage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(rows);
    await settle();
  });

  afterEach(() => http.verify());

  it('switches a portal down after confirming and saves every row', async () => {
    expect([...el.querySelectorAll('tbody tr strong')].map((s) => s.textContent!.trim())).toEqual(['ZED Certification portal', 'Consultancy portal']);
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(false);
    (el.querySelector('[aria-label="ZED Certification portal down"]') as HTMLInputElement).click();
    const msg = el.querySelector('[aria-label="Message of ZED Certification portal"]') as HTMLInputElement;
    msg.value = 'Back at 6 pm.';
    msg.dispatchEvent(new Event('input'));
    await settle();
    expect(el.querySelector('.mm-switch.down')!.textContent).toContain('Down');
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ message: expect.stringContaining('ZED Certification portal') }));
    http.expectNone(url, 'refused: nothing saved');
    confirm.mockResolvedValue(true);
    el.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
    expect(put.request.body).toEqual([
      { key: 'main', down: true, message: 'Back at 6 pm.', from: null, until: null },
      { key: 'consultancy', down: false, message: null, from: '2026-11-20T14:00', until: '2026-11-20T18:00' },
    ]);
    put.flush({ message: 'Maintenance saved.' });
    await settle();
    http.expectOne(url).flush(rows);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Maintenance saved.');
  });
});
