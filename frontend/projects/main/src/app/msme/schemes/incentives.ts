import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom, map } from 'rxjs';
import { Incentive, IncentiveDetails, STATES, SchemesApi } from './schemes.api';

/** Header and footer of the public scheme pages (the old _LayoutHome when signed out). */
@Component({
  selector: 'zed-public-frame',
  imports: [RouterLink],
  host: { class: 'zed-legacy d-block' },
  template: `
    @if (!bare()) {
      <header class="zed-header zed-smooth">
        <div class="container g-0">
          <div class="header-top d-flex justify-content-between align-items-center">
            <a href="https://msme.gov.in/" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" alt="Ministry of MSME" /></a>
            <img class="zedv2-logo" src="/Images/header/zed-logo.png" alt="ZED" />
            @if (msmeSignedIn()) {
              <a routerLink="/msme/dashboard" class="btn btn-sm btn-primary">Dashboard</a>
            } @else {
              <a routerLink="/msme/login" class="btn btn-sm btn-primary">Login</a>
            }
          </div>
        </div>
      </header>
    }
    <ng-content />
    @if (!bare()) {
      <footer class="text-center py-3"><small>ZED © {{ year }} All Rights Reserved</small></footer>
    }
  `,
})
export class PublicFrame {
  readonly bare = signal(false);
  protected readonly year = new Date().getFullYear();
  private readonly auth = inject(AuthService);
  /** Only when the app already knows the user (no extra request on this public page). */
  protected readonly msmeSignedIn = computed(() => this.auth.currentUser()?.roleId === 5);

  constructor() {
    this.bare.set(inject(ActivatedRoute).snapshot.data['mobile'] === true);
  }
}

type Section = 'Common' | 'States' | 'Financial' | 'Other';

/**
 * Incentives a ZED-certified unit can avail. Port of Frontend/Incentive/Details.cshtml (and DetailsMobile.cshtml,
 * the same page without header for the mobile app: route data `mobile`). Public, as before. Query parameters as
 * the old page: ct (level), id (state code), it (Common / States / Financial / Other; none = all sections).
 */
@Component({
  selector: 'zed-public-incentives',
  imports: [PublicFrame, NgTemplateOutlet],
  template: `
    <zed-public-frame>
      <div class="container form-page" id="zed_user_form">
        <div class="row incentive-page">
          <div class="col-sm-12 mb-4">
            <div class="panel panel-default panel-grey m-t-2">
              <div class="panel-body p-3">
                <div class="row">
                  <div class="col-sm-3">
                    <label for="incLevel"><p>Certification Level</p></label>
                    <select id="incLevel" class="form-select" [value]="ct()" (change)="filter({ ct: value($event) })">
                      <option value="">Select</option>
                      <option value="Bronze">Bronze</option>
                      <option value="Silver">Silver</option>
                      <option value="Gold">Gold</option>
                    </select>
                  </div>
                  @if (show('States')) {
                    <div class="col-sm-4">
                      <label for="incState"><p>State</p></label>
                      <select id="incState" class="form-select" [value]="state()" (change)="filter({ id: value($event) })">
                        <option value="">Select</option>
                        @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
                      </select>
                    </div>
                  }
                </div>
              </div>
            </div>
          </div>

          @if (error()) { <div class="col-sm-12"><div class="alert alert-danger" role="alert">{{ error() }}</div></div> }

          @if (data(); as d) {
            @if (show('Common')) {
              <ng-container *ngTemplateOutlet="incSection; context: { title: 'Incentives (Ministry Of MSME)', items: d.common, none: 'No Ministry of MSME Incentives available currently, please check again as Government may introduce incentives soon.', id: 'incCommon' }" />
            }
            @if (show('Financial')) {
              @for (dept of d.financialDepartments; track dept) {
                <ng-container *ngTemplateOutlet="incSection; context: { title: dept, items: byDept(d.financial, dept), none: 'No Financial Incentives available currently, please check again as Government may introduce incentives soon.', id: 'incFinancial' }" />
              }
            }
            @if (show('Other')) {
              <ng-container *ngTemplateOutlet="incSection; context: { title: 'Other Incentives', items: d.other, none: 'No Other Incentives available currently, please check again as Government may introduce incentives soon.', id: 'incOther' }" />
            }
            @if (show('States')) {
              <ng-container *ngTemplateOutlet="incSection; context: { title: 'State Incentives', items: d.states, none: 'No State Incentives available currently, please check again as Government may introduce incentives soon.', id: 'incStates' }" />
            }
          }
        </div>
      </div>

      <ng-template #incSection let-title="title" let-items="items" let-none="none" let-id="id">
        <div class="col-sm-12" [attr.id]="id">
          <div class="panel panel-default panel-incentive m-b-2"><h4 class="incentive-title">{{ title }}</h4></div>
          @if (items.length) {
            <div class="panel panel-default panel-grey">
              @for (row of items; track row.id; let i = $index) {
                <div class="panel-body incentive-item">
                  <div class="panel panel-default panel-white">
                    <div class="panel-body">
                      <p><img src="/Images/svgicons/ministry.svg" alt="" /> &nbsp;{{ row.ministryOrDepartment }}</p>
                      <h4>{{ i + 1 }}. {{ row.incentive }}</h4>
                      <p>{{ row.details }}</p>
                      <div class="incentive-footer">
                        @if (row.contactPerson) { <p><img src="/Images/svgicons/user.svg" alt="" />{{ row.contactPerson }}</p> }
                        @if (row.email) { <p><img src="/Images/svgicons/mail.svg" alt="" /> {{ row.email }}</p> }
                        @if (row.mobileNo) { <p><img src="/Images/svgicons/call.svg" alt="" /> {{ row.mobileNo }}</p> }
                        @if (row.videoLink) { <p><img src="/Images/svgicons/video.svg" alt="" /> <a [href]="row.videoLink" target="_blank" rel="noopener">Watch Video</a></p> }
                        @if (row.document1) { <p><img src="/Images/svgicons/document.svg" alt="" /> <a [href]="row.document1" target="_blank" rel="noopener">Doc-1</a></p> }
                        @if (row.document2) { <p><img src="/Images/svgicons/document.svg" alt="" /> <a [href]="row.document2" target="_blank" rel="noopener">Doc-2</a></p> }
                        @if (row.webLink) {
                          <div>
                            <a [href]="row.webLink" target="_blank" rel="noopener" class="btn btn-primary">
                              <span class="incentive-call"><span>Avail</span><img src="/Images/svgicons/nav-white.svg" alt="" /></span>
                            </a>
                          </div>
                        }
                      </div>
                    </div>
                  </div>
                </div>
              }
            </div>
          } @else {
            <div class="label-highlight4">
              <div class="no-incentive-block"><img src="/Images/svgicons/no-incentive.svg" alt="" /><p>{{ none }}</p></div>
            </div>
          }
        </div>
      </ng-template>
    </zed-public-frame>
  `,
})
export class PublicIncentivesPage {
  private readonly api = inject(SchemesApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  private readonly query = toSignal(this.route.queryParamMap.pipe(map((q) => q)), { initialValue: this.route.snapshot.queryParamMap });

  protected readonly states = STATES;
  protected readonly ct = computed(() => this.query().get('ct') ?? '');
  protected readonly state = computed(() => this.query().get('id') ?? '');
  protected readonly section = computed(() => (this.query().get('it') ?? '') as Section | '');
  protected readonly data = signal<IncentiveDetails | null>(null);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const ct = this.ct();
      const state = this.state();
      void this.load(ct, state);
    });
  }

  protected show(s: Section): boolean {
    return !this.section() || this.section() === s;
  }

  protected byDept(items: Incentive[], dept: string): Incentive[] {
    return items.filter((i) => i.ministryOrDepartment === dept);
  }

  protected value(e: Event): string {
    return (e.target as HTMLSelectElement).value;
  }

  protected filter(change: { ct?: string; id?: string }): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: change, queryParamsHandling: 'merge' });
  }

  private async load(ct: string, state: string): Promise<void> {
    this.error.set('');
    try {
      this.data.set(await firstValueFrom(this.api.incentives(ct, state)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
