import { Component, ElementRef, HostListener, inject, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';

/** The roles that can open a unit's profile (the guard of /staff/msme-profile/:zedId in app.routes.ts). */
export const MSME_PROFILE_ROLES: readonly number[] = [7, 10, 8, 11, 17, 2, 3];

/** A ZED ID as typed: "ZED" and letters, digits or "_" (e.g. ZEDMSME000001, ZEDM000005), at most 50 characters. */
export const ZED_ID_PATTERN = /^ZED[A-Z0-9_]{2,47}$/;

/**
 * 2026-11-17 (approved staff redesign): "Search ZED ID" in the header. Ctrl+K (⌘K) goes to the box; Enter opens the unit's
 * profile (/staff/msme-profile/ZEDID, trimmed and in capitals); anything that cannot be a ZED ID gets a short note instead.
 * Esc clears the box.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' box, 164 x 32, darker than the menu strip, with the
 * "Ctrl K" chip.
 */
@Component({
  selector: 'zed-zed-id-search',
  host: { class: 'zs' },
  template: `
    <form class="zs-box" role="search" (submit)="$event.preventDefault(); go()">
      <svg class="zs-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input #box type="search" name="zedId" class="zs-input" placeholder="Search ZED ID" aria-label="Search ZED ID" autocomplete="off"
             spellcheck="false" maxlength="60" [attr.aria-invalid]="!!note()" [attr.aria-describedby]="note() ? 'zs-note' : null"
             (input)="note.set('')" (keydown.escape)="clear()" />
      <kbd class="zs-key" aria-hidden="true">Ctrl K</kbd>
    </form>
    @if (note()) { <span class="zs-note" id="zs-note" role="alert">{{ note() }}</span> }
  `,
  styles: `
    :host { position: relative; display: inline-flex; }
    .zs-box { display: flex; align-items: center; gap: 7px; height: 32px; width: 164px; padding: 0 6px 0 10px; border: 1px solid transparent;
      border-radius: 8px; background: rgba(0, 0, 0, 0.2); color: #bcd8da; }
    .zs-box:focus-within { border-color: rgba(255, 255, 255, 0.45); background: rgba(0, 0, 0, 0.28); }
    .zs-icon { flex: none; width: 15px; height: 15px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .zs-input { flex: 1; min-width: 0; height: 100%; padding: 0; border: 0; outline: none; background: transparent; color: #fff; font-size: 12px; font-weight: 500; }
    .zs-input::placeholder { color: #bcd8da; opacity: 1; }
    .zs-input::-webkit-search-cancel-button { display: none; }
    .zs-key { flex: none; display: grid; place-items: center; height: 20px; padding: 0 5px; border-radius: 5px;
      background: color-mix(in srgb, var(--zt-mid, #45a5ad) 30%, var(--zt-dark, #24666b)); color: #d3e6e8; font-family: inherit; font-size: 9px; font-weight: 700; box-shadow: none; }
    .zs-note { position: absolute; top: calc(100% + 6px); left: 0; z-index: 1050; width: max-content; max-width: 260px; padding: 6px 10px; border-radius: 6px;
      background: #fff; color: #b03a2e; font-size: 12.5px; font-weight: 600; box-shadow: 0 6px 18px rgba(16, 61, 64, 0.18); }
    @media (max-width: 991.98px) {
      :host, .zs-box { width: 100%; }
      .zs-key { display: none; }
    }
  `,
})
export class ZedIdSearch {
  private readonly router = inject(Router);
  private readonly box = viewChild.required<ElementRef<HTMLInputElement>>('box');
  protected readonly note = signal('');

  protected go(): void {
    const input = this.box().nativeElement;
    const id = input.value.trim().toUpperCase();
    if (!id) {
      this.note.set('Type a ZED ID, e.g. ZEDMSME000001.');
      return;
    }
    if (!ZED_ID_PATTERN.test(id)) {
      this.note.set('This is not a ZED ID. A ZED ID starts with ZED, e.g. ZEDMSME000001.');
      return;
    }
    this.note.set('');
    input.value = '';
    input.blur();
    void this.router.navigate(['/staff/msme-profile', id]);
  }

  protected clear(): void {
    this.box().nativeElement.value = '';
    this.note.set('');
  }

  /** Ctrl+K / ⌘K anywhere on the page. */
  @HostListener('document:keydown', ['$event'])
  protected shortcut(event: KeyboardEvent): void {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      const input = this.box().nativeElement;
      input.focus();
      input.select();
    }
  }
}
