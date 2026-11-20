import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ConfirmService } from '../confirm-dialog';
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

  it('keeps the incentive mails on a tab of their own', async () => {
    fixture.destroy();
    fixture = TestBed.createComponent(EmailTemplatesPage);
    el = fixture.nativeElement;
    await settle();
    http.expectOne(url).flush([...items, item('MsmeSchemeVisitDueEmail', 'Scheme: onsite visit due (to the unit)', false, { group: 'Incentives' })]);
    await settle();
    expect([...el.querySelectorAll('[role=tab]')].map((t) => t.textContent!.trim())).toEqual(['Portal mails (2)', 'Incentive mails (1)', 'Database mails (1)']);
    expect(rows().some((r) => r.includes('onsite visit due'))).toBe(false);
    (el.querySelectorAll('[role=tab]')[1] as HTMLElement).click();
    await settle();
    expect(rows().length).toBe(1);
    expect(rows()[0]).toContain('Scheme: onsite visit due (to the unit)');
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
    expect(dialog.textContent).toContain('Switched off (not sent)');
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
    button('Save', dialog).click();
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

    button('Save', dialog).click();
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
    button('Cancel', dialog).click();
    await settle();
  });

  it('keeps the dialog open with the refusal', async () => {
    button('Edit').click();
    await settle();
    http.expectOne(`${url}/ContactQueryEmail`).flush({ item: items[0], bodyHtml: '{{Nme}}', standardBody: false });
    await settle();
    button('Save', el.querySelector('[role=dialog]')!).click();
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ title: '{{Nme}} is not a field of this e-mail.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('[role=dialog] .alert-danger')!.textContent).toContain('is not a field of this e-mail');
  });

  it('shows the last change (saved in UTC) in Indian time', () => {
    expect(el.querySelector('tbody')!.textContent).toContain('01-10-2026 15:30');
  });

  it('resets a changed mail after confirming', async () => {
    const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
    button('Reset').click();
    await settle();
    expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset to the Standard E-mail?', danger: true }));
    http.expectOne((r) => r.method === 'DELETE' && r.url === `${url}/ContactQueryEmail`).flush({ message: 'The standard e-mail is used again.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush(items);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('The standard e-mail is used again.');
  });

  it("switches a mail off from the list after confirming, keeping its subject and text", async () => {
    const confirm = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(false);
    const sw = () => el.querySelector('[aria-label="Switch off Payment Confirmation"]') as HTMLInputElement;
    sw().click();
    await settle();
    expect(confirm).toHaveBeenCalled();   // refused: nothing is asked of the server
    confirm.mockResolvedValue(true);
    sw().click();
    await settle();
    http.expectOne(`${url}/PaymentConfirmationEmail`).flush({
      item: { ...items[1], subject: 'Paid: {{Name}}' }, bodyHtml: '<p>Own text</p>', standardBody: false,
    });
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === `${url}/PaymentConfirmationEmail`);
    expect(put.request.body).toEqual({ enabled: false, subject: 'Paid: {{Name}}', bodyHtml: '<p>Own text</p>' });
    put.flush({ message: 'Saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === url).flush(items);
    await settle();

    // Switching on asks nothing; a standard text is sent as none.
    confirm.mockClear();
    (el.querySelector('[aria-label="Switch on Contact Query"]') as HTMLInputElement).click();
    await settle();
    expect(confirm).not.toHaveBeenCalled();
    http.expectOne(`${url}/ContactQueryEmail`).flush({ item: items[0], bodyHtml: '<p>Standard</p>', standardBody: true });
    await settle();
    expect(http.expectOne((r) => r.method === 'PUT').request.body).toEqual({ enabled: true, subject: null, bodyHtml: null });
  });
});
