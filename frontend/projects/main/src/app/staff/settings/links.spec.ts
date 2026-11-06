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
  const lgd: PortalLink = {
    key: 'lgd', name: 'LGD Directory', shownOn: 'Admin → Masters → LG Directory.', url: 'https://lgd.example.org/download', defaultUrl: 'https://lgd.example.org/', enabled: false,
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
  const chip = (key: string) => card(key).querySelector('.addr-chip')!.textContent!.trim();
  const stats = () => [...el.querySelectorAll('.links-stats .stat')].map((t) => `${t.querySelector('.stat-value')!.textContent} ${t.querySelector('.stat-label')!.textContent}`);

  afterEach(() => http.verify());

  it('lists every link with its switch and switches one off, keeping the address', async () => {
    await create([contact, lgd]);
    expect(el.querySelectorAll('.link-card').length).toBe(2);
    expect(stats()).toEqual(['2 Links', '1/2 Enabled', '1 Own address', '1 Switched off']);
    expect(chip('contact')).toBe('Default address');
    expect(chip('lgd')).toBe('Own address');
    expect(badge('contact')).toBe('Enabled');
    expect(badge('lgd')).toBe('Disabled');
    expect(toggle('lgd').checked).toBe(false);
    expect(address('lgd').value).toBe('https://lgd.example.org/download');
    expect(address('contact').placeholder).toBe(contact.defaultUrl);
    expect(saveButton('contact').disabled).toBe(true);

    toggle('contact').click();
    await settle();
    expect(card('contact').classList).toContain('is-off');
    expect(card('contact').querySelector('.link-off-note')).not.toBeNull();
    expect(card('contact').querySelector('.form-actions')!.textContent).toContain('Not saved yet.');
    expect(card('contact').classList).toContain('is-dirty');
    expect(stats()[1]).toBe('1/2 Enabled');
    expect(saveButton('lgd').disabled).toBe(true);

    card('contact').dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/contact`);
    expect(put.request.body).toEqual({ url: '', enabled: false });
    put.flush({ message: 'Contact ZED saved.' });
    await settle();
    http.expectOne(api).flush({ links: [{ ...contact, enabled: false }, lgd] });
    await settle();
    expect(badge('contact')).toBe('Disabled');
    expect(card('contact').querySelector('.alert-success')!.textContent).toContain('Contact ZED saved.');
    expect(saveButton('contact').disabled).toBe(true);
    expect(stats()).toEqual(['2 Links', '0/2 Enabled', '1 Own address', '2 Switched off']);
    expect(card('contact').classList).not.toContain('is-dirty');
  });

  it('counts own addresses after a save', async () => {
    await create([contact]);
    address('contact').value = 'https://zed.example.org/help';
    address('contact').dispatchEvent(new Event('input'));
    await settle();
    expect(chip('contact')).toBe('Default address');
    card('contact').dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${api}/contact`);
    expect(put.request.body).toEqual({ url: 'https://zed.example.org/help', enabled: true });
    put.flush({ message: 'Contact ZED saved.' });
    await settle();
    http.expectOne(api).flush({ links: [{ ...contact, url: 'https://zed.example.org/help' }] });
    await settle();
    expect(chip('contact')).toBe('Own address');
    expect(stats()).toEqual(['1 Links', '1/1 Enabled', '1 Own address', '0 Switched off']);
  });

  it('says when there is no link to set up', async () => {
    await create([]);
    expect(el.querySelector('.no-data')!.textContent).toContain('No links to set up.');
    expect(stats()[0]).toBe('0 Links');
  });

  it('checks the address and undoes changes', async () => {
    await create([lgd]);
    address('lgd').value = 'lgd download';
    address('lgd').dispatchEvent(new Event('input'));
    await settle();
    card('lgd').dispatchEvent(new Event('submit'));
    await settle();
    expect(card('lgd').querySelector('.help-block')!.textContent).toContain('is not a web address');
    http.expectNone((r) => r.method === 'PUT');

    (Array.from(card('lgd').querySelectorAll('button')).find((b) => b.textContent!.trim() === 'CANCEL') as HTMLButtonElement).click();
    await settle();
    expect(address('lgd').value).toBe('https://lgd.example.org/download');
    expect(card('lgd').querySelector('.help-block')).toBeNull();
    expect(saveButton('lgd').disabled).toBe(true);
  });
});
