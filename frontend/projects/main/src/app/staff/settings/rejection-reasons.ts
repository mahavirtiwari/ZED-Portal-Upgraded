import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { PortalSwitchComponent, REJECTION_REASON_PORTALS } from '../admin-portal';
import { itemId } from './submission-checklists';
import { ConfirmService } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

/** What happens to a unit an agency rejects with the reason: round robin to another agency, or back to the Master Admin. */
export type RejectionAction = 'Auto' | 'MasterAdmin';

/** A reason an agency picks when it rejects a unit allotted to it (desktop or site allotment). */
export interface RejectionReasonDef {
  id: string;
  text: string;
  action: RejectionAction;
  active: boolean;
}

export interface RejectionReasonsResponse {
  reasons: RejectionReasonDef[];
  actions: RejectionAction[];
  customised: boolean;
}

export const REJECTION_REASON_LIMITS = { reasons: 40, text: 150 } as const;

/** The wording of an action ("After rejection"). */
export function rejectionActionLabel(a: RejectionAction): string {
  switch (a) {
    case 'Auto': return t('staff.rejectionReasons.action.autoLabel', 'Auto re-allot (round robin)');
    case 'MasterAdmin': return t('staff.rejectionReasons.action.masterAdminLabel', 'Master Admin allots');
    default: return a;
  }
}

interface Editing {
  reason: RejectionReasonDef | null;
  text: string;
  action: RejectionAction;
  active: boolean;
}

/**
 * Admin → Rejection Reasons (2026-11-19, approved): the reasons an assessment agency picks when it rejects a unit allotted to it
 * (desktop and site allotment), each saying what happens next: the unit goes to another agency by round robin, or back to the
 * Master Admin for allotment. Per portal (the portal switch: ZED Certification and Surveillance). Laid out as Observation reasons.
 */
@Component({
  selector: 'zed-staff-rejection-reasons',
  imports: [FormsModule, PortalSwitchComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Rejection reasons' | t: 'staff.rejectionReasons.title' }}</h3>
        <p class="page-sub">{{ 'The reasons an assessment agency picks when it rejects a unit allotted to it, each with what happens to the unit next.' | t: 'staff.rejectionReasons.sub' }}</p>
      </div>
      @if (data(); as d) {
        <div class="page-actions">
          <button type="button" class="btn btn-default" [disabled]="!d.customised || busy()" (click)="resetAll()">{{ 'Reset to standard reasons' | t: 'staff.rejectionReasons.resetButton' }}</button>
          <button type="button" class="btn btn-primary" [disabled]="d.reasons.length >= limits.reasons || busy()" (click)="add()">{{ 'Add reason' | t: 'staff.rejectionReasons.addButton' }}</button>
        </div>
      }
    </div>
    <zed-portal-switch [portals]="portals" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    @if (data(); as d) {
      <div class="table-responsive">
        <table class="table table-zed reasons-table">
          <colgroup>
            <col style="width: 56px" />
            <col />
            <col style="width: 220px" />
            <col class="col-actions" style="width: 268px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">#</th>
              <th>{{ 'Reason' | t: 'staff.rejectionReasons.column.reason' }}</th>
              <th>{{ 'After rejection' | t: 'staff.rejectionReasons.column.after' }}</th>
              <th class="text-end">{{ 'Action' | t: 'staff.rejectionReasons.column.action' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (r of d.reasons; track r.id; let n = $index, last = $last) {
              <tr [class.is-off]="!r.active" [attr.data-id]="r.id">
                <td class="text-center"><span class="order-no">{{ n + 1 }}</span></td>
                <td><span class="reason-text">{{ r.text }}</span></td>
                <td><span class="after" [class.is-auto]="r.action === 'Auto'">{{ actionLabel(r.action) }}</span></td>
                <td>
                  <div class="st-actions">
                    <button type="button" class="btn btn-outline-primary btn-sm st-move" [title]="'Move up' | t: 'staff.rejectionReasons.row.moveUpTooltip'" [attr.aria-label]="'Move up' | t: 'staff.rejectionReasons.row.moveUpTooltip'" [disabled]="n === 0 || busy()" (click)="move(n, -1)">↑</button>
                    <button type="button" class="btn btn-outline-primary btn-sm st-move" [title]="'Move down' | t: 'staff.rejectionReasons.row.moveDownTooltip'" [attr.aria-label]="'Move down' | t: 'staff.rejectionReasons.row.moveDownTooltip'" [disabled]="last || busy()" (click)="move(n, 1)">↓</button>
                    <label class="st-switch" [class.off]="!r.active" [title]="r.active ? ('Switch this reason off' | t: 'staff.rejectionReasons.row.offTooltip') : ('Switch this reason on' | t: 'staff.rejectionReasons.row.onTooltip')">
                      <input type="checkbox" role="switch" [checked]="r.active" [disabled]="busy()" [attr.aria-label]="r.active ? ('Switch off {reason}' | t: 'staff.rejectionReasons.row.offAria' : { reason: r.text }) : ('Switch on {reason}' | t: 'staff.rejectionReasons.row.onAria' : { reason: r.text })"
                        (click)="$event.preventDefault(); toggle(n)" />
                      <span class="st-track" aria-hidden="true"></span>{{ r.active ? ('On' | t: 'staff.rejectionReasons.row.on') : ('Off' | t: 'staff.rejectionReasons.row.off') }}
                    </label>
                    <button type="button" class="btn btn-outline-primary btn-sm st-edit" [disabled]="busy()" (click)="edit(r)">{{ 'Edit' | t: 'staff.rejectionReasons.row.editButton' }}</button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <p class="sync-note">
        <span class="info-dot" aria-hidden="true">i</span>
        @if (!d.customised) { <span class="standard-note">{{ 'Standard reasons (not changed yet).' | t: 'staff.rejectionReasons.standardNote' }}</span> }
        {{ 'Only the reasons switched on are offered to the agencies. A unit already rejected keeps the reason it was rejected with.' | t: 'staff.rejectionReasons.note' }}
      </p>
    } @else if (!busy()) {
      <div class="no-data">{{ 'The rejection reasons could not be loaded' | t: 'staff.rejectionReasons.loadError' }}</div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="rejectionReasonTitle">
        <div class="modal-dialog modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start gap-3">
                <h3 class="registration-title m-0" id="rejectionReasonTitle">{{ e.reason ? ('Edit reason' | t: 'staff.rejectionReasons.dialog.editTitle') : ('Add reason' | t: 'staff.rejectionReasons.dialog.addTitle') }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.rejectionReasons.dialog.closeAria'" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              @let p = check(e);
              <label class="form-label" for="rejectionReasonText">{{ 'Reason' | t: 'staff.rejectionReasons.dialog.reason.label' }}<span class="req">*</span></label>
              <input type="text" class="form-control" id="rejectionReasonText" [maxlength]="limits.text" [placeholder]="'e.g. No assessor available in the area' | t: 'staff.rejectionReasons.dialog.reason.placeholder'" [class.is-invalid]="p" [(ngModel)]="e.text" />
              @if (p) { <small class="invalid">{{ p }}</small> }
              <label class="form-label d-block mt-3" for="rejectionReasonAction">{{ 'After rejection' | t: 'staff.rejectionReasons.dialog.action.label' }}<span class="req">*</span></label>
              <select class="form-select" id="rejectionReasonAction" [(ngModel)]="e.action">
                @for (a of data()?.actions ?? []; track a) { <option [value]="a">{{ actionLabel(a) }}</option> }
              </select>
              <label class="check-line mt-3" for="rejectionReasonActive">
                <input class="form-check-input" type="checkbox" id="rejectionReasonActive" [(ngModel)]="e.active" />
                <span>{{ 'In use' | t: 'staff.rejectionReasons.dialog.active.label' }}</span>
              </label>
              @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.rejectionReasons.dialog.cancelButton' }}</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="save(e)">{{ 'Save' | t: 'staff.rejectionReasons.dialog.saveButton' }}</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .page-actions { display: flex; flex-wrap: wrap; gap: 8px; }
    .reasons-table { table-layout: fixed; width: 100%; min-width: 720px; margin-bottom: 0; }
    .reasons-table td { overflow-wrap: break-word; vertical-align: middle; }
    .reasons-table tr.is-off td { color: #8a9899; }
    .reason-text { font-size: 14px; color: #232527; }
    .is-off .reason-text { color: #8a9899; }
    .after { display: inline-block; font-size: 12px; padding: 2px 10px; border-radius: 10px; background: #eef2f2; color: #3d4f50; border: 1px solid #d9e2e2; }
    .after.is-auto { background: #e6f2f3; color: #24666b; border-color: #cfe3e5; }
    .order-no { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border-radius: 14px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 13px; }
    .sync-note { display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; color: #5f6f70; font-size: 13px; margin: 10px 0 0; }
    .standard-note { font-weight: 600; color: #23474a; }
    .info-dot { flex: 0 0 18px; height: 18px; border-radius: 9px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; font-style: italic; font-family: Georgia, serif; }
    .st-actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; flex-wrap: nowrap; white-space: nowrap; overflow-wrap: normal; }
    .st-actions > * { flex: none; }
    .st-actions .st-move { width: 32px; padding-left: 0; padding-right: 0; font-weight: 700; }
    .st-switch { position: relative; display: inline-flex; align-items: center; gap: 5px; margin: 0 4px; font-size: 12.5px; font-weight: 600; color: #1e7a3c; cursor: pointer; text-transform: none; }
    .st-switch.off { color: #8a9899; }
    .st-switch input { position: absolute; opacity: 0; width: 1px; height: 1px; }
    .st-track { position: relative; width: 30px; height: 16px; border-radius: 9px; background: #45a5ad; flex: none; }
    .st-track::after { content: ''; position: absolute; top: 2px; left: 16px; width: 12px; height: 12px; border-radius: 50%; background: #fff; }
    .st-switch.off .st-track { background: #c3cdce; }
    .st-switch.off .st-track::after { left: 2px; }
    .st-switch input:focus-visible + .st-track { outline: 2px solid var(--zt-dark, #23656b); outline-offset: 2px; }
    /* Phone: one card per row, no sideways scroll. */
    @media (max-width: 767.98px) {
      .reasons-table { min-width: 0; table-layout: auto; }
      .reasons-table thead { display: none; }
      .reasons-table, .reasons-table tbody, .reasons-table tr, .reasons-table td { display: block; width: 100%; }
      .reasons-table tr { border: 1px solid #dfe9ea; border-radius: 10px; padding: 8px 12px; margin-bottom: 10px; background: #fff; }
      .reasons-table td { border: 0; padding: 4px 0; text-align: left !important; }
      .reasons-table td:first-child { display: none; }
      .reasons-table .st-actions { justify-content: flex-start; flex-wrap: wrap; padding-top: 4px; }
    }
    .check-line { display: flex; align-items: center; gap: 8px; font-weight: 400; cursor: pointer; }
    .check-line .form-check-input { margin: 0; float: none; flex: none; }
    .invalid { display: block; color: #a8303a; font-size: 12.5px; margin-top: 3px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class RejectionReasonsPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/rejection-reasons';

  protected readonly limits = REJECTION_REASON_LIMITS;
  protected readonly portals = REJECTION_REASON_PORTALS;
  protected readonly data = signal<RejectionReasonsResponse | null>(null);
  protected readonly editing = signal<Editing | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');
  private readonly tried = signal(false);

  constructor() {
    void this.load();
  }

  protected actionLabel(a: RejectionAction): string {
    return rejectionActionLabel(a);
  }

  protected add(): void {
    this.modalError.set('');
    this.tried.set(false);
    this.editing.set({ reason: null, text: '', action: 'MasterAdmin', active: true });
  }

  protected edit(r: RejectionReasonDef): void {
    this.modalError.set('');
    this.tried.set(false);
    this.editing.set({ reason: r, text: r.text, action: r.action, active: r.active });
  }

  /** The wording's rules (as the server's); null when fine. */
  protected check(e: Editing): string | null {
    const text = e.text.trim();
    if (!text) return this.tried() ? t('staff.rejectionReasons.dialog.error.empty', 'Enter the reason.') : null;
    if (text.length > REJECTION_REASON_LIMITS.text) return t('staff.rejectionReasons.dialog.error.long', 'At most {count} characters.', { count: REJECTION_REASON_LIMITS.text });
    const others = (this.data()?.reasons ?? []).filter((r) => r.id !== e.reason?.id);
    if (others.some((r) => r.text.trim().toLowerCase() === text.toLowerCase())) return t('staff.rejectionReasons.dialog.error.duplicate', 'Another reason has this wording.');
    return null;
  }

  protected async save(e: Editing): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.tried.set(true);
    if (this.check(e)) return;
    const reason: RejectionReasonDef = {
      id: e.reason?.id ?? itemId(e.text.trim(), d.reasons.map((r) => r.id)),
      text: e.text.trim(),
      action: e.action,
      active: e.active,
    };
    const reasons = e.reason ? d.reasons.map((r) => (r.id === e.reason!.id ? reason : r)) : [...d.reasons, reason];
    this.busy.set(true);
    this.modalError.set('');
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(RejectionReasonsPage.url, { reasons }));
      this.editing.set(null);
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(index: number): Promise<void> {
    const reasons = (this.data()?.reasons ?? []).map((x) => ({ ...x }));
    const r = reasons[index];
    if (!r) return;
    if (r.active && !(await this.confirms.ask({
      title: t('staff.rejectionReasons.offDialog.title', 'Switch the Reason Off?'),
      message: t('staff.rejectionReasons.offDialog.message', '"{reason}" is no longer offered to the agencies.', { reason: r.text }),
      confirmLabel: t('staff.rejectionReasons.offDialog.confirmButton', 'Switch Off'), danger: true,
    }))) return;
    r.active = !r.active;
    return this.change(() => this.http.put<MessageResponse>(RejectionReasonsPage.url, { reasons }));
  }

  protected move(index: number, by: -1 | 1): Promise<void> {
    const reasons = [...(this.data()?.reasons ?? [])];
    const target = index + by;
    if (target < 0 || target >= reasons.length) return Promise.resolve();
    [reasons[index], reasons[target]] = [reasons[target], reasons[index]];
    return this.change(() => this.http.put<MessageResponse>(RejectionReasonsPage.url, { reasons }));
  }

  protected async resetAll(): Promise<void> {
    if (!(await this.confirms.ask({
      title: t('staff.rejectionReasons.resetDialog.title', 'Reset to the Standard Reasons?'),
      message: t('staff.rejectionReasons.resetDialog.message', 'The reasons added or changed here are removed.'),
      confirmLabel: t('staff.rejectionReasons.resetDialog.confirmButton', 'Reset'), danger: true,
    }))) return;
    return this.change(() => this.http.delete<MessageResponse>(RejectionReasonsPage.url));
  }

  private async change(request: () => Observable<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(request());
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      this.data.set(await firstValueFrom(this.http.get<RejectionReasonsResponse>(RejectionReasonsPage.url)));
    } catch (err) {
      this.data.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
