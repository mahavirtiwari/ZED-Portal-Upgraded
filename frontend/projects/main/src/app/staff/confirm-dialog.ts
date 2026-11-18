import { Component, ElementRef, HostListener, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** The icon in the pop-up's tile (popups 03 / 04 / 09). */
export type ConfirmIcon = 'lock' | 'unlock' | 'mail' | 'warn' | 'info' | 'check';

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
  /** The grey line under the title ("ZEDAA0080 · 1 assessor"). */
  subtitle?: string | null;
  /** The tile's icon (default: 'warn' for a danger action, else 'info'). */
  icon?: ConfirmIcon;
  /** The tile's and the bullets' colour (default: 'danger' for a danger action, else 'teal'). */
  tone?: 'danger' | 'warn' | 'teal';
  /** What the action does, one line each (a bulleted list after the message). */
  points?: readonly string[];
  /** 'tick': green tick circles (reassurances, popup-04); default 'dot' in the tone. */
  pointStyle?: 'dot' | 'tick';
  /** A tick box above the buttons ("Tell the agency SPOC by e-mail"); its state comes with <code>decided</code>. */
  checkbox?: { label: string; checked?: boolean };
  /** The user the action is about, as a card before the points (popup-04): initials, name, "Assessor · ZEDBA3653", e-mail. */
  person?: { name: string; line?: string | null; email?: string | null; status?: string | null; initials?: string | null };
  /** A small grey line above the buttons (e.g. "The agency SPOC is told by e-mail."). */
  note?: string | null;
}

/** The answer with the tick box's state. */
export interface ConfirmResult {
  reason: string;
  checked: boolean;
}

const ICONS: Record<ConfirmIcon, string> = {
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
  unlock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 9.9-1',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  warn: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z M12 9v4 M12 17h.01',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  check: 'M20 6L9 17l-5-5',
};

let nextId = 0;

/**
 * 2026-11-17 (approved staff redesign, "menu items open a confirmation"): the confirmation pop-up of the staff pages, made
 * from the block / unblock reason pop-up (<code>ReasonDialog</code>, now a wrapper of this one): a title, a message, an
 * optional reason (required by default), Cancel and the confirm button (red for a danger action). <code>confirmed</code>
 * gives the reason (trimmed; "" without one). Esc or a click outside cancels. The page shows <code>busy</code> while it
 * works and <code>failed</code> (the server's refusal) in the pop-up.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the designs' pop-up (popups 01 / 03 / 04 / 09): 560px, a
 * white head with a 40px tinted icon tile, an 18px title and a grey subtitle, a grey square close button; the body as a
 * bulleted list (<code>points</code>), projected content (a user card) before it, the reason field, an optional tick box
 * (<code>checkbox</code>, given with <code>decided</code>); 40px title-case buttons. Callers that pass only a message keep
 * the old look and API.
 */
@Component({
  selector: 'zed-confirm-dialog',
  imports: [FormsModule],
  template: `
    @let a = ask();
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" [attr.aria-labelledby]="id + '-title'"
         [attr.aria-describedby]="a.message ? id + '-msg' : a.points?.length ? id + '-pts' : null" (click)="cancel.emit()">
      <div class="modal-dialog modal-dialog-centered modal-popup cd-dialog" (click)="$event.stopPropagation()">
        <div class="modal-content cd">
          <div class="cd-head">
            <span [class]="'cd-tile is-' + tone()" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path [attr.d]="iconPath()" /></svg>
            </span>
            <div class="cd-titles">
              <h3 class="m-0" [id]="id + '-title'">{{ a.title }}</h3>
              @if (a.subtitle) { <small>{{ a.subtitle }}</small> }
            </div>
            <button type="button" class="cd-x" aria-label="Close" (click)="cancel.emit()">
              <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12" /></svg>
            </button>
          </div>
          <form (ngSubmit)="submit()" novalidate>
            <div class="cd-body">
              <ng-content />
              @if (a.person; as u) {
                <div class="cd-person">
                  <span class="cd-av" aria-hidden="true">{{ u.initials || '?' }}</span>
                  <div class="cd-pi">
                    <strong>{{ u.name }}</strong>
                    @if (u.line) { <small>{{ u.line }}</small> }
                    @if (u.email) { <span>{{ u.email }}</span> }
                  </div>
                  @if (u.status) { <span class="status-badge is-active">{{ u.status }}</span> }
                </div>
              }
              @if (a.message) { <p class="cd-msg" [id]="id + '-msg'">{{ a.message }}</p> }
              @if (a.points?.length) {
                <ul [class]="'cd-pts is-' + tone() + (a.pointStyle === 'tick' ? ' is-tick' : '')" [id]="id + '-pts'">
                  @for (p of a.points; track $index) { <li>{{ p }}</li> }
                </ul>
              }
              @if (a.reason; as r) {
                <label class="cd-label" [for]="inputId()">{{ r.label ?? 'Reason' }}@if (r.required !== false) {<span class="req">*</span>}</label>
                <textarea [id]="inputId()" name="reason" class="form-control" rows="3" [attr.maxlength]="r.maxLength ?? 2000" [(ngModel)]="text"
                          [placeholder]="r.placeholder ?? ''" [attr.aria-invalid]="!!error()"></textarea>
                @if (r.hint) { <small class="cd-hint">{{ r.hint }}</small> }
              }
              @if (a.checkbox; as c) {
                <label class="cd-check"><input type="checkbox" name="checked" [ngModel]="checked()" (ngModelChange)="tick.set($event)" /> <span>{{ c.label }}</span></label>
              }
              @if (a.note) { <small class="cd-hint cd-note">{{ a.note }}</small> }
              @if (error() || failed()) { <span class="help-block" role="alert">{{ error() || failed() }}</span> }
            </div>
            <div class="cd-foot">
              <button type="button" class="btn btn-default cd-no" (click)="cancel.emit()">{{ a.cancelLabel ?? 'Cancel' }}</button>
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
    .modal .modal-dialog.modal-popup.cd-dialog { max-width: 560px; }
    .cd { border-radius: 16px; }
    .cd-head { display: flex; align-items: flex-start; gap: 14px; padding: 20px 24px 18px; border-bottom: 1px solid #dde7e8; background: #fff; }
    .cd-tile { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; }
    .cd-tile.is-danger { background: #fbe9e7; color: #c8473c; }
    .cd-tile.is-warn { background: #fdf2dc; color: #9a5f06; }
    .cd-tile svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .cd-titles { flex: 1; min-width: 0; padding-top: 1px; }
    .cd-titles h3 { font-size: 18px; font-weight: 700; line-height: 1.3; color: #17373b; overflow-wrap: anywhere; }
    .cd-titles small { display: block; margin-top: 2px; font-size: 12.5px; font-weight: 500; color: #6f8487; overflow-wrap: anywhere; }
    .cd-x { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: #17373b; }
    .cd-x:hover { background: #e2eaea; }
    .cd-x svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .cd-body { padding: 20px 28px 24px; }
    .cd-person { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding: 14px 18px; border: 1px solid #cfe3e5; border-radius: 12px; background: #f6fbfb; }
    .cd-av { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #e6f2f3; color: #24666b; font-size: 13px; font-weight: 800; }
    .cd-pi { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: anywhere; }
    .cd-pi strong { font-size: 15px; color: #17373b; }
    .cd-pi small { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .cd-pi span { font-size: 12.5px; font-weight: 600; color: #17373b; }
    .cd-person .status-badge { align-self: flex-start; }
    .cd-msg { font-size: 13px; font-weight: 500; color: #3d5559; margin-bottom: 12px; }
    .cd-pts { list-style: none; margin: 0 0 16px; padding: 0; }
    .cd-pts li { position: relative; padding-left: 20px; margin-bottom: 8px; font-size: 13px; font-weight: 500; line-height: 19px; color: #3d5559; }
    .cd-pts li::before { content: ''; position: absolute; left: 2px; top: 6px; width: 7px; height: 7px; border-radius: 50%; background: #24666b; }
    .cd-pts.is-danger li::before { background: #c8473c; }
    .cd-pts.is-warn li::before { background: #d98a12; }
    .cd-pts.is-tick li { padding-left: 26px; }
    .cd-pts.is-tick li::before { left: 0; top: 1px; width: 16px; height: 16px; background: #2f9e58 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Cpath d='M6 12.5l4 4 8-9' fill='none' stroke='%23fff' stroke-width='3' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center / 12px no-repeat; }
    .cd-label { display: block; margin: 4px 0 6px; font-size: 12.5px; font-weight: 600; color: #17373b; text-transform: none; }
    .cd-label .req { color: #c8473c; font-weight: 700; margin-left: 1px; }
    .cd textarea.form-control { min-height: 84px; height: 84px; border-radius: 9px; border: 1.2px solid #b9cdcf; font-size: 13px; resize: vertical; }
    .cd-hint { display: block; margin-top: 4px; font-size: 12.5px; color: #6f8487; }
    .cd-note { margin-top: 14px; }
    .cd-check { display: flex; align-items: center; gap: 12px; margin: 18px 0 0; font-size: 13.5px; font-weight: 600; color: #17373b; text-transform: none; cursor: pointer; }
    .cd-check input { flex: none; width: 20px; height: 20px; margin: 0; border-radius: 5px; accent-color: #24666b; }
    .help-block { display: block; margin-top: 8px; color: #c8473c; font-size: 13px; }
    .cd-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 28px; border-top: 1px solid #dde7e8; }
    .cd-foot .btn { min-height: 40px; padding: 8px 20px; font-size: 13.5px; font-weight: 700; white-space: nowrap; }
    .cd-foot .cd-no { min-width: 110px; }
    .cd-foot .cd-ok { min-width: 140px; }
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
  /** Emitted with <code>confirmed</code>: the reason and the tick box's state. */
  readonly decided = output<ConfirmResult>();
  readonly cancel = output<void>();

  protected readonly id = `zed-confirm-${++nextId}`;
  protected text = '';
  /** The tick box as the user left it (null: as the ask says). */
  protected readonly tick = signal<boolean | null>(null);
  protected readonly checked = computed(() => this.tick() ?? this.ask().checkbox?.checked ?? false);
  private readonly typed = signal('');
  protected readonly error = signal('');
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly blocked = computed(() => this.holdUntilReason() && this.needsReason() && !this.typed().trim());
  protected readonly tone = computed(() => this.ask().tone ?? (this.ask().danger ? 'danger' : 'teal'));
  protected readonly iconPath = computed(() => ICONS[this.ask().icon ?? (this.ask().danger ? 'warn' : 'info')]);

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
    this.decided.emit({ reason, checked: !!this.ask().checkbox && this.checked() });
  }
}
