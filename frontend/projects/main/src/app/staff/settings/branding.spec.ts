import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { ToastService } from '../toast';
import { BrandingPage, BrandingTarget, BrandingTheme } from './branding';

describe('BrandingPage', () => {
  let fixture: ComponentFixture<BrandingPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/branding';
  const themes: BrandingTheme[] = [
    { key: 'teal', name: 'ZED Teal (today)', dark: '#23656b', mid: '#45a5ad', accent: '#c9e8a0' },
    { key: 'navy', name: 'Navy', dark: '#1f3b73', mid: '#3c6fc4', accent: '#f2c14e' },
  ];
  const targets: BrandingTarget[] = [
    { key: 'main', name: 'ZED Certification portal', isApp: false, theme: 'teal', logos: [
      { slot: 'header-right', label: 'Header: ZED logo (right)', hint: '', url: '/api/public/branding/file/Branding_main_header-right_20261115120000_0a1b2c3d.png' },
      { slot: 'footer', label: 'Footer logo', hint: '', url: null },
    ] },
    { key: 'app-msme', name: 'ZED MSME app', isApp: true, theme: 'teal', logos: [{ slot: 'app-logo', label: 'App logo', hint: '', url: null }] },
  ];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [BrandingPage], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(BrandingPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush({ targets, themes });
    await settle();
  });

  afterEach(() => {
    document.documentElement.removeAttribute('data-zed-theme');
    http.verify();
  });

  it("shows each spot's logo or today's, uploads one and previews then saves a theme", async () => {
    const imgs = [...el.querySelectorAll('.br-box img')].map((i) => i.getAttribute('src'));
    expect(imgs).toEqual([targets[0].logos[0].url, 'Images/footer/footer-icon.png']);

    const input = el.querySelector('[aria-label="Upload Footer logo"]') as HTMLInputElement;
    Object.defineProperty(input, 'files', { value: [new File([new Uint8Array([137, 80])], 'f.png', { type: 'image/png' })] });
    input.dispatchEvent(new Event('change'));
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === `${url}/main/logos/footer`);
    expect(post.request.body instanceof FormData).toBe(true);
    post.flush({ message: 'Logo saved.' });
    await settle();
    http.expectOne(url).flush({ targets, themes });
    await settle();

    (el.querySelectorAll('.br-theme')[1] as HTMLButtonElement).click();
    await settle();
    const preview = [...el.querySelectorAll('button')].find((b) => b.textContent!.includes('Preview on this page')) as HTMLButtonElement;
    preview.click();
    await settle();
    expect(document.documentElement.dataset['zedTheme']).toBe('navy');
    (el.querySelector('.br-foot .btn-primary') as HTMLButtonElement).click();
    await settle();
    expect(document.documentElement.dataset['zedTheme']).toBeUndefined();   // the preview ends before saving
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/main/theme`);
    expect(put.request.body).toEqual({ theme: 'navy' });
    put.flush({ message: 'Colour theme saved.' });
    await settle();
    // The confirmation is a toast at the bottom, beside Save theme (2026-11-19: the alert at the top was out of view).
    expect(TestBed.inject(ToastService).toasts().at(-1)?.title).toBe('Colour theme saved.');
    expect(el.querySelector('.alert-success')).toBeNull();
    http.expectOne(url).flush({ targets: [{ ...targets[0], theme: 'navy' }, targets[1]], themes });
    await settle();
    // The saved theme is the one marked current; ZED Teal no longer says "(today)".
    expect([...el.querySelectorAll('.br-theme')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['ZED Teal', 'Navy (current)']);
    http.expectOne('/api/public/branding').flush({ theme: themes[1], logos: {} });
    await settle();
    expect(document.documentElement.dataset['zedTheme']).toBe('navy');
  });

  it('marks the theme saved for the portal shown as current', () => {
    expect([...el.querySelectorAll('.br-theme')].map((b) => b.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['ZED Teal (current)', 'Navy']);
  });

  it('shows the app tab with its one logo spot', async () => {
    ([...el.querySelectorAll('.br-tab')].find((b) => b.textContent!.includes('ZED MSME app')) as HTMLButtonElement).click();
    await settle();
    expect(el.querySelectorAll('.br-logo').length).toBe(1);
    expect(el.textContent).toContain('app icon and the splash screen change only with a new app build');
  });
});
