import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { BuiltInCard, BuiltInCardForm, DashboardIncentive, IncentivesApi, groupOfType } from './incentives.api';

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

/**
 * Admin → Incentives → Main Dashboard Cards (new in V4): the cards of "My Incentives" on every MSME's dashboard. The
 * built-in cards (MSME KAWACH, Joining Reward, Financial Assistance, Handholding Support, Technology Upgradation) keep
 * their buttons; the Admin changes their wording and shows or hides them. Below them, the incentives of the stakeholder
 * groups whose "Where it appears" is Main dashboard (edited on their own page).
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
      <section class="zed-card mb-3" aria-labelledby="dc-builtin-h">
        <div class="dc-head">
          <h5 class="m-0" id="dc-builtin-h">Built-in cards <span class="zed-chip">{{ shownBuiltIn() }} of {{ c.builtIn.length }} shown</span></h5>
          <p class="muted m-0">Their buttons are the portal's own. Change the wording, or hide a card from the dashboard.</p>
        </div>
        @if (!c.builtIn.length) {
          <div class="no-data">The built-in cards are not in the database yet. Please ask the administrator to apply database migration 0026.</div>
        }
        <div class="dc-grid">
          @for (b of c.builtIn; track b.card) {
            <article class="dc-card" [class.is-off]="!b.active">
              <div class="dc-card-top">
                <img [src]="image(b.card)" alt="" />
                <span class="status-badge" [class.is-active]="b.active" [class.is-inactive]="!b.active">{{ b.active ? 'Shown' : 'Hidden' }}</span>
              </div>
              <h6>{{ b.title }}</h6>
              <p>@if (b.highlight) { <span class="clr-spot">{{ b.highlight }}</span> } {{ b.details }}</p>
              <small class="muted">{{ action(b.card) }}</small>
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
        <div class="dc-head">
          <h5 class="m-0" id="dc-inc-h">Incentives on the main dashboard <span class="zed-chip">{{ c.incentives.length }}</span></h5>
          <p class="muted m-0">Incentives whose "Where it appears" is Main dashboard: each has its own card after the built-in ones, active ones only.</p>
        </div>
        <div class="table-responsive">
          <table class="table table-bordered table-zed">
            <thead>
              <tr>
                <th class="text-center" style="width: 60px">S.No</th><th>Incentive</th><th>Stakeholder</th>
                <th class="text-center">Applicable for</th><th class="text-center">Status</th><th class="text-center" style="width: 90px">Action</th>
              </tr>
            </thead>
            <tbody>
              @for (i of c.incentives; track i.id) {
                <tr>
                  <td class="text-center">{{ $index + 1 }}</td>
                  <td><strong>{{ i.title }}</strong>@if (i.highlight) { <div class="clr-spot small">{{ i.highlight }}</div> }</td>
                  <td>{{ stakeholder(i) }}</td>
                  <td class="text-center">
                    @if (i.applicableForBronze) { <span class="zed-chip">Bronze</span> }
                    @if (i.applicableForSilver) { <span class="zed-chip">Silver</span> }
                    @if (i.applicableForGold) { <span class="zed-chip">Gold</span> }
                  </td>
                  <td class="text-center"><span class="status-badge" [class.is-active]="i.active">{{ i.active ? 'Active' : 'Inactive' }}</span></td>
                  <td class="text-center">
                    <a class="btn btn-outline-primary btn-sm" [routerLink]="['/staff/incentives', groupKey(i), i.id, 'edit']" [queryParams]="stateParams(i)">Edit</a>
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="6" style="padding: 0"><div class="no-data">No incentive is on the main dashboard yet. Choose "Main dashboard" under "Where it appears" when you create or edit one.</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      </section>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="dc-edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="dc-edit-title">Edit card</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="save()" novalidate>
              <div class="modal-body">
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
    .dc-head { display: flex; flex-direction: column; gap: 4px; margin-bottom: 14px; }
    .dc-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 14px; }
    .dc-card { display: flex; flex-direction: column; gap: 6px; padding: 14px; border: 1px solid #dfe9ea; border-radius: 12px; background: #fff; }
    .dc-card.is-off { background: #f6f8f8; }
    .dc-card.is-off img, .dc-card.is-off h6, .dc-card.is-off p { opacity: .55; }
    .dc-card-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 8px; }
    .dc-card-top img { height: 54px; width: auto; max-width: 120px; object-fit: contain; }
    .dc-card h6 { margin: 4px 0 0; font-weight: 700; color: #23474a; }
    .dc-card p { margin: 0; font-size: 13px; color: #3b4b4c; }
    .dc-card small { font-size: 12px; }
    .dc-actions { display: flex; gap: 8px; margin-top: auto; padding-top: 6px; }
    .clr-spot { color: #2e858c; font-weight: 700; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .dc-switch { display: flex; align-items: center; gap: 10px; padding-left: 0; margin: 0; }
    .dc-switch .form-check-input { float: none; margin: 0; }
  `,
})
export class DashboardCardsPage {
  private readonly api = inject(IncentivesApi);

  protected readonly cards = signal<{ builtIn: BuiltInCard[]; incentives: DashboardIncentive[] } | null>(null);
  protected readonly shownBuiltIn = computed(() => (this.cards()?.builtIn ?? []).filter((b) => b.active).length);
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
