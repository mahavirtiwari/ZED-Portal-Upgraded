import { Component, OnInit, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { text } from './assessment-shared';
import { AgencyRejection, Person, RejectionReason, Row, serves } from './assessment.api';
import { mayAssess } from '../users/assessor-scope';
import { ConfirmAsk, ConfirmResult } from '../confirm-dialog';
import { TextPipe, t } from '../../content/page-text';

/**
 * 2026-11-18: the agency's Accept / Re-allot and Reject of a unit allotted to it, shared by the DA allotment list and the
 * assessment details page opened from it (the preview before acceptance), so both ask the same and call the same APIs
 * (da-allotment/allot, da-allotment/reject).
 */

/**
 * 2026-11-14: the agency's assessors ticked for the unit's level at the desktop (one kind of assessor; main sends one list
 * with the ticks). Surveillance keeps its own list. V4: only those who assess the unit's kind (Manufacturing / Services).
 */
export function assessorsForUnit(unit: Row, assessors: Person[], bronzeAssessors: Person[]): Person[] {
  const level = text(unit, 'Certification');
  const list = level === 'Bronze' ? bronzeAssessors : assessors;
  return list.filter((a) => serves(a, unit['SectorCategory']) && mayAssess(a, level, 'Desktop'));
}

/**
 * The Reject confirmation. 2026-11-19 (rejection reasons, approved): a reason of Admin → Rejection Reasons (required; under it
 * where the unit goes with that reason) and optional remarks, instead of the free-text reason.
 */
export function agencyRejectAsk(unit: Row, reasons: readonly RejectionReason[]): ConfirmAsk {
  return {
    title: t('staff.daAllotment.actions.reject.title', 'Reject assessment?'),
    message: t('staff.daAllotment.actions.reject.message', '{zedId} ({level}) leaves your agency. The reason you pick decides where it goes next.',
      { zedId: text(unit, 'ZedId'), level: text(unit, 'Certification') }),
    confirmLabel: t('staff.daAllotment.actions.reject.confirmButton', 'Reject'),
    danger: true,
    choice: {
      label: t('staff.daAllotment.actions.reject.reasonLabel', 'Reason for rejection'),
      options: reasons.map((r) => ({
        value: r.id,
        label: r.text,
        note: r.autoReallot
          ? t('staff.daAllotment.actions.reject.autoNote', 'With this reason the unit goes to another agency automatically.')
          : t('staff.daAllotment.actions.reject.masterAdminNote', 'With this reason the unit goes back to the ZED team (Master Admin) for allotment.'),
      })),
      requiredMessage: t('staff.daAllotment.actions.reject.reasonRequired.message', 'Please select the reason for rejection.'),
    },
    reason: { label: t('staff.daAllotment.actions.reject.remarksLabel', 'Remarks'), required: false, maxLength: REJECT_REMARKS_MAX },
  };
}

/** The remarks' limit (the server's). */
export const REJECT_REMARKS_MAX = 1000;

/** The rejection to send from the pop-up's answer (null without a reason picked). */
export function rejectionOf(result: ConfirmResult): AgencyRejection | null {
  return result.choice ? { reasonId: result.choice, remarks: result.reason.trim() || null } : null;
}

/** The chosen assessor. */
export interface AllotChoice {
  assessorId: string;
  assessorName: string;
}

/** Accept / Re-allot: choose one of the agency's desktop assessors (Re-allot opens with the current one selected). */
@Component({
  selector: 'zed-allot-assessor-dialog',
  imports: [FormsModule, TextPipe],
  template: `
    @let c = unit();
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="daAllotTitle" (click)="cancel.emit()">
      <div class="modal-dialog modal-dialog-centered" (click)="$event.stopPropagation()">
        <div class="modal-content da-pop">
          <div class="modal-header justify-content-between">
            <div>
              <h3 class="da-pop-title" id="daAllotTitle">{{ col(c, 'DesktopAssessorId') ? ('Re-allot assessment' | t: 'staff.daAllotment.actions.reallotTitle') : ('Accept assessment' | t: 'staff.daAllotment.actions.acceptTitle') }}</h3>
              <p class="da-pop-sub">{{ col(c, 'ZedId') }} · {{ col(c, 'Certification') }}@if (col(c, 'PUnitName')) { · {{ col(c, 'PUnitName') }} }</p>
            </div>
            <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.daAllotment.actions.closeAria'" (click)="cancel.emit()"></button>
          </div>
          <div class="modal-body">
            <label class="form-label" for="daAssessor">{{ 'Assessor' | t: 'staff.daAllotment.actions.assessorLabel' }}<span class="req">*</span></label>
            <select id="daAssessor" class="form-select" [(ngModel)]="assessorId">
              <option value="">{{ '--Select--' | t: 'staff.daAllotment.actions.selectLabel' }}</option>
              @for (a of assessors(); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
            </select>
            @if (missing() || failed()) { <div class="alert alert-danger mt-2 mb-0" role="alert">{{ missing() || failed() }}</div> }
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-light" (click)="cancel.emit()">{{ 'Cancel' | t: 'staff.daAllotment.actions.cancelButton' }}</button>
            <button type="button" class="btn btn-primary da-ok" [disabled]="busy()" (click)="submit()">{{ 'Allot to assessor' | t: 'staff.daAllotment.actions.allotButton' }}</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .da-pop { border: 0; border-radius: 12px; }
    .da-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .da-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
  `,
})
export class AllotAssessorDialog implements OnInit {
  readonly unit = input.required<Row>();
  /** Already limited to those who may assess the unit (assessorsForUnit). */
  readonly assessors = input<Person[]>([]);
  readonly busy = input(false);
  /** The server's refusal. */
  readonly failed = input('');
  readonly allot = output<AllotChoice>();
  readonly cancel = output<void>();
  protected readonly col = text;
  protected readonly missing = signal('');
  protected assessorId = '';

  ngOnInit(): void {
    this.assessorId = text(this.unit(), 'DesktopAssessorId');
  }

  protected submit(): void {
    if (!this.assessorId) {
      this.missing.set(t('staff.daAllotment.actions.selectError', 'Please select valid data.'));
      return;
    }
    this.missing.set('');
    const name = this.assessors().find((a) => a.userId === this.assessorId)?.userName ?? this.assessorId;
    this.allot.emit({ assessorId: this.assessorId, assessorName: name });
  }
}
