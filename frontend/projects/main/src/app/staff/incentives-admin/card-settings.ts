import { Component, Injectable, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe } from '../../content/page-text';
import { CardSettings, LevelOption, SchemesAdminApi } from './schemes-admin.api';

/** The levels shown before the server lists them (Admin → Certification Levels comes with the settings). */
export const DEFAULT_LEVELS: readonly LevelOption[] = [
  { code: 'Bronze', name: 'Bronze' }, { code: 'Silver', name: 'Silver' }, { code: 'Gold', name: 'Gold' },
];

/** The direct Technology Upgradation scheme the server adds (SchemeTemplates.DirectTuCode). */
export const DIRECT_TU_CODE = 'TU_DIRECT';

/**
 * The settings of the Financial Assistance and Technology Upgradation cards (one GET, one PUT), shared by the two blocks of
 * Main Dashboard Cards: provide it on the page.
 */
@Injectable()
export class CardSettingsState {
  private readonly api = inject(SchemesAdminApi);
  readonly settings = signal<CardSettings | null>(null);
  /** Every certification level (2026-11-20: Financial Assistance can open after any of them, ZED-X and added levels too). */
  readonly levels = signal<readonly LevelOption[]>(DEFAULT_LEVELS);
  readonly busy = signal(false);
  readonly message = signal<{ ok: boolean; text: string; card: string } | null>(null);

  async load(): Promise<void> {
    try {
      const s = await firstValueFrom(this.api.cards());
      if (s.financialAssistance?.levels?.length) this.levels.set(s.financialAssistance.levels);
      this.settings.set({
        financialAssistance: { activatesAfter: [...(s.financialAssistance?.activatesAfter ?? DEFAULT_LEVELS.map((l) => l.code))] },
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
      const ticked = s.financialAssistance.activatesAfter.map((l) => l.toLowerCase());
      const body: CardSettings = {
        financialAssistance: { activatesAfter: this.levels().map((l) => l.code).filter((c) => ticked.includes(c.toLowerCase())) },
        technologyUpgradation: { recommendationRequired: s.technologyUpgradation.recommendationRequired, directSchemeCode: s.technologyUpgradation.directSchemeCode || null },
      };
      this.message.set({ ok: true, text: (await firstValueFrom(this.api.saveCards(body))).message, card });
      // The server may have switched the direct scheme on or added grading rows: show the settings as saved.
      await this.load();
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err), card });
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Under a built-in card of Main Dashboard Cards (2026-11-20, approved): Financial Assistance → "Activates after" any certification
 * level (it is also the activation of the Financial Assistance scheme the card opens); Technology Upgradation → "Needs the
 * consultant's recommendation" (on: the Handholding flow as today; off: the chosen direct scheme of Admin → Incentive Schemes,
 * switched on by the save when it is off).
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
            @for (l of state.levels(); track l.code) {
              <label><input type="checkbox" [attr.data-level]="l.code" [checked]="ticked(l.code)" (change)="toggle(l.code)" /> {{ l.name }}</label>
            }
          </div>
          <small class="muted">{{ 'Tick at least one level. The card opens the Financial Assistance scheme of Incentive Schemes for units certified at these levels.' | t: 'staff.incentivesAdmin.cards.faHelp' }}</small>
        } @else {
          <label class="af-switch" [class.off]="!s.technologyUpgradation.recommendationRequired">
            <input type="checkbox" role="switch" id="cs-recommendation" [ngModel]="s.technologyUpgradation.recommendationRequired" (ngModelChange)="setRecommendation($event)" />
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
            @if (chosenOff()) {
              <small class="d-block cs-note" id="cs-direct-off">{{ 'This scheme is off: saving switches it on, so units can apply.' | t: 'staff.incentivesAdmin.cards.tuSwitchOn' }}</small>
            }
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
    /* The switch's label wraps inside the box (switches are one line by default and ran out of the narrow card). */
    .cs-box .af-switch { white-space: normal; margin: 0; }
    .cs-box .af-track { flex: none; }
    .cs-levels { display: flex; flex-wrap: wrap; gap: 4px 14px; }
    .cs-levels label { display: flex; align-items: center; gap: 6px; margin: 0; cursor: pointer; }
    .cs-save { align-self: flex-start; }
    .cs-note { color: #8a5a00; }
    .cs-ok { color: #1e7a3c; }
    .cs-bad { color: #a8303a; }
  `,
})
export class CardSettingsBlockComponent {
  protected readonly state = inject(CardSettingsState);
  readonly card = input.required<string>();

  protected ticked(code: string): boolean {
    return (this.state.settings()?.financialAssistance.activatesAfter ?? []).some((l) => l.toLowerCase() === code.toLowerCase());
  }

  protected toggle(code: string): void {
    const s = this.state.settings();
    if (!s) return;
    const list = s.financialAssistance.activatesAfter;
    s.financialAssistance.activatesAfter = this.ticked(code) ? list.filter((l) => l.toLowerCase() !== code.toLowerCase()) : [...list, code];
  }

  /** Off: the direct scheme is chosen for the Admin (the built-in one) when none is. */
  protected setRecommendation(on: boolean): void {
    const tu = this.state.settings()?.technologyUpgradation;
    if (!tu) return;
    tu.recommendationRequired = on;
    if (!on && !tu.directSchemeCode && (tu.schemes ?? []).some((o) => o.code === DIRECT_TU_CODE)) tu.directSchemeCode = DIRECT_TU_CODE;
  }

  /** The chosen direct scheme is switched off (the save switches it on). */
  protected chosenOff(): boolean {
    const tu = this.state.settings()?.technologyUpgradation;
    return !!tu && !tu.recommendationRequired && !!tu.directSchemeCode && (tu.schemes ?? []).some((o) => o.code === tu.directSchemeCode && !o.active);
  }
}
