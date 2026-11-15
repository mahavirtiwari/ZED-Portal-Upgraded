import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { MaintenanceBanner, MaintenanceService, maintenanceInterceptor } from './maintenance';

describe('Maintenance mode in the pages', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [MaintenanceBanner],
      providers: [provideHttpClient(withInterceptors([maintenanceInterceptor])), provideHttpClientTesting(), provideRouter([])],
    });
  });

  it('shows the maintenance page when the portal is down, and when a call is refused', async () => {
    const http = TestBed.inject(HttpTestingController);
    const service = TestBed.inject(MaintenanceService);
    const fixture = TestBed.createComponent(MaintenanceBanner);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.mt-page')).toBeNull();

    const check = service.check();
    http.expectOne('/api/public/maintenance').flush({ down: true, message: 'Back at 6 pm.', until: '2026-11-20T18:00' });
    await check;
    fixture.detectChanges();
    const page = fixture.nativeElement.querySelector('.mt-page') as HTMLElement;
    expect(page.textContent).toContain('Back at 6 pm.');
    expect(page.textContent).toContain('Expected back by 20-11-2026, 6:00 PM');

    service.info.set(null);
    const call = firstValueFrom(TestBed.inject(HttpClient).get('/api/public/levels')).catch(() => null);
    http.expectOne('/api/public/levels').flush({ title: 'Down for work.', maintenance: true }, { status: 503, statusText: 'Service Unavailable' });
    await call;
    expect(service.info()).toEqual({ message: 'Down for work.', until: null });
    http.verify();
  });
});
