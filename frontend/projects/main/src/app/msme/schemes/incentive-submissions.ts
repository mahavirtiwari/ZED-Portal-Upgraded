import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PublicFrame } from './incentives';
import { IncentiveSubmission, STATES, SchemesApi } from './schemes.api';

const PAGE_SIZE = 10;

/**
 * Public list of incentives disbursed to ZED-certified units ("API Incentives Submitted").
 * Port of Frontend/Incentive/SubmissionsPublic.cshtml with only non-personal columns: the old page also
 * showed the Udyam number and scheme application id and could be filtered by gender (decision pending).
 * Query parameters as before: id (state), ct (level), msmeSize.
 */
@Component({
  selector: 'zed-public-incentive-submissions',
  imports: [PublicFrame],
  template: `
    <zed-public-frame>
      <div class="container form-page" id="zed_user_form">
        <div class="incentive-page">
          <div class="panel panel-default panel-grey m-t-2 mb-3">
            <div class="panel-body p-3">
              <div class="d-flex flex-wrap gap-3 align-items-end">
                <div>
                  <label for="subState">State</label>
                  <select id="subState" class="form-control" style="width: 200px" [value]="state()" (change)="filter({ id: value($event) })">
                    <option value="">All</option>
                    @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
                  </select>
                </div>
                <div>
                  <label for="subLevel">Certification Level</label>
                  <select id="subLevel" class="form-control" style="width: 200px" [value]="ct()" (change)="filter({ ct: value($event) })">
                    <option value="">All</option>
                    <option value="Bronze">Bronze</option>
                    <option value="Silver">Silver</option>
                    <option value="Gold">Gold</option>
                  </select>
                </div>
                <div>
                  <label for="subSize">MSME Size</label>
                  <select id="subSize" class="form-control" style="width: 200px" [value]="size()" (change)="filter({ msmeSize: value($event) })">
                    <option value="">All</option>
                    <option value="Micro">Micro</option>
                    <option value="Small">Small</option>
                    <option value="Medium">Medium</option>
                  </select>
                </div>
              </div>
            </div>
          </div>

          <div class="panel panel-default panel-incentive m-b-2"><h4 class="incentive-title">API Incentives Submitted</h4></div>
          @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
          @if (rows().length) {
            <div class="panel panel-default panel-grey">
              <table class="table table-striped bg-white" id="incSubmissions">
                <thead><tr><th>S.No</th><th>Unit Name<br />State Name</th><th>Certification</th><th>Service Name<br />Incentive Name</th></tr></thead>
                <tbody>
                  @for (r of pageRows(); track $index) {
                    <tr>
                      <td>{{ start() + $index + 1 }}</td>
                      <td>{{ r.PUnitName }}<br />{{ r.PStateName }}</td>
                      <td>{{ r.Certification }}</td>
                      <td>{{ r.ServiceName ?? r.DataFrom }}<br />{{ r.IncentiveName }}</td>
                    </tr>
                  }
                </tbody>
              </table>
              <div class="d-flex justify-content-between align-items-center p-2">
                <span>Page {{ pageNo() }} of {{ lastPage() }}</span>
                <div class="btn-group">
                  <button type="button" class="btn btn-default btn-sm" [disabled]="pageNo() === 1" (click)="pageNo.set(pageNo() - 1)">Previous</button>
                  <button type="button" class="btn btn-default btn-sm" [disabled]="pageNo() >= lastPage()" (click)="pageNo.set(pageNo() + 1)">Next</button>
                </div>
              </div>
            </div>
          } @else if (loaded()) {
            <div class="label-highlight4">
              <div class="no-incentive-block"><img src="/Images/svgicons/no-incentive.svg" alt="" /><p>No incentives found for the selection.</p></div>
            </div>
          }
        </div>
      </div>
    </zed-public-frame>
  `,
})
export class PublicIncentiveSubmissionsPage {
  private readonly api = inject(SchemesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap, { initialValue: this.route.snapshot.queryParamMap });

  protected readonly states = STATES;
  protected readonly state = computed(() => this.query().get('id') ?? '');
  protected readonly ct = computed(() => this.query().get('ct') ?? '');
  protected readonly size = computed(() => this.query().get('msmeSize') ?? '');
  protected readonly rows = signal<IncentiveSubmission[]>([]);
  protected readonly loaded = signal(false);
  protected readonly error = signal('');
  protected readonly pageNo = signal(1);
  protected readonly lastPage = computed(() => Math.max(1, Math.ceil(this.rows().length / PAGE_SIZE)));
  protected readonly start = computed(() => (this.pageNo() - 1) * PAGE_SIZE);
  protected readonly pageRows = computed(() => this.rows().slice(this.start(), this.start() + PAGE_SIZE));

  constructor() {
    effect(() => {
      const [state, ct, size] = [this.state(), this.ct(), this.size()];
      void this.load(state, ct, size);
    });
  }

  protected value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }

  protected filter(change: Record<string, string>): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: change, queryParamsHandling: 'merge' });
  }

  private async load(state: string, ct: string, size: string): Promise<void> {
    this.error.set('');
    try {
      this.rows.set(await firstValueFrom(this.api.incentiveSubmissions(state, ct, size)));
      this.pageNo.set(1);
    } catch (err) {
      this.rows.set([]);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loaded.set(true);
    }
  }
}
