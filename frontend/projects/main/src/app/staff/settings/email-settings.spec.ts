import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { EmailSettingsPage } from './email-settings';

describe('EmailSettingsPage', () => {
  let fixture: ComponentFixture<EmailSettingsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;

  const items = [
    { key: 'Email.ContactInbox', label: 'Contact ZED queries', help: 'Contact page.', database: false, value: null, default: 'zed.support@qcin.org' },
    { key: 'Email.ZedTeamInbox', label: 'ZED team: allotment rejections', help: 'Rejections.', database: false, value: 'team@zed.test', default: 'zed@qcin.org' },
    { key: 'Email.DbMailBcc', label: 'Copy of every database mail', help: 'Procedures.', database: true, value: null, default: null },
  ];

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [EmailSettingsPage],
      providers: [provideHttpClient(), provideHttpClientTesting()],
    }).compileComponents();
    fixture = TestBed.createComponent(EmailSettingsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
    http.expectOne('/api/staff/settings/email').flush(items);
    http.expectOne('/api/staff/settings/email/servers').flush({ modules: [], pickupDirectory: null, redirectAllTo: null, allowedRecipientDomains: null });
    await settle();
  });

  afterEach(() => http.verify());

  const input = (key: string) => el.querySelector(`[id="${key}"]`) as HTMLInputElement;
  const addresses = () => el.querySelector('form.addresses') as HTMLFormElement;

  it('shows the mail servers, then the portal and database addresses with the configured defaults', () => {
    expect([...el.querySelectorAll('.card-title')].map((h) => h.textContent)).toEqual(['Mail servers']);
    expect([...el.querySelectorAll('.group-title')].map((h) => h.firstChild!.textContent!.trim())).toEqual(['Portal mails', 'Database mails']);
    expect(input('Email.ContactInbox').placeholder).toBe('Configured: zed.support@qcin.org');
    expect(input('Email.ZedTeamInbox').value).toBe('team@zed.test');
    expect(input('Email.DbMailBcc').placeholder).toBe('Not configured');
  });

  it('shows how many are set and where the mails of each mailbox go now', async () => {
    expect([...el.querySelectorAll('.group-count')].map((c) => c.textContent!.trim())).toEqual(['1 of 2 set here', '0 of 1 set here']);
    const count = () => el.querySelector('.mb-count')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(count()).toBe('1 of 3 set here 1 with no address');
    const usesOf = (key: string) => input(key).closest('.mb-field')!.querySelector('.mb-uses')!.textContent!.replace(/\s+/g, ' ').trim();
    expect(usesOf('Email.ContactInbox')).toBe('Uses the configured zed.support@qcin.org');
    expect(usesOf('Email.ZedTeamInbox')).toBe('Set here: team@zed.test Use configured');
    expect(usesOf('Email.DbMailBcc')).toBe('No address: nothing is sent to this mailbox');

    // Back to the configured address in one click.
    (input('Email.ZedTeamInbox').closest('.mb-field')!.querySelector('.use-configured') as HTMLButtonElement).click();
    await settle();
    expect(input('Email.ZedTeamInbox').value).toBe('');
    expect(usesOf('Email.ZedTeamInbox')).toBe('Uses the configured zed@qcin.org');
    expect(addresses().textContent).toContain('Unsaved changes');

    const box = input('Email.DbMailBcc');
    box.value = 'a@zed.test; b@zed.test';
    box.dispatchEvent(new Event('input'));
    await settle();
    expect(usesOf('Email.DbMailBcc')).toBe('Set here: a@zed.test, b@zed.test');
    expect(count()).toBe('1 of 3 set here');
  });

  it('saves every address and reloads them', async () => {
    const box = input('Email.DbMailBcc');
    box.value = 'monitor@zed.test';
    box.dispatchEvent(new Event('input'));
    await settle();
    addresses().dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/settings/email');
    expect(put.request.body).toEqual({ values: { 'Email.ContactInbox': '', 'Email.ZedTeamInbox': 'team@zed.test', 'Email.DbMailBcc': 'monitor@zed.test' } });
    put.flush({ message: 'Email settings saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET' && r.url === '/api/staff/settings/email').flush(items);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Email settings saved.');
  });

  it('shows refusals next to the Save button', async () => {
    const box = input('Email.ContactInbox');
    box.value = 'office@zed.test';
    box.dispatchEvent(new Event('input'));
    await settle();
    addresses().dispatchEvent(new Event('submit'));
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ title: "Contact ZED queries: 'x' is not a valid e-mail address." }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(addresses().querySelector('.alert-danger')!.textContent).toContain('is not a valid e-mail address');
  });

  it('offers Save only after a change', async () => {
    const save = () => addresses().querySelector('button[type=submit]') as HTMLButtonElement;
    expect(save().disabled).toBe(true);
    const box = input('Email.ContactInbox');
    box.value = 'office@zed.test';
    box.dispatchEvent(new Event('input'));
    await settle();
    expect(save().disabled).toBe(false);
    expect(addresses().textContent).toContain('Unsaved changes');
  });

  it('checks the addresses before saving, marks the box and opens its card', async () => {
    const box = input('Email.DbMailBcc');
    box.value = 'ok@zed.test; not-an-address';
    box.dispatchEvent(new Event('input'));
    await settle();
    addresses().dispatchEvent(new Event('submit'));
    await settle();
    http.expectNone((r) => r.method === 'PUT');
    expect(box.classList).toContain('is-invalid');
    expect(addresses().textContent).toContain("'not-an-address' is not a valid e-mail address.");
    expect(addresses().querySelector('.alert-danger')!.textContent).toContain('Please correct Copy of every database mail.');
  });
});
