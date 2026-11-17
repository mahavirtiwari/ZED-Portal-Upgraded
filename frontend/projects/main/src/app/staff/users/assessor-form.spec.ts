import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter } from '@angular/router';
import { AuthService } from '@zed/shared';
import { StaffRole } from '../staff-menu';
import { ToastService } from '../toast';
import { AssessorFormPage } from './assessor-form';

/** 2026-11-17 (approved staff redesign, staff-05): the assessor page's head actions, pop-ups, toasts and right rail. */
async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

const BASE = '/api/staff/users/assessors';
const options = {
  states: ['DELHI', 'MAHARASHTRA'],
  sectors: [{ sectorCode: '24', sectorName: 'Basic metals' }, { sectorCode: '10', sectorName: 'Food products' }],
  areasOfKnowledge: ['Quality', 'Safety'],
  verification: { mode: 'Off', needsPan: true },
};
const assessor = {
  userId: 'ZEDAS0001', userName: 'Asha Rao', emailId: 'asha@zed.test', mobileNo: '9000000001', address: 'Street', pinCode: '560001',
  assessorType: 'Assessor', certificateNo: 'AS1', idProofType: 'Aadhaar Card', idProofNumberMasked: 'XXXXXXXX9012', states: ['DELHI'],
  nicSectors: ['10', '24'], areasOfKnowledge: ['Quality'], reasonForRejection: null, isActive: true, agencyUserId: 'AGENCY1', canEdit: false,
  sectorActivity: 'Manufacturing',
};

describe('AssessorFormPage (staff-05 redesign)', () => {
  let fixture: ComponentFixture<AssessorFormPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  let toast: ToastService;

  async function open(roleId: number, userId: string | null, details: Partial<typeof assessor> = {}, open: number | null = 3) {
    await TestBed.configureTestingModule({
      imports: [AssessorFormPage],
      providers: [
        provideHttpClient(), provideHttpClientTesting(), provideRouter([]),
        { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap(userId ? { userId } : {}) } } },
      ],
    }).compileComponents();
    TestBed.inject(AuthService).setUser({
      userId: roleId === StaffRole.Agency ? 'AGENCY1' : 'MASTER1', userName: roleId === StaffRole.Agency ? 'Acme Agency' : 'Master', roleId, role: 'x', subRoles: [],
    });
    toast = TestBed.inject(ToastService);
    vi.spyOn(toast, 'success');
    fixture = TestBed.createComponent(AssessorFormPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await settle(fixture);
    http.expectOne(`${BASE}/options`).flush(options);
    await settle(fixture);
    if (!userId) {
      http.expectOne(`${BASE}/agency-sector-activity`).flush({ message: 'Both' });
      await settle(fixture);
      return;
    }
    http.expectOne(`${BASE}/${userId}`).flush({ ...assessor, canEdit: roleId === StaffRole.Agency, ...details });
    await settle(fixture);
    http.expectOne(`${BASE}/${userId}/open-assessments`).flush({ count: open });
    // The registered mobile card of the Master Admin (assessor-mobile.spec.ts).
    http.match((r) => r.url.startsWith('/api/staff/assessor-mobile/')).forEach((r) => r.flush({ userId, device: null, signIns: [] }));
    await settle(fixture);
  }

  afterEach(() => http.verify());

  const head = () => el.querySelector('zed-page-head')!;
  const act = (name: string) => el.querySelector(`[data-act="${name}"]`) as HTMLButtonElement | null;
  const dialog = () => el.querySelector('zed-confirm-dialog') as HTMLElement | null;

  async function confirm(reason?: string) {
    if (reason !== undefined) {
      const box = dialog()!.querySelector('textarea') as HTMLTextAreaElement;
      box.value = reason;
      box.dispatchEvent(new Event('input', { bubbles: true }));
      await settle(fixture);
    }
    dialog()!.querySelector('form')!.dispatchEvent(new Event('submit'));
    await settle(fixture);
  }

  it('shows the crumbs, the View only tag, the actions and the right rail to the Master Admin, with the full e-mail and mobile', async () => {
    await open(StaffRole.MasterAdmin, 'ZEDAS0001');
    expect([...head().querySelectorAll('.ph-crumb a, .ph-crumb span:not(.ph-sep)')].map((c) => c.textContent!.trim())).toEqual(['Home', 'Assessors', 'ZEDAS0001']);
    expect(head().querySelector('.ph-title')!.textContent).toContain('Assessor Details');
    expect(head().querySelector('.af-view-only')!.textContent!.trim()).toBe('View only');
    expect([...head().querySelectorAll('.ph-actions .btn')].map((b) => b.textContent!.trim())).toEqual(['Block', 'Reset link', 'History', 'Back']);
    // No masking on the record's own page.
    expect((el.querySelector('#emailId') as HTMLInputElement).value).toBe('asha@zed.test');
    expect((el.querySelector('#mobileNo') as HTMLInputElement).value).toBe('9000000001');

    const agency = el.querySelector('[data-rail="agency"]')!;
    expect(agency.textContent).toContain('Assessment agency');
    expect(agency.textContent).toContain('AGENCY1');
    expect(agency.querySelector('a')!.getAttribute('href')).toBe('/staff/users/agencies/AGENCY1');

    const coverage = el.querySelector('[data-rail="coverage"]')!;
    const values = () => [...coverage.querySelectorAll('dd')].map((d) => d.textContent!.replace(/\s+/g, ' ').trim());
    expect(values()).toEqual(['1 of 2 selected', '10-Food products +1 more', 'Quality']);
    (coverage.querySelector('button') as HTMLButtonElement).click();
    await settle(fixture);
    expect(values()[1]).toContain('10-Food products, 24-Basic metals');
    expect(coverage.querySelector('button')!.textContent!.trim()).toBe('Show less');

    expect(el.querySelector('[data-rail="open"]')!.textContent).toContain('3 assessments allotted and not certified yet.');
  });

  it('blocks with a required reason, stating the open assessments, then shows a toast and the Blocked status', async () => {
    await open(StaffRole.MasterAdmin, 'ZEDAS0001');
    act('block')!.click();
    await settle(fixture);
    expect(dialog()!.querySelector('h3')!.textContent!.trim()).toBe('Block Asha Rao?');
    expect(dialog()!.textContent).toContain('3 assessments allotted to this assessor are still open; the agency will need to re-allot them.');
    expect(dialog()!.querySelector('.cd-ok')!.textContent!.trim()).toBe('Block assessor');
    expect(dialog()!.querySelector('.cd-ok')!.classList).toContain('btn-danger');
    // The reason is required.
    await confirm();
    expect(dialog()!.textContent).toContain('Please enter the reason for blocking.');
    http.expectNone(`${BASE}/ZEDAS0001/block`);

    await confirm('Left the agency');
    const req = http.expectOne(`${BASE}/ZEDAS0001/block`);
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ reason: 'Left the agency' });
    req.flush({ message: 'User blocked successfully.' });
    await settle(fixture);
    expect(dialog()).toBeNull();
    expect(toast.success).toHaveBeenCalledWith('Assessor blocked', 'User blocked successfully.');
    expect(el.querySelector('.af-profile .status-badge')!.textContent!.trim()).toBe('Blocked');
    expect(act('block')).toBeNull();
    expect(act('unblock')).not.toBeNull();
    expect((el.querySelector('#reasonForRejection') as HTMLTextAreaElement).value).toBe('Left the agency');
  });

  it("keeps the pop-up open with the server's refusal; without a known count the pop-up and the rail say nothing about open assessments", async () => {
    await open(StaffRole.Agency, 'ZEDAS0001', {}, null);
    expect(el.querySelector('[data-rail="open"]')).toBeNull();
    act('block')!.click();
    await settle(fixture);
    expect(dialog()!.textContent).not.toContain('still open');
    await confirm('Reason');
    http.expectOne(`${BASE}/ZEDAS0001/block`).flush({ title: 'Not allowed.' }, { status: 400, statusText: 'Bad Request' });
    await settle(fixture);
    expect(dialog()!.querySelector('[role=alert]')).not.toBeNull();
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('sends a reset link after the confirmation and names the masked address in the toast', async () => {
    await open(StaffRole.MasterAdmin, 'ZEDAS0001');
    act('reset')!.click();
    await settle(fixture);
    expect(dialog()!.querySelector('h3')!.textContent!.trim()).toBe('Send password reset link?');
    expect(dialog()!.textContent).toContain('Asha Rao (ZEDAS0001) gets a link');
    expect(dialog()!.querySelector('textarea')).toBeNull();
    await confirm();
    const req = http.expectOne(`${BASE}/ZEDAS0001/password-reset`);
    expect(req.request.method).toBe('POST');
    req.flush({ message: 'A link to set a new password was e-mailed (a***@zed.test).' });
    await settle(fixture);
    expect(toast.success).toHaveBeenCalledWith('Reset link sent', 'E-mailed to a***@zed.test');
    expect(dialog()).toBeNull();
  });

  it('unblocks a blocked assessor through the reason pop-up', async () => {
    await open(StaffRole.MasterAdmin, 'ZEDAS0001', { isActive: false });
    expect(act('block')).toBeNull();
    act('unblock')!.click();
    await settle(fixture);
    expect(el.querySelector('zed-reason-dialog')).not.toBeNull();
    await confirm('Back with the agency');
    const req = http.expectOne(`${BASE}/ZEDAS0001/unblock`);
    expect(req.request.body).toEqual({ reason: 'Back with the agency' });
    req.flush({ message: 'User unblocked successfully.' });
    await settle(fixture);
    expect(toast.success).toHaveBeenCalledWith('Assessor unblocked', 'User unblocked successfully.');
    expect(el.querySelector('zed-reason-dialog')).toBeNull();
    expect(el.querySelector('.af-profile .status-badge')!.textContent!.trim()).toBe('Active');
  });

  it('opens the block / unblock history in the side panel', async () => {
    await open(StaffRole.MasterAdmin, 'ZEDAS0001');
    act('history')!.click();
    await settle(fixture);
    const panel = el.querySelector('zed-user-history')!;
    expect(panel.textContent).toContain('Asha Rao · ZEDAS0001');
    expect(panel.textContent).toContain('Loading');
    http.expectOne(`${BASE}/ZEDAS0001/history`).flush([
      { action: 'Blocked', reason: 'Left', actionBy: 'Master', actionByRole: 7, actionDate: '2026-11-10T10:00:00' },
    ]);
    await settle(fixture);
    expect(panel.textContent).toContain('Blocked');
    expect(panel.textContent).toContain('By Master (Master Admin) · Reason: Left');
    (panel.querySelector('.hp-x') as HTMLButtonElement).click();
    await settle(fixture);
    expect(el.querySelector('zed-user-history')).toBeNull();
  });

  it("the agency: its own name on the agency card (no Open link), no View only tag, and a toast after Update", async () => {
    await open(StaffRole.Agency, 'ZEDAS0001');
    expect(head().querySelector('.af-view-only')).toBeNull();
    expect([...head().querySelectorAll('.ph-crumb a')].map((a) => a.getAttribute('href'))).toEqual(['/staff', '/staff/users/my-assessors']);
    const agency = el.querySelector('[data-rail="agency"]')!;
    expect(agency.querySelector('.af-name')!.textContent!.trim()).toBe('Acme Agency');
    expect(agency.querySelector('.af-id')!.textContent!.trim()).toBe('AGENCY1');
    expect(agency.querySelector('a')).toBeNull();
    act('block')!.click();
    await settle(fixture);
    expect(dialog()!.textContent).toContain('you will need to re-allot them.');
    dialog()!.querySelector<HTMLButtonElement>('.btn-default')!.click();
    await settle(fixture);
    expect(dialog()).toBeNull();

    (el.querySelector('form.af-form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    await settle(fixture);
    http.expectOne(`${BASE}/ZEDAS0001`).flush({ message: 'User updated successfully.' });
    await settle(fixture);
    expect(toast.success).toHaveBeenCalledWith('Assessor updated', 'User updated successfully.');
    expect(el.querySelector('.alert-success')).toBeNull();
  });

  it('adding an assessor: no actions, no rail and no open assessments request', async () => {
    await open(StaffRole.Agency, null);
    expect(act('block')).toBeNull();
    expect(act('reset')).toBeNull();
    expect(act('history')).toBeNull();
    expect(el.querySelector('.af-rail')).toBeNull();
    expect(head().querySelector('[aria-current]')!.textContent!.trim()).toBe('Add');
    http.expectNone((r) => r.url.endsWith('/open-assessments'));
  });
});
