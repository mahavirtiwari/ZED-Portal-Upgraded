import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { RejectionReasonsPage, RejectionReasonsResponse } from './rejection-reasons';
import { ConfirmService } from '../confirm-dialog';
import { REJECTION_REASON_PORTALS, SWITCHED_APIS } from '../admin-portal';

/** 2026-11-19 (approved): Admin → Rejection Reasons (the reasons an agency picks when it rejects a unit allotted to it). */
async function settle(fixture: ComponentFixture<unknown>) {
  fixture.detectChanges();
  await new Promise((r) => setTimeout(r));
  await fixture.whenStable();
  fixture.detectChanges();
}

const button = (root: ParentNode, text: string) =>
  [...root.querySelectorAll('button')].find((b) => b.textContent!.trim() === text) as HTMLButtonElement;

describe('RejectionReasonsPage', () => {
  let fixture: ComponentFixture<RejectionReasonsPage>;
  let http: HttpTestingController;
  let el: HTMLElement;
  const url = '/api/staff/settings/rejection-reasons';

  const response = (customised = false): RejectionReasonsResponse => ({
    reasons: [
      { id: 'no-assessor', text: 'No assessor available', action: 'Auto', active: true },
      { id: 'conflict', text: 'Conflict of interest', action: 'MasterAdmin', active: true },
      { id: 'other', text: 'Other', action: 'MasterAdmin', active: false },
    ],
    actions: ['Auto', 'MasterAdmin'],
    customised,
  });

  async function reload(customised = false) {
    await settle(fixture);
    http.expectOne(url).flush(response(customised));
    await settle(fixture);
  }

  async function setup(customised: boolean) {
    await TestBed.configureTestingModule({ imports: [RejectionReasonsPage], providers: [provideHttpClient(), provideHttpClientTesting()] }).compileComponents();
    fixture = TestBed.createComponent(RejectionReasonsPage);
    http = TestBed.inject(HttpTestingController);
    el = fixture.nativeElement;
    await reload(customised);
  }

  afterEach(() => http.verify());

  describe('the standard list', () => {
    beforeEach(() => setup(false));

    it('is switched per portal on main and surveillance', () => {
      expect(REJECTION_REASON_PORTALS).toEqual(['main', 'surveillance']);
      expect(SWITCHED_APIS.find((a) => a.prefix === url)?.portals).toEqual(['main', 'surveillance']);
    });

    it('lists the reasons in order with what happens after the rejection and whether each is on', () => {
      const row = (id: string) => el.querySelector(`tr[data-id="${id}"]`)!.textContent!.replace(/\s+/g, ' ');
      expect([...el.querySelectorAll('tbody tr')].map((r) => r.getAttribute('data-id'))).toEqual(['no-assessor', 'conflict', 'other']);
      expect(row('no-assessor')).toContain('Auto re-allot (round robin)');
      expect(row('conflict')).toContain('Master Admin allots');
      expect(row('other')).toContain('Off');
      expect(el.textContent).toContain('Standard reasons (not changed yet).');
      expect(button(el, 'Reset to standard reasons').disabled).toBe(true);
      expect(el.querySelector('thead')!.textContent).not.toContain('Used');
    });

    it('edits a reason, its action and whether it is in use', async () => {
      button(el.querySelector('tr[data-id="other"]')!, 'Edit').click();
      await settle(fixture);
      const dialog = el.querySelector('[role=dialog]') as HTMLElement;
      const text = dialog.querySelector('#rejectionReasonText') as HTMLInputElement;
      expect(text.maxLength).toBe(150);
      text.value = 'conflict of interest';
      text.dispatchEvent(new Event('input'));
      await settle(fixture);
      expect(dialog.textContent).toContain('Another reason has this wording.');
      text.value = 'Unit outside our region';
      text.dispatchEvent(new Event('input'));
      const action = dialog.querySelector('#rejectionReasonAction') as HTMLSelectElement;
      expect([...action.options].map((o) => o.textContent!.trim())).toEqual(['Auto re-allot (round robin)', 'Master Admin allots']);
      action.value = 'Auto';
      action.dispatchEvent(new Event('change'));
      (dialog.querySelector('#rejectionReasonActive') as HTMLInputElement).click();
      await settle(fixture);
      button(dialog, 'Save').click();
      await settle(fixture);
      const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
      expect(put.request.body.reasons[2]).toEqual({ id: 'other', text: 'Unit outside our region', action: 'Auto', active: true });
      put.flush({ message: 'Rejection reasons saved.' });
      await reload(true);
      expect(el.querySelector('.alert-success')!.textContent).toContain('Rejection reasons saved.');
      expect(el.querySelector('[role=dialog]')).toBeNull();
    });

    it('adds a reason with a key made from its wording, Master Admin allots by default', async () => {
      button(el, 'Add reason').click();
      await settle(fixture);
      const dialog = el.querySelector('[role=dialog]') as HTMLElement;
      button(dialog, 'Save').click();
      await settle(fixture);
      expect(dialog.textContent).toContain('Enter the reason.');
      http.expectNone((r) => r.method === 'PUT');
      const text = dialog.querySelector('#rejectionReasonText') as HTMLInputElement;
      text.value = 'Assessors on leave';
      text.dispatchEvent(new Event('input'));
      await settle(fixture);
      button(dialog, 'Save').click();
      await settle(fixture);
      const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
      expect(put.request.body.reasons).toHaveLength(4);
      expect(put.request.body.reasons[3]).toEqual({ id: 'assessors-on-leave', text: 'Assessors on leave', action: 'MasterAdmin', active: true });
      put.flush({ message: 'Rejection reasons saved.' });
      await reload(true);
    });

    it('moves a reason down', async () => {
      (el.querySelector('tr[data-id="no-assessor"] [aria-label="Move down"]') as HTMLButtonElement).click();
      await settle(fixture);
      const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
      expect(put.request.body.reasons.map((r: { id: string }) => r.id)).toEqual(['conflict', 'no-assessor', 'other']);
      put.flush({ message: 'Rejection reasons saved.' });
      await reload(true);
    });

    it('switches a reason off after confirming in the app pop-up', async () => {
      const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
      (el.querySelector('[aria-label="Switch off Conflict of interest"]') as HTMLInputElement).click();
      await settle(fixture);
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Switch the Reason Off?', danger: true }));
      const put = http.expectOne((r) => r.method === 'PUT' && r.url === url);
      expect(put.request.body.reasons[1]).toEqual(expect.objectContaining({ id: 'conflict', active: false }));
      put.flush({ message: 'Rejection reasons saved.' });
      await reload(true);
    });
  });

  describe('a customised list', () => {
    beforeEach(() => setup(true));

    it('resets to the standard reasons after confirming', async () => {
      const ask = vi.spyOn(TestBed.inject(ConfirmService), 'ask').mockResolvedValue(true);
      const reset = button(el, 'Reset to standard reasons');
      expect(reset.disabled).toBe(false);
      reset.click();
      await settle(fixture);
      expect(ask).toHaveBeenCalledWith(expect.objectContaining({ title: 'Reset to the Standard Reasons?', danger: true }));
      const del = http.expectOne((r) => r.method === 'DELETE' && r.url === url);
      del.flush({ message: 'Standard rejection reasons restored.' });
      await reload(false);
      expect(el.querySelector('.alert-success')!.textContent).toContain('Standard rejection reasons restored.');
    });
  });
});
