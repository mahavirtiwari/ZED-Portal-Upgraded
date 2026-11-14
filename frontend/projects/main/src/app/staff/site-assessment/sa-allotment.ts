import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Assessor, ONSITE, Row, SITE_SYSTEM, SiteAssessmentApi, isWebLink, todayIso } from './site-assessment.api';
import { CoAllotmentPage } from './co-allotment';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';

interface AllotForm {
  unit: Row;
  assessmentDate: string;
  modeOfAssessment: string;
  siteAssessorId: string;
  coAssessorId: string;
  meetingLink: string;
}

/**
 * "Allot SA Assessments" for agencies with the site verification sub-role. Port of
 * Views/Assessment/SaAllotment.cshtml (Assessment/GetList allotmentType SA, Assessment/AcceptUnitForSa).
 * The old page also had a Reject pop-up, but no button opened it; it is not ported.
 * Surveillance build: "Allot Surveillance" for Silver/Gold surveillance — surveillance date and round, the original
 * certification's assessors, and the meeting link of the external video meeting (mode stored as Onsite, shown as
 * Remote, as before); one "Assessor" and no co-assessor (that page's Co Assessor select was commented out). Consultancy build: the CO allotment page ({@link CoAllotmentPage}) instead.
 */
@Component({
  selector: 'zed-staff-sa-allotment',
  imports: [FormsModule, CoAllotmentPage, PagerComponent, ListSearchComponent],
  template: `
    @if (system === 'consultancy') {
      <zed-staff-co-allotment />
    } @else {
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ surveillance ? 'Allot Surveillance Assessments' : 'Allot SA Assessments' }}</h3>
        <p class="page-sub">{{ surveillance ? 'Allot the Silver and Gold surveillance assessments to an assessor, with the date and the meeting link.' : 'Allot the site assessments to a lead assessor (and a co-assessor for onsite), with the date and the mode.' }}</p>
      </div>
      <div class="page-actions">
        <button type="button" class="refresh-link btn btn-default" (click)="load()">
          <img src="Images/svgicons/refresh.svg" alt="" />
          <span>Refresh Data</span>
        </button>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <zed-list-search [(value)]="search" placeholder="Search units" inputId="sa-allot-search" [found]="view.total()" />
    <div class="table-responsive">
      <table class="table table-bordered table-zed">
        <thead>
          <tr>
            <th class="text-center" style="width: 140px">Action(s)</th>
            <th class="text-center">Certification Level</th>
            <th>Unit Details</th>
            <th>Unit SPOC Details</th>
            @if (surveillance) { <th class="text-center">Surveillance Date</th> }
            <th>Assessor Details</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
            <tr>
              <td class="text-center">
                <div class="row-actions justify-content-center">
                  @if (s['SiteAssessorId']) {
                    <button type="button" class="btn btn-outline-primary" (click)="open(s)">RE-ALLOT</button>
                  } @else if (!s['ReasonForRejection']) {
                    <button type="button" class="btn btn-primary" (click)="open(s)">ALLOT</button>
                  }
                </div>
              </td>
              <td class="text-center">
                <strong>{{ s['Certification'] }}</strong>
                @if (surveillance && s['SurveillanceNo']) { <div class="muted">{{ s['SurveillanceNo'] }}</div> }
              </td>
              <td class="unit">
                <strong class="dash-text-clr">{{ s['ZedId'] }}</strong>
                <div><strong>{{ s['PUnitName'] }}</strong></div>
                <div class="muted">{{ s['UnitAddress'] }}</div>
              </td>
              <td><strong>{{ s['UnitSpocName'] }}</strong><div>{{ s['UnitSpocMobileNo'] }}</div><div class="muted">{{ s['UnitSpocEmailId'] }}</div></td>
              @if (surveillance) { <td class="text-center">{{ s['AssessmentDate'] }}</td> }
              <td class="stack">
                <div><span class="muted">{{ s['SiteAssessorId'] }}</span> <strong>{{ s['SaAssessorName'] }}</strong></div>
                @if (surveillance) {
                  <div><span class="muted">{{ s['CoAssessorId'] }}</span> <strong>{{ s['CoAssessorName'] }}</strong></div>
                } @else if (s['CoAssessorName']) {
                  <div><strong>{{ s['CoAssessorName'] }}</strong></div>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td [attr.colspan]="surveillance ? 6 : 5" style="padding: 0px"><div class="no-data">No Data</div></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allot-title" (click)="close()">
        <div class="modal-dialog modal-dialog-centered" (click)="$event.stopPropagation()">
          <div class="modal-content">
            <div class="modal-header justify-content-between">
              <h5 class="modal-title" id="allot-title">Allot Unit</h5>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <div class="modal-body">
              <p class="mb-3"><strong class="dash-text-clr">{{ f.unit['ZedId'] }}</strong> ({{ f.unit['Certification'] }})</p>
              <div class="mb-3">
                <label class="form-label" for="FinalSaDate">{{ surveillance ? 'Surveillance Assessment Date' : 'Assessment Date' }}<span class="req">*</span></label>
                <input type="date" id="FinalSaDate" name="FinalSaDate" class="form-control" [min]="minDate" [(ngModel)]="f.assessmentDate" />
              </div>
              <div class="mb-3">
                <label class="form-label" for="ModeOfAssessment">Mode of Assessment<span class="req">*</span></label>
                <select id="ModeOfAssessment" name="ModeOfAssessment" class="form-select" [(ngModel)]="f.modeOfAssessment">
                  <option value="">--Select--</option>
                  <!-- Surveillance stores Onsite but the assessment runs on the meeting link (the old page showed "Remote Assessment"). -->
                  <option [value]="onsite">{{ surveillance ? 'Remote Assessment' : 'Onsite Assessment' }}</option>
                </select>
              </div>
              @if (surveillance) {
                <div class="mb-3">
                  <label class="form-label" for="MeetingLink">Meeting Link<span class="req">*</span></label>
                  <textarea id="MeetingLink" name="MeetingLink" class="form-control" maxlength="5000" rows="4"
                            placeholder="https://..." [(ngModel)]="f.meetingLink"></textarea>
                </div>
              }
              <div class="mb-3">
                <label class="form-label" for="SiteAssessorId">{{ surveillance ? 'Assessor' : 'Lead Assessor' }}<span class="req">*</span></label>
                <select id="SiteAssessorId" name="SiteAssessorId" class="form-select" [(ngModel)]="f.siteAssessorId" (ngModelChange)="f.coAssessorId = ''">
                  <option value="">--Select--</option>
                  @for (a of assessorsFor(f.unit); track a.userId) {
                    <option [value]="a.userId">{{ a.userName }}</option>
                  }
                </select>
              </div>
              <!-- Surveillance: the old page had no co-assessor choice (its select was commented out); only one assessor is allotted. -->
              @if (f.modeOfAssessment === onsite && !surveillance) {
                <div class="mb-3">
                  <label class="form-label" for="CoAssessorId">Co Assessor</label>
                  <select id="CoAssessorId" name="CoAssessorId" class="form-select" [(ngModel)]="f.coAssessorId">
                    <option value="">--Select--</option>
                    @for (a of coAssessors(f.siteAssessorId); track a.userId) {
                      <option [value]="a.userId">{{ a.userName }}</option>
                    }
                  </select>
                </div>
              }
              @if (surveillance) {
                <div class="original">
                  <div><strong>Onsite Assessment Done by</strong></div>
                  <div><span class="muted">Onsite Lead Assessor:</span> {{ f.unit['LeadInCertification'] }} - {{ f.unit['LeadNameInCertification'] }}</div>
                  <div><span class="muted">Onsite Co Assessor:</span> {{ f.unit['CoInCertification'] }} - {{ f.unit['CoNameInCertification'] }}</div>
                </div>
              }
              @if (formError()) {
                <div class="alert alert-danger mt-3 mb-0" role="alert">{{ formError() }}</div>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="close()">CANCEL</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="allot(f)">ALLOT</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (busy()) {
      <div class="loadingdiv" role="status" aria-live="polite">
        <div class="text-center text-white">
          <div class="spinner-border text-light"></div>
          <div><small>Please wait ...</small></div>
        </div>
      </div>
    }
    }
  `,
  styles: `
    .unit { min-width: 200px; }
    .stack > div + div { margin-top: 6px; }
    .original { background: #eef6f6; border-radius: 10px; padding: 10px 12px; display: grid; gap: 4px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SaAllotmentPage {
  private readonly api = inject(SiteAssessmentApi);
  protected readonly system = inject(SITE_SYSTEM);
  protected readonly surveillance = this.system === 'surveillance';

  protected readonly units = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  protected readonly view = new PagedView(() => searchRows(this.units(), this.search()));
  protected readonly assessors = signal<Assessor[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly formError = signal('');
  protected readonly form = signal<AllotForm | null>(null);
  protected readonly onsite = ONSITE;
  protected readonly minDate = todayIso();
  /** V4: only assessors who assess the unit's kind (Manufacturing / Services; not set = no limit). */
  protected assessorsFor(unit: Row): Assessor[] {
    const category = unit['SectorCategory'];
    return this.assessors().filter((a) => !category || !a.sectorActivity || a.sectorActivity === 'Both' || a.sectorActivity === category);
  }
  protected readonly coAssessors = (leadId: string) => {
    const unit = this.form()?.unit;
    return (unit ? this.assessorsFor(unit) : this.assessors()).filter((a) => a.userId !== leadId);
  };

  constructor() {
    if (this.system !== 'consultancy') void this.load();
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.allotments());
      this.units.set(data.units ?? []);
      this.assessors.set(data.assessors ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** As the old pop-up (a copy of the row): RE-ALLOT opens with the current assessor and meeting link filled in. */
  protected open(unit: Row): void {
    this.success.set('');
    this.formError.set('');
    const value = (column: string) => (unit[column] === null || unit[column] === undefined ? '' : String(unit[column]));
    this.form.set({
      unit,
      assessmentDate: '',
      modeOfAssessment: this.surveillance ? ONSITE : '',
      siteAssessorId: value('SiteAssessorId'),
      coAssessorId: '',
      meetingLink: this.surveillance ? value('MeetingLink') : '',
    });
  }

  protected close(): void {
    this.form.set(null);
  }

  protected async allot(f: AllotForm): Promise<void> {
    if (!f.siteAssessorId || !f.modeOfAssessment || !f.assessmentDate) {
      this.formError.set('Please select valid data.');
      return;
    }
    if (this.surveillance && !isWebLink(f.meetingLink)) {
      this.formError.set('Please enter a valid meeting link (starting with https:// or http://).');
      return;
    }
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(
        this.api.allot({
          zedId: String(f.unit['ZedId']),
          certification: String(f.unit['Certification']),
          siteAssessorId: f.siteAssessorId,
          coAssessorId: f.modeOfAssessment === ONSITE && f.coAssessorId && !this.surveillance ? f.coAssessorId : null,
          assessmentDate: f.assessmentDate,
          modeOfAssessment: f.modeOfAssessment,
          ...(this.surveillance ? { meetingLink: f.meetingLink.trim() } : {}),
        }),
      );
      this.form.set(null);
      this.success.set(`${f.unit['ZedId']} allotted successfully.`);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
