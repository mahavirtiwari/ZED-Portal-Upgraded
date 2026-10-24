import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { RemarksKind, ReviewActions, ReviewApi } from './review.api';

type Dialog = 'finalSubmit' | 'sendBack' | 'reject' | null;

/**
 * Agency / master-admin buttons of the DA and SA review pages (old DaDetails / SaDetails: "Final Submit",
 * "Send Back to Assessor", "Reject") with their pop-ups. The server decides which actions apply
 * (`actions`); the pop-ups repeat the old confirmations: on the desktop page the exemptions check
 * box, then the quality-check box; on the site page the quality-check box; the rejection box.
 */
@Component({
  selector: 'zed-review-actions',
  imports: [FormsModule, ContentTextComponent],
  template: `
    @if (actions().finalSubmit) {
      <input type="button" value="Final Submit" class="btn btn-primary btn-md me-2" [disabled]="busy()" (click)="open('finalSubmit')" />
    }
    @if (actions().sendBack) {
      <input type="button" value="Send Back to Assessor" class="btn btn-primary btn-md me-2" [disabled]="busy()" (click)="open('sendBack')" />
    }
    @if (actions().reject) {
      <input type="button" value="Reject" class="btn btn-danger btn-md" [disabled]="busy()" (click)="open('reject')" />
    }

    @if (dialog(); as d) {
      <div class="modal d-block text-start" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="reviewDialogTitle">
        <div class="modal-dialog modal-popup" [class.modal-lg]="d === 'sendBack'">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title" id="reviewDialogTitle">
                  {{ d === 'finalSubmit' ? 'Confirm Final Submit' : d === 'reject' ? 'Confirm Reject Certification' : 'Send Back to Assessor' }}
                </h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="close()"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              @if (d === 'finalSubmit') {
                <div style="padding-left: 20px">
                  @if (stage() === 'desktop') {
                    <div class="form-check">
                      <input class="form-check-input option-input1 yes checkbox" type="checkbox" id="reviewExemptions" name="exemptionsReviewed"
                        [ngModel]="exemptionsReviewed()" (ngModelChange)="setExemptionsReviewed($event)" />
                      <label class="form-check-label" for="reviewExemptions" style="display: inline"><zed-text key="staff.monitoring.review.exemptionsReviewed.checkbox" [inline]="true" /></label>
                    </div>
                  }
                  @if (stage() === 'site' || exemptionsReviewed()) {
                    <div class="form-check" style="margin-top: 10px">
                      <input class="form-check-input option-input1 yes checkbox" type="checkbox" id="reviewQuality" name="qualityChecked"
                        [ngModel]="qualityChecked()" (ngModelChange)="qualityChecked.set($event)" />
                      <label class="form-check-label" for="reviewQuality" style="display: inline"><zed-text key="staff.monitoring.review.qualityChecked.checkbox" [inline]="true" /></label>
                    </div>
                  }
                </div>
              } @else if (d === 'reject') {
                <div class="form-check" style="padding-left: 20px">
                  <input class="form-check-input option-input1 yes checkbox" type="checkbox" id="reviewReject" name="rejectConfirmed"
                    [ngModel]="rejectConfirmed()" (ngModelChange)="rejectConfirmed.set($event)" />
                  <label class="form-check-label" for="reviewReject" style="display: inline"><zed-text key="staff.monitoring.review.reject.checkbox" [inline]="true" /></label>
                </div>
              } @else {
                <div style="margin-bottom: 9px">
                  <label for="reviewSendBack"><strong>Agency Send Back Remarks<span style="color: red">*</span></strong></label>
                  <textarea id="reviewSendBack" name="sendBackRemarks" class="form-control" maxlength="2000" style="max-width: 100%; height: 100px"
                    [ngModel]="remarks()" (ngModelChange)="remarks.set($event)"></textarea>
                </div>
              }
              @if (error()) { <div class="alert alert-danger mt-2" role="alert">{{ error() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="close()" />
              <input type="button" class="btn" [class.btn-primary]="canSubmit()" [class.btn-default]="!canSubmit()"
                [value]="d === 'reject' ? 'REJECT' : 'SUBMIT'" [disabled]="!canSubmit() || busy()" (click)="submit()" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
})
export class ReviewActionsBar {
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  readonly stage = input.required<'desktop' | 'site'>();
  readonly actions = input.required<ReviewActions>();
  /** Message of the server after an action succeeded; the page reloads its data. */
  readonly done = output<string>();

  private readonly api = inject(ReviewApi);
  protected readonly dialog = signal<Dialog>(null);
  protected readonly exemptionsReviewed = signal(false);
  protected readonly qualityChecked = signal(false);
  protected readonly rejectConfirmed = signal(false);
  protected readonly remarks = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  protected open(d: Exclude<Dialog, null>): void {
    // The old pop-ups started unticked every time they opened.
    this.exemptionsReviewed.set(false);
    this.qualityChecked.set(false);
    this.rejectConfirmed.set(false);
    this.remarks.set('');
    this.error.set('');
    this.dialog.set(d);
  }

  protected close(): void {
    this.dialog.set(null);
  }

  protected setExemptionsReviewed(value: boolean): void {
    this.exemptionsReviewed.set(value);
    if (!value) this.qualityChecked.set(false);
  }

  protected canSubmit(): boolean {
    switch (this.dialog()) {
      case 'finalSubmit':
        return this.qualityChecked() && (this.stage() === 'site' || this.exemptionsReviewed());
      case 'reject':
        return this.rejectConfirmed();
      case 'sendBack':
        return this.remarks().trim().length > 0;
      default:
        return false;
    }
  }

  protected async submit(): Promise<void> {
    const d = this.dialog();
    if (!d || !this.canSubmit()) return;
    const zedId = this.zedId();
    const level = this.certification();
    const call: Observable<{ message: string }> =
      d === 'finalSubmit'
        ? this.api.finalSubmit(zedId, level, this.stage() === 'site' || this.exemptionsReviewed(), this.qualityChecked())
        : d === 'reject'
          ? this.api.reject(zedId, level)
          : this.api.sendBack(zedId, level, this.remarks().trim());
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(call);
      this.dialog.set(null);
      this.done.emit(res.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}

/** What the agency is editing: a remark of an assessor finding, or the OFI comments of a parameter (site page). */
export interface RemarksTarget {
  kind: RemarksKind | 'ofi';
  id: unknown;
  remarks: string;
}

/** "Agency Remarks" (desktop) / "Remarks" (site) / "OFI Comments" pop-up of the old review pages. */
@Component({
  selector: 'zed-review-remarks',
  imports: [FormsModule],
  template: `
    @if (target(); as tg) {
      <div class="modal d-block text-start" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="reviewRemarksTitle">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title" id="reviewRemarksTitle">{{ tg.kind === 'ofi' ? 'OFI Comments' : stage() === 'site' ? 'Remarks' : 'Agency Remarks' }}</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="closed.emit()"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <label for="reviewRemarksText"><strong>{{ tg.kind === 'ofi' ? 'OFI Comments' : stage() === 'site' ? 'Remarks' : 'Assessment Agency Final Remarks' }}<span style="color: red">*</span></strong></label>
              <textarea id="reviewRemarksText" name="reviewRemarks" class="form-control" maxlength="2000" style="max-width: 100%; height: 100px"
                [ngModel]="text()" (ngModelChange)="text.set($event)"></textarea>
              @if (error()) { <div class="alert alert-danger mt-2" role="alert">{{ error() }}</div> }
            </div>
            <div class="modal-footer">
              <input type="button" class="btn btn-default" value="CANCEL" (click)="closed.emit()" />
              <input type="button" class="btn btn-primary" value="UPDATE" [disabled]="busy()" (click)="save(tg)" />
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
})
export class ReviewRemarksDialog {
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  readonly target = input<RemarksTarget | null>(null);
  /** The site assessment page titles the pop-up "Remarks" (SaDetails.cshtml #AgencyRemarks); the desktop page "Agency Remarks". */
  readonly stage = input<'desktop' | 'site'>('desktop');
  readonly saved = output<string>();
  readonly closed = output<void>();

  private readonly api = inject(ReviewApi);
  protected readonly text = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    effect(() => {
      const t = this.target();
      untracked(() => {
        this.text.set(t?.remarks ?? '');
        this.error.set('');
      });
    });
  }

  protected async save(t: RemarksTarget): Promise<void> {
    const value = this.text().trim();
    if (!value) {
      this.error.set(t.kind === 'ofi' ? 'Please enter OFI comments.' : 'Please enter remarks.');
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(
        t.kind === 'ofi'
          ? this.api.ofiComments(this.zedId(), this.certification(), t.id, value)
          : this.api.remarks(this.zedId(), this.certification(), t.kind, t.id, value),
      );
      this.saved.emit(res.message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
