import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AuthService, PORTAL_LINK_DEFAULTS, PortalLinkKey, PortalLinksService } from '@zed/shared';
import { ATTENTION_API } from './attention';
import { StaffLayout, closeButtonOf, escapeIsForDropDown, topDialog } from './staff-layout';

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
  it('marks the frame zed-admin for the Admin and the Master Admin (the scope of the dark buttons)', async () => {
    const admin = await render({}, { userId: 'ZEDV4AD01', userName: 'ADMIN', roleId: 1, role: 'Admin' });
    expect(admin.classList).toContain('zed-legacy');
    expect(admin.classList).toContain('zed-v4');
    expect(admin.classList).toContain('zed-admin');
    TestBed.resetTestingModule();
    // 2026-11-21 (the user): the Master Admin's pages have the dark buttons too.
    const master = await render({}, { userId: 'ZEDV4MA01', userName: 'MASTER ADMIN', roleId: 7, role: 'MasterAdmin' });
    expect(master.classList).toContain('zed-admin');
    TestBed.resetTestingModule();
    const agency = await render({}, { userId: 'ZEDAA0001', userName: 'AGENCY', roleId: 2, role: 'Agency' });
    expect(agency.classList).toContain('zed-v4');
    expect(agency.classList).not.toContain('zed-admin');
  });
});

describe('Esc on staff pop-ups (UI audit F1/F2/F5)', () => {
  it('finds the pop-up on top and its close button', () => {
    const root = document.createElement('div');
    root.innerHTML = `
      <div class="modal d-block" id="a"><button class="btn btn-primary">Save</button><button class="btn-close" aria-label="Close"></button></div>
      <div class="modal d-block" id="b"><button class="btn btn-default">Cancel</button><button class="su-x" aria-label="Close">x</button></div>`;
    const top = topDialog(root)!;
    expect(top.id).toBe('b');
    expect(closeButtonOf(top)!.className).toBe('su-x');
    const labelled = document.createElement('div');
    labelled.innerHTML = '<div role="dialog" aria-modal="true"><button>Save</button><button class="btn btn-link p-0" aria-label="Close">x</button></div>';
    expect(closeButtonOf(topDialog(labelled)!)!.getAttribute('aria-label')).toBe('Close');
    expect(topDialog(document.createElement('div'))).toBeNull();
  });

  it('skips hidden and nested pop-ups, falls back to the x or footer Close, and lets a drop-down in the pop-up take the Esc (audit item 3)', () => {
    const root = document.createElement('div');
    document.body.appendChild(root);
    root.innerHTML = `
      <button id="opener" aria-expanded="true">Menu</button>
      <div class="xd-back"></div>
      <div class="xd wide" role="dialog" aria-modal="true" id="cases">
        <div role="dialog" aria-modal="true" id="inner"><button class="btn">Export</button></div>
        <input id="combo" role="combobox" aria-expanded="true" />
        <div class="xd-foot"><button class="btn btn-default">Close</button></div>
      </div>
      <div class="modal d-block" id="kept" style="visibility: hidden"><button class="btn-close"></button></div>
      <div role="dialog" aria-modal="true" id="gone" hidden><button class="btn-close"></button></div>`;
    const top = topDialog(root)!;
    expect(top.id).toBe('cases');
    expect(closeButtonOf(top)!.textContent).toBe('Close');
    // An expanded control outside the pop-up (its opener) does not stop the Esc; one inside it does.
    expect(escapeIsForDropDown(root.querySelector('#opener'), top)).toBe(false);
    expect(escapeIsForDropDown(root.querySelector('#combo'), top)).toBe(true);
    expect(escapeIsForDropDown(null, top)).toBe(false);

    const marked = document.createElement('div');
    marked.innerHTML = '<div class="modal d-block"><button class="btn btn-link" aria-label="Fermer">x</button><button class="btn" data-dismiss>y</button></div>';
    expect(closeButtonOf(topDialog(marked)!)!.textContent).toBe('y');
    const times = document.createElement('div');
    times.innerHTML = '<div role="dialog" aria-modal="true"><button class="btn">Save</button><button class="btn">×</button></div>';
    expect(closeButtonOf(topDialog(times)!)!.textContent).toBe('×');
    // The one painted on top wins over the one later in the page.
    const layered = document.createElement('div');
    layered.innerHTML = '<div class="xd" role="dialog" aria-modal="true" id="high" style="position: fixed; z-index: 1070"></div><div class="modal d-block" id="low" style="z-index: 1055"></div>';
    expect(topDialog(layered)!.id).toBe('high');
    root.remove();
  });
});
