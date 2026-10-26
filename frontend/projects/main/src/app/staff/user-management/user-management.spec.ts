import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { AccountsPage } from './accounts';
import { SubUsersPage } from './sub-users';

describe('User management', () => {
  let fixture: ComponentFixture<unknown>;
  let http: HttpTestingController;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function create<T>(component: Type<T>) {
    await TestBed.configureTestingModule({ imports: [component], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(component);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle();
  }

  const button = (label: string) =>
    [...el.querySelectorAll('button')].find((b) => b.textContent!.replace(/\s+/g, ' ').trim() === label) as HTMLButtonElement;
  const type = (selector: string, value: string) => {
    const input = el.querySelector(selector) as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event(input instanceof HTMLSelectElement ? 'change' : 'input'));
  };
  const submit = () => (el.querySelector('.modal form') as HTMLFormElement).dispatchEvent(new Event('submit'));

  afterEach(() => http.verify());

  describe('AccountsPage (Admin)', () => {
    const list = {
      types: [
        { roleId: 7, label: 'Master Admin', needsState: false },
        { roleId: 6, label: 'MSME DFO', needsState: true },
      ],
      states: [{ code: '9', name: 'UTTAR PRADESH' }],
      accounts: [{ userId: 'DFO9', userName: 'DFO Lucknow', roleId: 6, email: 'dfo@zed.test', mobileNo: '9999999999', stateCode: '9', isActive: true }],
    };

    it('lists the logins and creates an MSME DFO with its state', async () => {
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush(list);
      await settle();
      expect(el.querySelector('tbody')!.textContent).toContain('MSME DFO');
      expect(el.querySelector('tbody')!.textContent).toContain('UTTAR PRADESH');

      button('+ Add Login').click();
      await settle();
      expect(el.querySelector('#acc-state')).toBeNull();
      type('#acc-type', '2: 6');
      await settle();
      type('#acc-id', 'DFOUP02');
      type('#acc-name', 'DFO Agra');
      type('#acc-email', 'agra@zed.test');
      type('#acc-mobile', '9876543210');
      type('#acc-state', '9');
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/accounts');
      expect(post.request.body).toEqual({ userId: 'DFOUP02', roleId: 6, userName: 'DFO Agra', email: 'agra@zed.test', mobileNo: '9876543210', stateCode: '9' });
      post.flush({ message: 'MSME DFO login DFOUP02 created.' });
      await settle();
      http.expectOne('/api/staff/accounts').flush(list);
      await settle();
      expect(el.querySelector('.modal')).toBeNull();
      expect(el.querySelector('.alert-success')!.textContent).toContain('DFOUP02 created');
    });

    it('blocks a login after asking and shows refusals', async () => {
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush(list);
      await settle();
      const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true);
      button('Block').click();
      await settle();
      http.expectNone('/api/staff/accounts/DFO9/block');
      button('Block').click();
      await settle();
      expect(confirm).toHaveBeenLastCalledWith('Block the login DFO9 (DFO Lucknow)? The user can no longer sign in.');
      http.expectOne('/api/staff/accounts/DFO9/block').flush({ title: 'Not allowed.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(el.querySelector('.alert-danger')!.textContent).toContain('Not allowed.');
      confirm.mockRestore();
    });

    it('counts active and blocked logins, filters by status and shows the user with initials', async () => {
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush({
        types: [{ roleId: 7, label: 'Master Admin', needsState: false }],
        states: [],
        accounts: [
          { userId: 'ZEDV4MA01', userName: 'Master Admin', roleId: 7, email: 'ma@zed.test', mobileNo: '9000000001', stateCode: null, isActive: true },
          { userId: 'ZEDV4MA02', userName: null, roleId: 7, email: null, mobileNo: null, stateCode: null, isActive: false },
        ],
      });
      await settle();
      const tiles = () => [...el.querySelectorAll('.acc-stat')].map((t) => `${t.querySelector('.acc-stat-count')!.textContent} ${t.querySelector('.acc-stat-label')!.textContent}`);
      expect(tiles()).toEqual(['2 All logins', '1 Active', '1 Blocked']);
      expect([...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual(['User', 'Login Type', 'Contact', 'Status', 'Actions']);
      expect([...el.querySelectorAll('.acc-avatar')].map((a) => a.textContent!.trim())).toEqual(['MA', 'ZE']);

      (el.querySelectorAll('.acc-stat')[2] as HTMLButtonElement).click();
      await settle();
      expect(el.querySelectorAll('tbody tr').length).toBe(1);
      expect(el.querySelector('tbody .acc-id')!.textContent).toBe('ZEDV4MA02');
      expect(button('UnBlock')).toBeTruthy();

      type('#acc-search', 'nobody');
      await settle();
      expect(el.querySelector('.acc-empty')!.textContent).toContain('No login matches the filters.');
      button('Show all logins').click();
      await settle();
      expect(el.querySelectorAll('tbody tr').length).toBe(2);
    });
  });

  describe('SubUsersPage (owners)', () => {
    const list = {
      accountType: 'Sub-User',
      permissions: [
        { key: 'monitoring', label: 'Monitoring' },
        { key: 'reports', label: 'Reports' },
      ],
      users: [{ userId: 'AG1S01', userName: 'Ravi', email: 'ravi@zed.test', mobileNo: null, permissions: ['reports'], isActive: true, createdAt: '2026-10-24T00:00:00', lastLoginAt: null, locked: false }],
    };

    it('creates a sub-user with the ticked screens', async () => {
      await create(SubUsersPage);
      http.expectOne('/api/staff/sub-users').flush(list);
      await settle();
      expect(el.querySelector('h3')!.textContent).toBe('Sub-Users');
      expect(el.querySelector('tbody')!.textContent).toContain('Reports');

      button('+ Add Sub-User').click();
      await settle();
      type('#sub-name', 'Asha');
      type('#sub-email', 'asha@zed.test');
      (el.querySelector('#perm-monitoring') as HTMLInputElement).click();
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/sub-users');
      expect(post.request.body).toEqual({ userName: 'Asha', email: 'asha@zed.test', mobileNo: '', permissions: ['monitoring'], isActive: true });
      post.flush({ message: 'Sub-User AG1S02 created.' });
      await settle();
      http.expectOne('/api/staff/sub-users').flush(list);
      await settle();
      expect(el.querySelector('.alert-success')!.textContent).toContain('AG1S02');
    });

    it('edits screens and blocks a sub-user', async () => {
      await create(SubUsersPage);
      http.expectOne('/api/staff/sub-users').flush(list);
      await settle();
      button('Edit').click();
      await settle();
      expect((el.querySelector('#perm-reports') as HTMLInputElement).checked).toBe(true);
      (el.querySelector('#perm-reports') as HTMLInputElement).click();
      (el.querySelector('#perm-monitoring') as HTMLInputElement).click();
      (el.querySelector('#sub-active') as HTMLInputElement).click();
      await settle();
      submit();
      await settle();
      const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/sub-users/AG1S01');
      expect(put.request.body).toEqual({ userName: 'Ravi', email: 'ravi@zed.test', mobileNo: '', permissions: ['monitoring'], isActive: false });
      put.flush({ title: 'Please select at least one screen.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please select at least one screen.');
    });
  });
});
