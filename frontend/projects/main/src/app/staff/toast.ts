import { NgTemplateOutlet } from '@angular/common';
import { Component, Injectable, inject, signal } from '@angular/core';
import { TextPipe } from '../content/page-text';

export type ToastTone = 'success' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  message: string | null;
}

/**
 * 2026-11-17 (approved staff redesign): "a short message in the corner confirms each completed action and fades after a few
 * seconds; it never blocks the page". Pages call <code>success()</code> / <code>error()</code>; the staff layout shows them
 * (<code>zed-toast</code>). Success hides after 5 seconds, an error after 8; each can be closed. No Undo.
 */
@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private next = 0;

  success(title: string, message?: string | null, ms = 5000): number {
    return this.show('success', title, message, ms);
  }

  error(title: string, message?: string | null, ms = 8000): number {
    return this.show('error', title, message, ms);
  }

  show(tone: ToastTone, title: string, message?: string | null, ms = 5000): number {
    const id = ++this.next;
    // At most three at a time: the oldest goes.
    this.toasts.update((list) => [...list.slice(-2), { id, tone, title, message: message ?? null }]);
    if (ms > 0) setTimeout(() => this.dismiss(id), ms);
    return id;
  }

  dismiss(id: number): void {
    this.toasts.update((list) => list.filter((t) => t.id !== id));
  }
}

/** The toasts, in the middle of the screen (once, in the staff layout). */
@Component({
  selector: 'zed-toast',
  imports: [NgTemplateOutlet, TextPipe],
  host: { class: 'zed-toast' },
  template: `
    <div class="tt-live" aria-live="polite" role="status">
      @for (t of service.toasts(); track t.id) {
        @if (t.tone === 'success') { <ng-container *ngTemplateOutlet="toast; context: { $implicit: t }" /> }
      }
    </div>
    <div class="tt-live" aria-live="assertive" role="alert">
      @for (t of service.toasts(); track t.id) {
        @if (t.tone === 'error') { <ng-container *ngTemplateOutlet="toast; context: { $implicit: t }" /> }
      }
    </div>
    <ng-template #toast let-t>
      <div class="tt" [class.tt-error]="t.tone === 'error'" [attr.data-tone]="t.tone">
        <span class="tt-icon" aria-hidden="true">
          @if (t.tone === 'success') { <svg viewBox="0 0 24 24"><path d="M6 12.5l4 4L18 8" /></svg> }
          @else { <svg viewBox="0 0 24 24"><path d="M12 7v6M12 16.5v.5" /></svg> }
        </span>
        <span class="tt-text"><b>{{ t.title }}</b>@if (t.message) {&ngsp;<small>{{ t.message }}</small> }</span>
        <button type="button" class="tt-x" [attr.aria-label]="'Close message' | t: 'common.toast.closeAria'" (click)="service.dismiss(t.id)">×</button>
      </div>
    </ng-template>
  `,
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): as the designs, at the bottom left of the page (on its left edge
       on wide screens), 400px, 12px corners, a 24px round icon, the title 13.5px bold and the line under it 12px. */
    /* 2026-11-25 (the user: "Please show the notifications in center not in bottom"): in the middle of the screen. */
    :host { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 1080; display: flex; flex-direction: column; gap: 8px; width: min(400px, calc(100vw - 32px));
      pointer-events: none; }
    .tt-live { display: flex; flex-direction: column; gap: 8px; }
    .tt-live:empty { display: none; }
    .tt { display: flex; align-items: center; gap: 12px; min-height: 64px; padding: 12px 16px 12px 20px; border-radius: 12px; background: #16292b; color: #fff;
      box-shadow: 0 12px 32px rgba(16, 40, 42, 0.3); pointer-events: auto; animation: tt-in 0.18s ease-out; }
    .tt-icon { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; background: #2f9e58; }
    .tt-error .tt-icon { background: #c8473c; }
    .tt-icon svg { width: 15px; height: 15px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .tt-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 13.5px; overflow-wrap: break-word; }
    .tt-text b { font-weight: 700; }
    .tt-text small { font-size: 12px; font-weight: 500; color: #bcd8da; }
    .tt-x { flex: none; border: 0; background: none; color: #bcd8da; font-size: 22px; line-height: 1; padding: 0 2px; }
    .tt-x:hover, .tt-x:focus-visible { color: #fff; }
    @keyframes tt-in { from { opacity: 0; transform: scale(.96); } }
    @media (prefers-reduced-motion: reduce) { .tt { animation: none; } }
  `,
})
export class ToastHost {
  protected readonly service = inject(ToastService);
}
