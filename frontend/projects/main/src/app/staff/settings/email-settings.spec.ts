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
    await settle();
  });

  afterEach(() => http.verify());

  const input = (key: string) => el.querySelector(`[id="${key}"]`) as HTMLInputElement;

  it('shows the portal and database addresses with the configured defaults', () => {
    expect([...el.querySelectorAll('h5')].map((h) => h.textContent)).toEqual(['Portal mails', 'Database mails']);
    expect(input('Email.ContactInbox').placeholder).toBe('Configured: zed.support@qcin.org');
    expect(input('Email.ZedTeamInbox').value).toBe('team@zed.test');
    expect(input('Email.DbMailBcc').placeholder).toBe('Not configured');
  });

  it('saves every address and reloads them', async () => {
    const box = input('Email.DbMailBcc');
    box.value = 'monitor@zed.test';
    box.dispatchEvent(new Event('input'));
    await settle();
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/settings/email');
    expect(put.request.body).toEqual({ values: { 'Email.ContactInbox': '', 'Email.ZedTeamInbox': 'team@zed.test', 'Email.DbMailBcc': 'monitor@zed.test' } });
    put.flush({ message: 'Email settings saved.' });
    await settle();
    http.expectOne((r) => r.method === 'GET').flush(items);
    await settle();
    expect(el.querySelector('.alert-success')!.textContent).toContain('Email settings saved.');
  });

  it('shows refusals', async () => {
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
    http.expectOne((r) => r.method === 'PUT').flush({ title: "Contact ZED queries: 'x' is not a valid e-mail address." }, { status: 400, statusText: 'Bad Request' });
    await settle();
    expect(el.querySelector('.alert-danger')!.textContent).toContain('is not a valid e-mail address');
  });
});
