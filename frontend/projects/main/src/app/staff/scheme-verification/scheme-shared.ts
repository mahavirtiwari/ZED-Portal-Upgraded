import { signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { t } from '../../content/page-text';
import { ConfirmAsk, ConfirmResult } from '../confirm-dialog';
import { ToastService } from '../toast';
import { SchemeStatus, SchemeVerificationApi } from './scheme-verification.api';

/** The status as the staff read it (Admin → Texts, staff.schemeVerification.status.*). */
export function statusLabel(status: SchemeStatus | string): string {
  switch (status) {
    case 'Submitted': return t('staff.schemeVerification.status.submitted', 'Waiting for allotment');
    case 'WithAgency': return t('staff.schemeVerification.status.withAgency', 'With agency');
    case 'WithAssessor': return t('staff.schemeVerification.status.withAssessor', 'With assessor');
    case 'Verifying': return t('staff.schemeVerification.status.verifying', 'Verifying');
    case 'Correction': return t('staff.schemeVerification.status.correction', 'Correction with unit');
    case 'Qc': return t('staff.schemeVerification.status.qc', 'Agency QC');
    case 'Approved': return t('staff.schemeVerification.status.approved', 'Approved');
    case 'Paid': return t('staff.schemeVerification.status.paid', 'Paid');
    case 'Rejected': return t('staff.schemeVerification.status.rejected', 'Rejected');
    case 'OnHold': return t('staff.schemeVerification.status.onHold', 'On hold');
    default: return status;
  }
}

/** The status chip's colour (existing .chip classes). */
export function statusTone(status: SchemeStatus | string): string {
  switch (status) {
    case 'Approved': case 'Paid': return 'is-good';
    case 'Rejected': return 'is-bad';
    case 'OnHold': case 'Correction': return 'is-warn';
    default: return 'is-info';
  }
}

/** Rupees as the staff pages show them ("1,25,000"). */
export function money(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '–';
  return Number(v).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** A date of the API (ISO) as dd-MMM-yyyy. */
export function day(v: string | null | undefined): string {
  if (!v) return '';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/ /g, '-');
}

/** What a pop-up does once confirmed: the server's message (shown as a toast). */
export type DialogRun = (r: ConfirmResult) => Promise<string>;

/**
 * The staff pop-ups of the scheme pages (allot, accept, reject with a reason, QC, hold): one at a time, the server's refusal shown in
 * it, the page reloaded after a success.
 */
export class SchemeDialogs {
  readonly current = signal<{ ask: ConfirmAsk; run: DialogRun } | null>(null);
  readonly busy = signal(false);
  readonly failed = signal('');

  constructor(
    private readonly toast: ToastService,
    private readonly after: () => Promise<void> | void,
  ) {}

  open(ask: ConfirmAsk, run: DialogRun): void {
    this.failed.set('');
    this.current.set({ ask, run });
  }

  close(): void {
    if (!this.busy()) this.current.set(null);
  }

  async confirm(r: ConfirmResult): Promise<void> {
    const d = this.current();
    if (!d || this.busy()) return;
    this.busy.set(true);
    this.failed.set('');
    try {
      const message = await d.run(r);
      this.current.set(null);
      this.toast.success(message);
      await this.after();
    } catch (err) {
      this.failed.set(err instanceof Error && !(err as { status?: number }).status ? err.message : apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

/** The minimum a pop-up needs of an application. */
export interface SchemeRef {
  id: number;
  zedId: string;
  unitName: string | null;
  schemeName: string;
  agency?: string | null;
  eligibleAmount?: number | null;
}

function subtitle(a: SchemeRef): string {
  return [a.zedId, a.unitName, a.schemeName].filter((x) => !!x).join(' · ');
}

/** The pop-ups of each role's actions (wording: staff.schemeVerification.dialog.*). */
export const schemeAsks = {
  async allot(api: SchemeVerificationApi, a: SchemeRef): Promise<{ ask: ConfirmAsk; run: DialogRun }> {
    const options = await firstValueFrom(api.agencies(a.id));
    return {
      ask: {
        title: a.agency ? t('staff.schemeVerification.dialog.reallotTitle', 'Re-allot to an agency') : t('staff.schemeVerification.dialog.allotTitle', 'Allot to an agency'),
        subtitle: subtitle(a),
        message: options.length ? null : t('staff.schemeVerification.dialog.noAgency', 'No agency is ticked for this scheme in the unit’s state and sector.'),
        choice: {
          label: t('staff.schemeVerification.dialog.agencyLabel', 'Agency'),
          options: options.map((o) => ({
            value: o.userId,
            label: `${o.userName} (${o.userId})`,
            note: o.rejectedBefore ? t('staff.schemeVerification.dialog.rejectedBefore', 'This agency returned the application before.') : null,
          })),
          requiredMessage: t('staff.schemeVerification.dialog.agencyRequired', 'Please select an agency.'),
        },
        confirmLabel: a.agency ? t('staff.schemeVerification.dialog.reallotButton', 'Re-allot') : t('staff.schemeVerification.dialog.allotButton', 'Allot'),
      },
      run: async (r) => (await firstValueFrom(api.allot(a.id, r.choice))).message,
    };
  },

  resume(api: SchemeVerificationApi, a: SchemeRef): { ask: ConfirmAsk; run: DialogRun } {
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.resumeTitle', 'Resume the application'),
        subtitle: subtitle(a),
        message: t('staff.schemeVerification.dialog.resumeMessage', 'The application continues where it was put on hold.'),
        confirmLabel: t('staff.schemeVerification.dialog.resumeButton', 'Resume'),
        icon: 'unlock',
      },
      run: async () => (await firstValueFrom(api.resume(a.id))).message,
    };
  },

  rejectOnHold(api: SchemeVerificationApi, a: SchemeRef): { ask: ConfirmAsk; run: DialogRun } {
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.rejectHoldTitle', 'Reject the application'),
        subtitle: subtitle(a),
        message: t('staff.schemeVerification.dialog.rejectHoldMessage', 'The unit is told by e-mail; it may apply again when the scheme is open for it.'),
        reason: { label: t('staff.schemeVerification.dialog.reasonLabel', 'Reason for rejection'), maxLength: 1000 },
        confirmLabel: t('staff.schemeVerification.dialog.rejectButton', 'Reject'),
        danger: true,
      },
      run: async (r) => (await firstValueFrom(api.rejectOnHold(a.id, r.reason))).message,
    };
  },

  async accept(api: SchemeVerificationApi, a: SchemeRef): Promise<{ ask: ConfirmAsk; run: DialogRun }> {
    const options = await firstValueFrom(api.assessors(a.id));
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.acceptTitle', 'Accept and name an assessor'),
        subtitle: subtitle(a),
        message: options.length ? null : t('staff.schemeVerification.dialog.noAssessor', 'None of your assessors is ticked for this scheme. Tick one on its page first.'),
        choice: {
          label: t('staff.schemeVerification.dialog.assessorLabel', 'Assessor'),
          options: options.map((o) => ({ value: o.userId, label: `${o.userName} (${o.userId})` })),
          requiredMessage: t('staff.schemeVerification.dialog.assessorRequired', 'Please select an assessor.'),
        },
        confirmLabel: t('staff.schemeVerification.dialog.acceptButton', 'Accept'),
      },
      run: async (r) => (await firstValueFrom(api.accept(a.id, r.choice))).message,
    };
  },

  async agencyReject(api: SchemeVerificationApi, a: SchemeRef): Promise<{ ask: ConfirmAsk; run: DialogRun }> {
    const reasons = await firstValueFrom(api.rejectionReasons());
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.agencyRejectTitle', 'Reject the allotment'),
        subtitle: subtitle(a),
        message: t('staff.schemeVerification.dialog.agencyRejectMessage', 'The application leaves your agency. The reason you pick decides where it goes next.'),
        choice: {
          label: t('staff.schemeVerification.dialog.reasonLabel', 'Reason for rejection'),
          options: reasons.map((r) => ({
            value: r.id,
            label: r.text,
            note: r.action === 'Auto'
              ? t('staff.schemeVerification.dialog.autoNote', 'With this reason the application goes to another agency automatically.')
              : t('staff.schemeVerification.dialog.masterAdminNote', 'With this reason the application goes back to the ZED team (Master Admin) for allotment.'),
          })),
          requiredMessage: t('staff.schemeVerification.dialog.reasonRequired', 'Please select the reason for rejection.'),
        },
        reason: { label: t('staff.schemeVerification.dialog.remarksLabel', 'Remarks'), required: false, maxLength: 1000 },
        confirmLabel: t('staff.schemeVerification.dialog.rejectButton', 'Reject'),
        danger: true,
      },
      run: async (r) => (await firstValueFrom(api.agencyReject(a.id, r.choice, r.reason.trim() || null))).message,
    };
  },

  approve(api: SchemeVerificationApi, a: SchemeRef): { ask: ConfirmAsk; run: DialogRun } {
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.approveTitle', 'Approve the application'),
        subtitle: subtitle(a),
        message: t('staff.schemeVerification.dialog.approveMessage', 'Eligible amount on the verified claim: Rs. {amount}. The approved amount goes to the MSME DFO for payment by NEFT.',
          { amount: money(a.eligibleAmount) }),
        reason: {
          label: t('staff.schemeVerification.dialog.amountLabel', 'Approved amount (Rs.)'),
          maxLength: 15,
          placeholder: a.eligibleAmount !== null && a.eligibleAmount !== undefined ? String(a.eligibleAmount) : '',
          requiredMessage: t('staff.schemeVerification.dialog.amountRequired', 'Please enter the approved amount.'),
        },
        confirmLabel: t('staff.schemeVerification.dialog.approveButton', 'Approve'),
        icon: 'check',
      },
      run: async (r) => {
        const amount = Number(r.reason.replace(/,/g, '').trim());
        if (!Number.isFinite(amount) || amount <= 0) throw new Error(t('staff.schemeVerification.dialog.amountInvalid', 'Please enter a valid amount.'));
        return (await firstValueFrom(api.approve(a.id, amount))).message;
      },
    };
  },

  back(api: SchemeVerificationApi, a: SchemeRef): { ask: ConfirmAsk; run: DialogRun } {
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.backTitle', 'Back to the assessor'),
        subtitle: subtitle(a),
        reason: { label: t('staff.schemeVerification.dialog.backLabel', 'Remarks for the assessor'), maxLength: 1000 },
        confirmLabel: t('staff.schemeVerification.dialog.backButton', 'Send back'),
      },
      run: async (r) => (await firstValueFrom(api.back(a.id, r.reason))).message,
    };
  },

  assessorAccept(api: SchemeVerificationApi, a: SchemeRef): { ask: ConfirmAsk; run: DialogRun } {
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.assessorAcceptTitle', 'Accept for verification'),
        subtitle: subtitle(a),
        message: t('staff.schemeVerification.dialog.assessorAcceptMessage', 'You verify the application’s answers and documents at the desktop.'),
        confirmLabel: t('staff.schemeVerification.dialog.acceptButton', 'Accept'),
        icon: 'check',
      },
      run: async () => (await firstValueFrom(api.assessorAccept(a.id))).message,
    };
  },

  assessorReturn(api: SchemeVerificationApi, a: SchemeRef): { ask: ConfirmAsk; run: DialogRun } {
    return {
      ask: {
        title: t('staff.schemeVerification.dialog.returnTitle', 'Return to the agency'),
        subtitle: subtitle(a),
        message: t('staff.schemeVerification.dialog.returnMessage', 'Your agency names another assessor.'),
        reason: { label: t('staff.schemeVerification.dialog.returnLabel', 'Reason'), maxLength: 1000 },
        confirmLabel: t('staff.schemeVerification.dialog.returnButton', 'Return'),
        danger: true,
      },
      run: async (r) => (await firstValueFrom(api.assessorReturn(a.id, r.reason))).message,
    };
  },
};
