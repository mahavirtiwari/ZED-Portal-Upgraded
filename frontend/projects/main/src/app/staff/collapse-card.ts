import { Component, input, model } from '@angular/core';

let nextId = 0;

/**
 * A card whose body opens and closes on its header (title, a one-line summary, a chevron). The body is hidden, not
 * removed, when closed, so what was typed in it stays. V4 building block of the Admin pages (docs/UI-GUIDE.md).
 *
 *   <zed-collapse-card title="Mail servers" [summary]="'11 modules'" [(open)]="open">…</zed-collapse-card>
 */
@Component({
  selector: 'zed-collapse-card',
  host: { class: 'zed-card zed-collapse-card d-block', '[class.is-closed]': '!open()' },
  template: `
    <button type="button" class="collapse-head" [attr.aria-expanded]="open()" [attr.aria-controls]="bodyId" (click)="open.set(!open())">
      <span class="collapse-title">
        <span class="card-title">{{ title() }}</span>
        @if (summary()) { <small class="collapse-summary">{{ summary() }}</small> }
      </span>
      <span class="chevron" aria-hidden="true"></span>
    </button>
    <div class="collapse-body" [id]="bodyId" [hidden]="!open()">
      <ng-content />
    </div>
  `,
  styles: `
    .collapse-head { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 12px; padding: 0;
      border: 0; background: none; text-align: left; cursor: pointer; color: inherit; }
    .collapse-head:focus-visible { outline: 2px solid #45a5ad; outline-offset: 4px; border-radius: 6px; }
    .card-title { display: block; margin: 0; font-size: 16px; font-weight: 700; color: #23474a; }
    .collapse-summary { display: block; margin-top: 2px; color: #6b7f80; font-size: 13px; }
    .chevron { flex: 0 0 auto; width: 10px; height: 10px; margin-right: 6px; border-right: 2px solid #2f7c83;
      border-bottom: 2px solid #2f7c83; transform: rotate(45deg); transition: transform .15s; }
    :host(.is-closed) .chevron { transform: rotate(-45deg); }
    .collapse-body { margin-top: 14px; }`,
})
export class CollapseCard {
  readonly title = input.required<string>();
  /** Shown under the title, open or closed: what is inside at a glance. */
  readonly summary = input<string>('');
  readonly open = model(false);
  protected readonly bodyId = `zed-collapse-${++nextId}`;
}
