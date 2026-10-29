import { Component, computed, inject, signal } from '@angular/core';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { assessorTypeLabel, initialsOf } from './assessor-list';
import { OwnAssessorRow, RESET_CONFIRM, UsersApi } from './users.api';
import { PagedView, PagerComponent } from '../pager';

interface Dialog {
  kind: 'block' | 'mobile';
  assessor: OwnAssessorRow;
  text: string;
}

/** Which assessors the list shows (the status tiles). */
type StatusFilter = 'all' | 'active' | 'blocked';

/**
 * The signed-in agency's assessors. Port of Views/User/Assessors.cshtml: block (with reason), unblock
 * (on main not offered while the certificate is attached to another active Bronze Assessor; on consultancy always),
 * edit, and the mobile number change the old ResetMobileNo action provided without a page. V4 layout: + Add New in the
 * page head, tiles with all, active and blocked assessors (a click filters), a search box, a row per assessor with the
 * selfie or initials, the masked ID proof under the name, the type and sector type as chips, contact with icons, status
 * badges, a note where UnBlock is not offered, a card per assessor on phones, and an empty state that leads to Add.
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

    @if (loaded() && !assessors().length) {
      <div class="zed-card ma-empty">
        <span class="ma-empty-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M19 8v6M16 11h6" />
          </svg>
        </span>
        <h4 class="ma-empty-title">No {{ labels.assessors.toLowerCase() }} yet</h4>
        <p class="muted ma-empty-text">
          @if (consultancy) {
            Add a consultant/expert: search the certified professional by certificate number and registered e-mail, then fill in the address and ID proof.
          } @else {
            Add your first assessor: search the certified professional by certificate number and registered e-mail, then fill in the address,
            ID proof, states, NIC sectors and sector type.
          }
        </p>
        <a routerLink="/staff/users/assessors/new" class="btn btn-primary">+ Add {{ labels.assessor }}</a>
      </div>
    } @else {
      <div class="ma-stats" role="group" [attr.aria-label]="labels.assessors + ' by status'">
        @for (t of tiles(); track t.key) {
          <button type="button" class="ma-stat" [class]="'tile-' + t.key" [class.is-on]="status() === t.key" [attr.aria-pressed]="status() === t.key" (click)="status.set(t.key)">
            <span class="ma-stat-count">{{ t.count }}</span>
            <span class="ma-stat-label">{{ t.label }}</span>
          </button>
        }
      </div>

      <div class="zed-card ma-list">
        <div class="ma-toolbar">
          <input type="search" class="form-control ma-search" placeholder="Search ID, name, type, mobile, e-mail or status" aria-label="Search assessors"
                 [ngModel]="search()" (ngModelChange)="search.set($event)" />
          <span class="muted ma-showing">{{ filtered().length }} of {{ assessors().length }} {{ labels.assessors.toLowerCase() }}</span>
        </div>
        <div class="table-responsive">
          <table class="table table-zed ma-table">
            <thead>
              <tr>
                <!-- ZEDCS_CONSULTANCY Frontend/User/Assessors.cshtml (its empty No. Of Assignments and Reason for Block columns are left out). -->
                <th>{{ labels.assessor }} Details</th>
                <th>{{ consultancy ? 'User Type' : 'Type and Sector' }}</th>
                <th>Contact Details</th>
                <th class="text-center" style="width: 100px">Status</th>
                <th class="text-center" style="width: 230px">Action(s)</th>
              </tr>
            </thead>
            <tbody>
              @for (u of view.page(); track u.UserId) {
                <tr class="filterClass" [class.is-blocked]="!u.IsActive">
                  <td class="ma-person-cell">
                    <div class="ma-user">
                      @if (!consultancy && u.PhotoPath) {
                        <a class="ma-photo" [href]="u.PhotoPath" target="_blank" rel="noopener"><img alt="Selfie of {{ u.UserName }}" [src]="u.PhotoPath" class="selfie" /></a>
                      } @else {
                        <span class="ma-avatar" aria-hidden="true">{{ initials(u.UserName) }}</span>
                      }
                      <span class="ma-who">
                        <span class="ma-name">{{ u.UserName }}</span>
                        <span class="ma-id">{{ u.UserId }}</span>
                        @if (u.IdProofNumber) { <span class="ma-id">ID proof <strong>{{ u.IdProofNumber }}</strong></span> }
                      </span>
                      <span class="status-badge ma-badge-phone" [class.is-active]="u.IsActive" [class.is-rejected]="!u.IsActive">{{ u.IdStatus }}</span>
                    </div>
                  </td>
                  <td class="ma-type-cell" [attr.data-label]="consultancy ? 'User Type' : 'Type and Sector'">
                    <span class="zed-chip">{{ typeLabel(consultancy ? u.UserType : u.AssessorType) }}</span>
                    @if (!consultancy) {
                      @if (u.SectorActivity) {
                        <span class="sector-chip" [class]="'sector-' + u.SectorActivity.toLowerCase()">{{ u.SectorActivity }}</span>
                      } @else {
                        <span class="sector-chip sector-none">Sector type not set</span>
                      }
                    }
                  </td>
                  <td class="ma-contact" data-label="Contact Details">
                    @if (u.MobileNo) { <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg>{{ u.MobileNo }}</span> }
                    @if (u.Email) { <span class="ma-mail"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v9H2z M2 4l6 4.5L14 4"/></svg>{{ u.Email }}</span> }
                    @if (u.Address) { <span class="ma-address" [title]="u.Address">{{ u.Address }}</span> }
                  </td>
                  <td class="text-center ma-status-cell"><span class="status-badge" [class.is-active]="u.IsActive" [class.is-rejected]="!u.IsActive">{{ u.IdStatus }}</span></td>
                  <td class="text-center ma-actions-cell">
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
                    @if (!u.IsActive && !consultancy && u.IsCertAttached !== 0) {
                      <small class="ma-note">The certificate is attached to another active Bronze Assessor.</small>
                    }
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row">
                  <td colspan="5" style="padding: 0">
                    <div class="no-data">
                      No {{ labels.assessor.toLowerCase() }} matches the search.
                      <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="view" />
      </div>
    }

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
                <div class="ma-dialog-who">
                  <span class="ma-avatar" aria-hidden="true">{{ initials(d.assessor.UserName) }}</span>
                  <span class="ma-who"><span class="ma-name">{{ d.assessor.UserName }}</span><span class="ma-id">{{ d.assessor.UserId }}</span></span>
                </div>
                @if (d.kind === 'mobile') {
                  <div class="form-grid">
                    <label for="assessor-mobile">Mobile Number<span class="req">*</span></label>
                    <input id="assessor-mobile" name="text" class="form-control" maxlength="10" inputmode="numeric" [(ngModel)]="d.text" />
                  </div>
                } @else {
                  <label class="form-label" for="assessor-reason">Reason<span class="req">*</span></label>
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
    .ma-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .ma-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 18px; text-align: left; min-width: 0;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 1px 2px rgba(35,71,74,.05); cursor: pointer; }
    .ma-stat:hover { border-color: #45a5ad; }
    .ma-stat.is-on { border-color: #45a5ad; box-shadow: inset 0 0 0 1px #45a5ad; background: #eef6f6; }
    .ma-stat-count { font-size: 26px; font-weight: 700; color: #23474a; line-height: 1.1; }
    .ma-stat.tile-active .ma-stat-count { color: #1e7a3c; }
    .ma-stat.tile-blocked .ma-stat-count { color: #a8303a; }
    .ma-stat-label { font-size: 13px; color: #5f6f70; font-weight: 600; }

    .ma-list { padding: 16px; }
    .ma-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; margin-bottom: 12px; }
    .ma-search { flex: 1 1 260px; max-width: 420px; }
    .ma-showing { font-size: 13px; }

    .ma-table { margin-bottom: 8px; }
    .ma-table td { vertical-align: middle; overflow-wrap: anywhere; font-size: 14px; }
    .ma-table tbody tr:hover td { background: #f7fbfb; }
    .ma-table tr.is-blocked td { background: #fbf7f7; }
    .ma-user { display: flex; align-items: center; gap: 12px; min-width: 200px; }
    .ma-who { min-width: 0; }
    .ma-avatar { flex: 0 0 40px; width: 40px; height: 40px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); font-weight: 700; font-size: 13px; letter-spacing: .03em; }
    tr.is-blocked .ma-avatar { background: #f3e9e9; color: #9b4a4a; }
    .ma-photo { flex: 0 0 40px; }
    .selfie { width: 40px; height: 40px; object-fit: cover; border-radius: 50%; border: 1px solid #dfe9ea; }
    .ma-name { display: block; font-weight: 600; color: #232527; }
    .ma-id { display: block; font-size: 12px; color: #6b7f80; letter-spacing: .3px; }
    .ma-id strong { color: #3b4b4c; }
    .ma-badge-phone { display: none; }
    .ma-type-cell { min-width: 140px; }
    .ma-type-cell .zed-chip { margin: 0 0 4px; white-space: nowrap; }
    .sector-chip { display: table; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; background: #e6f6ec; color: #1e7a3c; }
    .sector-chip.sector-services { background: #f1f0fb; color: #3f3a7a; }
    .sector-chip.sector-both { background: #eef6f6; color: #2f7c83; }
    .sector-chip.sector-none { background: #fff4d6; color: #8a6100; }
    .ma-contact { min-width: 220px; }
    .ma-contact span { display: flex; align-items: center; gap: 6px; line-height: 1.6; }
    .ma-contact .ma-mail { font-size: 13px; color: #5f6f70; }
    .ma-contact .ma-address { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; font-size: 12px; color: #6b7f80; line-height: 1.45; margin-top: 2px; }
    .ma-contact svg { flex: 0 0 13px; width: 13px; height: 13px; fill: none; stroke: #2f7c83; stroke-width: 1.4; stroke-linejoin: round; }
    .ma-actions-cell { overflow-wrap: normal !important; }
    .ma-actions-cell .btn { white-space: nowrap; }
    .ma-note { display: block; margin-top: 6px; font-size: 12px; color: #8a6100; line-height: 1.4; }
    .no-data .btn-link { font-weight: 600; }

    .ma-empty { text-align: center; padding: 40px 20px; }
    .ma-empty-icon { display: inline-flex; align-items: center; justify-content: center; width: 64px; height: 64px; border-radius: 50%; background: #eef6f6; color: #2f7c83; margin-bottom: 12px; }
    .ma-empty-title { font-size: 18px; font-weight: 700; color: #23474a; margin: 0 0 6px; }
    .ma-empty-text { max-width: 520px; margin: 0 auto 16px; font-size: 14px; }

    .ma-dialog-who { display: flex; align-items: center; gap: 12px; padding: 10px 12px; margin-bottom: 14px; border-radius: 10px; background: #f5fafa; }

    @media (max-width: 767.98px) {
      .ma-stats { gap: 8px; }
      .ma-stat { padding: 10px 12px; }
      .ma-stat-count { font-size: 22px; }
      .ma-search { max-width: none; }
      .ma-table { min-width: 0; }
      .ma-table thead { display: none; }
      .ma-table, .ma-table tbody, .ma-table tr, .ma-table td { display: block; width: 100%; box-sizing: border-box; }
      .ma-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; }
      .ma-table tr.empty-row { border: 0; padding: 0; }
      .ma-table td { border: 0; padding: 6px 0; text-align: left !important; }
      .ma-table tr.is-blocked { background: #fbf7f7; }
      .ma-table tr.is-blocked td, .ma-table tbody tr:hover td { background: transparent; }
      .ma-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .ma-status-cell { display: none !important; }
      .ma-user { min-width: 0; }
      .ma-who { flex: 1 1 auto; }
      .ma-badge-phone { display: inline-block; }
      .ma-type-cell .zed-chip { margin: 0 6px 0 0; }
      .sector-chip { display: inline-block; }
      .ma-contact, .ma-type-cell { min-width: 0; }
      .ma-actions-cell .row-actions { justify-content: flex-start !important; }
    }
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
  protected readonly status = signal<StatusFilter>('all');
  protected readonly loading = signal(false);
  /** The first load answered (the empty state is not shown before). */
  protected readonly loaded = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly initials = initialsOf;
  protected readonly typeLabel = assessorTypeLabel;

  protected readonly tiles = computed(() => {
    const rows = this.assessors();
    const active = rows.filter((r) => r.IsActive).length;
    return [
      { key: 'all' as const, label: 'All ' + this.labels.assessors.toLowerCase(), count: rows.length },
      { key: 'active' as const, label: 'Active', count: active },
      { key: 'blocked' as const, label: 'Blocked', count: rows.length - active },
    ];
  });

  protected readonly filtered = computed(() => {
    const s = this.search().trim().toLowerCase();
    const status = this.status();
    const rows = status === 'all' ? this.assessors() : this.assessors().filter((a) => (status === 'active') === a.IsActive);
    if (!s) return rows;
    return rows.filter((a) =>
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
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected clearFilters(): void {
    this.search.set('');
    this.status.set('all');
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
