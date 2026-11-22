import { Component, input, output } from '@angular/core';
import { TextPipe } from '../../content/page-text';

/**
 * 2026-11-22 (the product owner: the observation box off the side, its content in a History-style side panel): the button of a
 * review page that opens the ZED quality observations panel, with the number of open observations (none shown at 0).
 */
@Component({
  selector: 'zed-qo-button',
  imports: [TextPipe],
  template: `
    <button type="button" class="btn btn-primary qob" data-qo-open (click)="opened.emit()">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5h14v10H9l-4 4z" /></svg>{{ 'Observations' | t: 'staff.quality.button.label' }}
      @if (open() > 0) {
        <span class="qob-n" [attr.aria-label]="'{count} open' | t: 'staff.quality.button.openAria' : { count: open() }">{{ open() }}</span>
      }
    </button>
  `,
  styles: `
    :host { display: inline-flex; }
    .qob { display: inline-flex; align-items: center; gap: 8px; min-height: 36px; border-radius: 9px; padding: 0 14px; font-size: 13.5px; font-weight: 700; white-space: nowrap; }
    .qob svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    .qob-n { min-width: 20px; padding: 0 6px; border-radius: 10px; background: #b0362b; color: #fff; font-size: 11px; line-height: 20px; text-align: center; }
  `,
})
export class QoButton {
  /** Observations not closed. */
  readonly open = input(0);
  readonly opened = output<void>();
}
