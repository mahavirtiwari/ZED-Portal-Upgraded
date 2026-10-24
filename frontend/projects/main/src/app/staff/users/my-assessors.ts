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
 * edit, and the mobile number change the old ResetMobileNo action provided without a page.
 */
@Component({
  selector: 'zed-staff-my-assessors',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="Dashboard-msme mt-4">
        <div class="row">
          <div class="col-sm-12">
            <div class="d-flex d-sm-flex justify-content-between align-items-center mb-1">
              <h3 class="registration-title">{{ labels.assessors }}</h3>
              <div class="search-input" style="margin-left: auto">
                <input type="text" placeholder="Search.." aria-label="Search assessors" [ngModel]="search()" (ngModelChange)="search.set($event)" />
                <button type="button" aria-label="Search"><i class="fa fa-search"></i></button>
              </div>
              <a style="margin-left: 10px" routerLink="/staff/users/assessors/new" class="btn btn-primary">+ Add New</a>
            </div>
          </div>
        </div>
        @if (error()) {
          <div class="alert alert-danger" role="alert">{{ error() }}</div>
        }
        @if (success()) {
          <div class="alert alert-success" role="status">{{ success() }}</div>
        }
        <div class="row mb-2">
          <div class="col-sm-12">
            <div class="table-responsive">
              <table class="table table-bordered table-zed bg-white">
                <thead>
                  <tr class="text-center" style="font-size: 16px">
                    <th>Status</th>
                    @if (consultancy) {
                      <!-- ZEDCS_CONSULTANCY Frontend/User/Assessors.cshtml -->
                      <th>User Type</th>
                      <th>Consultant/Expert ID</th>
                      <th>Consultant/Expert Details</th>
                      <th>Consultant/Expert Contact Details</th>
                      <th>No. Of Assignments Completed</th>
                      <th>Reason for Block</th>
                    } @else {
                      <th>Selfie</th>
                      <th>Assessor Type</th>
                      <th>Assessor ID</th>
                      <th>Assessor Details</th>
                      <th>Assessor Conctact Details</th>
                    }
                    <th>Action(s)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (u of view.page(); track u.UserId) {
                    <tr class="filterClass">
                      <td><strong>{{ u.IdStatus }}</strong></td>
                      @if (!consultancy) {
                        <td>
                          @if (u.PhotoPath) {
                            <a [href]="u.PhotoPath" target="_blank" rel="noopener"><img alt="Selfie of {{ u.UserName }}" [src]="u.PhotoPath" class="align-center img-responsive" style="max-height: 60px" /></a>
                          }
                        </td>
                      }
                      <td><strong>{{ consultancy ? u.UserType : u.AssessorType }}</strong></td>
                      <td><strong>{{ u.UserId }}</strong></td>
                      <td><strong>{{ u.UserName }}</strong><br />{{ u.Address }}<br /><strong>{{ u.IdProofNumber }}</strong></td>
                      <td>{{ u.MobileNo }}<br />{{ u.Email }}</td>
                      @if (consultancy) {
                        <!-- Both cells are empty on the live page. -->
                        <td></td>
                        <td></td>
                      }
                      <td class="text-center">
                        @if (u.IsActive) {
                          <button type="button" class="btn btn-default" style="width: 100px" [disabled]="saving()" (click)="open('block', u)">Block</button><br />
                        } @else if (consultancy || u.IsCertAttached === 0) {
                          <!-- Consultancy: UnBlock for every blocked user, as on the old page (no Bronze certificate rule there). -->
                          <button type="button" class="btn btn-primary" style="width: 100px" [disabled]="saving()" (click)="unblock(u)">UnBlock</button><br />
                        }
                        <a [routerLink]="['/staff/users/assessors', u.UserId]" class="btn btn-primary btn-sm" style="width: 100px; margin-top: 5px">Edit</a><br />
                        <!-- V4 addition (not on the old consultancy list): Mobile No and Reset Link. -->
                        <button type="button" class="btn btn-default btn-sm" style="width: 100px; margin-top: 5px" [disabled]="saving()" (click)="open('mobile', u)">Mobile No</button>
                        @if (u.IsActive) {
                          <br /><button type="button" class="btn btn-default btn-sm" style="width: 100px; margin-top: 5px" [disabled]="saving()" (click)="sendReset(u)">Reset Link</button>
                        }
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td [attr.colspan]="consultancy ? 8 : 7" style="padding: 0"><div class="no-data">No Data</div></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <zed-pager [pager]="view" />
          </div>
        </div>
      </div>
    </div>

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
                  <label class="visually-hidden" for="assessor-mobile">Mobile Number</label>
                  <input id="assessor-mobile" name="text" class="form-control" maxlength="10" inputmode="numeric" [(ngModel)]="d.text" />
                } @else {
                  <label class="visually-hidden" for="assessor-reason">Reason</label>
                  <textarea id="assessor-reason" name="text" class="form-control" maxlength="2000" style="height: 100px" [(ngModel)]="d.text"></textarea>
                }
                @if (dialogError()) {
                  <span class="help-block" role="alert">{{ dialogError() }}</span>
                }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="dialog.set(null)">Cancel</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ d.kind === 'block' ? 'Block' : 'Update' }}</button>
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
