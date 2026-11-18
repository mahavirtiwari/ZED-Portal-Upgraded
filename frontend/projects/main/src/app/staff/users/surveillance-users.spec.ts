import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute } from '@angular/router';
import { AuthService } from '@zed/shared';
import { ToastService } from '../toast';
import { SurveillanceUsersPage } from './surveillance-users';

describe('surveillance agencies and assessors', () => {
  function create(kind: 'agencies' | 'assessors', master = false) {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), { provide: ActivatedRoute, useValue: { snapshot: { data: { kind } } } }],
    });
    if (master) TestBed.inject(AuthService).setUser({ userId: 'MADMIN', userName: 'M', roleId: 7, role: 'MasterAdmin', subRoles: [] });
    const fixture = TestBed.createComponent(SurveillanceUsersPage);
    return { fixture, http: TestBed.inject(HttpTestingController), el: fixture.nativeElement as HTMLElement };
  }

  async function settle(fixture: ComponentFixture<unknown>) {
    fixture.detectChanges();
    await new Promise((r) => setTimeout(r));
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** The 2026-11-17 row menu: opens it and gives its item labels. */
  async function menuOf(fixture: ComponentFixture<unknown>, tr: Element) {
    (tr.querySelector('zed-row-menu .rm-btn') as HTMLButtonElement).click();
    await settle(fixture);
    return [...tr.querySelectorAll('.rm-item')].map((b) => b.textContent!.trim());
  }

  async function choose(fixture: ComponentFixture<unknown>, tr: Element, label: string) {
    if (!tr.querySelector('.rm-item')) await menuOf(fixture, tr);
    ([...tr.querySelectorAll('.rm-item')].find((b) => b.textContent!.trim() === label) as HTMLButtonElement).click();
    await settle(fixture);
  }

  async function submit(fixture: ComponentFixture<unknown>, selector = 'zed-confirm-dialog form') {
    ((fixture.nativeElement as HTMLElement).querySelector(selector) as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  const lastToast = () => TestBed.inject(ToastService).toasts().at(-1);

  const agency = {
    userId: 'ZEDAA0001', userName: 'Acme', spocName: 'Spoc', email: 'a@acme.test', mobileNo: '9876543210', isActive: true, reasonForRejection: null,
    desktopVerification: true, siteVerification: false, allowBronzeSurveillance: false, reasonForRejectionForBS: null, tuPreferredState: '9', noOfUsers: 2,
  };
  const assessor = {
    userId: 'ZEDAS0001', userName: 'Asr', email: null, mobileNo: null, isActive: true, reasonForRejection: null, desktopVerification: true,
    siteVerification: false, allowBronzeSurveillance: true, agencyUserId: 'AGENCY1', agencyUserName: 'Acme',
  };

  async function agencies(rows: object[] = [agency]) {
    const page = create('agencies');
    page.http.expectOne('/api/staff/surveillance-users/agencies').flush(rows);
    page.http.expectOne('/api/staff/surveillance-users/states').flush([{ code: '9', name: 'UTTAR PRADESH' }]);
    await settle(page.fixture);
    return page;
  }

  it('lists the agencies with their Bronze surveillance state and preferred state', async () => {
    const { el } = await agencies();
    const text = el.textContent ?? '';
    expect(el.querySelector('h2')!.textContent).toBe('Bronze Surveillance Agencies');
    expect(el.querySelector('zed-page-head')!.textContent).toContain('changes here apply to surveillance only');
    expect(text).toContain('ZEDAA0001');
    expect(el.querySelector('.bronze-status')!.textContent).toContain('Not allowed');
    expect(el.querySelector('.bronze-status')!.textContent).toContain('UTTAR PRADESH');
  });

  it('enables Bronze surveillance with the state and districts', async () => {
    const { fixture, http } = await agencies();
    const page = fixture.componentInstance as unknown as { openBronze(a: unknown): Promise<void>; saveBronze(d: unknown): Promise<void>; bronze(): unknown };
    const opening = page.openBronze(agency);
    http.expectOne('/api/staff/surveillance-users/agencies/ZEDAA0001').flush({ agency, districts: ['160'] });
    await Promise.resolve();
    await Promise.resolve();
    http.expectOne((r) => r.url === '/api/staff/surveillance-users/districts').flush([{ districtCode: '160', districtName: 'Agra' }]);
    await opening;
    const dialog = page.bronze() as { allow: boolean; state: string; districts: string[] };
    dialog.allow = true;
    const saving = page.saveBronze(dialog);
    const put = http.expectOne('/api/staff/surveillance-users/agencies/ZEDAA0001/bronze-surveillance');
    expect(put.request.method).toBe('PUT');
    expect(put.request.body).toEqual({ allow: true, preferredState: '9', districts: ['160'] });
    put.flush({ message: 'Bronze surveillance enabled.' });
    await Promise.resolve();
    http.match(() => true).forEach((r) => r.flush([]));
    await saving;
    expect(lastToast()).toMatchObject({ tone: 'success', title: 'Bronze surveillance saved', message: 'Bronze surveillance enabled.' });
    expect(page.bronze()).toBeNull();
  });

  it('blocks an assessor from the row menu after a confirmation with a required reason', async () => {
    const { fixture, http, el } = create('assessors');
    http.expectOne('/api/staff/surveillance-users/assessors').flush([assessor]);
    await settle(fixture);
    await choose(fixture, el.querySelector('tbody tr')!, 'Block assessor');
    const dialog = el.querySelector('zed-confirm-dialog')!;
    expect(dialog.querySelector('h3')!.textContent).toContain('Block Asr?');
    expect(dialog.textContent).toContain('The assessor can no longer sign in to surveillance until unblocked.');
    expect(dialog.querySelector('.cd-ok')!.textContent!.trim()).toBe('Block assessor');
    await submit(fixture);
    expect(dialog.textContent).toContain('Please enter the reason for blocking.');
    const reason = el.querySelector('#sv-block-reason') as HTMLTextAreaElement;
    reason.value = ' Left ';
    reason.dispatchEvent(new Event('input'));
    await submit(fixture);
    const post = http.expectOne('/api/staff/surveillance-users/assessors/ZEDAS0001/block');
    expect(post.request.body).toEqual({ reason: 'Left' });
    post.flush({ message: 'User Blocked successful' });
    await settle(fixture);
    http.expectOne('/api/staff/surveillance-users/assessors').flush([{ ...assessor, isActive: false }]);
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(el.querySelector('.alert-success')).toBeNull();
    expect(lastToast()).toMatchObject({ tone: 'success', title: 'Assessor blocked', message: 'User Blocked successful' });
  });

  it('shows the agency rows as designed: the SPOC contact in full, Bronze surveillance as a button, the rest in the row menu', async () => {
    const { fixture, el } = await agencies([{ ...agency, address: '12 Mill Road', pinCode: '208001' }]);
    const table = el.querySelector('table')!;
    expect(table.classList).toContain('table-zed');
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual([
      'Agency', 'SPOC', 'Verification', 'Assessors', 'Bronze surveillance', 'Status', 'Actions',
    ]);
    const tr = table.querySelector('tbody tr')!;
    const cells = [...tr.querySelectorAll('td')];
    expect([...cells[0].querySelectorAll('.sv-who > span')].map((s) => s.textContent!.trim())).toEqual(['Acme', 'ZEDAA0001', '12 Mill Road, 208001']);
    // 2026-11-18 (the user): never masked.
    expect([...cells[1].children].map((s) => s.textContent!.trim())).toEqual(['Spoc', '9876543210', 'a@acme.test']);
    expect(cells[2].textContent!.trim()).toBe('Desktop verification');
    expect(cells[3].textContent!.trim()).toBe('2');
    expect(cells[5].textContent!.trim()).toBe('Active');
    expect([...cells[6].querySelectorAll('.sv-btns > button')].map((b) => b.textContent!.trim())).toEqual(['Bronze surveillance']);
    expect(await menuOf(fixture, tr)).toEqual(['Send reset link', 'View history', 'Block agency']);
  });

  it('shows the assessor rows with the Bronze surveillance switch, no PAN and Unblock in the menu of a blocked one', async () => {
    const { fixture, http, el } = create('assessors');
    http.expectOne('/api/staff/surveillance-users/assessors').flush([
      { ...assessor, email: 'a@x.test', mobileNo: '9812345678', isActive: false, address: 'Kanpur', idProofNumber: 'ID-77', panNo: 'ABCDE1234F' },
    ]);
    await settle(fixture);
    const table = el.querySelector('table')!;
    expect([...table.querySelectorAll('thead th')].map((th) => th.textContent!.trim())).toEqual(['Assessor', 'Contact', 'Bronze surveillance', 'Status', 'Actions']);
    const tr = table.querySelector('tbody tr')!;
    const cells = [...tr.querySelectorAll('td')];
    expect(cells[0].textContent).toContain('Kanpur');
    expect(cells[0].textContent).toContain('ID-77');
    expect(tr.textContent).not.toContain('ABCDE1234F');
    expect([...cells[1].children].map((s) => s.textContent!.trim())).toEqual(['9812345678', 'a@x.test']);
    expect(cells[2].querySelector('input[type=checkbox]')).not.toBeNull();
    expect(cells[3].textContent!.trim()).toBe('In-Active');
    expect(await menuOf(fixture, tr)).toEqual(['View history', 'Unblock assessor']);
    expect(table.querySelector('.sv-agency-line')).toBeNull();
    expect(el.querySelector('#sv-agency')).toBeNull();
  });

  it('unblocks an assessor with a reason and switches its Bronze surveillance', async () => {
    const { fixture, http, el } = create('assessors');
    http.expectOne('/api/staff/surveillance-users/assessors').flush([{ ...assessor, isActive: false }]);
    await settle(fixture);
    await choose(fixture, el.querySelector('tbody tr')!, 'Unblock assessor');
    expect(el.querySelector('zed-reason-dialog h3')!.textContent).toContain('Unblock Asr');
    const box = el.querySelector('#reason-dialog-text') as HTMLTextAreaElement;
    box.value = 'Back on the panel';
    box.dispatchEvent(new Event('input'));
    await submit(fixture, 'zed-reason-dialog form');
    const post = http.expectOne('/api/staff/surveillance-users/assessors/ZEDAS0001/unblock');
    expect(post.request.body).toEqual({ reason: 'Back on the panel' });
    post.flush({ message: 'User UnBlocked successful' });
    await settle(fixture);
    http.expectOne('/api/staff/surveillance-users/assessors').flush([assessor]);
    await settle(fixture);
    expect(el.querySelector('zed-reason-dialog')).toBeNull();
    expect(lastToast()).toMatchObject({ title: 'Assessor unblocked' });

    const toggle = el.querySelector('.bronze-switch input') as HTMLInputElement;
    toggle.checked = false;
    toggle.dispatchEvent(new Event('change'));
    await settle(fixture);
    const put = http.expectOne('/api/staff/surveillance-users/assessors/ZEDAS0001/bronze-surveillance');
    expect(put.request.body).toEqual({ allow: false });
    put.flush({ message: 'Saved.' });
    await settle(fixture);
    http.expectOne('/api/staff/surveillance-users/assessors').flush([{ ...assessor, allowBronzeSurveillance: false }]);
    await settle(fixture);
    expect(lastToast()).toMatchObject({ title: 'Bronze surveillance not allowed', message: 'Saved.' });
    http.verify();
  });

  it('sends an agency a reset link after the confirmation and shows its history in the side panel', async () => {
    const { fixture, http, el } = await agencies();
    await choose(fixture, el.querySelector('tbody tr')!, 'Send reset link');
    expect(el.querySelector('zed-confirm-dialog h3')!.textContent).toContain('Send password reset link?');
    const person = el.querySelector('zed-confirm-dialog .cd-person')!.textContent!;
    for (const part of ['Acme', 'Surveillance agency · ZEDAA0001', 'a@acme.test']) expect(person).toContain(part);
    await submit(fixture);
    http.expectOne('/api/staff/surveillance-users/agencies/ZEDAA0001/password-reset').flush({ message: 'Link sent (a@acme.test).' });
    await settle(fixture);
    expect(el.querySelector('zed-confirm-dialog')).toBeNull();
    expect(lastToast()).toMatchObject({ title: 'Reset link sent', message: 'E-mailed to a@acme.test' });

    await choose(fixture, el.querySelector('tbody tr')!, 'View history');
    expect(el.querySelector('zed-user-history small')!.textContent).toBe('Acme · ZEDAA0001');
    http.expectOne('/api/staff/surveillance-users/agencies/ZEDAA0001/history').flush([
      { action: 'Blocked', reason: 'Audit pending', actionBy: 'MADMIN', actionByRole: 7, actionDate: '2026-11-06T15:42:00' },
    ]);
    await settle(fixture);
    const item = [...el.querySelector('zed-user-history .hp-list li')!.children].map((c) => c.textContent!.trim());
    expect(item).toEqual(['Blocked', 'By MADMIN (Master Admin) · Reason: Audit pending', '06 Nov 2026, 15:42']);
    http.verify();
  });

  it('counts the assessors, filters with the tiles and by agency for the MasterAdmin, and shows initials', async () => {
    const { fixture, http, el } = create('assessors', true);
    const row = { email: null, mobileNo: null, reasonForRejection: null, desktopVerification: true, siteVerification: false };
    http.expectOne('/api/staff/surveillance-users/assessors').flush([
      { ...row, userId: 'ZEDAS0001', userName: 'Rahul Verma', isActive: true, allowBronzeSurveillance: true, agencyUserId: 'AG1', agencyUserName: 'Acme' },
      { ...row, userId: 'ZEDAS0002', userName: 'Pooja', isActive: true, allowBronzeSurveillance: false, agencyUserId: 'AG2', agencyUserName: 'Beta' },
      { ...row, userId: 'ZEDAS0003', userName: null, isActive: false, allowBronzeSurveillance: false, agencyUserId: 'AG1', agencyUserName: 'Acme' },
    ]);
    await settle(fixture);
    const tiles = () => [...el.querySelectorAll('zed-list-counts .lc-item')].map((t) => `${t.querySelector('b')!.textContent} ${t.querySelector('.lc-label')!.textContent!.trim()}`);
    const ids = () => [...el.querySelectorAll('tbody .sv-id')].map((c) => c.textContent!.trim());
    expect(tiles()).toEqual(['3 All assessors', '2 Active', '1 Blocked', '1 Bronze allowed']);
    expect([...el.querySelectorAll('.sv-avatar')].map((a) => a.textContent!.trim())).toEqual(['RV', 'PO', 'ZE']);
    expect(el.querySelector('tbody .sv-agency-line')!.textContent!.trim()).toBe('Acme');

    const select = el.querySelector('#sv-agency') as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent!.trim())).toEqual(['All agencies', 'Acme (2)', 'Beta (1)']);
    select.value = 'AG1';
    select.dispatchEvent(new Event('change'));
    fixture.detectChanges();
    expect(ids()).toEqual(['ZEDAS0001', 'ZEDAS0003']);
    expect(tiles()).toEqual(['2 All assessors', '1 Active', '1 Blocked', '1 Bronze allowed']);

    (el.querySelectorAll('zed-list-counts button')[3] as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(ids()).toEqual(['ZEDAS0001']);
    expect(el.querySelectorAll('zed-list-counts button')[3].getAttribute('aria-pressed')).toBe('true');
    expect(el.querySelector('.sv-showing')!.textContent).toContain('1 of 3 assessors · Bronze allowed only');

    const search = el.querySelector('.sv-search') as HTMLInputElement;
    search.value = 'nobody';
    search.dispatchEvent(new Event('input'));
    fixture.detectChanges();
    expect(el.querySelector('.sv-empty')!.textContent).toContain('No assessor matches the filters.');
    (el.querySelector('.sv-empty button') as HTMLButtonElement).click();
    fixture.detectChanges();
    expect(ids().length).toBe(3);
    expect(tiles()[0]).toBe('3 All assessors');
  });

  it('says where agencies come from when there are none', async () => {
    const { el, http, fixture } = create('agencies');
    http.expectOne('/api/staff/surveillance-users/agencies').flush([]);
    http.expectOne('/api/staff/surveillance-users/states').flush([]);
    await settle(fixture);
    expect(el.querySelector('.sv-empty')!.textContent).toContain('No agencies yet. They are added on the ZED portal (main).');
    expect([...el.querySelectorAll('zed-list-counts .lc-item b')].map((c) => c.textContent)).toEqual(['0', '0', '0', '0']);
  });
});
