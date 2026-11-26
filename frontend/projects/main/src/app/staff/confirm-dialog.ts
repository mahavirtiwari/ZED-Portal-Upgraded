import { Component, ElementRef, HostListener, Injectable, afterNextRender, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TextPipe, t } from '../content/page-text';

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
  /**
   * 2026-11-19 (rejection reasons, approved): a required drop-down before the reason box ("Reason for rejection"); the
   * chosen option's <code>note</code> shows under it. Its value comes with <code>decided</code> (<code>choice</code>).
   */
  choice?: {
    label: string;
    options: readonly ConfirmChoiceOption[];
    /** The first, empty option (default "--Select--"). */
    placeholder?: string;
    /** Shown when nothing is chosen (default "Please select an option."). */
    requiredMessage?: string;
  };
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

/** One option of the drop-down (<code>ConfirmAsk.choice</code>). */
export interface ConfirmChoiceOption {
  value: string;
  label: string;
  /** A line under the drop-down while this option is chosen (what it does). */
  note?: string | null;
}

/** The answer with the tick box's state and the drop-down's value ("" without one). */
export interface ConfirmResult {
  reason: string;
  checked: boolean;
  choice: string;
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
  imports: [FormsModule, TextPipe],
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
            <button type="button" class="cd-x" [attr.aria-label]="'Close' | t: 'common.confirm.closeAria'" (click)="cancel.emit()">
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
                    @if (u.email) { <span class="cd-mail" [attr.title]="u.email">{{ u.email }}</span> }
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
              @if (a.choice; as c) {
                <label class="cd-label" [for]="inputId() + '-choice'">{{ c.label }}<span class="req">*</span></label>
                <select [id]="inputId() + '-choice'" name="choice" class="form-select cd-select" [ngModel]="picked()" (ngModelChange)="pick($event)"
                        [attr.aria-invalid]="!!error() && !picked()">
                  <option value="">{{ c.placeholder ?? ('--Select--' | t: 'common.confirm.choicePlaceholder') }}</option>
                  @for (o of c.options; track o.value) { <option [value]="o.value">{{ o.label }}</option> }
                </select>
                @if (pickedNote(); as n) { <small class="cd-hint cd-choice-note" role="status"><span class="cd-i" aria-hidden="true">i</span>{{ n }}</small> }
              }
              @if (a.reason; as r) {
                <label class="cd-label" [for]="inputId()">{{ r.label ?? ('Reason' | t: 'common.confirm.reasonLabel') }}@if (r.required !== false) {<span class="req">*</span>}</label>
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
              <button type="button" class="btn btn-default cd-no" (click)="cancel.emit()">{{ a.cancelLabel ?? ('Cancel' | t: 'common.confirm.cancelButton') }}</button>
              <button type="submit" class="btn cd-ok" [class.btn-danger]="a.danger" [class.btn-primary]="!a.danger" [disabled]="busy() || blocked()">
                {{ a.confirmLabel ?? ('Confirm' | t: 'common.confirm.confirmButton') }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .modal .modal-dialog.modal-popup.cd-dialog { max-width: 560px; }
    /* 2026-11-19 (Admin UI audit): the staff pop-up frame (styles/_staff-shared.scss): never taller than the window less 16px above
       and below; the head and the buttons stay in view and the body scrolls; on phones 16px from the window's sides. */
    .cd { border-radius: 16px; max-height: calc(100vh - 32px); max-height: calc(100dvh - 32px); display: flex; flex-direction: column; }
    .cd > form { display: flex; flex-direction: column; flex: 1 1 auto; min-height: 0; }
    .cd-head { flex: none; display: flex; align-items: flex-start; gap: 14px; padding: 20px 24px 18px; border-bottom: 1px solid #dde7e8; background: #fff; }
    .cd-tile { flex: none; width: 40px; height: 40px; border-radius: 10px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; }
    .cd-tile.is-danger { background: #fbe9e7; color: #c8473c; }
    .cd-tile.is-warn { background: #fdf2dc; color: #9a5f06; }
    .cd-tile svg { width: 20px; height: 20px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .cd-titles { flex: 1; min-width: 0; padding-top: 1px; }
    .cd-titles h3 { font-size: 18px; font-weight: 700; line-height: 1.3; color: #17373b; overflow-wrap: break-word; }
    .cd-titles small { display: block; margin-top: 2px; font-size: 12.5px; font-weight: 500; color: #6f8487; overflow-wrap: break-word; }
    .cd-x { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: #17373b; }
    .cd-x:hover { background: #e2eaea; }
    .cd-x svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; }
    .cd-body { flex: 1 1 auto; min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 20px 28px 24px; }
    .cd-person { display: flex; align-items: center; gap: 14px; margin-bottom: 16px; padding: 14px 18px; border: 1px solid #cfe3e5; border-radius: 12px; background: #f6fbfb; }
    .cd-av { flex: none; width: 44px; height: 44px; border-radius: 50%; display: grid; place-items: center; background: #e6f2f3; color: #24666b; font-size: 13px; font-weight: 800; }
    .cd-pi { flex: 1; min-width: 0; display: flex; flex-direction: column; overflow-wrap: break-word; }
    .cd-pi strong { font-size: 15px; color: #17373b; }
    .cd-pi small { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .cd-pi span { font-size: 12.5px; font-weight: 600; color: #17373b; }
    .cd-pi .cd-mail { white-space: normal; overflow-wrap: break-word; }
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
    .cd-select { height: 40px; border-radius: 9px; border: 1.2px solid #b9cdcf; font-size: 13px; margin-bottom: 4px; }
    .cd-choice-note { display: flex; gap: 6px; align-items: flex-start; margin: 2px 0 12px; color: #24666b; }
    .cd-i { flex: none; width: 16px; height: 16px; margin-top: 1px; border-radius: 50%; display: grid; place-items: center; background: #e6f2f3; font: italic 700 11px Georgia, serif; }
    .cd-note { margin-top: 14px; }
    .cd-check { display: flex; align-items: center; gap: 12px; margin: 18px 0 0; font-size: 13.5px; font-weight: 600; color: #17373b; text-transform: none; cursor: pointer; }
    .cd-check input { flex: none; width: 20px; height: 20px; margin: 0; border-radius: 5px; accent-color: #24666b; }
    .help-block { display: block; margin-top: 8px; color: #c8473c; font-size: 13px; }
    .cd-foot { flex: none; display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: 10px; padding: 14px 28px; border-top: 1px solid #dde7e8; }
    .cd-foot .btn { min-height: 40px; padding: 8px 20px; font-size: 13.5px; font-weight: 700; white-space: nowrap; }
    .cd-foot .cd-no { min-width: 110px; }
    .cd-foot .cd-ok { min-width: 140px; }
    .cd-ok:disabled { opacity: 0.55; cursor: not-allowed; }
    @media (max-width: 575.98px) {
      .modal .modal-dialog.modal-popup.cd-dialog { width: auto; max-width: none; margin: 16px; }
      .cd-head { padding: 16px 16px 14px; gap: 12px; }
      .cd-body { padding: 16px; }
      .cd-foot { padding: 12px 16px; }
      .cd-foot .cd-no, .cd-foot .cd-ok { min-width: 0; flex: 1 1 auto; }
    }
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
  /** The drop-down's value ("" until chosen). */
  protected readonly picked = signal('');
  protected readonly pickedNote = computed(() => this.ask().choice?.options.find((o) => o.value === this.picked())?.note ?? null);
  protected readonly error = signal('');
  private readonly host = inject(ElementRef<HTMLElement>);
  protected readonly blocked = computed(() => this.holdUntilReason() && this.needsReason() && !this.typed().trim());
  protected readonly tone = computed(() => this.ask().tone ?? (this.ask().danger ? 'danger' : 'teal'));
  protected readonly iconPath = computed(() => ICONS[this.ask().icon ?? (this.ask().danger ? 'warn' : 'info')]);

  constructor() {
    // The reason field first, else the confirm button.
    afterNextRender(() => {
      const el = this.host.nativeElement as HTMLElement;
      (el.querySelector<HTMLElement>('.cd-select') ?? el.querySelector('textarea') ?? el.querySelector<HTMLButtonElement>('.cd-ok'))?.focus();
    });
  }

  private needsReason(): boolean {
    const r = this.ask().reason;
    return !!r && r.required !== false;
  }

  protected pick(value: string): void {
    this.picked.set(value ?? '');
    if (value) this.error.set('');
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
    const choice = this.ask().choice ? this.picked() : '';
    if (this.ask().choice && !choice) {
      this.error.set(this.ask().choice?.requiredMessage ?? t('common.confirm.choiceError', 'Please select an option.'));
      return;
    }
    if (this.needsReason() && !reason) {
      this.error.set(this.ask().reason?.requiredMessage ?? t('common.confirm.reasonError', 'Please enter the reason.'));
      return;
    }
    this.error.set('');
    this.confirmed.emit(reason);
    this.decided.emit({ reason, checked: !!this.ask().checkbox && this.checked(), choice });
  }
}

/** The question the staff layout's pop-up is showing, and how it is answered. */
export interface PendingConfirm {
  ask: ConfirmAsk;
  done: (ok: boolean) => void;
}

/**
 * 2026-11-19 (admin audit: the Reset / switch-off buttons asked with the browser's own confirm() box): the staff pages ask
 * through this instead, <code>if (!(await confirms.ask({ title, message, danger })) return;</code>, and the staff layout shows
 * the shared pop-up above (<code>zed-confirm-host</code>). Confirm answers true; Cancel, Esc, a click outside or a newer
 * question answer false.
 */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly pending = signal<PendingConfirm | null>(null);

  ask(ask: ConfirmAsk): Promise<boolean> {
    this.pending()?.done(false);
    return new Promise<boolean>((resolve) => {
      const p: PendingConfirm = {
        ask,
        done: (ok) => {
          if (this.pending() === p) this.pending.set(null);
          resolve(ok);
        },
      };
      this.pending.set(p);
    });
  }
}

/** The pop-up of <code>ConfirmService</code> (once, in the staff layout, beside the toasts). */
@Component({
  selector: 'zed-confirm-host',
  imports: [ConfirmDialog],
  template: `
    @if (service.pending(); as p) {
      <zed-confirm-dialog [ask]="p.ask" inputId="zed-confirm-host-text" (confirmed)="p.done(true)" (cancel)="p.done(false)" />
    }
  `,
})
export class ConfirmHost {
  protected readonly service = inject(ConfirmService);
}
