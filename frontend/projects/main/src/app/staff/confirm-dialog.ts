import { Component, ElementRef, HostListener, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** What a confirmation asks. With <code>reason</code> the pop-up also asks for a text (required unless said otherwise). */
export interface ConfirmAsk {
  title: string;
  message?: string | null;
  /** The confirm button's text (default "Confirm"). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** A destructive action (block, delete): the confirm button is red. */
  danger?: boolean;
  reason?: {
    label?: string;
    placeholder?: string;
    /** Default true. */
    required?: boolean;
    /** Shown when a required reason is empty (default "Please enter the reason."). */
    requiredMessage?: string;
    maxLength?: number;
    /** A line under the field (e.g. "Kept in the history and e-mailed to the user."). */
    hint?: string;
  };
}

let nextId = 0;

/**
 * 2026-11-17 (approved staff redesign, "menu items open a confirmation"): the confirmation pop-up of the staff pages, made
 * from the block / unblock reason pop-up (<code>ReasonDialog</code>, now a wrapper of this one): a title, a message, an
 * optional reason (required by default), Cancel and the confirm button (red for a danger action). <code>confirmed</code>
 * gives the reason (trimmed; "" without one). Esc or a click outside cancels. The page shows <code>busy</code> while it
 * works and <code>failed</code> (the server's refusal) in the pop-up.
 */
@Component({
  selector: 'zed-confirm-dialog',
  imports: [FormsModule],
  template: `
    @let a = ask();
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" [attr.aria-labelledby]="id + '-title'"
         [attr.aria-describedby]="a.message ? id + '-msg' : null" (click)="cancel.emit()">
      <div class="modal-dialog modal-dialog-centered modal-popup" (click)="$event.stopPropagation()">
        <div class="modal-content cd">
          <div class="modal-header">
            <div class="modal-title w-100 d-flex justify-content-between align-items-center">
              <h3 class="registration-title m-0" [id]="id + '-title'">{{ a.title }}</h3>
              <button type="button" class="btn btn-link p-0 cd-x" aria-label="Close" (click)="cancel.emit()">×</button>
            </div>
          </div>
          <form (ngSubmit)="submit()" novalidate>
            <div class="modal-body">
              @if (a.message) { <p class="cd-msg" [id]="id + '-msg'">{{ a.message }}</p> }
              @if (a.reason; as r) {
                <label class="form-label" [for]="inputId()">{{ r.label ?? 'Reason' }}@if (r.required !== false) {<span class="req">*</span>}</label>
                <textarea [id]="inputId()" name="reason" class="form-control" rows="3" [attr.maxlength]="r.maxLength ?? 2000" [(ngModel)]="text"
                          [placeholder]="r.placeholder ?? ''" [attr.aria-invalid]="!!error()"></textarea>
                @if (r.hint) { <small class="cd-hint">{{ r.hint }}</small> }
              }
              @if (error() || failed()) { <span class="help-block" role="alert">{{ error() || failed() }}</span> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="cancel.emit()">{{ a.cancelLabel ?? 'Cancel' }}</button>
              <button type="submit" class="btn cd-ok" [class.btn-danger]="a.danger" [class.btn-primary]="!a.danger" [disabled]="busy() || blocked()">
                {{ a.confirmLabel ?? 'Confirm' }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .cd { border-radius: 12px; }
    .cd-msg { font-size: 14px; color: #3d5254; margin-bottom: 12px; }
    .cd-hint { display: block; margin-top: 4px; font-size: 12.5px; color: #5f6f70; }
    .cd-x { font-size: 24px; line-height: 1; color: #5f6f70 !important; text-decoration: none; }
    .help-block { display: block; margin-top: 6px; color: #a94442; font-size: 13px; }
    .cd-ok:disabled { opacity: 0.55; }
  `,
})
export class ConfirmDialog {
  readonly ask = input.required<ConfirmAsk>();
  readonly busy = input(false);
  /** The server's refusal, shown in the pop-up. */
  readonly failed = input('');
  /** The reason field's id (ReasonDialog keeps its own). */
  readonly inputId = input('confirm-dialog-text');
  /** Disables the confirm button until a required reason is typed (else it says what is missing on confirm). */
  readonly holdUntilReason = input(false);
  readonly confirmed = output<string>();
  readonly cancel = output<void>();

  protected readonly id = `zed-confirm-${++nextId}`;
  protected text = '';
  private readonly typed = signal('');
  protected readonly error = signal('');
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly blocked = computed(() => this.holdUntilReason() && this.needsReason() && !this.typed().trim());

  constructor() {
    // The reason field first, else the confirm button.
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      (el.querySelector('textarea') ?? el.querySelector<HTMLButtonElement>('.cd-ok'))?.focus();
    });
  }

  private needsReason(): boolean {
    const r = this.ask().reason;
    return !!r && r.required !== false;
  }

  @HostListener('input', ['$event'])
  protected typing(event: Event): void {
    if (event.target instanceof HTMLTextAreaElement) this.typed.set(event.target.value);
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.cancel.emit();
  }

  protected submit(): void {
    const reason = this.ask().reason ? this.text.trim() : '';
    if (this.needsReason() && !reason) {
      this.error.set(this.ask().reason?.requiredMessage ?? 'Please enter the reason.');
      return;
    }
    this.error.set('');
    this.confirmed.emit(reason);
  }
}
