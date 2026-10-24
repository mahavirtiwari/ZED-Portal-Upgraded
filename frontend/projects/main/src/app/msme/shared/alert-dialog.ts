import { Component, ElementRef, afterRenderEffect, input, output, viewChild } from '@angular/core';

export type AlertKind = 'error' | 'success';

/** What the dialog shows; the title defaults to the legacy "Error!" / "Success!". */
export interface AlertMessage {
  kind: AlertKind;
  text: string;
  title?: string;
}

export const errorAlert = (text: string): AlertMessage => ({ kind: 'error', text });
export const successAlert = (text: string): AlertMessage => ({ kind: 'success', text });

let nextId = 0;

/**
 * Modal message in the style of the legacy pages' `swal("Error!", text, "error")` and
 * `swal("Success!", text, "success")` (SweetAlert 2.x look: icon, title, text, OK). Shown wherever the
 * page is scrolled. OK, Escape or a click outside closes it; the page clears its message on `closed`.
 * Focus goes to OK while open and back to where it was on close.
 *
 *   <zed-alert-dialog [message]="alert()" (closed)="alert.set(null)" />
 */
@Component({
  selector: 'zed-alert-dialog',
  template: `
    @if (message(); as m) {
      <div class="swal-overlay" (click)="close()" (keydown)="onKey($event)">
        <div class="swal-modal" role="dialog" aria-modal="true" [attr.aria-labelledby]="id + '-title'" [attr.aria-describedby]="id + '-text'" (click)="$event.stopPropagation()">
          @if (m.kind === 'error') {
            <div class="swal-icon swal-icon--error" aria-hidden="true">
              <span class="swal-icon--error__line swal-icon--error__line--left"></span>
              <span class="swal-icon--error__line swal-icon--error__line--right"></span>
            </div>
          } @else {
            <div class="swal-icon swal-icon--success" aria-hidden="true">
              <span class="swal-icon--success__line swal-icon--success__line--long"></span>
              <span class="swal-icon--success__line swal-icon--success__line--tip"></span>
            </div>
          }
          <div class="swal-title" [id]="id + '-title'">{{ m.title ?? (m.kind === 'error' ? 'Error!' : 'Success!') }}</div>
          <div class="swal-text" [id]="id + '-text'">{{ m.text }}</div>
          <div class="swal-footer"><button #ok type="button" class="swal-button" (click)="close()">OK</button></div>
        </div>
      </div>
    }
  `,
  styles: `
    .swal-overlay { position: fixed; inset: 0; z-index: 10000; display: flex; align-items: center; justify-content: center; overflow-y: auto; background: rgba(0,0,0,.4); }
    .swal-modal { width: 478px; max-width: calc(100% - 20px); margin: 20px auto; background: #fff; border-radius: 5px; text-align: center; }
    .swal-icon { position: relative; box-sizing: content-box; width: 80px; height: 80px; margin: 20px auto; border: 4px solid; border-radius: 50%; }
    .swal-icon--error { border-color: #f27474; }
    .swal-icon--error__line { position: absolute; top: 37px; display: block; width: 47px; height: 5px; border-radius: 2px; background: #f27474; }
    .swal-icon--error__line--left { left: 17px; transform: rotate(45deg); }
    .swal-icon--error__line--right { right: 16px; transform: rotate(-45deg); }
    .swal-icon--success { border-color: rgba(165,220,134,.3); }
    .swal-icon--success__line { position: absolute; display: block; height: 5px; border-radius: 2px; background: #a5dc86; }
    .swal-icon--success__line--long { top: 38px; right: 8px; width: 47px; transform: rotate(-45deg); }
    .swal-icon--success__line--tip { top: 46px; left: 14px; width: 25px; transform: rotate(45deg); }
    .swal-title { padding: 13px 16px 0; margin-bottom: 13px; font-size: 27px; font-weight: 600; color: rgba(0,0,0,.65); }
    .swal-text { display: inline-block; max-width: calc(100% - 20px); padding: 0 10px; font-size: 16px; color: rgba(0,0,0,.64); text-align: left; overflow-wrap: break-word; }
    .swal-footer { margin-top: 13px; padding: 13px 16px; text-align: right; }
    .swal-button { padding: 10px 24px; border: none; border-radius: 5px; background: #7cd1f9; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; }
    .swal-button:hover { background: #78cbf2; }
    .swal-button:focus { outline: none; box-shadow: 0 0 0 1px #fff, 0 0 0 3px rgba(43,114,165,.29); }
  `,
  host: { '(document:keydown.escape)': 'escape($event)' },
})
export class AlertDialog {
  readonly message = input<AlertMessage | null>(null);
  readonly closed = output<void>();

  protected readonly id = `zed-alert-${nextId++}`;
  private readonly ok = viewChild<ElementRef<HTMLButtonElement>>('ok');
  private opener: HTMLElement | null = null;
  private open = false;

  constructor() {
    afterRenderEffect(() => {
      const isOpen = !!this.message();
      const ok = this.ok()?.nativeElement;
      if (isOpen && !this.open) this.opener = document.activeElement as HTMLElement | null;
      if (isOpen) ok?.focus();
      else if (this.open) this.opener?.focus?.();
      this.open = isOpen;
    });
  }

  protected close(): void {
    this.closed.emit();
  }

  protected escape(event: Event): void {
    if (!this.message()) return;
    event.preventDefault();
    this.close();
  }

  /** OK is the only control: Tab keeps focus on it. */
  protected onKey(event: KeyboardEvent): void {
    if (event.key !== 'Tab') return;
    event.preventDefault();
    this.ok()?.nativeElement.focus();
  }
}
