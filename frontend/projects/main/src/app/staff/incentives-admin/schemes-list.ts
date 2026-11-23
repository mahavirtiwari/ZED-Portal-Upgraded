import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { DashIcon } from '../../msme/dashboard/dash-icon';
import { TextPipe, t } from '../../content/page-text';
import {
  SchemeSummary, SchemesAdminApi, SchemesResponse, activationLabel, codeFrom, flowLabel, gradingModeLabel, gradingSummary, noBenefit,
} from './schemes-admin.api';

interface NewScheme { name: string; code: string; codeTouched: boolean; template: string }

/**
 * Admin → Incentives → Incentive Schemes (2026-11-20, approved design, docs/INCENTIVE-SCHEMES.md): every scheme with when it
 * opens, how it is graded, its verification flow and its on / off switch; "New scheme" starts one from Financial Assistance,
 * Technology Upgradation or blank (off until switched on). Schemes are never deleted, only switched off.
 */
@Component({
  selector: 'zed-staff-schemes-list',
  imports: [FormsModule, RouterLink, TextPipe, DashIcon],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Incentive Schemes' | t: 'staff.incentivesAdmin.list.title' }}</h3>
        <p class="page-sub">{{ 'The schemes units apply for from their dashboard: when each opens, the benefit, the form and the verification.' | t: 'staff.incentivesAdmin.list.sub' }}</p>
      </div>
      <div class="page-actions">
        <a class="btn btn-default" routerLink="/staff/incentives/dashboard-cards">{{ 'Main Dashboard Cards' | t: 'staff.incentivesAdmin.list.cardsLink' }}</a>
        <button type="button" class="btn btn-primary" [disabled]="busy() || !data()" (click)="openNew()">{{ 'New scheme' | t: 'staff.incentivesAdmin.list.newButton' }}</button>
      </div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }

    @if (data(); as d) {
      <div class="sl-stats" role="list">
        <div class="sl-stat" role="listitem"><b>{{ d.schemes.length }}</b><span>{{ 'Schemes' | t: 'staff.incentivesAdmin.list.stat.total' }}</span></div>
        <div class="sl-stat" role="listitem"><b>{{ counts().seen }}</b><span>{{ 'Seen by units' | t: 'staff.incentivesAdmin.list.stat.seen' }}</span></div>
        <div class="sl-stat" role="listitem"><b>{{ counts().hidden }}</b><span>{{ 'On, waiting on a setting' | t: 'staff.incentivesAdmin.list.stat.hidden' }}</span></div>
        <div class="sl-stat" role="listitem"><b>{{ counts().off }}</b><span>{{ 'Off' | t: 'staff.incentivesAdmin.list.stat.off' }}</span></div>
      </div>

      <ul class="sl-list zed-card">
        @for (s of d.schemes; track s.code) {
          <li class="sl-row" [class.is-off]="!s.active" [attr.data-code]="s.code">
            <span class="sl-icon" aria-hidden="true"><zed-dash-icon [name]="s.icon || 'star'" [size]="20" [stroke]="1.8" /></span>
            <div class="sl-main">
              <div class="sl-name"><strong>{{ s.name }}</strong> <small class="sl-code">{{ s.code }}</small></div>
              <div class="sl-meta">
                {{ 'Opens after {opens}' | t: 'staff.incentivesAdmin.list.opensAfter' : { opens: opens(s) } }}
                · {{ flow(s) }}
                @if (s.correctionRounds) { · {{ '{n} correction rounds' | t: 'staff.incentivesAdmin.list.rounds' : { n: s.correctionRounds } }} }
                @if (s.cardTitle && s.cardTitle !== s.name) { · {{ 'Card: {title}' | t: 'staff.incentivesAdmin.list.cardTitle' : { title: s.cardTitle } }} }
              </div>
            </div>
            <div class="sl-grading">
              <span class="sl-mode">{{ gradingMode(s) }}</span>
              @for (line of grading(s); track $index) { <span class="sl-chip">{{ line }}</span> }
              @if (noBenefit(s)) { <span class="sl-chip sl-bad" data-no-benefit>{{ 'No benefit set (0%)' | t: 'staff.incentivesAdmin.list.noBenefit' }}</span> }
            </div>
            <div class="sl-state">
              @switch (status(s)) {
                @case ('seen') { <span class="sl-pill sl-seen">{{ 'Units see it' | t: 'staff.incentivesAdmin.list.status.seen' }}</span> }
                @case ('hidden') { <span class="sl-pill sl-hidden" [title]="hiddenHelp()">{{ 'On, not shown' | t: 'staff.incentivesAdmin.list.status.hidden' }}</span> }
                @default { <span class="sl-pill sl-off">{{ 'Off' | t: 'staff.incentivesAdmin.list.status.off' }}</span> }
              }
              <label class="af-switch" [class.off]="!s.active">
                <input type="checkbox" role="switch" [checked]="s.active" [disabled]="busy()"
                       [attr.aria-label]="'Switch {name} on or off' | t: 'staff.incentivesAdmin.list.switchAria' : { name: s.name }"
                       (click)="$event.preventDefault(); toggle(s)" />
                <span class="af-track" aria-hidden="true"></span>{{ s.active ? ('On' | t: 'staff.incentivesAdmin.list.on') : ('Off' | t: 'staff.incentivesAdmin.list.off') }}
              </label>
              <a class="btn btn-primary btn-sm" [routerLink]="[s.code]">{{ 'Edit' | t: 'staff.incentivesAdmin.list.editButton' }}</a>
            </div>
          </li>
        } @empty {
          <li class="no-data">{{ 'No scheme yet. Use New scheme to add one.' | t: 'staff.incentivesAdmin.list.emptyNoScheme' }}</li>
        }
      </ul>
      @if (counts().hidden) { <p class="muted sl-note" data-hidden-note>{{ hiddenHelp() }}</p> }
      <p class="muted sl-note">{{ 'A scheme is never deleted: switch it off. Applications already made continue.' | t: 'staff.incentivesAdmin.list.note' }}</p>
    }

    @if (creating(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sl-new-title">
        <div class="modal-dialog">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="sl-new-title">{{ 'New scheme' | t: 'staff.incentivesAdmin.new.title' }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.incentivesAdmin.new.closeAria'" (click)="creating.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="create(c)" novalidate>
              <div class="modal-body">
                <label class="form-label" for="sl-name">{{ 'Name' | t: 'staff.incentivesAdmin.new.nameLabel' }}<span class="req">*</span></label>
                <input id="sl-name" name="name" class="form-control" maxlength="200" [(ngModel)]="c.name" (ngModelChange)="nameChanged(c)" />
                <label class="form-label mt-3" for="sl-code">{{ 'Code' | t: 'staff.incentivesAdmin.new.codeLabel' }}<span class="req">*</span></label>
                <input id="sl-code" name="code" class="form-control" maxlength="40" [(ngModel)]="c.code" (ngModelChange)="c.codeTouched = true" />
                <small class="muted">{{ 'Capital letters, digits and _ . It cannot be changed later.' | t: 'staff.incentivesAdmin.new.codeHelp' }}</small>
                <span class="form-label d-block mt-3">{{ 'Start from' | t: 'staff.incentivesAdmin.new.templateLabel' }}</span>
                @for (o of templates(); track o.value) {
                  <label class="sl-choice">
                    <input type="radio" name="template" [value]="o.value" [(ngModel)]="c.template" />
                    <span>{{ o.label }}</span>
                  </label>
                }
                @if (modalError()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ modalError() }}</div> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="creating.set(null)">{{ 'Cancel' | t: 'staff.incentivesAdmin.new.cancelButton' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ 'Create' | t: 'staff.incentivesAdmin.new.createButton' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .sl-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 0 0 14px; }
    .sl-stat { background: #fff; border: 1px solid #dde7e8; border-radius: 12px; padding: 12px 16px; }
    .sl-stat b { display: block; font-size: 22px; line-height: 28px; color: #17373b; }
    .sl-stat span { font-size: 12.5px; color: #5f7a7d; }
    .sl-list { list-style: none; margin: 0; padding: 0; overflow: hidden; }
    .sl-row { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding: 14px 18px; border-bottom: 1px solid #edf2f2; }
    .sl-row:last-child { border-bottom: 0; }
    .sl-icon { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #e6f2f3; color: #1f5c61; }
    .sl-main { flex: 1 1 260px; min-width: 0; }
    .sl-name strong { font-size: 15px; color: #17373b; }
    .sl-code { font-family: monospace; font-size: 12px; color: #6f8487; margin-left: 6px; }
    .sl-meta { font-size: 12.5px; color: #5f7a7d; margin-top: 2px; overflow-wrap: anywhere; }
    .sl-grading { flex: 1 1 220px; display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .sl-mode { font-size: 11px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; color: #6f8487; margin-right: 2px; }
    .sl-chip { font-size: 12px; font-weight: 600; color: #1f5c61; background: #e6f2f3; border-radius: 6px; padding: 3px 8px; }
    .sl-bad { color: #a12f2f; background: #fdeaea; }
    .sl-state { flex: none; display: flex; align-items: center; gap: 12px; margin-left: auto; }
    .sl-pill { font-size: 12px; font-weight: 700; border-radius: 999px; padding: 3px 10px; white-space: nowrap; }
    .sl-seen { color: #1e6b3a; background: #e3f3e8; }
    .sl-hidden { color: #8a5a06; background: #fdf2dc; cursor: help; }
    .sl-off { color: #5f7a7d; background: #eef1f1; }
    .sl-row.is-off .sl-icon { background: #eef1f1; color: #8aa0a2; }
    .sl-row.is-off .sl-name strong, .sl-row.is-off .sl-meta { color: #7d9295; }
    .sl-note { font-size: 13px; margin-top: 8px; }
    .sl-choice { display: flex; align-items: center; gap: 8px; font-weight: 400; margin: 4px 0; cursor: pointer; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .sl-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .sl-state { margin-left: 0; width: 100%; justify-content: space-between; }
    }
  `,
})
export class SchemesListPage {
  private readonly api = inject(SchemesAdminApi);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  protected readonly data = signal<SchemesResponse | null>(null);
  protected readonly creating = signal<NewScheme | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly modalError = signal('');

  constructor() {
    void this.load();
  }

  protected opens(s: SchemeSummary): string {
    return activationLabel(s.activation, this.data()?.levels ?? []);
  }

  protected gradingMode(s: SchemeSummary): string {
    return gradingModeLabel(s.grading.mode);
  }

  /** 2026-11-23 (list design): one line when every row is the same. */
  protected grading(s: SchemeSummary): string[] {
    return gradingSummary(s.grading, this.data()?.levels ?? []);
  }

  protected noBenefit(s: SchemeSummary): boolean {
    return noBenefit(s.grading);
  }

  /** Units see it; on, but hidden by the Technology Upgradation card's setting; or off. */
  protected status(s: SchemeSummary): 'seen' | 'hidden' | 'off' {
    return !s.active ? 'off' : s.hiddenByTuSetting ? 'hidden' : 'seen';
  }

  protected readonly counts = computed(() => {
    const list = this.data()?.schemes ?? [];
    return {
      seen: list.filter((s) => this.status(s) === 'seen').length,
      hidden: list.filter((s) => this.status(s) === 'hidden').length,
      off: list.filter((s) => !s.active).length,
    };
  });

  protected hiddenHelp(): string {
    return t('staff.incentivesAdmin.list.hiddenHelp',
      '"On, not shown": Technology Upgradation still opens after the consultant\'s recommendation, so units do not see the direct scheme. Change it in Main Dashboard Cards.');
  }

  protected flow(s: SchemeSummary): string {
    return flowLabel(s.flow);
  }

  protected templates(): { value: string; label: string }[] {
    const names: Record<string, string> = {
      FA: t('staff.incentivesAdmin.new.templateFa', 'Financial Assistance (certificate and expenditure)'),
      TU: t('staff.incentivesAdmin.new.templateTu', 'Technology Upgradation (technologies, "Add more")'),
    };
    return [
      ...(this.data()?.templates ?? []).map((v) => ({ value: v, label: names[v] ?? v })),
      { value: '', label: t('staff.incentivesAdmin.new.templateBlank', 'Blank (one section)') },
    ];
  }

  protected openNew(): void {
    this.modalError.set('');
    this.creating.set({ name: '', code: '', codeTouched: false, template: 'FA' });
  }

  protected nameChanged(c: NewScheme): void {
    if (!c.codeTouched) c.code = codeFrom(c.name);
  }

  protected async create(c: NewScheme): Promise<void> {
    const code = c.code.trim().toUpperCase();
    if (!c.name.trim() || !code) {
      this.modalError.set(t('staff.incentivesAdmin.new.requiredError', 'Enter the name and the code.'));
      return;
    }
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(this.api.create({ template: c.template || null, code, name: c.name.trim() }));
      this.creating.set(null);
      await this.router.navigate([code], { relativeTo: this.route });
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async toggle(s: SchemeSummary): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.setActive(s.code, !s.active))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.api.list()));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
