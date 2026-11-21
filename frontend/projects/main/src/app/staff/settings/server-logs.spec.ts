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
});
