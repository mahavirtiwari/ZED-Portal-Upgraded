import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { AssessorRow, RESET_CONFIRM, UsersApi } from './users.api';
import { ClientPager, PagerComponent } from '../pager';

/**
 * MasterAdmin list of all assessors (optionally of one agency, `?agencyId=`, and verification type,
 * `?type=DA|SA|FA`). Port of Views/User/AssessorList.cshtml: search, page size and paging in the page. V4 layout: search in
 * a filter bar, status badge, row buttons side by side.
 */
@Component({
  selector: 'zed-staff-assessor-list',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ consultancy ? 'Consultants' : labels.assessors }}{{ agencyId ? ' of ' + agencyId : '' }}</h3>
        <p class="page-sub">{{ consultancy ? 'Consultants' : labels.assessors }} of the {{ labels.agencies.toLowerCase() }}, with their details and status.</p>
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
        <input type="search" class="form-control" maxlength="50" placeholder="Search ID, name, mobile, e-mail or agency" aria-label="Search assessors"
               [ngModel]="search()" (ngModelChange)="pager.setSearch($event)" />
      </div>
    </div>
    <div class="table-responsive">
      <table class="table table-zed table-bordered">
        <thead>
          <tr>
            <th class="text-center" style="width: 60px">S.No</th>
            <th class="text-center" style="width: 100px">Status</th>
            @if (consultancy) {
              <!-- ZEDCS_CONSULTANCY Frontend/User/AssessorList.cshtml -->
              <th class="text-center">Consultant ID</th>
              <th>Consultant Details</th>
              <th>Consultant Organisation Details</th>
              <th class="text-center">No. Of Consulting Completed</th>
            } @else {
              <th class="text-center">Assessor Type</th>
              <th class="text-center">Assessor ID</th>
              <th>Assessor Details</th>
              <th>{{ labels.agency }} Details</th>
            }
            <th class="text-center" style="width: 180px">Action(s)</th>
          </tr>
        </thead>
        <tbody>
          @for (s of page(); track s.UserId) {
            <tr class="filterClass">
              <td class="text-center">{{ s.RowNumber }}</td>
              <td class="text-center"><span class="status-badge" [class.is-active]="s.IsActive" [class.is-rejected]="!s.IsActive">{{ s.IdStatus }}</span></td>
              @if (!consultancy) {
                <td class="text-center"><span class="zed-chip">{{ s.AssessorType }}</span></td>
              }
              <td class="text-center"><strong>{{ s.UserId }}</strong></td>
              <td class="word-break">
                <strong>{{ s.UserName }}</strong>
                <small class="d-block">{{ s.MobileNo }}</small>
                <small class="d-block">{{ s.Email }}</small>
                <small class="d-block text-muted">{{ s.Address }}</small>
              </td>
              <td><strong>{{ s.AgencyUserName }}</strong><small class="d-block text-muted">{{ s.AgencyUserId }}</small></td>
              @if (consultancy) {
                <!-- The live page prints 0 for each milestone (no count is read). -->
                <td class="text-center"><div>Milestone 1: <strong>0</strong></div><div>Milestone 2: <strong>0</strong></div><div>Milestone 3: <strong>0</strong></div></td>
              }
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  <a [routerLink]="['/staff/users/assessors', s.UserId]" class="btn btn-outline-primary">View</a>
                  <!-- V4 addition (not on the old consultancy list): Reset Link. -->
                  @if (s.IsActive) {
                    <button type="button" class="btn btn-default" [disabled]="busy()" (click)="sendReset(s)">Reset Link</button>
                  }
                </div>
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" style="padding: 0"><div class="no-data">No Data Entered</div></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="pager" />
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Loading…</span></div>
    }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class AssessorListPage {
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly labels = LABELS[this.system];
  private readonly api = inject(UsersApi);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly agencyId = this.query.get('agencyId') ?? '';
  protected readonly type = this.query.get('type') ?? '';
  /** Paged (20 per page) and searched (any value of the row) in the browser, as before. */
  protected readonly pager = new ClientPager<AssessorRow>(20);
  protected readonly search = this.pager.search;
  protected readonly page = this.pager.page;
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  /** E-mails the assessor a link to set a new password. */
  protected async sendReset(s: AssessorRow): Promise<void> {
    if (!window.confirm(RESET_CONFIRM)) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.passwordReset('assessors', s.UserId))).message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.pager.set(await firstValueFrom(this.api.allAssessors(this.agencyId, this.type)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
