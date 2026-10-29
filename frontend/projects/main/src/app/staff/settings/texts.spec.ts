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

  it('puts a field at the cursor of the text and shows the preview with sample values', async () => {
    button('Edit').click();
    await settle();
    const own = '<p>Fee: Rs. </p><img src="{{PublicBaseUrl}}/Images/header/zed-logo.png" alt="ZED Logo">';
    http.expectOne(`${url}/msme.payment.disclaimer`).flush({ item: items[0], bodyHtml: own, standardHtml: '<p>Standard</p>' });
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    const base = document.baseURI.replace(/\/+$/, '');
    expect(dialog.querySelector('.preview img')!.getAttribute('src')).toBe(`${base}/Images/header/zed-logo.png`);

    const body = dialog.querySelector('#textBody') as HTMLTextAreaElement;
    body.dispatchEvent(new Event('focus'));
    const at = body.value.indexOf('</p>');
    body.setSelectionRange(at, at);
    button('{{Fee}}', dialog).click();
    await settle();
    expect(body.value).toBe('<p>Fee: Rs. {{Fee}}</p><img src="{{PublicBaseUrl}}/Images/header/zed-logo.png" alt="ZED Logo">');
    expect(body.selectionStart).toBe(at + '{{Fee}}'.length);
    expect(dialog.querySelector('.preview p')!.textContent).toBe('Fee: Rs. [Fee]');

    button('SAVE', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/msme.payment.disclaimer`);
    // What is saved keeps the fields; only the preview fills them.
    expect(put.request.body).toEqual({ enabled: true, bodyHtml: '<p>Fee: Rs. {{Fee}}</p><img src="{{PublicBaseUrl}}/Images/header/zed-logo.png" alt="ZED Logo">' });
    put.flush({ message: 'Text saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === url).flush(items);
    await settle();
  });

  it('shows the counts, filters by status, and previews an app text at phone width with whether it is the standard', async () => {
    // Website: 2 texts, 1 shown, 1 hidden, 1 changed.
    expect([...el.querySelectorAll('.stat-value')].map((v) => v.textContent!.trim())).toEqual(['2', '1', '1', '1']);
    button('Hidden').click();
    await settle();
    expect(rows()).toEqual([expect.stringContaining('Payment instructions')]);
    button('All').click();
    await settle();
    expect(rows()[0]).toContain('fields: Fee');

    (el.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    await settle();
    button('Edit').click();
    await settle();
    http.expectOne(`${url}/app.msme.undertaking`).flush({ item: items[2], bodyHtml: '<p>I agree.</p>', standardHtml: '<p>I agree.</p>' });
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    // An app's text opens at phone width; the badge says it is the standard text until it differs.
    expect(dialog.querySelector('.page-frame')!.classList).toContain('phone');
    expect(dialog.querySelector('.std-badge')!.textContent!.trim()).toBe('Standard text');
    const body = dialog.querySelector('#textBody') as HTMLTextAreaElement;
    body.value = '<p>I agree to the terms.</p>';
    body.dispatchEvent(new Event('input'));
    await settle();
    expect(dialog.querySelector('.std-badge')!.textContent!.trim()).toBe('Differs from the standard');
    button('Desktop', dialog).click();
    await settle();
    expect(dialog.querySelector('.page-frame')!.classList).not.toContain('phone');
    button('CANCEL', dialog).click();
    await settle();
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
