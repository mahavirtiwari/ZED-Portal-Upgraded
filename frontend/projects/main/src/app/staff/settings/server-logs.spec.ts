import { HttpErrorResponse, provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { apiErrorMessage, errorReference } from '@zed/shared';
import { ServerLogEntry, ServerLogsPage } from './server-logs';

describe('error reference (2026-11-21, server log)', () => {
  const error = (status: number, body: object) => new HttpErrorResponse({ status, error: body });

  it('takes the start of the trace id of a server error', () => {
    const e = error(500, { title: 'An error occurred while processing your request.', traceId: '00-A0FE8BFED63E9934DB00AE2D39B6AF99-696e0c6244744f42-00' });
    expect(errorReference(e)).toBe('a0fe8bfe');
    expect(apiErrorMessage(e)).toBe('An error occurred while processing your request. (Reference: a0fe8bfe)');
  });

  it('adds nothing to other answers', () => {
    expect(errorReference(error(400, { title: 'Bad', traceId: '00-a0fe8bfed63e9934db00ae2d39b6af99-696e0c6244744f42-00' }))).toBeNull();
    expect(apiErrorMessage(error(500, { title: 'Oops' }))).toBe('Oops');
  });
});

describe('ServerLogsPage', () => {
  let fixture: ComponentFixture<ServerLogsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/server-logs';
  const entry = (more: Partial<ServerLogEntry>): ServerLogEntry => ({ t: '2026-11-21T05:46:10Z', l: 'Warning', s: 'main', c: 'Zed.Request', e: 0, m: 'Slow', ...more });

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [ServerLogsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(ServerLogsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    // 2026-11-27: the app token readiness card (none here: no card).
    for (const r of http.match((r) => r.url === '/api/staff/settings/app-tokens')) r.flush({ apps: [], recorded: true });
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the entries newest first with the error marked, and opens the full error', async () => {
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('level')).toBe('Warning');
    req.flush({
      source: 'main', more: false, from: '2026-11-21', to: '2026-11-21',
      sources: [{ name: 'main', days: ['2026-11-21'] }, { name: 'mobile-main', days: [] }],
      entries: [
        entry({ l: 'Error', c: 'Microsoft.AspNetCore.Diagnostics.ExceptionHandlerMiddleware', m: 'An unhandled exception has occurred while executing the request.',
          x: 'System.Data.SqlClient.SqlException: insufficient system memory\n   at X', p: '/api/staff/users/agencies', u: 'ZEDV4MA01 (7)', r: '0af7651916cd43dd8448eb211c80319c' }),
        entry({}),
      ],
    });
    await settle();
    const rows = [...el.querySelectorAll('tbody tr')];
    expect(rows.length).toBe(2);
    expect(rows[0].classList).toContain('is-error');
    expect(rows[0].textContent).toContain('insufficient system memory');
    expect(rows[0].textContent).toContain('/api/staff/users/agencies');
    expect(el.textContent).toContain('1 errors');
    expect([...el.querySelectorAll('select option')].map((o) => o.textContent!.trim())).toContain('Mobile apps server (main)');

    (rows[0].querySelector('button') as HTMLElement).click();
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('0af7651916cd43dd8448eb211c80319c');
    expect(dialog.querySelector('pre')!.textContent).toContain('at X');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await settle();
    expect(el.querySelector('[role=dialog]')).toBeNull();
  });

  it('says where the log is kept, and warns when the portal cannot write it', async () => {
    // 2026-11-23: the page was empty on every portal; an unwritable folder must not look like "no problems".
    http.expectOne((r) => r.url === url).flush({
      source: 'main', more: false, from: '', to: '', sources: [{ name: 'main', days: [] }], entries: [], folder: 'E:\\ZedV4\\main\\logs', writeProblem: null,
    });
    await settle();
    expect(el.querySelector('[data-log-folder]')!.textContent).toContain('E:\\ZedV4\\main\\logs');
    expect(el.querySelector('[data-write-problem]')).toBeNull();

    (el.querySelector('.sl-actions .btn-primary') as HTMLButtonElement).click();
    await settle();
    http.expectOne((r) => r.url === url).flush({
      source: 'main', more: false, from: '', to: '', sources: [{ name: 'main', days: [] }], entries: [],
      folder: 'E:\\ZedV4\\main\\logs', writeProblem: "Access to the path 'E:\\ZedV4\\main\\logs' is denied.",
    });
    await settle();
    const warning = el.querySelector('[data-write-problem]')!;
    expect(warning.textContent).toContain('cannot write its log');
    expect(warning.textContent).toContain('is denied');
    expect(el.querySelector('[data-log-folder]')).toBeNull();
  });

  it('searches by the reference and shows a refusal', async () => {
    http.expectOne((r) => r.url === url).flush({ source: 'main', more: false, from: '', to: '', sources: [{ name: 'main', days: [] }], entries: [] });
    await settle();
    expect(el.textContent).toContain('Nothing logged for these filters.');
    const box = el.querySelector('input[type=search]') as HTMLInputElement;
    box.value = 'a0fe8bfe';
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await settle();
    const req = http.expectOne((r) => r.url === url);
    expect(req.request.params.get('q')).toBe('a0fe8bfe');
    req.flush({ title: 'Please choose at most 31 days.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('at most 31 days');
  });

  it('pages the entries and downloads the chosen filters as Excel (2026-11-24)', async () => {
    const many = Array.from({ length: 120 }, (_, i) => entry({ m: `Entry ${i + 1}`, l: i < 3 ? 'Error' : 'Warning' }));
    http.expectOne((r) => r.url === url).flush({ source: 'main', more: false, from: '2026-11-01', to: '2026-11-24', sources: [{ name: 'main', days: [] }], entries: many });
    await settle();
    // 50 a page; the counts are of all the entries loaded.
    expect(el.querySelectorAll('tbody tr').length).toBe(50);
    expect(el.textContent).toContain('3 errors');
    expect(el.textContent).toContain('117 warnings');
    const next = [...el.querySelectorAll('.zp-btn')].find((b) => b.textContent!.trim() === 'Next') as HTMLButtonElement;
    next.click();
    await settle();
    expect(el.querySelector('tbody tr')!.textContent).toContain('Entry 51');

    (el.querySelector('[data-excel]') as HTMLButtonElement).click();
    await settle();
    const req = http.expectOne((r) => r.url === url + '/excel');
    expect(req.request.params.get('level')).toBe('Warning');
    expect(req.request.params.get('source')).toBe('main');
    expect(req.request.responseType).toBe('blob');
    const createUrl = vi.fn(() => 'blob:x');
    Object.assign(URL, { createObjectURL: createUrl, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
    req.flush(new Blob(['x']));
    await settle();
    expect(createUrl).toHaveBeenCalled();
    vi.restoreAllMocks();
    expect(el.querySelector('.alert-danger')).toBeNull();
  });
});

describe('ServerLogsPage app token readiness (2026-11-27)', () => {
  it('shows the mode of each app and the units that called without a token, and which can be enforced', async () => {
    await TestBed.configureTestingModule({ imports: [ServerLogsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    const fixture = TestBed.createComponent(ServerLogsPage);
    const http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();
    http.expectOne((r) => r.url === '/api/staff/settings/app-tokens').flush({ recorded: true, apps: [
      { app: 'MSME', mode: 'Monitor', users7: 12, users30: 40, lastAt: '2026-11-27T10:05:00', ready: false },
      { app: 'SA', mode: 'Enforce', users7: 0, users30: 0, lastAt: null, ready: true },
      { app: 'RA', mode: 'Monitor', users7: 0, users30: 0, lastAt: null, ready: true },
    ] });
    for (const r of http.match((r) => r.url === '/api/staff/settings/server-logs')) r.flush({ source: 'main', more: false, from: '', to: '', sources: [], entries: [] });
    await new Promise((r) => setTimeout(r));
    fixture.detectChanges();
    const card = (fixture.nativeElement as HTMLElement).querySelector('.sl-tokens')!;
    const rows = [...card.querySelectorAll('tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' '));
    expect(rows[0]).toContain('ZED MSME app');
    expect(rows[0]).toContain('12 units / users');
    expect(rows[0]).toContain('27-11-2026 10:05');
    expect(rows[0]).toContain('Not yet');
    expect(rows[1]).toContain('Enforced');
    expect(rows[2]).toContain('Yes: none in 30 days');
    http.verify();
  });
});
