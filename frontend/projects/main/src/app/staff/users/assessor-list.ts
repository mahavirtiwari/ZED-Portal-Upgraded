import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { AssessorRow, UsersApi } from './users.api';

/**
 * MasterAdmin list of all assessors (optionally of one agency, `?agencyId=`, and verification type,
 * `?type=DA|SA|FA`). Port of Views/User/AssessorList.cshtml: search, page size and paging in the page.
 */
@Component({
  selector: 'zed-staff-assessor-list',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="mt-4">
        <div class="row">
          <div class="col-sm-12">
            <div class="d-flex d-sm-flex justify-content-between align-items-center mb-1">
              <h3 class="registration-title">{{ labels.assessors }}{{ agencyId ? ' of ' + agencyId : '' }}</h3>
              <div class="search-input" style="margin-left: auto">
                <input type="text" class="form-control" style="display: inline; width: 100%" maxlength="50" aria-label="Search assessors"
                       [ngModel]="search()" (ngModelChange)="search.set($event); pageNo.set(1)" />
                <button type="button" aria-label="Search"><i class="fa fa-search"></i></button>
              </div>
            </div>
            @if (error()) {
              <div class="alert alert-danger" role="alert">{{ error() }}</div>
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

        <div class="row justify-content-between mb-4">
          <div class="col-sm-6">
            Show
            <select class="btn btn-primary" aria-label="Entries per page" [ngModel]="pageSize()" (ngModelChange)="pageSize.set(+$event); pageNo.set(1)">
              @for (n of [10, 20, 50, 100]; track n) {
                <option [ngValue]="n">{{ n }}</option>
              }
            </select>
            Entries
          </div>
          <div class="col-sm-6 text-end">
            <button type="button" class="btn btn-primary me-1" (click)="pageNo.set(1)">First</button>
            <button type="button" class="btn btn-primary me-1" (click)="go(pageNo() - 1)">Prev</button>
            <select class="btn btn-primary me-1" aria-label="Page" [ngModel]="pageNo()" (ngModelChange)="go(+$event)">
              @for (i of pages(); track i) {
                <option [ngValue]="i">{{ i }}</option>
              }
            </select>
            <button type="button" class="btn btn-primary me-1" (click)="go(pageNo() + 1)">Next</button>
            <button type="button" class="btn btn-primary" (click)="go(lastPage())">Last</button>
          </div>
        </div>
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
  protected readonly assessors = signal<AssessorRow[]>([]);
  protected readonly search = signal('');
  protected readonly pageSize = signal(20);
  protected readonly pageNo = signal(1);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  /** As before: the search matches any value of the row. */
  protected readonly filtered = computed(() => {
    const s = this.search().trim().toLowerCase();
    return s ? this.assessors().filter((a) => Object.values(a).some((v) => String(v ?? '').toLowerCase().includes(s))) : this.assessors();
  });
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.filtered().length / this.pageSize())));
  protected readonly pages = computed(() => Array.from({ length: this.lastPage() }, (_, i) => i + 1));
  protected readonly page = computed(() => {
    const start = (this.pageNo() - 1) * this.pageSize();
    return this.filtered().slice(start, start + this.pageSize());
  });

  constructor() {
    void this.load();
  }

  protected go(n: number): void {
    this.pageNo.set(Math.min(Math.max(1, n), this.lastPage()));
  }

  private async load(): Promise<void> {
    try {
      this.assessors.set(await firstValueFrom(this.api.allAssessors(this.agencyId, this.type)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
