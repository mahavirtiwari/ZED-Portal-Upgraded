import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MailServerInfo, MailServersCard } from './mail-servers';

describe('MailServersCard', () => {
  let fixture: ComponentFixture<MailServersCard>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const info: MailServerInfo = {
    modules: [
      {
        key: 'Default', label: 'Default', help: 'Every other mail.', uses: 'Module',
        saved: { host: 'smtp.office365.com', port: 587, startTls: true, from: 'ZED <zed@zed.test>', userName: 'zed@zed.test', passwordSet: true },
        configured: { host: 'smtp.file.test', port: 25, startTls: false, from: 'file@zed.test', userName: null, passwordSet: false },
      },
      { key: 'Registration', label: 'Registration', help: 'Registration mails.', uses: 'Default', saved: null, configured: null },
      {
        key: 'Payment', label: 'Payment confirmation', help: 'Payments.', uses: 'Module', configured: null,
        saved: { host: 'smtp.pay.test', port: 465, startTls: false, from: 'pay@zed.test', userName: 'pay@zed.test', passwordSet: false },
      },
    ],
    pickupDirectory: null,
    redirectAllTo: 'testers@zed.test',
    allowedRecipientDomains: null,
  };

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MailServersCard],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(MailServersCard);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/settings/email/servers').flush(info);
    await settle();
  });

  afterEach(() => http.verify());

  const row = (key: string) => el.querySelector(`tr[data-module="${key}"]`) as HTMLTableRowElement;
  const text = (e: Element | null) => e!.textContent!.replace(/\s+/g, ' ').trim();
  const button = (scope: Element, label: string) => [...scope.querySelectorAll('button')].find((b) => text(b) === label) as HTMLButtonElement;
  const type = async (selector: string, value: string) => {
    const box = el.querySelector(selector) as HTMLInputElement;
    box.value = value;
    box.dispatchEvent(new Event('input'));
    await settle();
  };

  it('starts collapsed with a summary and opens on its header', async () => {
    const head = el.querySelector('.collapse-head') as HTMLButtonElement;
    expect([text(head.querySelector('.card-title')), text(head.querySelector('small'))]).toEqual(['Mail servers', '3 modules · 2 with their own server']);
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect((el.querySelector('.collapse-body') as HTMLElement).hidden).toBe(true);
    head.click();
    await settle();
    expect(head.getAttribute('aria-expanded')).toBe('true');
    expect((el.querySelector('.collapse-body') as HTMLElement).hidden).toBe(false);
  });

  it('lists every module with the server its mails use, and where mails go on this server', () => {
    const server = row('Default').querySelector('.server')!;
    expect(text(server.querySelector('div'))).toBe('smtp.office365.com:587');
    expect(text(server.querySelector('small'))).toBe('From ZED <zed@zed.test> · sign-in zed@zed.test');
    expect(text(row('Registration').querySelector('.server'))).toContain('smtp.office365.com:587');
    expect(text(row('Registration').querySelector('.uses'))).toBe('Default');
    expect([...row('Payment').querySelectorAll('.uses .status-badge')].map(text)).toEqual(['Own server', 'no password']);
    expect(button(row('Registration'), 'Set')).toBeTruthy();
    expect(button(row('Payment'), 'Use Default')).toBeTruthy();
    expect(text(el.querySelector('.alert-info'))).toContain('every mail goes to testers@zed.test');
  });

  it('sets a module server from what it uses now, without a password unless one is typed', async () => {
    button(row('Registration'), 'Set').click();
    await settle();
    expect((el.querySelector('#smtpHost') as HTMLInputElement).value).toBe('smtp.office365.com');
    expect((el.querySelector('#smtpPassword') as HTMLInputElement).value).toBe('');
    await type('#smtpFrom', 'ZED Registration <reg@zed.test>');
    await type('#smtpPassword', 'Pass#Word1');
    (el.querySelector('form.server-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/settings/email/servers/Registration');
    expect(put.request.body).toEqual({
      host: 'smtp.office365.com', port: 587, startTls: true, from: 'ZED Registration <reg@zed.test>', userName: 'zed@zed.test',
      password: 'Pass#Word1', clearPassword: false,
    });
    put.flush({ message: 'Registration: mail server saved.' });
    await settle();
    http.expectOne('/api/staff/settings/email/servers').flush(info);
    await settle();
    expect(el.querySelector('form.server-form')).toBeNull();
    expect(text(el.querySelector('.alert-success'))).toBe('Registration: mail server saved.');
  });

  const submitServer = async () => {
    (el.querySelector('form.server-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
  };

  it('checks the form before sending and marks the field', async () => {
    button(row('Payment'), 'Edit').click();
    await settle();
    await type('#smtpHost', '');
    await submitServer();
    http.expectNone((r) => r.method === 'PUT');
    expect(text(el.querySelector('form.server-form .alert-danger'))).toBe('Please enter the mail server (host name).');
    expect(el.querySelector('#smtpHost')!.classList).toContain('is-invalid');

    await type('#smtpHost', 'smtp.pay.test');
    await type('#smtpFrom', 'not an address');
    await submitServer();
    expect(text(el.querySelector('form.server-form .alert-danger'))).toContain("'not an address' is not a valid From address");

    await type('#smtpFrom', 'Pay <pay@zed.test>');
    await submitServer();
    // A sign-in name with no saved password needs one.
    expect(text(el.querySelector('form.server-form .alert-danger'))).toContain('Please enter the password');
    http.expectNone((r) => r.method === 'PUT');
  });

  it('shows a refusal of the server inside the form and keeps it open', async () => {
    button(row('Payment'), 'Edit').click();
    await settle();
    await type('#smtpPassword', 'secret');
    await submitServer();
    http.expectOne((r) => r.method === 'PUT').flush({ title: 'The mail server could not be saved.' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(text(el.querySelector('form.server-form .alert-danger'))).toBe('The mail server could not be saved.');
    expect(el.querySelector('form.server-form')).not.toBeNull();
  });

  it('asks for the mailbox address as sign-in name on Microsoft 365, and flags a module that has another name', async () => {
    button(row('Default'), 'Edit').click();
    await settle();
    await type('#smtpUser', 'ZED Staging');
    expect(text(el.querySelector('form.server-form .help-block'))).toBe(
      'This mail service only accepts the full mailbox address as the sign-in name, e.g. zed@zed.test.');
    await submitServer();
    http.expectNone((r) => r.method === 'PUT');
    expect(el.querySelector('#smtpUser')!.classList).toContain('is-invalid');

    const flagged: MailServerInfo = { ...info, modules: info.modules.map((m) => m.key === 'Default' ? { ...m, saved: { ...m.saved!, userName: 'ZED Staging' } } : m) };
    (fixture.componentInstance as unknown as { info: { set(v: MailServerInfo): void } }).info.set(flagged);
    await settle();
    expect([...row('Default').querySelectorAll('.uses .status-badge')].map(text)).toEqual(['Own server', 'check sign-in name']);
    expect(text(row('Registration').querySelector('.uses'))).toContain('check sign-in name');
  });

  it('puts a module back on Default after asking', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    button(row('Payment'), 'Use Default').click();
    await settle();
    expect(confirm).toHaveBeenCalledWith('Remove the mail server of Payment confirmation? Its mails will use Default.');
    http.expectOne((r) => r.method === 'DELETE' && r.url === '/api/staff/settings/email/servers/Payment').flush({ message: 'cleared' });
    await settle();
    http.expectOne('/api/staff/settings/email/servers').flush(info);
    await settle();
    confirm.mockRestore();
  });

  it('refuses a test mail to something that is not one address', async () => {
    await type('#testTo', 'me@zed.test; you@zed.test');
    const send = button(el.querySelector('form.test-mail')!, 'Send test mail');
    expect(send.disabled).toBe(true);
    expect(text(el.querySelector('.help-block'))).toBe('Please enter one valid e-mail address.');
    (el.querySelector('form.test-mail') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    http.expectNone((r) => r.method === 'POST');
  });

  it('sends a test mail of a module and shows the mail server error', async () => {
    const select = el.querySelector('#testModule') as HTMLSelectElement;
    select.value = 'Payment';
    select.dispatchEvent(new Event('change'));
    await type('#testTo', ' me@zed.test ');
    (el.querySelector('form.test-mail') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/settings/email/test');
    expect(post.request.body).toEqual({ to: 'me@zed.test', module: 'Payment' });
    post.flush({ title: 'The test mail could not be sent: 535: Authentication unsuccessful' }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(text(el.querySelector('.alert-danger'))).toBe('The test mail could not be sent: 535: Authentication unsuccessful');
  });
});
