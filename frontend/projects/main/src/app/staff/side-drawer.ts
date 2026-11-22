import { Component, input, output } from '@angular/core';
import { TextPipe } from '../content/page-text';

/**
 * 2026-11-22 (the product owner: "side panel as you are showing for history"): the right-hand side panel of the History of a login
 * (users/history-panel.ts, popup-08) as a shell for other panels: the ZED quality observations of a review page and the units of the
 * same PAN. 520px from the right (full width on phones) over a dimmed page, a 19px title with its subtitle, the grey square close
 * button, a scrolling body and a white footer with a top line. The body is the content; the footer is the <code>[drawer-foot]</code>
 * element. Closing (the backdrop, the × button) is reported through <code>closed</code>; Esc is left to the panel inside, which may
 * first close a form of its own.
 */
@Component({
  selector: 'zed-side-drawer',
  imports: [TextPipe],
  template: `
    <div class="sd-back" (click)="closed.emit()"></div>
    <aside class="sd" role="dialog" aria-modal="true" [attr.aria-labelledby]="id() + '-title'" [attr.data-drawer]="id()">
      <header class="sd-head">
        <div>
          <h3 [id]="id() + '-title'">{{ title() }}</h3>
          @if (subtitle()) { <small>{{ subtitle() }}</small> }
        </div>
        <button type="button" class="sd-x" [attr.aria-label]="'Close' | t: 'staff.sideDrawer.closeAria'" (click)="closed.emit()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12" /></svg></button>
      </header>
      <div class="sd-body"><ng-content /></div>
      <div class="sd-foot"><ng-content select="[drawer-foot]" /></div>
    </aside>
  `,
  styles: `
    .sd-back { position: fixed; inset: 0; z-index: 1065; background: rgba(15, 35, 38, 0.56); }
    .sd { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1066; width: min(520px, 100vw); display: flex; flex-direction: column; background: #fff;
      box-shadow: -12px 0 32px rgba(16, 61, 64, 0.2); }
    .sd-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 24px 28px 20px; border-bottom: 1px solid #dde7e8; }
    .sd-head h3 { margin: 0; font-size: 19px; font-weight: 700; color: #17373b; }
    .sd-head small { display: block; margin-top: 4px; font-size: 12.5px; font-weight: 500; color: #6f8487; overflow-wrap: anywhere; }
    .sd-x { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: #17373b; }
    .sd-x svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .sd-body { flex: 1; overflow: auto; padding: 20px 28px; }
    .sd-foot { flex: none; display: flex; justify-content: space-between; gap: 12px; padding: 14px 28px; border-top: 1px solid #dde7e8; background: #fff; color: inherit; }
    .sd-foot:empty { display: none; }
    @media (max-width: 575.98px) {
      .sd-head { padding: 18px 16px 14px; }
      .sd-body { padding: 16px; }
      .sd-foot { padding: 12px 16px; }
    }
  `,
})
export class SideDrawer {
  /** The id of the panel (its title's id and data-drawer). */
  readonly id = input('side-drawer');
  readonly title = input.required<string>();
  readonly subtitle = input('');
  readonly closed = output<void>();
}
