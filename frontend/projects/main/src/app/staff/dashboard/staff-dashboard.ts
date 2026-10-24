import { Component, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Counts, CountsFilter, DashboardApi, Row } from './dashboard.api';
import { SIZES, STATE_NAMES, text } from './dashboard-filters';
import { PortalSystem } from '../../portal-system';
import { STAFF_SYSTEM } from '../staff-menu';

interface Card {
  css: string;
  title: string;
  /** `fixed`: a number the template printed as it is (Surveillance's Bronze "NC Raised: 0"). */
  lines: { label: string; field: string; fixed?: string }[];
}

/** The four cards of Views/Dashboard/Index.cshtml (column names of SP_DASHBOARD_GET_DETAILS). */
const MAIN_CARDS: Card[] = [
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
 * Consultancy (ZEDCS_CONSULTANCY Frontend/Dashboard/Index.cshtml): handholding by milestone and Technology
 * Intervention. MasterAdmin's two count tiles above them are CONSULTANT_TILES.
 */
const CONSULTANCY_CARDS: Card[] = [
  {
    css: 'panel-silver', title: 'Silver Level', lines: [
      { label: 'Total Applications', field: 'SilverTotal' },
      { label: 'Milestone 1 Payment Received', field: 'SilverM1PaymentDone' }, { label: 'Milestone 1 Completed', field: 'SilverCompleted' },
      { label: 'Milestone 2 Payment Received', field: 'SilverM2PaymentDone' }, { label: 'Milestone 2 Completed', field: 'SilverPending' },
      { label: 'Milestone 3 Payment Received', field: 'SilverM3PaymentDone' }, { label: 'Milestone 3 Completed', field: 'SaSilverCompleted' },
    ],
  },
  {
    css: 'panel-gold', title: 'Gold Level', lines: [
      { label: 'Total Applications', field: 'GoldTotal' },
      { label: 'Milestone 1 Payment Received', field: 'GoldM1PaymentDone' }, { label: 'Milestone 1 Completed', field: 'GoldCompleted' },
      { label: 'Milestone 2 Payment Received', field: 'GoldM2PaymentDone' }, { label: 'Milestone 2 Completed', field: 'GoldPending' },
      { label: 'Milestone 3 Payment Received', field: 'GoldM3PaymentDone' }, { label: 'Milestone 3 Completed', field: 'SaGoldCompleted' },
    ],
  },
  {
    css: 'panel-finance', title: 'Technology Intervention', lines: [
      { label: 'Total Application', field: 'FaTotal' }, { label: 'Approved', field: 'FaCompleted' }, { label: 'Pending', field: 'FaPending' },
    ],
  },
];

/** Surveillance (ZEDCS_SURVEILLANCE Frontend/Dashboard/Index.cshtml): no Financial Assistance card. */
const SURVEILLANCE_CARDS: Card[] = [
  {
    css: 'panel-bronze', title: 'BRONZE SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'BronzeTotal' }, { label: 'Surveillance Pending', field: 'BronzePending' },
      { label: 'Surveillance Completed', field: 'BronzeCompleted' }, { label: 'NC Raised', field: '', fixed: '0' },
      { label: 'Rejected', field: 'BronzeRejected' },
    ],
  },
  {
    css: 'panel-silver', title: 'SILVER SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'SilverTotal' }, { label: 'Surveillance Pending', field: 'SilverPending' },
      { label: 'Surveillance Completed', field: 'SaSilverCompleted' }, { label: 'NC Raised', field: 'SaSilverNcRaised' },
      { label: 'Rejected', field: 'SilverRejected' },
    ],
  },
  {
    css: 'panel-gold', title: 'GOLD SURVEILLANCE', lines: [
      { label: 'Total Application', field: 'GoldTotal' }, { label: 'Surveillance Pending', field: 'GoldPending' },
      { label: 'Surveillance Completed', field: 'SaGoldCompleted' }, { label: 'NC Raised', field: 'SaGoldNcRaised' },
      { label: 'Rejected', field: 'GoldRejected' },
    ],
  },
];

export const DASHBOARD_CARDS: Record<PortalSystem, Card[]> = { main: MAIN_CARDS, consultancy: CONSULTANCY_CARDS, surveillance: SURVEILLANCE_CARDS };

/** Consultancy MasterAdmin's tiles ("dashboard-consultant-block"): count only, the number under the title. */
export const CONSULTANT_TILES = [
  { css: 'panel-empanel', title: 'Empanelled Consultant Organisations', field: 'AssessmentAgencies' },
  { css: 'panel-consultant', title: 'Consultants', field: 'SiteAssessors' },
];

/** Captions of the counts strip; Consultancy's show the TI count where the others show Bronze. */
const STRIP_LABELS: Record<PortalSystem, { total: string; bronze: string }> = {
  main: { total: 'Registered', bronze: 'Bronze' },
  consultancy: { total: 'Application', bronze: 'TI' },
  surveillance: { total: 'Registered', bronze: 'Bronze' },
};

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
              @if (showConsultantTiles()) {
                <div class="col-sm-12">
                  <div class="dashboard-consultant-block">
                    @for (tile of consultantTiles; track tile.field) {
                      <div class="item">
                        <div class="panel panel-default w-100" [class]="tile.css">
                          <div class="panel-heading">
                            <h5>{{ tile.title }}</h5>
                            <h1 [attr.data-field]="tile.field">{{ value(tile.field) }}</h1>
                          </div>
                        </div>
                      </div>
                    }
                  </div>
                </div>
              }
              <div class="col-sm-12">
                <div class="dashboard-cert-block" [class.cert-items]="itemLayout" [class.cert-items-consultancy]="system === 'consultancy'">
                  @for (card of cards; track card.title) {
                    <div [class.item]="itemLayout">
                      <div class="panel panel-default panel-cert-block" [class]="card.css">
                        <div class="panel-heading"><h5>{{ card.title }}</h5></div>
                        <div class="panel-body">
                          <div class="inner">
                            @for (line of card.lines; track line.label) {
                              <p>{{ line.label }}: <span [attr.data-field]="line.field || null">{{ line.fixed ?? value(line.field) }}</span></p>
                            }
                          </div>
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
                  <div class="registered"><p>{{ stripLabels.total }}</p><h1 id="registered">{{ count('total') }}</h1></div>
                  <div class="bronzeVerified"><p>{{ stripLabels.bronze }}</p><h1 id="bronze">{{ count('bronze') }}</h1></div>
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
      <div class="loadingdiv" style="display: block" role="status" aria-live="polite"><div class="loadingimage"><div class="loader"></div><div class="text-center"><small>Please wait ...</small></div></div></div>
    }
  `,
  styles: `
    .Dashboard .panel-cert-block, .Dashboard .panel-cert-block:hover { height: 200px; width: 250px; }
    /* Consultancy and Surveillance: the cards share the row in ".item" wrappers (their Dashboard/Index.cshtml). */
    .dashboard-cert-block.cert-items { gap: 10px; }
    .cert-items .item { flex: 1 1 0; }
    .Dashboard .cert-items .panel-cert-block, .Dashboard .cert-items .panel-cert-block:hover { width: 100%; }
    .cert-items-consultancy { justify-content: flex-start; }
    .cert-items-consultancy .item { flex: 1; background: rgba(179, 224, 121, 0.2); border-radius: 8px; }
    .Dashboard .cert-items-consultancy .panel-cert-block, .Dashboard .cert-items-consultancy .panel-cert-block:hover { height: auto; overflow: visible; background: transparent; }
    .cert-items-consultancy .inner p { margin-bottom: 5px; }
    .dashboard-consultant-block { display: flex; flex-wrap: wrap; gap: 10px; border-radius: 10px; margin-bottom: 10px; }
    .dashboard-consultant-block .item { flex: 1; border-radius: 8px; }
    .dashboard-consultant-block .panel { margin-bottom: 0; border: none; border-radius: 8px; box-shadow: none; }
    .dashboard-consultant-block .panel-empanel { background-color: #73d085; }
    .dashboard-consultant-block .panel-consultant { background-color: #45a5ad; }
    .dashboard-consultant-block .panel-heading { background-color: transparent; border: none; }
    .dashboard-consultant-block .panel-heading h1 { color: #fff; font-weight: 700; }
    @media only screen and (max-width: 480px) {
      .dashboard-consultant-block .item, .cert-items .item { flex: auto; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class StaffDashboardPage {
  private readonly api = inject(DashboardApi);

  protected readonly system = inject(STAFF_SYSTEM);
  protected readonly cards = DASHBOARD_CARDS[this.system];
  protected readonly itemLayout = this.system !== 'main';
  protected readonly stripLabels = STRIP_LABELS[this.system];
  protected readonly consultantTiles = CONSULTANT_TILES;

  /** Consultancy MasterAdmin's tiles, shown when the API sent their columns (it does for MasterAdmin only). */
  protected showConsultantTiles(): boolean {
    const s = this.summary();
    return this.system === 'consultancy' && s !== null && 'AssessmentAgencies' in s;
  }
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
