import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TextItem, TextsPage } from './texts';

describe('TextsPage', () => {
  let fixture: ComponentFixture<TextsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/texts';

  const item = (key: string, name: string, channel: string, more: Partial<TextItem> = {}): TextItem => ({
    key, name, group: 'Payment', channel, enabled: true, customised: false, placeholders: [], updatedBy: null, updatedOn: null, ...more,
  });
  const items = [
    item('msme.payment.disclaimer', 'Payment disclaimer', 'Website', { placeholders: ['Fee'] }),
    item('msme.payment.instructions', 'Payment instructions', 'Website', { enabled: false, customised: true }),
    item('app.msme.undertaking', 'Undertaking', 'Mobile app', { group: 'MSME app' }),
  ];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  const rows = () => [...el.querySelectorAll('tbody tr')].map((r) => r.textContent!.replace(/\s+/g, ' ').trim());
  const button = (text: string, root: ParentNode = el) =>
    [...root.querySelectorAll('button, input[type=button]')].find((b) => (b.textContent || (b as HTMLInputElement).value).trim() === text) as HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [TextsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(TextsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(items);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the website and the app texts on their tabs', async () => {
    expect([...el.querySelectorAll('[role=tab]')].map((t) => t.textContent!.trim())).toEqual(['Website (2)', 'Mobile app (1)']);
    expect(rows()[1]).toContain('Hidden');
    (el.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    await settle();
    expect(rows()).toEqual([expect.stringContaining('Undertaking')]);
  });

  it('edits a text with its fields, goes back to the standard text and saves', async () => {
    button('Edit').click();
    await settle();
    http.expectOne(`${url}/msme.payment.disclaimer`).flush({ item: items[0], bodyHtml: '<p>Own</p>', standardHtml: '<p>Standard fee Rs. {{Fee}}</p>' });
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.querySelector('.preview')!.innerHTML).toBe('<p>Own</p>');
    button('Use the standard text', dialog).click();
    await settle();
    button('{{Fee}}', dialog).click();
    (dialog.querySelector('#textEnabled') as HTMLInputElement).click();
    await settle();
    button('SAVE', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/msme.payment.disclaimer`);
    expect(put.request.body).toEqual({ enabled: false, bodyHtml: '<p>Standard fee Rs. {{Fee}}</p>{{Fee}}' });
    put.flush({ message: 'Text saved. It is not shown.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === url).flush(items);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Text saved. It is not shown.');
  });

  it('resets a changed text after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Reset').click();
    await settle();
    http.expectOne((r) => r.method === 'DELETE' && r.url === `${url}/msme.payment.instructions`).flush({ message: 'The standard text is shown again.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush(items);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('The standard text is shown again.');
  });
});
