import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { BuiltInCard, BuiltInCardForm, DashboardIncentive, INCENTIVE_GROUPS, IncentivesApi, groupOfType } from './incentives.api';
import { GROUP_CARD } from './incentive-master';

/** The pictures of the built-in cards on the MSME dashboard. */
export const BUILT_IN_CARD_IMAGES: Record<string, string> = {
  KAWACH: '/Images/Dashboard/wash.png',
  JOINING_REWARD: '/Images/Dashboard/reward.png',
  FINANCIAL_ASSISTANCE: '/Images/Dashboard/financial.png',
  HANDHOLDING: '/Images/Dashboard/handholding.png',
  TECHNOLOGY_UPGRADATION: '/Images/Dashboard/technology.png',
};

/** What each built-in card's button does (the portal's own, not editable here). */
const BUILT_IN_ACTION: Record<string, string> = {
  KAWACH: 'Avail opens MSME KAWACH (Admin → Links).',
  JOINING_REWARD: 'Avail / View opens the joining reward of the unit.',
  FINANCIAL_ASSISTANCE: 'Avail opens the Financial Assistance application once the unit is eligible.',
  HANDHOLDING: 'Avail / View opens Handholding Support once the unit is certified.',
  TECHNOLOGY_UPGRADATION: 'Avail / View opens Technology Upgradation once the unit is eligible.',
};

/** The stakeholder cards that always close "My Incentives" (their lists are the incentive pages). */
const STAKEHOLDER_CARDS = INCENTIVE_GROUPS.map((g) => ({
  key: g.key, title: GROUP_CARD[g.key],
  image: { ministry: '/Images/Dashboard/dash-msme.PNG', state: '/Images/Dashboard/stateUts.png', financial: '/Images/Dashboard/financial-Institution.png', others: '/Images/Dashboard/incentive.png' }[g.key],
}));

type LevelFilter = 'all' | 'bronze' | 'silver' | 'gold';

const LEVEL_FIELD: Record<Exclude<LevelFilter, 'all'>, 'applicableForBronze' | 'applicableForSilver' | 'applicableForGold'> = {
  bronze: 'applicableForBronze', silver: 'applicableForSilver', gold: 'applicableForGold',
};

/**
 * Admin → Incentives → Main Dashboard Cards (new in V4): the cards of "My Incentives" on every MSME's dashboard. The
 * built-in cards (MSME KAWACH, Joining Reward, Financial Assistance, Handholding Support, Technology Upgradation) keep
 * their buttons; the Admin changes their wording and shows or hides them. Below them, the incentives of the stakeholder
 * groups whose "Where it appears" is Main dashboard (edited on their own page). V4 layout: the counts, then the cards in
 * their dashboard order drawn as MSMEs see them, each with its Show / Hide and Edit; a level filter on the incentive
 * cards, the fixed stakeholder cards at the end, and the Edit pop-up beside a live preview of the card.
 */
@Component({
  selector: 'zed-staff-dashboard-cards',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Main Dashboard Cards</h3>
        <p class="page-sub">The cards of "My Incentives" on every MSME's dashboard, in their order.</p>
      </div>
      <a class="btn btn-primary" routerLink="/staff/incentives/ministry/new">+ Create New Incentive</a>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (cards(); as c) {
      <div class="dc-stats">
        <div class="stat"><span class="stat-value">{{ stats().seen }}</span><span class="stat-label">Cards MSMEs see (with the 4 stakeholder cards)</span></div>
        <div class="stat"><span class="stat-value">{{ shownBuiltIn() }}<small>/{{ c.builtIn.length }}</small></span><span class="stat-label">Built-in cards shown</span></div>
        <div class="stat"><span class="stat-value">{{ stats().activeIncentives }}<small>/{{ c.incentives.length }}</small></span><span class="stat-label">Incentive cards active</span></div>
        <div class="stat" [class.stat-warn]="stats().off > 0"><span class="stat-value">{{ stats().off }}</span><span class="stat-label">Hidden or inactive</span></div>
      </div>

      <section class="zed-card" aria-labelledby="dc-builtin-h">
        <div class="dc-head">
          <h5 class="dc-h m-0" id="dc-builtin-h"><span class="dc-step">1</span> Built-in cards <span class="zed-chip">{{ shownBuiltIn() }} of {{ c.builtIn.length }} shown</span></h5>
          <p class="muted m-0">Their buttons are the portal's own. Change the wording, or hide a card from the dashboard.</p>
        </div>
        @if (!c.builtIn.length) {
          <div class="no-data">The built-in cards are not in the database yet. Please ask the administrator to apply database migration 0026.</div>
        }
        <div class="dc-grid">
          @for (b of c.builtIn; track b.card) {
            <article class="dc-card" [class.is-off]="!b.active">
              <div class="dc-bar">
                <span class="status-badge" [class.is-active]="b.active" [class.is-inactive]="!b.active">{{ b.active ? 'Shown' : 'Hidden' }}</span>
                <span class="dc-order">#{{ $index + 1 }}</span>
              </div>
              <div class="pv-card">
                <div class="pv-head">
                  <img [src]="image(b.card)" alt="" />
                  <span class="pv-avail" aria-hidden="true">Avail</span>
                </div>
                <div class="pv-body">
                  <h6>{{ b.title }}</h6>
                  @if (b.card === 'KAWACH') {
                    <p>{{ b.details }}</p>
                    @if (b.highlight) { <p class="mt-2"><span class="clr-spot">{{ b.highlight }}</span></p> }
                  } @else {
                    <p>@if (b.highlight) { <span class="clr-spot">{{ b.highlight }}</span> } {{ b.details }}</p>
                  }
                </div>
              </div>
              <small class="muted dc-action">{{ action(b.card) }}</small>
              <div class="dc-actions">
                <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(b)">Edit</button>
                <button type="button" class="btn btn-sm" [class.btn-outline-danger]="b.active" [class.btn-outline-success]="!b.active"
                        [disabled]="busy()" (click)="toggle(b)">{{ b.active ? 'Hide' : 'Show' }}</button>
              </div>
            </article>
          }
        </div>
      </section>

      <section class="zed-card" aria-labelledby="dc-inc-h">
        <div class="dc-head dc-head-row">
          <div>
            <h5 class="dc-h m-0" id="dc-inc-h"><span class="dc-step">2</span> Incentives on the main dashboard <span class="zed-chip">{{ c.incentives.length }}</span></h5>
            <p class="muted m-0">Incentives whose "Where it appears" is Main dashboard: each has its own card after the built-in ones, active ones only.</p>
          </div>
          @if (c.incentives.length) {
            <div class="seg" role="group" aria-label="Level">
              @for (l of levelFilters; track l.value) {
                <button type="button" [attr.data-level]="l.value" [class.active]="level() === l.value" [attr.aria-pressed]="level() === l.value"
                        (click)="level.set(l.value)">{{ l.label }} <span class="seg-count">{{ levelCount(l.value) }}</span></button>
              }
            </div>
          }
        </div>
        <div class="dc-grid">
          @for (i of shownIncentives(); track i.id) {
            <article class="dc-card dc-inc" [class.is-off]="!i.active">
              <div class="dc-bar">
                <span class="status-badge" [class.is-active]="i.active" [class.is-inactive]="!i.active">{{ i.active ? 'Active' : 'Inactive' }}</span>
                <span class="dc-stake">{{ stakeholder(i) }}</span>
              </div>
              <div class="pv-card">
                <div class="pv-head">
                  <img src="/Images/Dashboard/incentive.png" alt="" />
                  <span class="pv-avail" aria-hidden="true">Avail</span>
                </div>
                <div class="pv-body">
                  <h6>{{ i.title }}</h6>
                  @if (i.highlight) { <p><span class="clr-spot">{{ i.highlight }}</span></p> }
                </div>
              </div>
              <div class="dc-levels">
                @if (i.applicableForBronze) { <span class="lv-chip lv-bronze">Bronze</span> }
                @if (i.applicableForSilver) { <span class="lv-chip lv-silver">Silver</span> }
                @if (i.applicableForGold) { <span class="lv-chip lv-gold">Gold</span> }
              </div>
              <div class="dc-actions">
                <a class="btn btn-outline-primary btn-sm" [routerLink]="['/staff/incentives', groupKey(i), i.id, 'edit']" [queryParams]="stateParams(i)">Edit</a>
                @if (!i.active) { <small class="muted">Not on the dashboard until it is active.</small> }
              </div>
            </article>
          } @empty {
            <div class="no-data">{{ c.incentives.length ? 'No incentive card applies to this level.' : 'No incentive is on the main dashboard yet. Choose "Main dashboard" under "Where it appears" when you create or edit one.' }}</div>
          }
        </div>
      </section>

      <section class="zed-card" aria-labelledby="dc-stake-h">
        <div class="dc-head">
          <h5 class="dc-h m-0" id="dc-stake-h"><span class="dc-step">3</span> Stakeholder cards</h5>
          <p class="muted m-0">Always shown last. Their Avail opens the incentive page of the group; manage their incentives there.</p>
        </div>
        <div class="dc-stake-grid">
          @for (s of stakeholderCards; track s.key) {
            <a class="dc-stake-card" [routerLink]="['/staff/incentives', s.key]">
              <img [src]="s.image" alt="" />
              <span><strong>{{ s.title }}</strong><small class="muted d-block">Open its incentives →</small></span>
            </a>
          }
        </div>
      </section>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dc-edit-title">
        <div class="modal-dialog modal-popup modal-xl dc-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="dc-edit-title">Edit card</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
                <div class="dc-edit">
                  <div class="form-grid">
                    <label for="dc-title">Card title<span class="req">*</span></label>
                    <input id="dc-title" name="title" class="form-control" maxlength="200" [(ngModel)]="e.form.title" />
                    <label for="dc-highlight">Highlight</label>
                    <input id="dc-highlight" name="highlight" class="form-control" maxlength="300" placeholder="e.g. Rs. 10,000/-" [(ngModel)]="e.form.highlight" />
                    <label for="dc-details" class="top">Description<span class="req">*</span></label>
                    <textarea id="dc-details" name="details" class="form-control" rows="3" maxlength="1000" [(ngModel)]="e.form.details"></textarea>
                    <span class="label-like">On the dashboard</span>
                    <div class="form-check form-switch dc-switch">
                      <input class="form-check-input" type="checkbox" role="switch" id="dc-active" name="active" [(ngModel)]="e.form.active" />
                      <label class="form-check-label" for="dc-active">{{ e.form.active ? 'Shown' : 'Hidden' }}</label>
                    </div>
                  </div>
                  <aside class="dc-preview" aria-label="Preview">
                    <h4>Preview</h4>
                    <div class="pv-card" [class.is-faded]="!e.form.active">
                      <div class="pv-head">
                        <img [src]="image(e.card)" alt="" />
                        <span class="pv-avail" aria-hidden="true">Avail</span>
                      </div>
                      <div class="pv-body">
                        <h6>{{ e.form.title.trim() || 'Card title' }}</h6>
                        @if (e.card === 'KAWACH') {
                          <p>{{ e.form.details }}</p>
                          @if (e.form.highlight.trim()) { <p class="mt-2"><span class="clr-spot">{{ e.form.highlight }}</span></p> }
                        } @else {
                          <p>@if (e.form.highlight.trim()) { <span class="clr-spot">{{ e.form.highlight }}</span> } {{ e.form.details }}</p>
                        }
                      </div>
                    </div>
                    <small class="muted d-block mt-2">{{ e.form.active ? action(e.card) : 'Hidden: MSMEs do not see this card.' }}</small>
                  </aside>
                </div>
                @if (editError()) { <span class="help-block" role="alert">{{ editError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">UPDATE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .page-head { align-items: center; }
    .zed-card { margin-bottom: 16px; }

    .dc-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value small { font-size: 15px; color: #8a9899; font-weight: 600; }
    .stat-label { font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }
    .stat.stat-warn { border-color: #f1dca0; background: #fffcf2; }
    .stat.stat-warn .stat-value { color: #8a6100; }

    .dc-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .dc-head-row { flex-direction: row; flex-wrap: wrap; justify-content: space-between; align-items: flex-end; gap: 10px; }
    .dc-h { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-weight: 700; color: #23474a; }
    .dc-step { flex: none; width: 24px; height: 24px; border-radius: 12px; display: inline-grid; place-items: center; background: #45a5ad; color: #fff; font-size: 12px; }
    .seg { display: inline-flex; flex-wrap: wrap; border: 1px solid #cbd9da; border-radius: 8px; overflow: hidden; }
    .seg button { display: inline-flex; align-items: center; gap: 6px; border: 0; background: #fff; color: #2f7c83; font-size: 13px; font-weight: 600; padding: 7px 14px; cursor: pointer; }
    .seg button + button { border-left: 1px solid #cbd9da; }
    .seg button:hover { background: #eef6f6; }
    .seg button.active { background: #45a5ad; color: #fff; }
    .seg-count { font-size: 12px; border-radius: 10px; padding: 0 7px; background: #eef6f6; color: #23474a; }
    .seg button.active .seg-count { background: rgba(255,255,255,.25); color: #fff; }

    /* Each card as the MSME dashboard draws it, with its controls around it. */
    .dc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(196px, 1fr)); gap: 14px; }
    .dc-grid > .no-data { grid-column: 1 / -1; }
    .dc-card { display: flex; flex-direction: column; gap: 10px; padding: 12px; border: 1px solid #dfe9ea; border-radius: 12px; background: #f4f8f8; min-width: 0; }
    .dc-card.is-off { background: #f6f6f6; border-style: dashed; }
    .dc-card.is-off .pv-card { opacity: .5; }
    .dc-bar { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
    .dc-order { font-size: 12px; font-weight: 700; color: #8a9899; }
    .dc-stake { font-size: 12px; color: #5f6f70; text-align: right; overflow-wrap: anywhere; }
    .pv-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 6px 14px rgba(0, 0, 0, .08); overflow: hidden; flex: 1 1 auto; }
    .pv-card.is-faded { opacity: .5; }
    .pv-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 14px 14px 0; }
    .pv-head img { width: 70px; max-height: 64px; object-fit: contain; }
    .pv-avail { background: #45a5ad; color: #fff; font-size: 11px; font-weight: 600; border-radius: 4px; padding: 3px 9px; text-transform: uppercase; }
    .pv-body { padding: 8px 14px 14px; }
    .pv-body h6 { margin: 0 0 6px; font-weight: 700; font-size: 16px; color: #232527; overflow-wrap: anywhere; }
    .pv-body p { margin: 0; font-size: 13px; color: #232527; overflow-wrap: anywhere; }
    .clr-spot { color: #27aae1; font-weight: 700; }
    .dc-action { font-size: 12px; }
    .dc-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: auto; }
    .dc-levels { display: flex; flex-wrap: wrap; gap: 4px; }
    .lv-chip { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 12px; padding: 2px 10px; }
    .lv-chip.lv-bronze { background: #fbeee8; color: #8a4a33; }
    .lv-chip.lv-silver { background: #eef1f2; color: #4f5b60; }
    .lv-chip.lv-gold { background: #fbf3d9; color: #7a6110; }

    .dc-stake-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 12px; }
    .dc-stake-card { display: flex; align-items: center; gap: 12px; padding: 10px 14px; border: 1px solid #dfe9ea; border-radius: 10px; background: #fff;
      color: #232527; text-decoration: none; min-width: 0; }
    .dc-stake-card:hover { border-color: #45a5ad; background: #f4fafa; color: #232527; }
    .dc-stake-card img { flex: none; width: 56px; height: 44px; object-fit: contain; }

    /* The pop-up: the fields beside the preview. Wider than the skin's 760px form pop-ups. */
    .modal > .modal-dialog.modal-xl.dc-dialog { max-width: 940px; width: calc(100% - 32px); margin-left: auto; margin-right: auto; }
    .modal .dc-dialog textarea.form-control { min-height: 0; height: auto; }
    .dc-edit { display: grid; grid-template-columns: minmax(0, 1fr) 280px; gap: 20px; align-items: start; }
    .dc-preview { background: #f4f8f8; border-radius: 12px; padding: 14px; }
    .dc-preview h4 { font-size: 13px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 8px; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .dc-switch { display: flex; align-items: center; gap: 10px; padding-left: 0; margin: 0; }
    .dc-switch .form-check-input { float: none; margin: 0; }
    @media (max-width: 767.98px) {
      .dc-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .dc-edit { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class DashboardCardsPage {
  private readonly api = inject(IncentivesApi);

  protected readonly stakeholderCards = STAKEHOLDER_CARDS;
  protected readonly levelFilters: { value: LevelFilter; label: string }[] = [
    { value: 'all', label: 'All levels' }, { value: 'bronze', label: 'Bronze' }, { value: 'silver', label: 'Silver' }, { value: 'gold', label: 'Gold' },
  ];

  protected readonly cards = signal<{ builtIn: BuiltInCard[]; incentives: DashboardIncentive[] } | null>(null);
  protected readonly shownBuiltIn = computed(() => (this.cards()?.builtIn ?? []).filter((b) => b.active).length);
  /** Only the incentive cards that apply to this level. */
  protected readonly level = signal<LevelFilter>('all');
  protected readonly shownIncentives = computed(() => {
    const l = this.level();
    const all = this.cards()?.incentives ?? [];
    return l === 'all' ? all : all.filter((i) => i[LEVEL_FIELD[l]]);
  });
  protected readonly stats = computed(() => {
    const c = this.cards() ?? { builtIn: [], incentives: [] };
    const activeIncentives = c.incentives.filter((i) => i.active).length;
    return {
      activeIncentives,
      seen: this.shownBuiltIn() + activeIncentives + STAKEHOLDER_CARDS.length,
      off: c.builtIn.length - this.shownBuiltIn() + c.incentives.length - activeIncentives,
    };
  });
  protected readonly editing = signal<{ card: string; form: BuiltInCardForm } | null>(null);
  protected readonly editError = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected image(card: string): string {
    return BUILT_IN_CARD_IMAGES[card] ?? '/Images/Dashboard/incentive.png';
  }

  protected action(card: string): string {
    return BUILT_IN_ACTION[card] ?? '';
  }

  protected levelCount(l: LevelFilter): number {
    const all = this.cards()?.incentives ?? [];
    return l === 'all' ? all.length : all.filter((i) => i[LEVEL_FIELD[l]]).length;
  }

  protected stakeholder(i: DashboardIncentive): string {
    const g = groupOfType(i.incentiveType);
    return g.key === 'state' ? `State Government: ${i.incentiveType}` : g.label;
  }

  protected groupKey(i: DashboardIncentive): string {
    return groupOfType(i.incentiveType).key;
  }

  protected stateParams(i: DashboardIncentive): Record<string, string> | null {
    return groupOfType(i.incentiveType).key === 'state' ? { state: i.incentiveType } : null;
  }

  protected edit(b: BuiltInCard): void {
    this.editError.set('');
    this.editing.set({ card: b.card, form: { title: b.title ?? '', highlight: b.highlight ?? '', details: b.details ?? '', active: b.active } });
  }

  protected async save(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!e.form.title.trim() || !e.form.details.trim()) {
      this.editError.set('Please enter the card title and description.');
      return;
    }
    if (await this.put(e.card, e.form, (m) => this.editError.set(m))) this.editing.set(null);
  }

  /** Show or hide a card at once, keeping its wording. */
  protected async toggle(b: BuiltInCard): Promise<void> {
    await this.put(b.card, { title: b.title ?? '', highlight: b.highlight ?? '', details: b.details ?? '', active: !b.active }, (m) => this.error.set(m));
  }

  private async put(card: string, form: BuiltInCardForm, fail: (message: string) => void): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.saveBuiltInCard(card, form))).message);
      await this.load();
      return true;
    } catch (err) {
      fail(apiErrorMessage(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.cards.set(await firstValueFrom(this.api.dashboardCards()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
