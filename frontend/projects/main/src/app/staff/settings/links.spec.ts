import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LinksPage, PortalLink } from './links';

describe('LinksPage', () => {
  let fixture: ComponentFixture<LinksPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const api = '/api/staff/settings/links';
  const contact: PortalLink = {
    key: 'contact', name: 'Contact ZED', shownOn: 'The MSME menu.', url: null, defaultUrl: 'https://zed.example.org/contact-us', enabled: true,
  };
  const kawach: PortalLink = {
    key: 'kawach', name: 'MSME KAWACH', shownOn: 'The MSME dashboard.', url: 'https://kawach.example.org/login', defaultUrl: 'https://kawach.example.org/', enabled: false,
  };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create(links: PortalLink[]) {
    await TestBed.configureTestingModule({
      imports: [LinksPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(LinksPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(api).flush({ links });
    await settle();
  }

  const card = (key: string) => el.querySelector(`#${key}-url`)!.closest('form') as HTMLFormElement;
  const toggle = (key: string) => el.querySelector(`#${key}-enabled`) as HTMLInputElement;
  const address = (key: string) => el.querySelector(`#${key}-url`) as HTMLInputElement;
  const saveButton = (key: string) => card(key).querySelector('button[type=submit]') as HTMLButtonElement;
  const badge = (key: string) => card(key).querySelector('.link-title .status-badge')!.textContent!.trim();

  afterEach(() => http.verify());

  it('lists every link with its switch and switches one off, keeping the address', async () => {
    await create([contact, kawach]);
    expect(el.querySelectorAll('.link-card').length).toBe(2);
    expect(el.querySelector('.links-summary')!.textContent).toContain('1 of 2 links enabled.');
    expect(badge('contact')).toBe('Enabled');
    expect(badge('kawach')).toBe('Disabled');
    expect(toggle('kawach').checked).toBe(false);
    expect(address('kawach').value).toBe('https://kawach.example.org/login');
    expect(address('contact').placeholder).toBe(contact.defaultUrl);
    expect(saveButton('contact').disabled).toBe(true);

    toggle('contact').click();
    await settle();
    expect(card('contact').classList).toContain('is-off');
    expect(card('contact').querySelector('.link-off-note')).not.toBeNull();
    expect(card('contact').querySelector('.form-actions')!.textContent).toContain('Not saved yet.');
    expect(saveButton('kawach').disabled).toBe(true);

    card('contact').dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/contact`);
    expect(put.request.body).toEqual({ url: '', enabled: false });
    put.flush({ message: 'Contact ZED saved.' });
    await settle();
    http.expectOne(api).flush({ links: [{ ...contact, enabled: false }, kawach] });
    await settle();
    expect(badge('contact')).toBe('Disabled');
    expect(card('contact').querySelector('.alert-success')!.textContent).toContain('Contact ZED saved.');
    expect(saveButton('contact').disabled).toBe(true);
    expect(el.querySelector('.links-summary')!.textContent).toContain('0 of 2 links enabled.');
  });

  it('checks the address and undoes changes', async () => {
    await create([kawach]);
    address('kawach').value = 'kawach login';
    address('kawach').dispatchEvent(new Event('input'));
    await settle();
    card('kawach').dispatchEvent(new Event('submit'));
    await settle();
    expect(card('kawach').querySelector('.help-block')!.textContent).toContain('is not a web address');
    http.expectNone((r) => r.method === 'PUT');

    (Array.from(card('kawach').querySelectorAll('button')).find((b) => b.textContent!.trim() === 'CANCEL') as HTMLButtonElement).click();
    await settle();
    expect(address('kawach').value).toBe('https://kawach.example.org/login');
    expect(card('kawach').querySelector('.help-block')).toBeNull();
    expect(saveButton('kawach').disabled).toBe(true);
  });
});
