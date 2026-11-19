import { Component, ElementRef, HostListener, Injector, afterNextRender, inject, input, output, signal, viewChild } from '@angular/core';

/** The small line icons a menu item can show. */
export type RowMenuIcon = 'edit' | 'people' | 'mail' | 'history' | 'lock' | 'unlock' | 'eye' | 'download' | 'trash' | 'refresh' | 'award' | 'file';

/** One action of a row menu. A danger item (block, delete) is red and set apart below a line. */
export interface RowMenuItem {
  key: string;
  label: string;
  icon?: RowMenuIcon;
  danger?: boolean;
  disabled?: boolean;
}

const ICONS: Record<RowMenuIcon, string> = {
  edit: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  people: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM2 21v-1a6 6 0 0 1 12 0v1M16 3.5a4 4 0 0 1 0 7.5M22 21v-1a6 6 0 0 0-4-5.6',
  mail: 'M3 5h18v14H3zM3 6l9 7 9-7',
  history: 'M12 7v5l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6L3 9M3 4v5h5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  unlock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 7.5-2',
  eye: 'M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12zM12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
  download: 'M12 3v12M7 10l5 5 5-5M4 21h16',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  refresh: 'M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7',
  // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-11's ribbon (pledge certificate) and document (report).
  award: 'M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12zM8.5 14l-1.5 8 5-3 5 3-1.5-8',
  file: 'M14 3H6v18h12V7zM14 3v4h4M9 13h6M9 17h6',
};

/**
 * 2026-11-17 (approved staff redesign, "every list uses the same row menu"): the "⋮" button of a table row with the row's
 * further actions; the routine ones first, the danger ones last, in red, below a line. Opens below the button (above when
 * there is no room), over the table; closes on a choice, a click outside, Esc, Tab, scrolling or resizing. Keyboard:
 * Enter / Space / ↓ open it on the first item, ↑ / ↓ / Home / End move, Esc returns to the button.
 */
@Component({
  selector: 'zed-row-menu',
  host: { class: 'zed-row-menu' },
  template: `
    <button #trigger type="button" class="rm-btn" aria-haspopup="menu" [attr.aria-expanded]="open()" [attr.aria-label]="label()"
            (click)="toggle($event)" (keydown)="triggerKey($event)">
      <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="5" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="12" cy="19" r="1.8" /></svg>
    </button>
    @if (open()) {
      <div #menu class="rm-menu" role="menu" [attr.aria-label]="label()" [style.top.px]="pos().top" [style.left.px]="pos().left" (keydown)="menuKey($event)">
        @for (item of items(); track item.key; let i = $index) {
          @if (item.danger && i > 0 && !items()[i - 1].danger) { <div class="rm-sep" role="separator"></div> }
          <button type="button" role="menuitem" class="rm-item" [class.danger]="item.danger" [disabled]="item.disabled" tabindex="-1"
                  (click)="choose(item)">
            @if (item.icon) { <svg viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icon(item.icon)" /></svg> }
            <span>{{ item.label }}</span>
          </button>
        }
      </div>
    }
  `,
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' kebab, a 32px grey square (pale teal and outlined
       while open), and the menu: 36px rows, teal icons, the chosen row on pale teal, the red actions under a line. */
    :host { display: inline-block; vertical-align: middle; }
    .rm-btn { width: 32px; height: 32px; padding: 0; display: grid; place-items: center; border: 1.5px solid #e7eeee; border-radius: 8px; background: #e7eeee; color: #17373b; }
    .rm-btn:hover, .rm-btn[aria-expanded='true'] { border-color: var(--zt-dark, #24666b); background: #e6f2f3; color: var(--zt-dark, #24666b); }
    .rm-btn:focus-visible { outline: 2px solid var(--zt-mid2, #2a8a8c); outline-offset: 2px; }
    .rm-btn svg { width: 18px; height: 18px; fill: currentColor; }
    /* 2026-11-19 (the user, Admin login: dark buttons): the "⋯" button solid dark with white dots. */
    :host-context(.zed-admin) .rm-btn { border-color: #3d5a5e; background: #3d5a5e; color: #fff; }
    :host-context(.zed-admin) .rm-btn:hover, :host-context(.zed-admin) .rm-btn[aria-expanded='true'] { border-color: #2c4346; background: #2c4346; color: #fff; }
    .rm-menu { position: fixed; z-index: 1060; min-width: 230px; max-width: min(320px, calc(100vw - 16px)); padding: 6px; background: #fff;
      border: 1px solid #dde7e8; border-radius: 12px; box-shadow: 0 3px 10px rgba(0, 0, 0, 0.09), 0 12px 32px rgba(16, 61, 64, 0.12); text-align: left; }
    .rm-item { display: flex; align-items: center; gap: 10px; width: 100%; min-height: 36px; padding: 8px 12px; border: 0; border-radius: 8px; background: none;
      color: #17373b; font-size: 13px; font-weight: 500; text-align: left; }
    .rm-item:hover:not(:disabled), .rm-item:focus-visible { background: #e6f2f3; font-weight: 600; outline: none; }
    .rm-item:disabled { color: #9aa8a9; }
    .rm-item svg { flex: none; width: 16px; height: 16px; fill: none; stroke: var(--zt-dark, #24666b); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .rm-item:disabled svg { stroke: currentColor; }
    .rm-item.danger { color: #c8473c; }
    .rm-item.danger svg { stroke: currentColor; }
    .rm-item.danger:hover:not(:disabled), .rm-item.danger:focus-visible { background: #fbe9e7; }
    .rm-sep { height: 1px; margin: 6px 4px; background: #dde7e8; }
  `,
})
export class RowMenu {
  readonly items = input.required<RowMenuItem[]>();
  /** The button's accessible name, e.g. "More actions for Mahavir Agency". */
  readonly label = input('More actions');
  /** The key of the item chosen. */
  readonly picked = output<string>();

  protected readonly open = signal(false);
  protected readonly pos = signal({ top: 0, left: 0 });
  private readonly host = inject(ElementRef<HTMLElement>);
  private readonly injector = inject(Injector);
  private readonly trigger = viewChild.required<ElementRef<HTMLButtonElement>>('trigger');
  private readonly menu = viewChild<ElementRef<HTMLElement>>('menu');

  protected icon(name: RowMenuIcon): string {
    return ICONS[name];
  }

  protected toggle(event: Event): void {
    event.stopPropagation();
    if (this.open()) this.close(false);
    else this.show(0);
  }

  protected triggerKey(event: KeyboardEvent): void {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      this.show(event.key === 'ArrowUp' ? -1 : 0);
    }
  }

  protected menuKey(event: KeyboardEvent): void {
    const buttons = this.enabled();
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const move = (i: number) => buttons[(i + buttons.length) % buttons.length]?.focus();
    switch (event.key) {
      case 'ArrowDown': event.preventDefault(); move(at + 1); break;
      case 'ArrowUp': event.preventDefault(); move(at < 0 ? -1 : at - 1); break;
      case 'Home': event.preventDefault(); move(0); break;
      case 'End': event.preventDefault(); move(-1); break;
      case 'Escape': event.preventDefault(); event.stopPropagation(); this.close(true); break;
      case 'Tab': this.close(false); break;
    }
  }

  protected choose(item: RowMenuItem): void {
    if (item.disabled) return;
    this.close(true);
    this.picked.emit(item.key);
  }

  /** Opens below the button, right edges lined up; above it when it does not fit; focuses the first (or last) item. */
  private show(focus: 0 | -1): void {
    const r = this.trigger().nativeElement.getBoundingClientRect();
    this.pos.set({ top: r.bottom + 6, left: Math.max(8, r.right - 220) });
    this.open.set(true);
    afterNextRender(() => {
      const menu = this.menu()?.nativeElement;
      if (!menu) return;
      const m = menu.getBoundingClientRect();
      const left = Math.min(Math.max(8, r.right - m.width), window.innerWidth - m.width - 8);
      const top = r.bottom + 6 + m.height > window.innerHeight - 8 && r.top - 6 - m.height > 8 ? r.top - 6 - m.height : r.bottom + 6;
      this.pos.set({ top, left });
      const buttons = this.enabled();
      buttons[focus === 0 ? 0 : buttons.length - 1]?.focus();
    }, { injector: this.injector });
  }

  private close(refocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (refocus) this.trigger().nativeElement.focus();
  }

  private enabled(): HTMLButtonElement[] {
    return Array.from(this.menu()?.nativeElement.querySelectorAll<HTMLButtonElement>('.rm-item:not(:disabled)') ?? []);
  }

  @HostListener('document:click', ['$event'])
  protected outside(event: Event): void {
    if (this.open() && !this.host.nativeElement.contains(event.target as Node)) this.close(false);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.close(false);
  }

  @HostListener('window:resize')
  @HostListener('window:scroll')
  protected moved(): void {
    this.close(false);
  }
}
