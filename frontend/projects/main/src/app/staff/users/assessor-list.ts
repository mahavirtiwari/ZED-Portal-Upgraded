import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { AssessorRow, RESET_CONFIRM, UsersApi } from './users.api';
import { ClientPager, PagerComponent } from '../pager';

/**
 * MasterAdmin list of all assessors (optionally of one agency, `?agencyId=`, and verification type,
 * `?type=DA|SA|FA`). Port of Views/User/AssessorList.cshtml: search, page size and paging in the page.
 */
@Component({
  selector: 'zed-staff-assessor-list',
  imports: [FormsModule, RouterLink, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="mt-4">
        <div class="row">
          <div class="col-sm-12">
            <div class="d-flex d-sm-flex justify-content-between align-items-center mb-1">
              <h3 class="registration-title">{{ labels.assessors }}{{ agencyId ? ' of ' + agencyId : '' }}</h3>
              <div class="search-input" style="margin-left: auto">
                <input type="text" class="form-control" style="display: inline; width: 100%" maxlength="50" aria-label="Search assessors"
                       [ngModel]="search()" (ngModelChange)="pager.setSearch($event)" />
                <button type="button" aria-label="Search"><i class="fa fa-search"></i></button>
              </div>
            </div>
            @if (error()) {
              <div class="alert alert-danger" role="alert">{{ error() }}</div>
            }
            @if (success()) {
              <div class="alert alert-success" role="status">{{ success() }}</div>
            }
            <div class="table-responsive">
              <table class="table table-zed table-bordered bg-white">
                <thead>
                  <tr class="btn-default text-center" style="font-size: 16px">
                    <th>S.No</th>
                    <th>Status</th>
                    <th>{{ consultancy ? 'Type' : 'Assessor Type' }}</th>
                    <th>{{ consultancy ? 'ID' : 'Assessor ID' }}</th>
                    <th>Assessor Details</th>
                    <th>{{ labels.agency }} Details</th>
                    <th>Action(s)</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of page(); track s.UserId) {
                    <tr class="filterClass">
                      <td><strong>{{ s.RowNumber }}</strong></td>
                      <td><strong>{{ s.IdStatus }}</strong></td>
                      <td><strong>{{ consultancy ? 'Consultant' : s.AssessorType }}</strong></td>
                      <td><strong>{{ s.UserId }}</strong></td>
                      <td class="word-break"><strong>{{ s.UserName }}</strong><br />{{ s.MobileNo }}<br />{{ s.Email }}<br />{{ s.Address }}</td>
                      <td><strong>{{ s.AgencyUserName }}</strong><br />{{ s.AgencyUserId }}</td>
                      <td class="text-center">
                        <a [routerLink]="['/staff/users/assessors', s.UserId]" class="btn btn-primary btn-sm" style="width: 100px; margin-top: 5px">View</a>
                        @if (s.IsActive) {
                          <br /><button type="button" class="btn btn-default btn-sm" style="width: 100px; margin-top: 5px" [disabled]="busy()" (click)="sendReset(s)">Reset Link</button>
                        }
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
          </div>
        </div>

        <zed-pager [pager]="pager" />
      </div>
    </div>
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Loading…</span></div>
    }
  `,
  styles: `.loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class AssessorListPage {
  protected readonly consultancy = PORTAL_SYSTEM === 'consultancy';
  protected readonly labels = PORTAL_LABELS;
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
