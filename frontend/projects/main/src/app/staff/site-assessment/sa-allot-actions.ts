import { Component, OnInit, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AllotRequest, Assessor, ONSITE, REMOTE, Row, SITE_SYSTEM, isWebLink, todayIso } from './site-assessment.api';
import { mayAssess } from '../users/assessor-scope';
import { ConfirmAsk } from '../confirm-dialog';

/**
 * 2026-11-18 (the user: "accept, reject, view details ... similar to combination one"): the agency's Accept (allot / re-allot
 * to a site assessor) and Reject of a unit in its site-assessment allotment, shared by the list (sa-allotment.ts) and the
 * assessment details page opened from it (the allotment banner), so both ask the same and call the same APIs.
 */

const str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

/** 2026-11-14: a main unit whose level's flow is remote (the server sends AssessmentMode). */
export function siteRemoteUnit(unit: Row, surveillance: boolean): boolean {
  return !surveillance && unit['AssessmentMode'] === 'Remote';
}

/** 2026-11-14 (Onsite surveillance): a surveillance unit whose level is surveilled by an onsite visit. */
export function siteOnsiteVisit(unit: Row, surveillance: boolean): boolean {
  return surveillance && unit['AssessmentMode'] === 'Onsite';
}

/** Surveillance (except an onsite visit) and main remote assessments are held on a meeting link. */
export function siteNeedsLink(unit: Row, surveillance: boolean): boolean {
  return (surveillance && !siteOnsiteVisit(unit, surveillance)) || siteRemoteUnit(unit, surveillance);
}

/** V4: only assessors who assess the unit's kind and (2026-11-14) are ticked for its level in its mode. */
export function siteAssessorsFor(unit: Row, assessors: Assessor[], surveillance: boolean): Assessor[] {
  const category = unit['SectorCategory'];
  const level = str(unit['Certification']);
  return assessors.filter((a) => (!category || !a.sectorActivity || a.sectorActivity === 'Both' || a.sectorActivity === category)
    // A meeting-link surveillance keeps today's list (no mode to tick for it).
    && (surveillance && !siteOnsiteVisit(unit, surveillance) ? true : mayAssess(a, level, siteRemoteUnit(unit, surveillance) ? 'Remote' : 'Onsite')));
}

/** The Reject confirmation (reason required; the procedure keeps 100 characters). */
export function siteRejectAsk(unit: Row): ConfirmAsk {
  return {
    title: 'Reject assessment?',
    message: `${str(unit['ZedId'])} (${str(unit['Certification'])}) goes back to the ZED team with your reason.`,
    confirmLabel: 'Reject',
    danger: true,
    reason: { label: 'Reason for rejection', maxLength: 100, requiredMessage: 'Please enter reason for rejection.' },
  };
}

/** The allotment asked for, with the lead assessor's name for the toast. */
export interface SiteAllotChoice {
  request: AllotRequest;
  assessorName: string | null;
}

/** Accept / Re-allot of the site assessment: date, mode, assessors and (remote, surveillance) the meeting link. */
@Component({
  selector: 'zed-sa-allot-dialog',
  imports: [FormsModule],
  template: `
    @let u = unit();
    <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allot-title" (click)="cancel.emit()">
      <div class="modal-dialog modal-dialog-centered" (click)="$event.stopPropagation()">
        <div class="modal-content sa-pop">
          <div class="modal-header justify-content-between">
            <div>
              <h3 class="sa-pop-title" id="allot-title">{{ u['SiteAssessorId'] ? 'Re-allot unit' : 'Accept assessment' }}</h3>
              <p class="sa-pop-sub">{{ u['ZedId'] }} · {{ u['Certification'] }}@if (u['PUnitName']) { · {{ u['PUnitName'] }} }</p>
            </div>
            <button type="button" class="btn-close" aria-label="Close" (click)="cancel.emit()"></button>
          </div>
          <div class="modal-body">
            <div class="mb-3">
              <label class="form-label" for="FinalSaDate">{{ surveillance ? 'Surveillance Assessment Date' : 'Assessment Date' }}<span class="req">*</span></label>
              <input type="date" id="FinalSaDate" name="FinalSaDate" class="form-control" [min]="minDate" [(ngModel)]="assessmentDate" />
            </div>
            <div class="mb-3">
              <label class="form-label" for="ModeOfAssessment">Mode of Assessment<span class="req">*</span></label>
              <select id="ModeOfAssessment" name="ModeOfAssessment" class="form-select" [(ngModel)]="modeOfAssessment">
                <option value="">--Select--</option>
                <!-- Surveillance stores Onsite but the assessment runs on the meeting link (the old page showed "Remote Assessment"). -->
                <!-- 2026-11-14: a main unit whose level is assessed remotely (Desktop + Remote, Remote only) is allotted Remote. -->
                @if (remoteUnit()) {
                  <option [value]="remote">Remote Assessment</option>
                } @else {
                  <option [value]="onsite">{{ surveillance && !onsiteVisit() ? 'Remote Assessment' : 'Onsite Assessment' }}</option>
                }
              </select>
            </div>
            @if (needsLink()) {
              <div class="mb-3">
                <label class="form-label" for="MeetingLink">Meeting Link<span class="req">*</span></label>
                <textarea id="MeetingLink" name="MeetingLink" class="form-control" maxlength="5000" rows="4" placeholder="https://..." [(ngModel)]="meetingLink"></textarea>
              </div>
            }
            <div class="mb-3">
              <label class="form-label" for="SiteAssessorId">{{ surveillance ? 'Assessor' : 'Lead Assessor' }}<span class="req">*</span></label>
              <select id="SiteAssessorId" name="SiteAssessorId" class="form-select" [(ngModel)]="siteAssessorId" (ngModelChange)="coAssessorId = ''">
                <option value="">--Select--</option>
                @for (a of offered(); track a.userId) { <option [value]="a.userId">{{ a.userName }}</option> }
              </select>
            </div>
            <!-- Surveillance: the old page had no co-assessor choice (its select was commented out); only one assessor is allotted. -->
            @if (modeOfAssessment === onsite && !surveillance) {
              <div class="mb-3">
                <label class="form-label" for="CoAssessorId">Co Assessor</label>
                <select id="CoAssessorId" name="CoAssessorId" class="form-select" [(ngModel)]="coAssessorId">
                  <option value="">--Select--</option>
                  @for (a of offered(); track a.userId) { @if (a.userId !== siteAssessorId) { <option [value]="a.userId">{{ a.userName }}</option> } }
                </select>
              </div>
            }
            @if (surveillance) {
              <div class="original">
                <div><strong>Onsite Assessment Done by</strong></div>
                <div><span class="muted">Onsite Lead Assessor:</span> {{ u['LeadInCertification'] }} - {{ u['LeadNameInCertification'] }}</div>
                <div><span class="muted">Onsite Co Assessor:</span> {{ u['CoInCertification'] }} - {{ u['CoNameInCertification'] }}</div>
              </div>
            }
            @if (missing() || failed()) { <div class="alert alert-danger mt-3 mb-0" role="alert">{{ missing() || failed() }}</div> }
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-light" (click)="cancel.emit()">Cancel</button>
            <button type="button" class="btn btn-primary sa-ok" [disabled]="busy()" (click)="submit()">Allot</button>
          </div>
        </div>
      </div>
    </div>
    <div class="modal-backdrop show"></div>
  `,
  styles: `
    .sa-pop { border: 0; border-radius: 12px; }
    .sa-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .sa-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
    .original { background: #eef6f6; border-radius: 10px; padding: 10px 12px; display: grid; gap: 4px; }
  `,
})
export class SaAllotDialog implements OnInit {
  readonly unit = input.required<Row>();
  /** All the agency's site assessors (the dialog offers those who may assess the unit). */
  readonly assessors = input<Assessor[]>([]);
  readonly busy = input(false);
  /** The server's refusal. */
  readonly failed = input('');
  readonly allot = output<SiteAllotChoice>();
  readonly cancel = output<void>();

  protected readonly surveillance = inject(SITE_SYSTEM) === 'surveillance';
  protected readonly onsite = ONSITE;
  protected readonly remote = REMOTE;
  protected readonly minDate = todayIso();
  protected readonly missing = signal('');
  protected readonly remoteUnit = computed(() => siteRemoteUnit(this.unit(), this.surveillance));
  protected readonly onsiteVisit = computed(() => siteOnsiteVisit(this.unit(), this.surveillance));
  protected readonly needsLink = computed(() => siteNeedsLink(this.unit(), this.surveillance));
  protected readonly offered = computed(() => siteAssessorsFor(this.unit(), this.assessors(), this.surveillance));

  protected assessmentDate = '';
  protected modeOfAssessment = '';
  protected siteAssessorId = '';
  protected coAssessorId = '';
  protected meetingLink = '';

  /** As the old pop-up (a copy of the row): RE-ALLOT opens with the current assessor and meeting link filled in. */
  ngOnInit(): void {
    const u = this.unit();
    this.modeOfAssessment = this.surveillance ? ONSITE : this.remoteUnit() ? REMOTE : '';
    this.siteAssessorId = str(u['SiteAssessorId']);
    this.meetingLink = this.needsLink() ? str(u['MeetingLink']) : '';
  }

  protected submit(): void {
    if (!this.siteAssessorId || !this.modeOfAssessment || !this.assessmentDate) {
      this.missing.set('Please select valid data.');
      return;
    }
    if (this.needsLink() && !isWebLink(this.meetingLink)) {
      this.missing.set('Please enter a valid meeting link (starting with https:// or http://).');
      return;
    }
    this.missing.set('');
    const u = this.unit();
    this.allot.emit({
      request: {
        zedId: str(u['ZedId']),
        certification: str(u['Certification']),
        siteAssessorId: this.siteAssessorId,
        coAssessorId: this.modeOfAssessment === ONSITE && this.coAssessorId && !this.surveillance ? this.coAssessorId : null,
        assessmentDate: this.assessmentDate,
        modeOfAssessment: this.modeOfAssessment,
        ...(this.needsLink() ? { meetingLink: this.meetingLink.trim() } : {}),
      },
      assessorName: this.assessors().find((a) => a.userId === this.siteAssessorId)?.userName ?? null,
    });
  }
}
