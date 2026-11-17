import { Component, computed, input, output } from '@angular/core';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';

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
 * 2026-11-17 (staff redesign): a wrapper of the shared confirmation pop-up (<code>zed-confirm-dialog</code>), same texts.
 */
@Component({
  selector: 'zed-reason-dialog',
  imports: [ConfirmDialog],
  template: `<zed-confirm-dialog [ask]="confirm()" [busy]="busy()" [failed]="failed()" inputId="reason-dialog-text"
                                 (confirmed)="confirmed.emit($event)" (cancel)="cancel.emit()" />`,
})
export class ReasonDialog {
  readonly ask = input.required<ReasonAsk>();
  readonly busy = input(false);
  /** The server's refusal, shown in the pop-up. */
  readonly failed = input('');
  readonly confirmed = output<string>();
  readonly cancel = output<void>();

  protected readonly confirm = computed<ConfirmAsk>(() => {
    const a = this.ask();
    const block = a.action === 'block';
    return {
      title: `${block ? 'Block' : 'Unblock'} ${a.userName || a.userId}`,
      message: `${block ? 'The login cannot sign in until it is unblocked.' : 'The login can sign in again with its existing password.'} ` +
        'The reason is kept in its history and e-mailed to the user.',
      confirmLabel: block ? 'Block' : 'Unblock',
      danger: block,
      reason: { label: 'Reason', placeholder: block ? 'Why the login is blocked' : 'Why the login is unblocked', maxLength: 2000 },
    };
  });
}
