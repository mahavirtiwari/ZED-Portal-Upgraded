import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Counts, CountsFilter, DashboardApi, Row } from './dashboard.api';
import { SIZES, STATE_NAMES, text } from './dashboard-filters';

interface Card {
  css: string;
  title: string;
  lines: { label: string; field: string }[];
}

/** The four cards of Views/Dashboard/Index.cshtml (column names of SP_DASHBOARD_GET_DETAILS). */
const CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE CERTIFICATION', lines: [
      { label: 'Total Application', field: 'BronzeTotal' }, { label: 'DA Pending', field: 'BronzePending' },
      { label: 'NC Raised', field: 'BronzeNcRaised' }, { label: 'Certified', field: 'BronzeCompleted' }, { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER CERTIFICATION', lines: [
      { label: 'Total Application', field: 'SilverTotal' }, { label: 'SA Pending', field: 'SaSilverPending' },
      { label: 'NC Raised', field: 'SilverNcRaised' }, { label: 'Certified', field: 'SaSilverCompleted' }, { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD CERTIFICATION', lines: [
      { label: 'Total Application', field: 'GoldTotal' }, { label: 'SA Pending', field: 'SaGoldPending' },
      { label: 'NC Raised', field: 'GoldNcRaised' }, { label: 'Certified', field: 'SaGoldCompleted' }, { label: 'Rejected', field: 'GoldRejected' },
    ],
  },
  {
    css: 'panel-finance', title: 'Financial Assistance', lines: [
      { label: 'Total Application', field: 'FaTotal' }, { label: 'Approved', field: 'FaCompleted' },
      { label: 'Pending', field: 'FaPending' }, { label: 'Rejected', field: 'FaRejected' },
    ],
  },
];

/**
 * Staff home dashboard. Port of Views/Dashboard/Index.cshtml: certification cards (scoped to the user by the
 * API) and registered/certified counts with filters. The counts strip showed placeholder numbers until the
 * request returned; here it shows "-" instead.
 */
@Component({
  selector: 'zed-staff-dashboard',
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12"><h3 class="registration-title dash-text-clr">Welcome</h3></div>
      </div>
      @if (error()) {
        <div class="alert alert-danger" role="alert">
          {{ error() }} <button type="button" class="btn btn-link" (click)="load()">Try again</button>
        </div>
      }
      <div class="Dashboard">
        <div class="panel panel-default panel-dashboard panel-bg-default">
          <div class="panel-body">
            <div class="row mb-4">
              <div class="col-sm-12">
                <div class="dashboard-cert-block">
                  @for (card of cards; track card.title) {
                    <div class="panel panel-default panel-cert-block" [class]="card.css">
                      <div class="panel-heading"><h5>{{ card.title }}</h5></div>
                      <div class="panel-body">
                        <div class="inner">
                          @for (line of card.lines; track line.field) {
                            <p>{{ line.label }}: <span [attr.data-field]="line.field">{{ value(line.field) }}</span></p>
                          }
                        </div>
                      </div>
                    </div>
                  }
                </div>
              </div>
            </div>

            <div class="row">
              <div class="col-sm-12 mb-4">
                <div class="d-flex flex-wrap gap-2">
                  <div>
                    <label for="d-state"><strong>Filter by State</strong></label>
                    <select class="form-select" style="width: 200px" id="d-state" (change)="setFilter('state', $event)">
                      <option value="">Show All</option>
                      @for (s of stateNames; track s) { <option [value]="s">{{ s }}</option> }
                    </select>
                  </div>
                  <div>
                    <label for="d-size"><strong>MSME Size</strong></label>
                    <select class="form-select" style="width: 200px" id="d-size" (change)="setFilter('size', $event)">
                      <option value="">Show All</option>
                      @for (s of sizes; track s) { <option [value]="s">{{ s }}</option> }
                    </select>
                  </div>
                  <div>
                    <label for="d-social"><strong>Social Category</strong></label>
                    <select class="form-select" style="width: 200px" id="d-social" (change)="setFilter('socialCategory', $event)">
                      <option value="">Show All</option>
                      @for (s of socialCategories; track s) { <option [value]="s">{{ s }}</option> }
                    </select>
                  </div>
                  <div>
                    <label for="d-gender"><strong>Gender</strong></label>
                    <select class="form-select" style="width: 200px" id="d-gender" (change)="setFilter('gender', $event)">
                      <option value="">Show All</option>
                      <option value="male">Male</option>
                      <option value="female">Female</option>
                      <option value="OTHERS">Others</option>
                    </select>
                  </div>
                </div>
              </div>
              <div class="col-sm-12">
                <div class="cert-section certDetail-block unitDetail-sec1">
                  <div class="registered"><p>Registered</p><h1 id="registered">{{ count('total') }}</h1></div>
                  <div class="bronzeVerified"><p>Bronze</p><h1 id="bronze">{{ count('bronze') }}</h1></div>
                  <div class="goldVerified"><p>Gold</p><h1 id="gold">{{ count('gold') }}</h1></div>
                  <div class="silverVerified"><p>Silver</p><h1 id="silver">{{ count('silver') }}</h1></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
    @if (loading()) {
      <div class="loadingdiv" role="status"><img src="/Images/loading.gif" alt="Loading" /></div>
    }
  `,
  styles: `
    .Dashboard .panel-cert-block, .Dashboard .panel-cert-block:hover { height: 200px; width: 250px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class StaffDashboardPage {
  private readonly api = inject(DashboardApi);

  protected readonly cards = CARDS;
  protected readonly stateNames = STATE_NAMES;
  protected readonly sizes = SIZES;
  protected readonly socialCategories = ['General', 'SC', 'ST', 'OBC'];

  protected readonly summary = signal<Row | null>(null);
  protected readonly counts = signal<Counts | null>(null);
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  private filter: CountsFilter = {};

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const [summary] = await Promise.all([firstValueFrom(this.api.summary()), this.loadCounts()]);
      this.summary.set(summary);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected value(field: string): string {
    const s = this.summary();
    return s ? text(s, field) || '0' : '';
  }

  protected count(key: keyof Counts): string {
    const c = this.counts();
    return c ? Number(c[key] ?? 0).toLocaleString('en-IN') : '-';
  }

  protected async setFilter(key: keyof CountsFilter, event: Event): Promise<void> {
    this.filter = { ...this.filter, [key]: (event.target as HTMLSelectElement).value };
    this.error.set('');
    try {
      await this.loadCounts();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  private async loadCounts(): Promise<void> {
    this.counts.set(await firstValueFrom(this.api.counts(this.filter)));
  }
}
