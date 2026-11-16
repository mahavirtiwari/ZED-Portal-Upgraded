import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

/** What a reason pop-up asks for: block or unblock a login. */
export interface ReasonAsk {
  action: 'block' | 'unblock';
  userId: string;
  userName: string | null;
}

/**
 * 2026-11-16 (the user): the reason for blocking or unblocking a login, which is recorded in its history and e-mailed to
 * the user. Used for every unblock (agencies, assessors, consultants, surveillance logins, User Management, the NEFT
 * Admin) and for the blocks of User Management and the NEFT Admin (the other pages keep their own block pop-up).
 */
@Component({
  selector: 'zed-reason-dialog',
  imports: [FormsModule],
  template: `
    @let a = ask();
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="reason-dialog-title" (click)="cancel.emit()">
      <div class="modal-dialog modal-popup" (click)="$event.stopPropagation()">
        <div class="modal-content">
          <div class="modal-header">
            <div class="modal-title w-100 d-flex justify-content-between align-items-center">
              <h3 class="registration-title m-0" id="reason-dialog-title">{{ a.action === 'block' ? 'Block' : 'Unblock' }} {{ a.userName || a.userId }}</h3>
              <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="cancel.emit()"><img src="Images/svgicons/close.svg" alt="" /></button>
            </div>
          </div>
          <form (ngSubmit)="submit()" novalidate>
            <div class="modal-body">
              <p class="muted rd-note">{{ a.action === 'block'
                ? 'The login cannot sign in until it is unblocked.'
                : 'The login can sign in again with its existing password.' }} The reason is kept in its history and e-mailed to the user.</p>
              <label class="form-label" for="reason-dialog-text">Reason<span class="req">*</span></label>
              <textarea id="reason-dialog-text" name="reason" class="form-control" rows="3" maxlength="2000" [(ngModel)]="text"
                        [placeholder]="a.action === 'block' ? 'Why the login is blocked' : 'Why the login is unblocked'"></textarea>
              @if (error() || failed()) { <span class="help-block" role="alert">{{ error() || failed() }}</span> }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="cancel.emit()">Cancel</button>
              <button type="submit" class="btn" [class.btn-danger]="a.action === 'block'" [class.btn-primary]="a.action === 'unblock'" [disabled]="busy()">
                {{ a.action === 'block' ? 'Block' : 'Unblock' }}</button>
            </div>
          </form>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .rd-note { font-size: 13px; margin-bottom: 10px; }
    .help-block { color: #a94442; font-size: 13px; }
  `,
})
export class ReasonDialog {
  readonly ask = input.required<ReasonAsk>();
  readonly busy = input(false);
  /** The server's refusal, shown in the pop-up. */
  readonly failed = input('');
  readonly confirmed = output<string>();
  readonly cancel = output<void>();

  protected text = '';
  protected readonly error = signal('');

  protected submit(): void {
    const reason = this.text.trim();
    if (!reason) {
      this.error.set('Please enter the reason.');
      return;
    }
    this.error.set('');
    this.confirmed.emit(reason);
  }
}
