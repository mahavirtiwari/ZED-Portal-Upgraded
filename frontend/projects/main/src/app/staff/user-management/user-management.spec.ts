import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Type } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { ToastService } from '../toast';
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

  async function create<T>(component: Type<T>, mode?: string) {
    await TestBed.configureTestingModule({ imports: [component], providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])] }).compileComponents();
    // The NEFT Admins page: the route's data mode 'neft'.
    if (mode) Object.assign(TestBed.inject(ActivatedRoute).snapshot.data, { mode });
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
  const toasts = () => TestBed.inject(ToastService).toasts().map((t) => `${t.title}: ${t.message ?? ''}`);
  /** Opens a row's menu (the three dots) and picks the item with this text. */
  const pickMenu = async (row: Element, item: string) => {
    (row.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
    await settle();
    const found = [...el.querySelectorAll<HTMLButtonElement>('.rm-item')].find((b) => b.textContent!.trim() === item);
    expect(found, `menu item ${item}`).toBeTruthy();
    found!.click();
    await settle();
  };
  const menuItems = async (row: Element) => {
    (row.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
    await settle();
    const items = [...el.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim());
    (row.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
    await settle();
    return items;
  };
  const confirmDialog = () => el.querySelector('zed-confirm-dialog') as HTMLElement | null;
  const confirm = async (reason?: string) => {
    if (reason !== undefined) {
      const box = confirmDialog()!.querySelector('textarea') as HTMLTextAreaElement;
      box.value = reason;
      box.dispatchEvent(new Event('input'));
      await settle();
    }
    (confirmDialog()!.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle();
  };

  afterEach(() => http.verify());

  describe('AccountsPage (Admin)', () => {
    const list = {
      types: [
        { roleId: 7, label: 'Master Admin', needsState: false },
        { roleId: 6, label: 'MSME DFO', needsState: false, hasScope: true, hasStateScope: true, hasLevels: false, hasDistricts: true, hasNeftLists: true },
      ],
      states: [{ code: '9', name: 'UTTAR PRADESH' }],
      accounts: [{ userId: 'DFO9', userName: 'DFO Lucknow', roleId: 6, email: 'dfo@zed.test', mobileNo: '9999999999', stateCode: '9', isActive: true }],
    };

    it('lists the logins and creates an MSME DFO with its states, districts and NEFT lists (2026-11-07)', async () => {
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush(list);
      await settle();
      expect(el.querySelector('tbody')!.textContent).toContain('MSME DFO');
      expect(el.querySelector('tbody')!.textContent).toContain('UTTAR PRADESH');

      button('+ Add Login').click();
      await settle();
      expect(el.querySelector('#acc-state')).toBeNull();
      expect([...el.querySelectorAll('.modal .choice-card')].map((c) => c.querySelector('strong')!.textContent)).toEqual(['Master Admin', 'MSME DFO']);
      expect(el.querySelector('label[for="acc-type-6"]')!.textContent).toContain('Financial Assistance and Handholding NEFT of its states and districts.');
      (el.querySelector('#acc-type-6') as HTMLInputElement).click();
      await settle();
      expect(el.querySelector('label[for="acc-type-6"]')!.classList).toContain('active');
      // Category, states, districts and both NEFT lists; no certification levels.
      expect(el.querySelector('input[name="acc-level-Bronze"]')).toBeNull();
      expect((el.querySelector('input[name="acc-list-main"]') as HTMLInputElement).checked).toBe(true);
      expect((el.querySelector('input[name="acc-list-consultancy"]') as HTMLInputElement).checked).toBe(true);
      expect(el.querySelector('.acc-scope-districts')).toBeNull();
      type('#acc-id', 'DFOUP02');
      type('#acc-name', 'DFO Agra');
      type('#acc-email', 'agra@zed.test');
      type('#acc-mobile', '9876543210');
      // No state yet: refused before any call.
      submit();
      await settle();
      expect(el.querySelector('.modal')!.textContent).toContain("Please choose the MSME DFO's states.");
      const up = [...el.querySelectorAll('.acc-scope-states label')].find((l) => l.textContent!.trim() === 'UTTAR PRADESH')!;
      (up.querySelector('input') as HTMLInputElement).click();
      await settle();
      http.expectOne((r) => r.url === '/api/staff/accounts/districts' && r.params.get('states') === '9').flush([
        { stateCode: '9', stateName: 'UTTAR PRADESH', districts: [{ code: '162', name: 'LUCKNOW' }, { code: '164', name: 'KANPUR NAGAR' }] },
      ]);
      await settle();
      const agra = [...el.querySelectorAll('.acc-scope-districts label')].find((l) => l.textContent!.trim() === 'LUCKNOW')!;
      (agra.querySelector('input') as HTMLInputElement).click();
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/accounts');
      expect(post.request.body).toMatchObject({
        userId: 'DFOUP02', roleId: 6, userName: 'DFO Agra', email: 'agra@zed.test', mobileNo: '9876543210', stateCode: null,
        sectorActivity: 'Both', states: ['9'], districts: ['162'], neftLists: ['main', 'consultancy'],
      });
      post.flush({ message: 'MSME DFO login DFOUP02 created.' });
      await settle();
      http.expectOne('/api/staff/accounts').flush(list);
      await settle();
      expect(el.querySelector('.modal')).toBeNull();
      expect(el.querySelector('.alert-success')).toBeNull();
      expect(toasts()).toContain('Login added: MSME DFO login DFOUP02 created.');
    });

    it('gives a Master Admin its category, levels and states, and lists them under the login (2026-11-07)', async () => {
      const scoped = {
        ...list,
        types: [{ roleId: 7, label: 'Master Admin', needsState: false, hasScope: true, hasStateScope: true }, { roleId: 8, label: 'Ministry', needsState: false, hasScope: true }],
        states: [{ code: '9', name: 'UTTAR PRADESH' }, { code: '7', name: 'DELHI' }],
        levels: [{ code: 'Bronze', name: 'Bronze' }, { code: 'Silver', name: 'Silver' }, { code: 'Gold', name: 'Gold' }, { code: 'ZEDX', name: 'ZED-X' }],
        accounts: [{ userId: 'MASTER2', userName: 'Master North', roleId: 7, email: 'm@zed.test', mobileNo: '9999999999', stateCode: null, isActive: true,
          sectorActivity: 'Manufacturing', levels: ['Bronze', 'Silver'], states: ['9', '7'] }],
      };
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush(scoped);
      await settle();
      expect(el.querySelector('.acc-scope')!.textContent).toBe('Manufacturing · Bronze, Silver · 2 states');

      button('+ Add Login').click();
      await settle();
      (el.querySelector('#acc-type-8') as HTMLInputElement).click();
      await settle();
      // Ministry: category and levels, no states.
      expect(el.querySelector('.acc-scope-box')).not.toBeNull();
      expect(el.querySelector('.acc-scope-states')).toBeNull();
      (el.querySelector('#acc-type-7') as HTMLInputElement).click();
      await settle();
      expect(el.querySelector('.acc-scope-states zed-multi-select')).not.toBeNull();
      [...el.querySelectorAll('.acc-seg-btn')].find((b) => b.textContent!.trim() === 'Services')!.dispatchEvent(new Event('click'));
      (el.querySelector('input[name="acc-level-Bronze"]') as HTMLInputElement).click();
      (el.querySelector('input[name="acc-level-Silver"]') as HTMLInputElement).click();
      await settle();
      const delhi = [...el.querySelectorAll('.acc-scope-states label')].find((l) => l.textContent!.trim() === 'DELHI')!;
      (delhi.querySelector('input') as HTMLInputElement).click();
      type('#acc-id', 'MASTER07');
      type('#acc-name', 'Master Services');
      type('#acc-email', 's@zed.test');
      type('#acc-mobile', '9876543210');
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/accounts');
      expect(post.request.body).toEqual({
        userId: 'MASTER07', roleId: 7, userName: 'Master Services', email: 's@zed.test', mobileNo: '9876543210', stateCode: null,
        sectorActivity: 'Services', levels: ['Gold', 'ZEDX'], states: ['7'],
      });
      post.flush({ message: 'Master Admin login MASTER07 created.' });
      await settle();
      http.expectOne('/api/staff/accounts').flush(scoped);
      await settle();
    });

    it('creates one Dashboard Admin with the screens ticked per portal (2026-11-07)', async () => {
      const dash = {
        ...list,
        types: [{ roleId: 10, label: 'Dashboard Admin', needsState: false, hasScope: true, hasStateScope: true, hasScreens: true }],
        states: [{ code: '9', name: 'UTTAR PRADESH' }],
        levels: [{ code: 'Bronze', name: 'Bronze' }],
        screens: [
          { portal: 'main', portalName: 'ZED Certification', key: 'dash-registered', label: 'ZED Dashboard', group: 'Dashboard tabs', hint: null },
          { portal: 'main', portalName: 'ZED Certification', key: 'reports', label: 'Reports', group: 'Modules', hint: null },
          { portal: 'main', portalName: 'ZED Certification', key: 'hide-names', label: 'Hide agency and assessor names', group: 'Privacy', hint: null },
          { portal: 'consultancy', portalName: 'Handholding', key: 'history', label: 'MSME / Customer History', group: 'Modules', hint: null },
        ],
        accounts: [],
      };
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush(dash);
      await settle();
      button('+ Add Login').click();
      await settle();
      // The only login type: chosen already; the screens by portal, every screen ticked but the privacy option.
      expect([...el.querySelectorAll('.acc-portal-name')].map((h) => h.textContent)).toEqual(['ZED Certification', 'Handholding']);
      expect([...el.querySelectorAll('.acc-screen.on')].length).toBe(3);
      (el.querySelector('input[name="acc-screen-main-reports"]') as HTMLInputElement).click();
      (el.querySelector('input[name="acc-screen-main-hide-names"]') as HTMLInputElement).click();
      type('#acc-id', 'DASH01');
      type('#acc-name', 'Dashboard Desk');
      type('#acc-email', 'd@zed.test');
      type('#acc-mobile', '9876543210');
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/accounts');
      expect(post.request.body.roleId).toBe(10);
      expect(post.request.body.screens).toEqual(['main:dash-registered', 'consultancy:history', 'main:hide-names']);
      post.flush({ message: 'Dashboard Admin login DASH01 created.' });
      await settle();
      http.expectOne('/api/staff/accounts').flush(dash);
      await settle();
    });

    it('blocks a login with a reason and shows refusals in the pop-up (2026-11-16)', async () => {
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush(list);
      await settle();
      button('Block').click();
      await settle();
      expect(el.querySelector('zed-reason-dialog h3')!.textContent).toContain('Block DFO Lucknow');
      (el.querySelector('zed-reason-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle();
      http.expectNone('/api/staff/accounts/DFO9/block');
      const box = el.querySelector('#reason-dialog-text') as HTMLTextAreaElement;
      box.value = 'Transferred';
      box.dispatchEvent(new Event('input'));
      await settle();
      (el.querySelector('zed-reason-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle();
      const req = http.expectOne('/api/staff/accounts/DFO9/block');
      expect(req.request.body).toEqual({ reason: 'Transferred' });
      req.flush({ title: 'Not allowed.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(el.querySelector('zed-reason-dialog')!.textContent).toContain('Not allowed.');
    });

    it('filters by login type with the tabs, starts Add with that type and keeps the type of a saved login', async () => {
      await create(AccountsPage);
      http.expectOne('/api/staff/accounts').flush({
        ...list,
        accounts: [
          ...list.accounts,
          { userId: 'ZEDV4MA01', userName: 'Master Admin', roleId: 7, email: 'ma@zed.test', mobileNo: null, stateCode: null, isActive: false },
        ],
      });
      await settle();
      const tabs = () => [...el.querySelectorAll('.acc-tab')] as HTMLButtonElement[];
      expect(tabs().map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['All login types 2', 'Master Admin 1', 'MSME DFO 1']);
      expect(tabs()[0].getAttribute('aria-selected')).toBe('true');

      tabs()[2].click();
      await settle();
      expect(tabs()[2].classList).toContain('active');
      expect(el.querySelectorAll('tbody tr').length).toBe(1);
      expect(el.querySelector('tbody .acc-id')!.textContent).toBe('DFO9');
      expect(el.querySelector('.acc-state')!.textContent).toBe('UTTAR PRADESH');
      expect(el.querySelector('.acc-showing')!.textContent).toContain('1 of 2 logins');
      expect([...el.querySelectorAll('zed-list-counts .lc-item b')].map((c) => c.textContent)).toEqual(['1', '1', '0']);

      button('+ Add Login').click();
      await settle();
      expect((el.querySelector('#acc-type-6') as HTMLInputElement).checked).toBe(true);
      // An MSME DFO has states (several), not one state.
      expect(el.querySelector('#acc-state')).toBeNull();
      expect(el.querySelector('.acc-scope-states zed-multi-select')).not.toBeNull();
      button('Cancel').click();
      await settle();

      button('Edit').click();
      await settle();
      expect(el.querySelector('.modal .choice-card')).toBeNull();
      expect(el.querySelector('.acc-type-fixed')!.textContent).toContain('MSME DFO');
      expect(el.querySelector('.acc-scope-states zed-multi-select')).not.toBeNull();
      button('Cancel').click();
      await settle();

      tabs()[0].click();
      await settle();
      expect(el.querySelectorAll('tbody tr').length).toBe(2);
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
      const tiles = () => [...el.querySelectorAll('zed-list-counts .lc-item')].map((t) => `${t.querySelector('b')!.textContent} ${t.querySelector('.lc-label')!.textContent!.trim()}`);
      expect(tiles()).toEqual(['2 All logins', '1 Active', '1 Blocked']);
      expect([...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual(['User', 'Login Type', 'Contact', 'Status', 'Actions']);
      expect([...el.querySelectorAll('.acc-avatar')].map((a) => a.textContent!.trim())).toEqual(['MA', 'ZE']);

      (el.querySelectorAll('zed-list-counts .lc-btn')[2] as HTMLButtonElement).click();
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

  describe('AccountsPage (NEFT Admins, 2026-11-17 redesign)', () => {
    const types = [{ roleId: 6, label: 'NEFT Admin', needsState: false }];
    const neftList = {
      types,
      states: [],
      accounts: [
        { userId: 'NEFT01', userName: 'Neft Desk', roleId: 6, email: 'neft.desk@zed.test', mobileNo: '9876543210', stateCode: 'ALL', isActive: true },
        { userId: 'NEFT00', userName: 'Old Desk', roleId: 6, email: 'old@zed.test', mobileNo: null, stateCode: 'ALL', isActive: false },
      ],
    };

    it('shows the empty state with three steps and adds the first NEFT admin in the short pop-up', async () => {
      await create(AccountsPage, 'neft');
      http.expectOne('/api/staff/neft-admins').flush({ types, states: [], accounts: [] });
      await settle();
      expect(el.querySelector('.ph-title')!.textContent).toBe('NEFT Admins');
      expect(el.querySelector('.ph-crumb [aria-current]')!.textContent).toBe('NEFT Admins');
      expect([...el.querySelectorAll('zed-list-counts .lc-item')].map((t) => t.textContent!.replace(/\s+/g, ' ').trim())).toEqual(['0 All logins', '0 Active', '0 Blocked']);
      expect(el.querySelector('.nf-empty h4')!.textContent).toBe('No NEFT desk logins yet');
      expect([...el.querySelectorAll('.nf-steps b')].map((b) => b.textContent)).toEqual(['1 Add the login', '2 Login details are e-mailed', '3 One desk for every state']);
      expect(el.querySelector('table')).toBeNull();
      // Not the Admin's page: no portal switch, no login type tabs.
      expect(el.querySelector('zed-portal-switch')).toBeNull();
      expect(el.querySelector('.acc-tabs')).toBeNull();

      button('+ Add the first login').click();
      await settle();
      expect(el.querySelector('#account-title')!.textContent).toBe('Add NEFT admin');
      expect((el.querySelector('#nf-type') as HTMLSelectElement).disabled).toBe(true);
      expect(el.querySelector('#nf-type')!.textContent!.trim()).toBe('NEFT Admin');
      expect(el.querySelector('.nf-note')!.textContent).toContain('The login details are e-mailed to this address');
      expect(el.querySelector('.modal .choice-card')).toBeNull();
      type('#acc-id', 'NEFT02');
      type('#acc-name', 'Neft Two');
      type('#acc-email', 'two@zed.test');
      type('#acc-mobile', '9876543211');
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/neft-admins');
      expect(post.request.body).toEqual({ userId: 'NEFT02', roleId: 6, userName: 'Neft Two', email: 'two@zed.test', mobileNo: '9876543211', stateCode: null });
      post.flush({ message: 'NEFT Admin login NEFT02 created. The login details have been sent to two@zed.test.' });
      await settle();
      http.expectOne('/api/staff/neft-admins').flush(neftList);
      await settle();
      expect(el.querySelector('.modal')).toBeNull();
      expect(toasts()[0]).toContain('Login added: NEFT Admin login NEFT02 created.');
      expect(el.querySelector('.nf-empty')).toBeNull();
      expect(el.querySelectorAll('tbody tr').length).toBe(2);
    });

    it('shows the contact in full, keeps Edit on the row and sends a new password from the row menu after a confirmation', async () => {
      await create(AccountsPage, 'neft');
      http.expectOne('/api/staff/neft-admins').flush(neftList);
      await settle();
      expect([...el.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual(['User', 'Contact', 'Status', 'Actions']);
      const row = el.querySelectorAll('tbody tr')[0];
      // 2026-11-18 (the user): never masked.
      expect(row.querySelector('.acc-mobile')!.textContent).toBe('9876543210');
      expect(row.querySelector('.acc-mail')!.textContent).toBe('neft.desk@zed.test');
      expect(row.querySelector('.acc-mail')!.getAttribute('title')).toBe('neft.desk@zed.test');
      expect([...row.querySelectorAll('.acc-actions-cell button.btn')].map((b) => b.textContent!.trim())).toEqual(['Edit']);
      expect(await menuItems(row)).toEqual(['Send new password', 'Block login']);
      expect(await menuItems(el.querySelectorAll('tbody tr')[1])).toEqual(['Unblock login']);

      await pickMenu(row, 'Send new password');
      expect(confirmDialog()!.querySelector('h3')!.textContent).toBe('Send a new password?');
      expect(confirmDialog()!.textContent).toContain('Neft Desk (NEFT01) gets a new password by e-mail at neft.desk@zed.test.');
      await confirm();
      const req = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/neft-admins/NEFT01/reset-password');
      expect(req.request.body).toBeNull();
      req.flush({ message: 'A new password has been sent to neft.desk@zed.test.' });
      await settle();
      http.expectOne('/api/staff/neft-admins').flush(neftList);
      await settle();
      expect(confirmDialog()).toBeNull();
      expect(toasts()).toContain('New password sent: E-mailed to neft.desk@zed.test');

      // Edit shows the full values in the pop-up.
      button('Edit').click();
      await settle();
      expect(el.querySelector('#account-title')!.textContent).toBe('Edit NEFT admin');
      expect((el.querySelector('#acc-email') as HTMLInputElement).value).toBe('neft.desk@zed.test');
      expect(el.querySelector('#acc-id')).toBeNull();
      button('Cancel').click();
      await settle();
    });

    it('blocks with a required reason in the confirmation and unblocks with the reason pop-up', async () => {
      await create(AccountsPage, 'neft');
      http.expectOne('/api/staff/neft-admins').flush(neftList);
      await settle();
      await pickMenu(el.querySelectorAll('tbody tr')[0], 'Block login');
      expect(confirmDialog()!.querySelector('h3')!.textContent).toBe('Block Neft Desk?');
      expect(confirmDialog()!.querySelector('.cd-ok')!.classList).toContain('btn-danger');
      await confirm();
      http.expectNone('/api/staff/neft-admins/NEFT01/block');
      expect(confirmDialog()!.textContent).toContain('Please enter the reason.');
      await confirm('Left the desk');
      const block = http.expectOne('/api/staff/neft-admins/NEFT01/block');
      expect(block.request.body).toEqual({ reason: 'Left the desk' });
      block.flush({ title: 'Not allowed.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(confirmDialog()!.textContent).toContain('Not allowed.');
      await confirm();
      http.expectOne('/api/staff/neft-admins/NEFT01/block').flush({ message: 'Login blocked.' });
      await settle();
      http.expectOne('/api/staff/neft-admins').flush(neftList);
      await settle();
      expect(confirmDialog()).toBeNull();
      expect(toasts()).toContain('Login blocked: Neft Desk (NEFT01) can no longer sign in. The reason was e-mailed.');

      await pickMenu(el.querySelectorAll('tbody tr')[1], 'Unblock login');
      expect(el.querySelector('zed-reason-dialog h3')!.textContent).toContain('Unblock Old Desk');
      const box = el.querySelector('#reason-dialog-text') as HTMLTextAreaElement;
      box.value = 'Back on the desk';
      box.dispatchEvent(new Event('input'));
      await settle();
      (el.querySelector('zed-reason-dialog form') as HTMLFormElement).dispatchEvent(new Event('submit'));
      await settle();
      const unblock = http.expectOne('/api/staff/neft-admins/NEFT00/unblock');
      expect(unblock.request.body).toEqual({ reason: 'Back on the desk' });
      unblock.flush({ message: 'Login unblocked.' });
      await settle();
      http.expectOne('/api/staff/neft-admins').flush(neftList);
      await settle();
      expect(toasts()).toContain('Login unblocked: Old Desk (NEFT00) can sign in again. The reason was e-mailed.');
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
      expect(el.querySelector('.ph-title')!.textContent).toBe('Sub-Users');
      expect(el.querySelector('.ph-crumb [aria-current]')!.textContent).toBe('Sub-Users');
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
      expect(post.request.body).toEqual({ userName: 'Asha', email: 'asha@zed.test', mobileNo: '', permissions: ['monitoring'], isActive: true, states: [], agencies: [] });
      post.flush({ message: 'Sub-User AG1S02 created.' });
      await settle();
      http.expectOne('/api/staff/sub-users').flush(list);
      await settle();
      expect(el.querySelector('.alert-success')).toBeNull();
      expect(toasts()).toContain('Sub-User added: Sub-User AG1S02 created.');
    });

    it('gives an agency sub-user states, and an operation admin states and agencies (2026-11-16)', async () => {
      await create(SubUsersPage);
      const states = [{ code: '28', name: 'ANDHRA PRADESH' }, { code: '36', name: 'TELANGANA' }];
      http.expectOne('/api/staff/sub-users').flush({ ...list, states, users: [{ ...list.users[0], states: ['36'] }] });
      await settle();
      expect(el.querySelector('[data-scope]')!.textContent!.trim()).toBe('TELANGANA');
      button('+ Add Sub-User').click();
      await settle();
      // An agency's sub-user: states only.
      expect(el.querySelector('[data-scope-states]')).not.toBeNull();
      expect(el.querySelector('[data-scope-agencies]')).toBeNull();
      type('#sub-name', 'Asha');
      type('#sub-email', 'asha@zed.test');
      (el.querySelector('#perm-monitoring') as HTMLInputElement).click();
      const stateBox = [...el.querySelectorAll<HTMLLabelElement>('[data-scope-states] label.option')].find((l) => l.textContent!.includes('ANDHRA'))!;
      stateBox.querySelector('input')!.click();
      await settle();
      submit();
      await settle();
      const post = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/sub-users');
      expect(post.request.body).toMatchObject({ states: ['28'], agencies: [] });
      post.flush({ message: 'Sub-User AG1S02 created.' });
      await settle();
      // Master Admin: the agencies too, and the list says both.
      http.expectOne('/api/staff/sub-users').flush({
        ...list, accountType: 'Operation Admin', states, agencies: [{ code: 'AGENCY1', name: 'Acme Assessors' }],
        users: [{ ...list.users[0], states: ['28', '36'], agencies: ['AGENCY1'] }],
      });
      await settle();
      expect(el.querySelector('[data-scope]')!.textContent!.trim()).toBe('2 states · 1 agency');
      button('+ Add Operation Admin').click();
      await settle();
      expect(el.querySelector('[data-scope-agencies]')!.textContent).toContain('Acme Assessors');
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
      expect(put.request.body).toEqual({ userName: 'Ravi', email: 'ravi@zed.test', mobileNo: '', permissions: ['monitoring'], isActive: false, states: [], agencies: [] });
      put.flush({ title: 'Please select at least one screen.' }, { status: 400, statusText: 'Bad Request' });
      await settle();
      expect(el.querySelector('.modal .alert-danger')!.textContent).toContain('Please select at least one screen.');
    });

    it('counts the logins by status, filters with the tiles and shows initials and screen chips', async () => {
      await create(SubUsersPage);
      const user = list.users[0];
      const screens = ['a', 'b', 'c', 'd', 'e', 'f'].map((k) => ({ key: k, label: 'Screen ' + k.toUpperCase() }));
      http.expectOne('/api/staff/sub-users').flush({
        accountType: 'Operation Admin',
        permissions: screens,
        users: [
          { ...user, userId: 'MA1S01', userName: 'Priya Nair', permissions: ['a', 'b', 'c', 'd', 'e'] },
          { ...user, userId: 'MA1S02', userName: 'Rohan', permissions: ['a', 'b', 'c', 'd', 'e', 'f'], locked: true, lastLoginAt: '2026-10-29T09:42:00' },
          { ...user, userId: 'MA1S03', userName: 'Arjun Singh', isActive: false },
        ],
      });
      await settle();
      expect(el.querySelector('.ph-title')!.textContent).toBe('Operation Admins');
      const tiles = () => [...el.querySelectorAll('zed-list-counts .lc-item')].map((t) => `${t.querySelector('b')!.textContent} ${t.querySelector('.lc-label')!.textContent!.trim()}`);
      expect(tiles()).toEqual(['3 All logins', '1 Active', '1 Locked', '1 Blocked']);
      expect([...el.querySelectorAll('.su-avatar')].map((a) => a.textContent!.trim())).toEqual(['PN', 'RO', 'AS']);
      const rows = () => [...el.querySelectorAll('tbody tr')];
      expect([...rows()[0].querySelectorAll('.su-screens .zed-chip')].map((c) => c.textContent!.trim())).toEqual(['Screen A', 'Screen B', 'Screen C', 'Screen D', '+1 more']);
      expect(rows()[0].querySelector('.su-chip-more')!.getAttribute('title')).toBe('Screen E');
      expect(rows()[1].querySelector('.su-screens')!.textContent!.trim()).toBe('All 6 screens');
      expect(rows()[0].querySelector('.su-never')!.textContent).toBe('Never signed in');

      (el.querySelectorAll('zed-list-counts .lc-btn')[3] as HTMLButtonElement).click();
      await settle();
      expect(rows().length).toBe(1);
      expect(el.querySelector('tbody .su-id')!.textContent).toBe('MA1S03');
      expect(el.querySelector('tbody .su-status-cell')!.textContent!.trim()).toBe('Blocked');
      expect(el.querySelector('.su-showing')!.textContent).toContain('1 of 3 logins · blocked only');

      type('#sub-users-search', 'nobody');
      await settle();
      expect(el.querySelector('.su-empty')!.textContent).toContain('No login matches the filters.');
      button('Show all logins').click();
      await settle();
      expect(rows().length).toBe(3);
    });

    it('gives every screen with Select all and none with Clear', async () => {
      await create(SubUsersPage);
      http.expectOne('/api/staff/sub-users').flush({ ...list, users: [] });
      await settle();
      expect(el.querySelector('.su-empty')!.textContent).toContain('No sub-users yet.');
      button('Add the first sub-user').click();
      await settle();
      const given = () => el.querySelector('.su-given')!.textContent;
      expect(given()).toBe('0 of 2 given');
      // The screens' own Select all / Clear (the scope's multi-selects have theirs).
      const bulk = (label: string) => [...el.querySelectorAll<HTMLButtonElement>('.su-bulk button')].find((b) => b.textContent!.trim() === label)!;
      bulk('Select all').click();
      await settle();
      expect(given()).toBe('2 of 2 given');
      expect((el.querySelector('#perm-monitoring') as HTMLInputElement).checked).toBe(true);
      expect(el.querySelector('label[for="perm-reports"]')!.classList).toContain('active');
      bulk('Clear').click();
      await settle();
      expect(given()).toBe('0 of 2 given');
      expect((el.querySelector('#perm-reports') as HTMLInputElement).checked).toBe(false);
      expect(el.querySelector('#sub-active')).toBeNull();
      button('Cancel').click();
      await settle();
    });

    describe('row menu (2026-11-17 redesign)', () => {
      const opList = {
        accountType: 'Operation Admin',
        permissions: list.permissions,
        users: [
          { ...list.users[0], userId: 'MA1S01', userName: 'Priya Nair', mobileNo: '9876543210', permissions: ['monitoring'] },
          { ...list.users[0], userId: 'MA1S02', userName: 'Rohan', email: 'rohan@zed.test', locked: true },
          { ...list.users[0], userId: 'MA1S03', userName: 'Arjun', isActive: false, states: ['28'] },
        ],
      };
      const row = (i: number) => el.querySelectorAll('tbody tr')[i];

      it('shows the contact in full and offers a new password, Unlock only on a locked login, and Block / Unblock', async () => {
        await create(SubUsersPage);
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        // 2026-11-18 (the user): never masked.
        expect([...row(0).querySelectorAll('.su-contact span')].map((s) => s.textContent)).toEqual(['9876543210', 'ravi@zed.test']);
        expect(row(0).querySelector('.su-mail')!.getAttribute('title')).toBe('ravi@zed.test');
        expect(row(1).querySelector('.su-status-cell .status-badge svg.su-lock')).not.toBeNull();
        expect(row(1).querySelector('.su-status-cell')!.textContent!.trim()).toBe('Locked');
        expect([...row(0).querySelectorAll('.su-actions button.btn')].map((b) => b.textContent!.trim())).toEqual(['Edit']);
        expect(await menuItems(row(0))).toEqual(['Send new password', 'Block login']);
        expect(await menuItems(row(1))).toEqual(['Unlock (send new password)', 'Block login']);
        expect(await menuItems(row(2))).toEqual(['Send new password', 'Unblock login']);
      });

      it('sends a new password after the confirmation, and unlocks a locked login the same way', async () => {
        await create(SubUsersPage);
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        await pickMenu(row(0), 'Send new password');
        expect(confirmDialog()!.querySelector('h3')!.textContent).toBe('Send a new password?');
        expect(confirmDialog()!.textContent).toContain('Priya Nair (MA1S01) gets a new password by e-mail at ravi@zed.test.');
        // Cancel: nothing is sent.
        (confirmDialog()!.querySelector('.btn-default') as HTMLButtonElement).click();
        await settle();
        expect(confirmDialog()).toBeNull();
        http.expectNone('/api/staff/sub-users/MA1S01/reset-password');

        await pickMenu(row(0), 'Send new password');
        await confirm();
        const reset = http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/sub-users/MA1S01/reset-password');
        expect(reset.request.body).toBeNull();
        reset.flush({ message: 'A new password has been sent to ravi@zed.test.' });
        await settle();
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        expect(toasts()).toContain('New password sent: New password e-mailed to ravi@zed.test');

        await pickMenu(row(1), 'Unlock (send new password)');
        expect(confirmDialog()!.querySelector('h3')!.textContent).toBe('Unlock Rohan?');
        expect(confirmDialog()!.textContent).toContain('The lock is lifted at once');
        await confirm();
        http.expectOne((r) => r.method === 'POST' && r.url === '/api/staff/sub-users/MA1S02/reset-password').flush({ message: 'A new password has been sent to rohan@zed.test.' });
        await settle();
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        expect(toasts()).toContain('Login unlocked: New password e-mailed to rohan@zed.test');
      });

      it('blocks (a red confirmation, no reason: the API takes none) and unblocks with the same update as Edit', async () => {
        await create(SubUsersPage);
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        await pickMenu(row(0), 'Block login');
        expect(confirmDialog()!.querySelector('h3')!.textContent).toBe('Block Priya Nair?');
        expect(confirmDialog()!.querySelector('.cd-ok')!.classList).toContain('btn-danger');
        expect(confirmDialog()!.querySelector('textarea')).toBeNull();
        await confirm();
        const put = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/sub-users/MA1S01');
        expect(put.request.body).toEqual({ userName: 'Priya Nair', email: 'ravi@zed.test', mobileNo: '9876543210', permissions: ['monitoring'], isActive: false, states: [], agencies: [] });
        put.flush({ title: 'Please select at least one screen.' }, { status: 400, statusText: 'Bad Request' });
        await settle();
        expect(confirmDialog()!.textContent).toContain('Please select at least one screen.');
        await confirm();
        http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/sub-users/MA1S01').flush({ message: 'Operation Admin MA1S01 updated.' });
        await settle();
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        expect(confirmDialog()).toBeNull();
        expect(toasts()).toContain('Login blocked: Priya Nair (MA1S01) can no longer sign in.');

        await pickMenu(row(2), 'Unblock login');
        expect(confirmDialog()!.querySelector('.cd-ok')!.classList).not.toContain('btn-danger');
        await confirm();
        const unblock = http.expectOne((r) => r.method === 'PUT' && r.url === '/api/staff/sub-users/MA1S03');
        expect(unblock.request.body).toMatchObject({ isActive: true, states: ['28'], permissions: ['reports'] });
        unblock.flush({ message: 'Operation Admin MA1S03 updated.' });
        await settle();
        http.expectOne('/api/staff/sub-users').flush(opList);
        await settle();
        expect(toasts()).toContain('Login unblocked: Arjun (MA1S03) can sign in again.');
      });

      it('opens the two-column pop-up: details and scope on the left, the screens on the right', async () => {
        await create(SubUsersPage);
        http.expectOne('/api/staff/sub-users').flush({ ...opList, agencies: [{ code: 'AGENCY1', name: 'Acme Assessors' }] });
        await settle();
        button('+ Add Operation Admin').click();
        await settle();
        const cols = el.querySelectorAll('.su-body > .su-col');
        expect(cols.length).toBe(2);
        expect(cols[0].querySelector('#sub-name')).not.toBeNull();
        expect(cols[0].querySelector('[data-scope-agencies]')).not.toBeNull();
        expect(cols[1].querySelector('#perm-monitoring')).not.toBeNull();
        expect(cols[1].querySelector('.su-note')!.textContent).toContain('Work done by an operation admin is recorded under your login.');
        expect(el.querySelector('.su-foot')!.textContent).toContain('Fields marked * are required.');
        expect(button('Add operation admin')).toBeTruthy();
        button('Cancel').click();
        await settle();
        expect(el.querySelector('.modal')).toBeNull();
      });
    });
  });
});
