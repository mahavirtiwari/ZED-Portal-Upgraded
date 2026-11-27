import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, PortalLinksService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom, map } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { Incentive, IncentiveDetails, STATES, SchemesApi } from './schemes.api';

/** Header and footer of the public scheme pages (the old _LayoutHome when signed out). */
@Component({
  selector: 'zed-public-frame',
  imports: [RouterLink, TextPipe],
  // 2026-11-15 (the user): room for the fixed 100px header, as the public layout has; the filters were hidden under it.
  host: { class: 'zed-legacy d-block', '[style.padding-top.px]': 'bare() ? 0 : 100' },
  template: `
    @if (!bare()) {
      <header class="zed-header zed-smooth">
        <div class="container g-0">
          <div class="header-top d-flex justify-content-between align-items-center">
            @if (links.url('ministry'); as u) {<a [href]="u" target="_blank" rel="noopener"><img src="/Images/header/ministry.png" [alt]="'Ministry of MSME' | t: 'public.publicFrame.ministryAlt'" /></a>} @else {<img src="/Images/header/ministry.png" [alt]="'Ministry of MSME' | t: 'public.publicFrame.ministryAlt'" />}
            <img class="zedv2-logo" src="/Images/header/zed-logo.png" [alt]="'ZED' | t: 'public.publicFrame.logoAlt'" />
            @if (msmeSignedIn()) {
              <a routerLink="/msme/dashboard" class="btn btn-sm btn-primary">{{ 'Dashboard' | t: 'public.publicFrame.dashboardButton' }}</a>
            } @else {
              <a routerLink="/msme/login" class="btn btn-sm btn-primary">{{ 'Login' | t: 'public.publicFrame.loginButton' }}</a>
            }
          </div>
        </div>
      </header>
    }
    <ng-content />
    @if (!bare()) {
      <footer class="text-center py-3"><small>{{ 'ZED © {year} All Rights Reserved' | t: 'public.publicFrame.copyrightText' : { year } }}</small></footer>
    }
  `,
})
export class PublicFrame {
  /** Links to pages outside the portal, as the Admin set them (Admin → Links). */
  protected readonly links = inject(PortalLinksService);
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
 * the old page: ct (level), id (state code), it (Common / States / Financial / Other; none = all sections). 2026-11-16: ct
 * can be ZEDX (ZED-X), and act (Manufacturing / Services) leaves out the incentives of the other activity; a signed-in
 * MSME gets its own activity from the server (no choice shown).
 */
@Component({
  selector: 'zed-public-incentives',
  imports: [PublicFrame, NgTemplateOutlet, TextPipe],
  template: `
    <zed-public-frame>
      <div class="container form-page" id="zed_user_form">
        <!-- 2026-11-27 (UI review: the page had no heading; the first one was the translation widget's). -->
        <h1 class="incentive-title inc-page-title">{{ 'Incentives for ZED certified units' | t: 'public.incentives.pageTitle' }}</h1>
        <div class="row incentive-page">
          <div class="col-sm-12 mb-4">
            <div class="panel panel-default panel-grey m-t-2">
              <div class="panel-body p-3">
                <div class="row">
                  <div class="col-sm-3">
                    <label for="incLevel"><p>{{ 'Certification Level' | t: 'public.incentives.levelLabel' }}</p></label>
                    <select id="incLevel" class="form-select" [value]="ct()" (change)="filter({ ct: value($event) })">
                      <option value="">{{ 'Select' | t: 'public.incentives.selectOption' }}</option>
                      <option value="Bronze">Bronze</option>
                      <option value="Silver">Silver</option>
                      <option value="Gold">Gold</option>
                      <option value="ZEDX">ZED-X (Export)</option>
                    </select>
                  </div>
                  @if (!msmeSignedIn()) {
                    <div class="col-sm-3">
                      <label for="incActivity"><p>{{ 'Activity' | t: 'public.incentives.activityLabel' }}</p></label>
                      <select id="incActivity" class="form-select" [value]="act()" (change)="filter({ act: value($event) })">
                        <option value="">{{ 'All' | t: 'public.incentives.allOption' }}</option>
                        <option value="Manufacturing">Manufacturing</option>
                        <option value="Services">Services</option>
                      </select>
                    </div>
                  }
                  @if (show('States')) {
                    <div class="col-sm-4">
                      <label for="incState"><p>{{ 'State' | t: 'public.incentives.stateLabel' }}</p></label>
                      <select id="incState" class="form-select" [value]="state()" (change)="filter({ id: value($event) })">
                        <option value="">{{ 'Select' | t: 'public.incentives.selectOption' }}</option>
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
              <ng-container *ngTemplateOutlet="incSection; context: { title: texts().commonTitle, items: d.common, none: texts().commonEmpty, id: 'incCommon' }" />
            }
            @if (show('Financial')) {
              @for (dept of d.financialDepartments; track dept) {
                <ng-container *ngTemplateOutlet="incSection; context: { title: dept, items: byDept(d.financial, dept), none: texts().financialEmpty, id: 'incFinancial' }" />
              }
            }
            @if (show('Other')) {
              <ng-container *ngTemplateOutlet="incSection; context: { title: texts().otherTitle, items: d.other, none: texts().otherEmpty, id: 'incOther' }" />
            }
            @if (show('States')) {
              <ng-container *ngTemplateOutlet="incSection; context: { title: texts().statesTitle, items: d.states, none: texts().statesEmpty, id: 'incStates' }" />
            }
          }
        </div>
      </div>

      <ng-template #incSection let-title="title" let-items="items" let-none="none" let-id="id">
        <div class="col-sm-12" [attr.id]="id">
          <div class="panel panel-default panel-incentive m-b-2"><h2 class="incentive-title">{{ title }}</h2></div>
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
                        @if (row.videoLink) { <p><img src="/Images/svgicons/video.svg" alt="" /> <a [href]="row.videoLink" target="_blank" rel="noopener">{{ 'Watch Video' | t: 'public.incentives.videoLink' }}</a></p> }
                        @if (row.document1) { <p><img src="/Images/svgicons/document.svg" alt="" /> <a [href]="row.document1" target="_blank" rel="noopener">{{ 'Doc-1' | t: 'public.incentives.document1Link' }}</a></p> }
                        @if (row.document2) { <p><img src="/Images/svgicons/document.svg" alt="" /> <a [href]="row.document2" target="_blank" rel="noopener">{{ 'Doc-2' | t: 'public.incentives.document2Link' }}</a></p> }
                        @if (row.webLink) {
                          <div>
                            <a [href]="row.webLink" target="_blank" rel="noopener" class="btn btn-primary">
                              <span class="incentive-call"><span>{{ 'Avail' | t: 'public.incentives.availButton' }}</span><img src="/Images/svgicons/nav-white.svg" alt="" /></span>
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
  styles: `
    .inc-page-title { margin: 16px 0 0 10px; font-size: 24px; font-weight: 700; line-height: 1.3; }
    h2.incentive-title { margin-top: 0; margin-bottom: 0; }
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
  protected readonly act = computed(() => this.query().get('act') ?? '');
  /** A signed-in MSME: the server uses its own activity. */
  protected readonly msmeSignedIn = computed(() => this.auth.currentUser()?.roleId === 5);
  private readonly auth = inject(AuthService);
  protected readonly section = computed(() => (this.query().get('it') ?? '') as Section | '');
  protected readonly data = signal<IncentiveDetails | null>(null);
  /** The section titles and "none" lines (the financial sections are titled by their department, from the server). */
  protected readonly texts = computed(() => ({
    commonTitle: t('public.incentives.common.title', 'Incentives (Ministry of MSME)'),
    commonEmpty: t('public.incentives.common.empty', 'No Ministry of MSME Incentives available currently, please check again as Government may introduce incentives soon.'),
    financialEmpty: t('public.incentives.financial.empty', 'No Financial Incentives available currently, please check again as Government may introduce incentives soon.'),
    otherTitle: t('public.incentives.other.title', 'Other Incentives'),
    otherEmpty: t('public.incentives.other.empty', 'No Other Incentives available currently, please check again as Government may introduce incentives soon.'),
    statesTitle: t('public.incentives.states.title', 'State Incentives'),
    statesEmpty: t('public.incentives.states.empty', 'No State Incentives available currently, please check again as Government may introduce incentives soon.'),
  }));
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const ct = this.ct();
      const state = this.state();
      const act = this.act();
      void this.load(ct, state, act);
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

  protected filter(change: { ct?: string; id?: string; act?: string }): void {
    void this.router.navigate([], { relativeTo: this.route, queryParams: change, queryParamsHandling: 'merge' });
  }

  private async load(ct: string, state: string, act: string): Promise<void> {
    this.error.set('');
    try {
      this.data.set(await firstValueFrom(this.api.incentives(ct, state, act)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
