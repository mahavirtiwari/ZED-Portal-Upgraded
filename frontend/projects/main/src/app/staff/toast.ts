import { NgTemplateOutlet } from '@angular/common';
import { Component, Injectable, inject, signal } from '@angular/core';

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

/** The toasts, bottom right (once, in the staff layout). */
@Component({
  selector: 'zed-toast',
  imports: [NgTemplateOutlet],
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
        <button type="button" class="tt-x" aria-label="Close message" (click)="service.dismiss(t.id)">×</button>
      </div>
    </ng-template>
  `,
  styles: `
    :host { position: fixed; right: 16px; bottom: 16px; z-index: 1080; display: flex; flex-direction: column; gap: 8px; width: min(400px, calc(100vw - 32px));
      pointer-events: none; }
    .tt-live { display: flex; flex-direction: column; gap: 8px; }
    .tt-live:empty { display: none; }
    .tt { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 10px; background: #1d2f31; color: #fff;
      box-shadow: 0 12px 32px rgba(16, 40, 42, 0.3); pointer-events: auto; animation: tt-in 0.18s ease-out; }
    .tt-icon { flex: none; width: 28px; height: 28px; border-radius: 50%; display: grid; place-items: center; background: #2e9e57; }
    .tt-error .tt-icon { background: #d64532; }
    .tt-icon svg { width: 16px; height: 16px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .tt-text { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; font-size: 14px; overflow-wrap: anywhere; }
    .tt-text small { font-size: 12.5px; color: #c9dcdc; }
    .tt-x { flex: none; border: 0; background: none; color: #c9dcdc; font-size: 22px; line-height: 1; padding: 0 2px; }
    .tt-x:hover, .tt-x:focus-visible { color: #fff; }
    @keyframes tt-in { from { opacity: 0; transform: translateY(8px); } }
    @media (prefers-reduced-motion: reduce) { .tt { animation: none; } }
  `,
})
export class ToastHost {
  protected readonly service = inject(ToastService);
}
