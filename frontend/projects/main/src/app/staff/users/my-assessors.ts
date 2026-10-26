import { Component, computed, inject, signal } from '@angular/core';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { OwnAssessorRow, RESET_CONFIRM, UsersApi } from './users.api';
import { PagedView, PagerComponent } from '../pager';

interface Dialog {
  kind: 'block' | 'mobile';
  assessor: OwnAssessorRow;
  text: string;
}

/**
 * The signed-in agency's assessors. Port of Views/User/Assessors.cshtml: block (with reason), unblock
 * (on main not offered while the certificate is attached to another active Bronze Assessor; on consultancy always),
 * edit, and the mobile number change the old ResetMobileNo action provided without a page. V4 layout: + Add New in the
 * page head, search in a filter bar, status badge, row buttons side by side.
 */
@Component({
  selector: 'zed-staff-my-assessors',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ labels.assessors }}</h3>
        <p class="page-sub">Your {{ labels.assessors.toLowerCase() }}: block or unblock, edit, change the mobile number or send a password reset link.</p>
      </div>
      <div class="page-actions">
        <a routerLink="/staff/users/assessors/new" class="btn btn-primary">+ Add New</a>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <div class="filter-bar mb-3">
      <div class="filter wide">
        <input type="search" class="form-control" placeholder="Search ID, name, type, mobile, e-mail or status" aria-label="Search assessors"
               [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-bordered table-zed">
        <thead>
          <tr>
            <th class="text-center" style="width: 100px">Status</th>
            @if (consultancy) {
              <!-- ZEDCS_CONSULTANCY Frontend/User/Assessors.cshtml -->
              <th class="text-center">User Type</th>
              <th class="text-center">Consultant/Expert ID</th>
              <th>Consultant/Expert Details</th>
              <th>Consultant/Expert Contact Details</th>
              <th class="text-center">No. Of Assignments Completed</th>
              <th>Reason for Block</th>
            } @else {
              <th class="text-center" style="width: 80px">Selfie</th>
              <th class="text-center">Assessor Type</th>
              <th class="text-center">Assessor ID</th>
              <th>Assessor Details</th>
              <th>Assessor Conctact Details</th>
            }
            <th class="text-center" style="width: 230px">Action(s)</th>
          </tr>
        </thead>
        <tbody>
          @for (u of view.page(); track u.UserId) {
            <tr class="filterClass">
              <td class="text-center"><span class="status-badge" [class.is-active]="u.IsActive" [class.is-rejected]="!u.IsActive">{{ u.IdStatus }}</span></td>
              @if (!consultancy) {
                <td class="text-center">
                  @if (u.PhotoPath) {
                    <a [href]="u.PhotoPath" target="_blank" rel="noopener"><img alt="Selfie of {{ u.UserName }}" [src]="u.PhotoPath" class="selfie" /></a>
                  }
                </td>
              }
              <td class="text-center"><span class="zed-chip">{{ consultancy ? u.UserType : u.AssessorType }}</span></td>
              <td class="text-center"><strong>{{ u.UserId }}</strong></td>
              <td><strong>{{ u.UserName }}</strong><small class="d-block text-muted">{{ u.Address }}</small><small class="d-block"><strong>{{ u.IdProofNumber }}</strong></small></td>
              <td>{{ u.MobileNo }}<small class="d-block text-muted">{{ u.Email }}</small></td>
              @if (consultancy) {
                <!-- Both cells are empty on the live page. -->
                <td class="text-center"></td>
                <td></td>
              }
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <a [routerLink]="['/staff/users/assessors', u.UserId]" class="btn btn-outline-primary">Edit</a>
                  <!-- V4 addition (not on the old consultancy list): Mobile No and Reset Link. -->
                  <button type="button" class="btn btn-default" [disabled]="saving()" (click)="open('mobile', u)">Mobile No</button>
                  @if (u.IsActive) {
                    <button type="button" class="btn btn-default" [disabled]="saving()" (click)="sendReset(u)">Reset Link</button>
                    <button type="button" class="btn btn-outline-danger" [disabled]="saving()" (click)="open('block', u)">Block</button>
                  } @else if (consultancy || u.IsCertAttached === 0) {
                    <!-- Consultancy: UnBlock for every blocked user, as on the old page (no Bronze certificate rule there). -->
                    <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="unblock(u)">UnBlock</button>
                  }
                </div>
              </td>
            </tr>
          } @empty {
            <tr>
              <td [attr.colspan]="consultancy ? 8 : 7" style="padding: 0"><div class="no-data">{{ search() ? 'No ' + labels.assessor.toLowerCase() + ' matches the search' : 'No Data' }}</div></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (dialog(); as d) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="assessor-dialog-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="assessor-dialog-title">{{ d.kind === 'block' ? 'Reason for Block the ' + (consultancy ? 'Consultant' : 'Assessor') : labels.assessor + ' Mobile Number' }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="dialog.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="submitDialog()" novalidate>
              <div class="modal-body">
                <p class="mb-2"><strong>{{ d.assessor.UserId }}</strong> – {{ d.assessor.UserName }}</p>
                @if (d.kind === 'mobile') {
                  <div class="form-grid">
                    <label for="assessor-mobile">Mobile Number<span class="req">*</span></label>
                    <input id="assessor-mobile" name="text" class="form-control" maxlength="10" inputmode="numeric" [(ngModel)]="d.text" />
                  </div>
                } @else {
                  <label class="visually-hidden" for="assessor-reason">Reason</label>
                  <textarea id="assessor-reason" name="text" class="form-control" maxlength="2000" rows="4" [(ngModel)]="d.text"></textarea>
                }
                @if (dialogError()) {
                  <span class="help-block" role="alert">{{ dialogError() }}</span>
                }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="dialog.set(null)">Cancel</button>
                <button type="submit" class="btn" [class.btn-danger]="d.kind === 'block'" [class.btn-primary]="d.kind !== 'block'" [disabled]="saving()">{{ d.kind === 'block' ? 'Block' : 'Update' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Loading…</span></div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .selfie { max-height: 60px; border-radius: 6px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class MyAssessorsPage {
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly labels = LABELS[this.system];
  private readonly api = inject(UsersApi);

  protected readonly assessors = signal<OwnAssessorRow[]>([]);
  protected readonly search = signal('');
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');

  protected readonly filtered = computed(() => {
    const s = this.search().trim().toLowerCase();
    if (!s) return this.assessors();
    return this.assessors().filter((a) =>
      [a.UserId, a.UserName, a.AssessorType, a.MobileNo, a.Email, a.Address, a.IdStatus].some((v) => (v ?? '').toLowerCase().includes(s)),
    );
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.filtered());

  constructor() {
    const message = (globalThis.history?.state as { message?: unknown } | null)?.message;
    if (typeof message === 'string') this.success.set(message);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.assessors.set(await firstValueFrom(this.api.myAssessors()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected open(kind: Dialog['kind'], assessor: OwnAssessorRow): void {
    this.success.set('');
    this.dialogError.set('');
    this.dialog.set({ kind, assessor, text: kind === 'mobile' ? (assessor.MobileNo ?? '') : '' });
  }

  protected async submitDialog(): Promise<void> {
    const d = this.dialog();
    if (!d) return;
    const text = d.text.trim();
    if (d.kind === 'mobile' ? !/^\d{10}$/.test(text) : !text) {
      this.dialogError.set(d.kind === 'mobile' ? 'Please enter a valid 10 digit mobile number.' : 'This is required.');
      return;
    }
    const call = d.kind === 'block' ? this.api.block('assessors', d.assessor.UserId, text) : this.api.resetMobile('assessors', d.assessor.UserId, text);
    if (await this.run(call, true)) this.dialog.set(null);
  }

  /** E-mails the assessor a link to set a new password. */
  protected async sendReset(u: OwnAssessorRow): Promise<void> {
    if (!window.confirm(RESET_CONFIRM)) return;
    await this.run(this.api.passwordReset('assessors', u.UserId), false);
  }

  protected async unblock(u: OwnAssessorRow): Promise<void> {
    if (!window.confirm('Are you sure that you want to unblock?')) return;
    await this.run(this.api.unblock('assessors', u.UserId), false);
  }

  private async run(call: Observable<MessageResponse>, inDialog: boolean): Promise<boolean> {
    this.saving.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(call)).message);
      await this.load();
      return true;
    } catch (err) {
      (inDialog ? this.dialogError : this.error).set(apiErrorMessage(err));
      return false;
    } finally {
      this.saving.set(false);
    }
  }
}
