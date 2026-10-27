import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ApiIntegrationsPage } from './api-integrations';

describe('ApiIntegrationsPage', () => {
  let fixture: ComponentFixture<ApiIntegrationsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/integrations';

  const clients = [
    { id: 1, name: 'RAMP Dashboard', clientId: '4947838', createdDate: null, baseUrl: null, access: ['Encrypted lists (RAMP dashboard)'], lastTokenOn: null, enabled: true },
    { id: 3, name: 'Andhra Pradesh', clientId: 'AP01', createdDate: null, baseUrl: null, access: ['Incentive submission'], lastTokenOn: null, enabled: false },
  ];
  const groups = [{ key: 'lookups', name: 'Certificate lookups', usedBy: 'Banks', description: 'Details', endpoints: ['Msme/GetZedDetails'], enabled: true }];
  const outbound = [{ name: 'CCAvenue payment gateway', purpose: 'Payments', managedAt: 'Server', inV4: true }];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function flushAll() {
    http.expectOne(`${url}/clients`).flush(clients);
    http.expectOne(`${url}/groups`).flush(groups);
    http.expectOne(`${url}/outbound`).flush(outbound);
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ApiIntegrationsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(ApiIntegrationsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    flushAll();
    await settle();
  });

  afterEach(() => {
    http.verify();
    vi.restoreAllMocks();
  });

  it('lists the partners with what they may call, the API groups and the services ZED calls', () => {
    const rows = [...el.querySelectorAll('section[aria-labelledby="ai-clients"] tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' '));
    expect(rows[0]).toContain('RAMP Dashboard');
    expect(rows[0]).toContain('Encrypted lists (RAMP dashboard)');
    expect(rows[1]).toContain('Disabled');
    expect(el.querySelector('.ai-group')!.textContent).toContain('Msme/GetZedDetails');
    expect(el.querySelector('section[aria-labelledby="ai-outbound"]')!.textContent).toContain('In use');
  });

  it('disables a partner after a confirmation and keeps it on when cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    const sw = el.querySelector('[aria-label="Disable RAMP Dashboard"]') as HTMLInputElement;
    sw.click();
    await settle();
    expect(sw.checked).toBe(true);
    http.expectNone((r) => r.method === 'PUT');

    confirm.mockReturnValue(true);
    sw.click();
    await settle();
    const put = http.expectOne(`${url}/clients/1`);
    expect(put.request.body).toEqual({ enabled: false });
    put.flush({ message: 'RAMP Dashboard is disabled.' });
    await settle();
    flushAll();
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('is disabled');
  });

  it('switches an API group on without asking, and puts the switch back on an error', async () => {
    const sw = el.querySelector('[aria-label="Enable Andhra Pradesh"]') as HTMLInputElement;
    sw.click();
    await settle();
    http.expectOne(`${url}/clients/3`).flush({ title: 'Not allowed.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(sw.checked).toBe(false);
    expect(el.querySelector('.alert-danger')!.textContent).toContain('Not allowed.');
  });
});
