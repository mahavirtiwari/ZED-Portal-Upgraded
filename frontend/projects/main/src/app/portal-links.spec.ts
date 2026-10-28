import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { PORTAL_LINK_DEFAULTS, PortalLinksService } from '@zed/shared';

/** The links of Admin → Links as the pages get them from /api/config (the other specs use the defaults). */
describe('PortalLinksService', () => {
  let http: HttpTestingController;
  let links: PortalLinksService;

  async function create(config: object) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: PortalLinksService, useClass: PortalLinksService }],
    });
    http = TestBed.inject(HttpTestingController);
    links = TestBed.inject(PortalLinksService);
    // Until the server answers: the defaults.
    expect(links.url('ministry')).toBe(PORTAL_LINK_DEFAULTS.ministry);
    http.expectOne('/api/config').flush(config);
    await new Promise((r) => setTimeout(r));
  }

  afterEach(() => http.verify());

  it('uses the addresses the Admin set and leaves out the links switched off', async () => {
    await create({
      captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '', contactUrl: 'https://zed.example.org/contact',
      links: { contact: 'https://zed.example.org/contact', ministry: 'https://msme.example.org/', kawach: null },
    });
    expect(links.url('contact')).toBe('https://zed.example.org/contact');
    expect(links.url('ministry')).toBe('https://msme.example.org/');
    expect(links.url('kawach')).toBeNull();
    expect(links.url('playStore')).toBe(PORTAL_LINK_DEFAULTS.playStore);
  });

  it('takes Contact ZED from a server without the links', async () => {
    await create({ captchaEnabled: false, captchaSiteKey: '', legacyPortalUrl: '', contactUrl: 'https://zed.example.org/contact' });
    expect(links.url('contact')).toBe('https://zed.example.org/contact');
    expect(links.url('appStore')).toBe(PORTAL_LINK_DEFAULTS.appStore);
  });
});
