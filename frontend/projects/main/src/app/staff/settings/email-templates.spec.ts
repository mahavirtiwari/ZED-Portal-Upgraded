import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailTemplateItem, EmailTemplatesPage, fillSampleFields, insertAtCursor, portalBaseUrl } from './email-templates';

describe('email template preview helpers', () => {
  it("takes the portal's address with its base href, without the trailing slash", () => {
    expect(portalBaseUrl({ baseURI: 'https://loginzed.msme.gov.in/Consultancy/' } as Document)).toBe('https://loginzed.msme.gov.in/Consultancy');
    expect(portalBaseUrl({ baseURI: 'https://loginzed.msme.gov.in/' } as Document)).toBe('https://loginzed.msme.gov.in');
  });

  it('fills the fields with sample values', () => {
    expect(fillSampleFields('<a href="{{ publicBaseUrl }}/msme/login">{{Name}}</a>{{StandardBody}}', 'https://zed.example/C', { StandardBody: '<i>standard</i>' }))
      .toBe('<a href="https://zed.example/C/msme/login">[Name]</a><i>standard</i>');
  });

  it('puts a snippet in place of the selection, or at the end without a cursor', () => {
    const box = document.createElement('textarea');
    box.value = 'Dear X, hello';
    box.setSelectionRange(5, 6);
    expect(insertAtCursor('Dear X, hello', '{{Name}}', box)).toEqual({ value: 'Dear {{Name}}, hello', caret: 13 });
    expect(insertAtCursor('Dear X, hello', '{{Name}}', null)).toEqual({ value: 'Dear X, hello{{Name}}', caret: 21 });
  });
});

describe('EmailTemplatesPage', () => {
  let fixture: ComponentFixture<EmailTemplatesPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/email-templates';

  const item = (key: string, name: string, database: boolean, more: Partial<EmailTemplateItem> = {}): EmailTemplateItem => ({
    key, name, group: database ? 'Database mails' : 'MSME and general', database, enabled: true, customised: false, subject: null,
    placeholders: database ? ['StandardSubject', 'StandardBody'] : ['Name', 'Query', 'StandardSubject', 'StandardBody'],
    updatedBy: null, updatedOn: null, ...more,
  });
  const items = [
    item('ContactQueryEmail', 'Contact Query', false, { enabled: false, customised: true, updatedBy: 'ADMIN1', updatedOn: '2026-10-01T10:00:00' }),
    item('PaymentConfirmationEmail', 'Payment Confirmation', false),
    item('db:SP_SEND_MAIL_AUTO_ALLOT_AGENCY', 'Send mail auto allot agency', true, { subject: 'ZED: {{StandardSubject}}', customised: true }),
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
    await TestBed.configureTestingModule({
      imports: [EmailTemplatesPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(EmailTemplatesPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush(items);
    await settle();
  });

  afterEach(() => http.verify());

  it('lists the portal mails and the database mails on their tabs', async () => {
    expect([...el.querySelectorAll('[role=tab]')].map((t) => t.textContent!.trim())).toEqual(['Portal mails (2)', 'Database mails (1)']);
    expect(rows()[0]).toContain('Contact Query');
    expect(rows()[0]).toContain('Switched off');
    expect(rows()[0]).toContain('ADMIN1');
    expect(rows()[1]).toContain('Sent');
    expect(button('Reset')).toBeTruthy();

    (el.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    await settle();
    expect(rows().length).toBe(1);
    expect(rows()[0]).toContain('Subject: ZED: {{StandardSubject}}');
  });

  it('searches the mails', async () => {
    const box = el.querySelector('input[aria-label="Search e-mails"]') as HTMLInputElement;
    box.value = 'payment';
    box.dispatchEvent(new Event('input'));
    await settle();
    expect(rows().length).toBe(1);
    expect(rows()[0]).toContain('Payment Confirmation');
  });

  it('edits a mail with its fields and saves it', async () => {
    button('Edit').click();
    await settle();
    http.expectOne(`${url}/ContactQueryEmail`).flush({ item: items[0], bodyHtml: '<b>Name:</b> {{Name}}', standardBody: true });
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.textContent).toContain('This e-mail is switched off');
    expect([...dialog.querySelectorAll('.chip')].map((c) => c.textContent!.trim())).toEqual(['{{Name}}', '{{Query}}', '{{StandardSubject}}', '{{StandardBody}}']);
    expect(dialog.querySelector('iframe')!.getAttribute('sandbox')).toBe('');

    (dialog.querySelector('#templateEnabled') as HTMLInputElement).click();
    const subject = dialog.querySelector('#templateSubject') as HTMLInputElement;
    subject.value = 'Query: ';
    subject.dispatchEvent(new Event('input'));
    subject.dispatchEvent(new Event('focus'));
    await settle();
    button('{{Name}}', dialog).click();
    await settle();
    button('SAVE', dialog).click();
    await settle();

    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/ContactQueryEmail`);
    expect(put.request.body).toEqual({ enabled: true, subject: 'Query: {{Name}}', bodyHtml: '<b>Name:</b> {{Name}}' });
    put.flush({ message: 'E-mail template saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === url).flush(items);
    await settle();
    expect(el.querySelector('[role=dialog]')).toBeNull();
    expect(el.querySelector('.alert-success')!.textContent).toContain('E-mail template saved.');
  });

  it('puts a field at the cursor of the text and shows the preview with sample values', async () => {
    button('Edit').click();
    await settle();
    const standard = '<img src="{{PublicBaseUrl}}/Images/header/zed-logo.png" alt="ZED Logo"><p>Dear , thank you.</p>';
    http.expectOne(`${url}/ContactQueryEmail`).flush({ item: items[0], bodyHtml: standard, standardBody: true });
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    const frame = () => dialog.querySelector('iframe')!.getAttribute('srcdoc')!;
    const base = document.baseURI.replace(/\/+$/, '');
    expect(frame()).toContain(`<img src="${base}/Images/header/zed-logo.png" alt="ZED Logo">`);
    expect(frame()).not.toContain('{{');

    const body = dialog.querySelector('#templateBody') as HTMLTextAreaElement;
    expect(body.value).toBe(standard);
    body.dispatchEvent(new Event('focus'));
    const at = body.value.indexOf(', thank');
    body.setSelectionRange(at, at);
    button('{{Name}}', dialog).click();
    await settle();
    expect(body.value).toContain('<p>Dear {{Name}}, thank you.</p>');
    expect(body.selectionStart).toBe(at + '{{Name}}'.length);
    expect(frame()).toContain('<p>Dear [Name], thank you.</p>');

    button('SAVE', dialog).click();
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/ContactQueryEmail`);
    // What is saved keeps the fields; only the preview fills them.
    expect(put.request.body.bodyHtml).toBe('<img src="{{PublicBaseUrl}}/Images/header/zed-logo.png" alt="ZED Logo"><p>Dear {{Name}}, thank you.</p>');
    put.flush({ message: 'E-mail template saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === url).flush(items);
    await settle();
  });

  it('shows the counts, filters by status and previews the subject at desktop or phone width', async () => {
    // Portal mails: 2, 1 sent, 1 switched off, 1 changed.
    expect([...el.querySelectorAll('.stat-value')].map((v) => v.textContent!.trim())).toEqual(['2', '1', '1', '1']);
    button('Switched off').click();
    await settle();
    expect(rows().length).toBe(1);
    expect(rows()[0]).toContain('Contact Query');
    button('All').click();
    await settle();
    expect(rows().length).toBe(2);

    button('Edit').click();
    await settle();
    http.expectOne(`${url}/ContactQueryEmail`).flush({ item: items[0], bodyHtml: '<p>Hello</p>', standardBody: true });
    await settle();
    const dialog = el.querySelector('[role=dialog]')!;
    expect(dialog.querySelector('.meta-subject')!.textContent).toContain("The standard e-mail's subject");
    const subject = dialog.querySelector('#templateSubject') as HTMLInputElement;
    subject.value = 'Query from {{Name}}: {{StandardSubject}}';
    subject.dispatchEvent(new Event('input'));
    await settle();
    expect(dialog.querySelector('.meta-subject')!.textContent).toBe('Query from [Name]: [the standard subject]');
    expect(dialog.querySelector('.mail-frame')!.classList).not.toContain('phone');
    button('Phone', dialog).click();
    await settle();
    expect(dialog.querySelector('.mail-frame')!.classList).toContain('phone');
    button('CANCEL', dialog).click();
    await settle();
  });

  it('keeps the dialog open with the refusal', async () => {
    button('Edit').click();
    await settle();
    http.expectOne(`${url}/ContactQueryEmail`).flush({ item: items[0], bodyHtml: '{{Nme}}', standardBody: false });
    await settle();
    button('SAVE', el.querySelector('[role=dialog]')!).click();
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ title: '{{Nme}} is not a field of this e-mail.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('[role=dialog] .alert-danger')!.textContent).toContain('is not a field of this e-mail');
  });

  it('resets a changed mail after confirming', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    button('Reset').click();
    await settle();
    http.expectOne((r) => r.method === 'DELETE' && r.url === `${url}/ContactQueryEmail`).flush({ message: 'The standard e-mail is used again.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush(items);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('The standard e-mail is used again.');
  });
});
