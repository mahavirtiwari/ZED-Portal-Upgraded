import { Component, computed, input } from '@angular/core';
import { t } from '../../content/page-text';

/** One step of a tracker: its name and the line under it (e.g. a date, or "You are here"). */
export interface TrackerStep {
  label: string;
  note?: string | null;
}

/**
 * 2026-11-17 (the user's applicant designs): the numbered step tracker of the applicant pages (certification progress,
 * apply and pay, financial assistance claim): done steps ticked green and joined by a green line, the current one
 * outlined, the rest grey. <code>current</code> is the 0-based current step; a value past the last step marks all done.
 */
@Component({
  selector: 'zed-step-tracker',
  host: { class: 'd-block' },
  template: `
    <ol class="st" [attr.aria-label]="name()">
      @for (s of steps(); track $index; let i = $index) {
        <li class="st-step" [class.st-done]="i < current()" [class.st-now]="i === current()" [attr.aria-current]="i === current() ? 'step' : null">
          <span class="st-dot" aria-hidden="true">
            @if (i < current()) {
              <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            } @else {
              {{ i + 1 }}
            }
          </span>
          <span class="st-label">{{ s.label }}</span>
          @if (s.note) { <span class="st-note">{{ s.note }}</span> }
        </li>
      }
    </ol>
  `,
  styles: `
    .st { list-style: none; margin: 0; padding: 16px 12px 14px; display: grid; grid-auto-columns: minmax(0, 1fr); grid-auto-flow: column;
      background: #fff; border: 1px solid #e3ecec; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); }
    .st-step { position: relative; display: flex; flex-direction: column; align-items: center; text-align: center; padding: 0 6px; min-width: 0; }
    .st-step + .st-step::before { content: ''; position: absolute; top: 15px; right: calc(50% + 20px); left: calc(-50% + 20px); height: 3px;
      background: #dfe7e8; border-radius: 2px; }
    .st-step.st-done + .st-step::before, .st-step.st-done + .st-step.st-done::before { background: #2e9e57; }
    .st-dot { width: 32px; height: 32px; border-radius: 50%; display: grid; place-items: center; font-size: 13px; font-weight: 700;
      border: 2px solid #c9d6d7; color: #6b7c7d; background: #fff; }
    .st-dot svg { width: 18px; height: 18px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .st-done .st-dot { background: #2e9e57; border-color: #2e9e57; }
    .st-now .st-dot { border: 3px solid var(--zt-dark, #1f5c61); color: var(--zt-dark, #1f5c61); }
    .st-label { margin-top: 8px; font-size: 13.5px; font-weight: 700; color: #24393b; }
    .st-step:not(.st-done):not(.st-now) .st-label { color: #5f6f70; }
    .st-note { font-size: 12px; color: #5f6f70; }
    .st-now .st-note { color: var(--zt-dark, #1f5c61); }
    @media (max-width: 575.98px) {
      .st-label { font-size: 11.5px; }
      .st-note { display: none; }
    }
  `,
})
export class StepTracker {
  readonly steps = input.required<TrackerStep[]>();
  /** The 0-based current step (steps before it are done). */
  readonly current = input(0);
  /** Unset: the standard "Progress" (Admin-editable). */
  readonly label = input<string>();
  protected readonly name = computed(() => this.label() || t('common.stepTracker.aria', 'Progress'));
  protected readonly count = computed(() => this.steps().length);
}
