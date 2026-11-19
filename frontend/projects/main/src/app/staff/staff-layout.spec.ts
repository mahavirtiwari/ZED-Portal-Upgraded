import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, PORTAL_LINK_DEFAULTS, PortalLinkKey, PortalLinksService } from '@zed/shared';
import { ATTENTION_API } from './attention';
import { StaffLayout } from './staff-layout';

/** jsdom has no ResizeObserver (the menu row measures its entries on resize). */
class NoResizeObserver {
  observe(): void {}
  disconnect(): void {}
}

describe('StaffLayout (2026-11-18 designs)', () => {
  beforeAll(() => {
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver ??= NoResizeObserver;
  });

  type SignedIn = { userId: string; userName: string; roleId: number; role: string };
  const MASTER_ADMIN: SignedIn = { userId: 'ZEDV4MA01', userName: 'MASTER ADMIN', roleId: 7, role: 'MasterAdmin' };

  async function render(links: Partial<Record<PortalLinkKey, string | null>> = {}, user: SignedIn = MASTER_ADMIN) {
    TestBed.configureTestingModule({
      imports: [StaffLayout],
      providers: [
        provideRouter([]),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: PortalLinksService, useValue: { url: (k: PortalLinkKey) => (k in links ? links[k]! : PORTAL_LINK_DEFAULTS[k]) } },
      ],
    });
    TestBed.inject(AuthService).setUser({ ...user, subRoles: [] });
    const fixture = TestBed.createComponent(StaffLayout);
    fixture.detectChanges();
    const http = TestBed.inject(HttpTestingController);
    for (const r of http.match(() => true)) r.flush(r.request.url === ATTENTION_API ? { total: 4, items: [] } : { legacyPortalUrl: '' });
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }

  it('shows the user with the role, the search box and the bell with its count', async () => {
    const el = await render();
    expect(el.querySelector('.user-menu .avatar')!.textContent!.trim()).toBe('M');
    expect(el.querySelector('.user-menu .who b')!.textContent!.trim()).toBe('MASTER ADMIN');
    expect(el.querySelector('.user-menu .who small')!.textContent!.trim()).toBe('Master Admin');
    expect(el.querySelector('.nav-tools zed-zed-id-search .zs-key')!.textContent!.trim()).toBe('Ctrl K');
    expect(el.querySelector('.nav-tools zed-attention-bell [data-total]')!.textContent!.trim()).toBe('4');
    // The menu starts with Home; no "|" separators are written in the markup.
    expect(el.querySelector('#staff-menu .nav > li:first-child')!.textContent!.trim()).toBe('Home');
    expect(el.querySelector('#staff-menu')!.textContent).not.toContain('|');
  });

  it('shows the footer with the four links of the designs (Admin → Links)', async () => {
    const el = await render();
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.sf-links a')];
    expect(links.map((a) => a.textContent!.trim())).toEqual(['Scheme guidelines', 'Privacy policy', 'Terms of use', 'Help desk']);
    expect(links.map((a) => a.getAttribute('href'))).toEqual([
      PORTAL_LINK_DEFAULTS.guidelines, PORTAL_LINK_DEFAULTS.privacy, PORTAL_LINK_DEFAULTS.terms, PORTAL_LINK_DEFAULTS.contact,
    ]);
    expect(el.querySelector('.sfoot')!.textContent).toContain('All Rights Reserved');
  });

  it('falls back to the portal\'s own pages for a link the Admin switched off, and leaves out the others', async () => {
    const el = await render({ terms: null, privacy: null, guidelines: null });
    const links = [...el.querySelectorAll<HTMLAnchorElement>('.sf-links a')];
    // The account's documents (Master Admin has "Documents") and the main portal's privacy page; no "Terms of use".
    expect(links.map((a) => a.textContent!.trim())).toEqual(['Scheme guidelines', 'Privacy policy', 'Help desk']);
    expect(links.slice(0, 2).map((a) => a.getAttribute('href'))).toEqual(['/staff/documents', '/privacy-policy']);
  });

  // 2026-11-19 (the user, Admin login: 'make the buttons in dark color'): the dark buttons are scoped to .zed-admin.
  it('marks the frame zed-admin for the Admin login only (the scope of the dark buttons)', async () => {
    const admin = await render({}, { userId: 'ZEDV4AD01', userName: 'ADMIN', roleId: 1, role: 'Admin' });
    expect(admin.classList).toContain('zed-legacy');
    expect(admin.classList).toContain('zed-v4');
    expect(admin.classList).toContain('zed-admin');
    TestBed.resetTestingModule();
    const master = await render();
    expect(master.classList).toContain('zed-v4');
    expect(master.classList).not.toContain('zed-admin');
  });
});
