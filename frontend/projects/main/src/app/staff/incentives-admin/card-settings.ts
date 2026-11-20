import { Component, Injectable, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe } from '../../content/page-text';
import { CardSettings, SchemesAdminApi } from './schemes-admin.api';

/** The levels the Financial Assistance card can open after (the user: Bronze / Silver / Gold only). */
export const FA_LEVELS = ['Bronze', 'Silver', 'Gold'] as const;

/**
 * The settings of the Financial Assistance and Technology Upgradation cards (one GET, one PUT), shared by the two blocks of
 * Main Dashboard Cards: provide it on the page.
 */
@Injectable()
export class CardSettingsState {
  private readonly api = inject(SchemesAdminApi);
  readonly settings = signal<CardSettings | null>(null);
  readonly busy = signal(false);
  readonly message = signal<{ ok: boolean; text: string; card: string } | null>(null);

  async load(): Promise<void> {
    try {
      const s = await firstValueFrom(this.api.cards());
      this.settings.set({
        financialAssistance: { activatesAfter: [...(s.financialAssistance?.activatesAfter ?? FA_LEVELS)] },
        technologyUpgradation: { ...s.technologyUpgradation, schemes: s.technologyUpgradation?.schemes ?? [] },
      });
    } catch {
      this.settings.set(null);
    }
  }

  async save(card: string): Promise<void> {
    const s = this.settings();
    if (!s) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const body: CardSettings = {
        financialAssistance: { activatesAfter: FA_LEVELS.filter((l) => s.financialAssistance.activatesAfter.includes(l)) },
        technologyUpgradation: { recommendationRequired: s.technologyUpgradation.recommendationRequired, directSchemeCode: s.technologyUpgradation.directSchemeCode || null },
      };
      this.message.set({ ok: true, text: (await firstValueFrom(this.api.saveCards(body))).message, card });
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err), card });
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Under a built-in card of Main Dashboard Cards (2026-11-20, approved): Financial Assistance → "Activates after" Bronze / Silver
 * / Gold; Technology Upgradation → "Needs the consultant's recommendation" (on: the Handholding flow as today; off: the chosen
 * direct scheme of Admin → Incentive Schemes).
 */
@Component({
  selector: 'zed-card-settings-block',
  imports: [FormsModule, TextPipe],
  template: `
    @if (state.settings(); as s) {
      <div class="cs-box">
        @if (card() === 'FINANCIAL_ASSISTANCE') {
          <span class="cs-label">{{ 'Activates after' | t: 'staff.incentivesAdmin.cards.faActivatesAfter' }}</span>
          <div class="cs-levels">
            @for (l of levels; track l) {
              <label><input type="checkbox" [attr.data-level]="l" [checked]="s.financialAssistance.activatesAfter.includes(l)" (change)="toggle(l)" /> {{ l }}</label>
            }
          </div>
          <small class="muted">{{ 'None ticked = all three levels.' | t: 'staff.incentivesAdmin.cards.faHelp' }}</small>
        } @else {
          <label class="af-switch" [class.off]="!s.technologyUpgradation.recommendationRequired">
            <input type="checkbox" role="switch" id="cs-recommendation" [(ngModel)]="s.technologyUpgradation.recommendationRequired" />
            <span class="af-track" aria-hidden="true"></span>{{ "Needs the consultant's recommendation" | t: 'staff.incentivesAdmin.cards.tuRecommendation' }}
          </label>
          <small class="muted d-block">{{ s.technologyUpgradation.recommendationRequired
            ? ('On: units apply after the consultant recommends technologies in Handholding (as today).' | t: 'staff.incentivesAdmin.cards.tuOnHelp')
            : ('Off: units apply directly through the scheme chosen here.' | t: 'staff.incentivesAdmin.cards.tuOffHelp') }}</small>
          @if (!s.technologyUpgradation.recommendationRequired) {
            <select class="form-select form-select-sm mt-1" id="cs-direct" [attr.aria-label]="'Direct scheme' | t: 'staff.incentivesAdmin.cards.tuDirectAria'" [(ngModel)]="s.technologyUpgradation.directSchemeCode">
              <option [ngValue]="null">{{ 'Choose the scheme…' | t: 'staff.incentivesAdmin.cards.tuChoose' }}</option>
              @for (o of s.technologyUpgradation.schemes ?? []; track o.code) {
                <option [ngValue]="o.code">{{ o.name }}{{ o.active ? '' : (' (off)' | t: 'staff.incentivesAdmin.cards.tuOff') }}</option>
              }
            </select>
          }
        }
        <button type="button" class="btn btn-outline-primary btn-sm cs-save" [disabled]="state.busy()" (click)="state.save(card())">{{ 'Save setting' | t: 'staff.incentivesAdmin.cards.saveButton' }}</button>
        @if (state.message(); as m) {
          @if (m.card === card()) { <small class="d-block" [class.cs-ok]="m.ok" [class.cs-bad]="!m.ok" [attr.role]="m.ok ? 'status' : 'alert'">{{ m.text }}</small> }
        }
      </div>
    }
  `,
  styles: `
    .cs-box { display: flex; flex-direction: column; gap: 6px; padding: 10px; border: 1px dashed #9cc9cd; border-radius: 8px; background: #fff; font-size: 13px; }
    .cs-label { font-weight: 700; color: #23474a; }
    .cs-levels { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .cs-levels label { display: flex; align-items: center; gap: 6px; margin: 0; cursor: pointer; }
    .cs-save { align-self: flex-start; }
    .cs-ok { color: #1e7a3c; }
    .cs-bad { color: #a8303a; }
  `,
})
export class CardSettingsBlockComponent {
  protected readonly state = inject(CardSettingsState);
  readonly card = input.required<string>();
  protected readonly levels = FA_LEVELS;

  protected toggle(level: string): void {
    const s = this.state.settings();
    if (!s) return;
    const list = s.financialAssistance.activatesAfter;
    s.financialAssistance.activatesAfter = list.includes(level) ? list.filter((l) => l !== level) : [...list, level];
  }
}
