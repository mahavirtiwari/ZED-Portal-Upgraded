import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Assessor, ONSITE, Row, SITE_SYSTEM, SiteAssessmentApi, isWebLink, todayIso } from './site-assessment.api';
import { CoAllotmentPage } from './co-allotment';

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
  imports: [FormsModule, CoAllotmentPage],
  template: `
    @if (system === 'consultancy') {
      <zed-staff-co-allotment />
    } @else {
    <div class="container form-page" id="zed_user_form">
      <div class="Dashboard-msme">
        <div class="row mt-3">
          <div class="col-sm-10">
            <h3 class="registration-title">{{ surveillance ? 'Allot Surveillance Assessments' : 'Allot SA Assessments' }}</h3>
          </div>
          <div class="col-sm-2">
            <button type="button" class="refresh-link btn btn-link" (click)="load()">
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

        <div class="row">
          <div class="col-sm-12">
            <div class="table-responsive">
              <table class="table table-bordered table-zed">
                <thead>
                  <tr>
                    <th>Action(s)</th>
                    <th>Certification Level</th>
                    <th>Unit Details</th>
                    <th>SPOC Details</th>
                    @if (surveillance) { <th>Surveillance Date</th> }
                    <th>Assessor Details</th>
                  </tr>
                </thead>
                <tbody>
                  @for (s of units(); track s['ZedId'] + '|' + s['Certification']) {
                    <tr>
                      <td>
                        @if (s['SiteAssessorId']) {
                          <button type="button" class="btn btn-primary btn-xs" (click)="open(s)">RE-ALLOT</button>
                        } @else if (!s['ReasonForRejection']) {
                          <button type="button" class="btn btn-primary btn-xs" (click)="open(s)">ALLOT</button>
                        }
                      </td>
                      <td>
                        {{ s['Certification'] }}
                        @if (surveillance && s['SurveillanceNo']) { <br /><br />{{ s['SurveillanceNo'] }} }
                      </td>
                      <td>
                        <strong class="dash-text-clr">{{ s['ZedId'] }}</strong><br />
                        <strong>{{ s['PUnitName'] }}</strong><br />
                        {{ s['UnitAddress'] }}
                      </td>
                      <td><strong>{{ s['UnitSpocName'] }}</strong><br />{{ s['UnitSpocMobileNo'] }}<br />{{ s['UnitSpocEmailId'] }}</td>
                      @if (surveillance) { <td>{{ s['AssessmentDate'] }}</td> }
                      <td>
                        {{ s['SiteAssessorId'] }}<br />
                        {{ s['SaAssessorName'] }}
                        @if (surveillance) {
                          {{ s['CoAssessorId'] }}<br />
                          {{ s['CoAssessorName'] }}
                        } @else if (s['CoAssessorName']) {
                          <br />{{ s['CoAssessorName'] }}
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
          </div>
        </div>
      </div>
    </div>

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allot-title" (click)="close()">
        <div class="modal-dialog modal-popup" (click)="$event.stopPropagation()">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between">
                <h3 class="registration-title" id="allot-title">Allot Unit</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="close()"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <p class="mb-2"><strong class="dash-text-clr">{{ f.unit['ZedId'] }}</strong> ({{ f.unit['Certification'] }})</p>
              <div style="margin-bottom: 9px">
                <label for="FinalSaDate"><strong>{{ surveillance ? 'Surveillance Assessment Date' : 'Assessment Date' }}<span style="color: red">*</span></strong></label>
                <input type="date" id="FinalSaDate" name="FinalSaDate" class="form-control" [min]="minDate" [(ngModel)]="f.assessmentDate" />
              </div>
              <div style="margin-bottom: 9px">
                <label for="ModeOfAssessment"><strong>Mode of Assessment<span style="color: red">*</span></strong></label>
                <select id="ModeOfAssessment" name="ModeOfAssessment" class="form-control" [(ngModel)]="f.modeOfAssessment">
                  <option value="">--Select--</option>
                  <!-- Surveillance stores Onsite but the assessment runs on the meeting link (the old page showed "Remote Assessment"). -->
                  <option [value]="onsite">{{ surveillance ? 'Remote Assessment' : 'Onsite Assessment' }}</option>
                </select>
              </div>
              @if (surveillance) {
                <div style="margin-bottom: 9px">
                  <label for="MeetingLink"><strong>Meeting Link<span style="color: red">*</span></strong></label>
                  <textarea id="MeetingLink" name="MeetingLink" class="form-control" maxlength="2000" style="line-height: 24px; height: 100px"
                            placeholder="https://..." [(ngModel)]="f.meetingLink"></textarea>
                </div>
              }
              <div style="margin-bottom: 9px">
                <label for="SiteAssessorId"><strong>{{ surveillance ? 'Assessor' : 'Lead Assessor' }}<span style="color: red">*</span></strong></label>
                <select id="SiteAssessorId" name="SiteAssessorId" class="form-control" [(ngModel)]="f.siteAssessorId" (ngModelChange)="f.coAssessorId = ''">
                  <option value="">--Select--</option>
                  @for (a of assessors(); track a.userId) {
                    <option [value]="a.userId">{{ a.userName }}</option>
                  }
                </select>
              </div>
              <!-- Surveillance: the old page had no co-assessor choice (its select was commented out); only one assessor is allotted. -->
              @if (f.modeOfAssessment === onsite && !surveillance) {
                <div style="margin-bottom: 9px">
                  <label for="CoAssessorId"><strong>Co Assessor</strong></label>
                  <select id="CoAssessorId" name="CoAssessorId" class="form-control" [(ngModel)]="f.coAssessorId">
                    <option value="">--Select--</option>
                    @for (a of coAssessors(f.siteAssessorId); track a.userId) {
                      <option [value]="a.userId">{{ a.userName }}</option>
                    }
                  </select>
                </div>
              }
              @if (surveillance) {
                <div class="mt-3 original">
                  <div><strong>Onsite Assessment Done by</strong></div>
                  <div><strong>Onsite Lead Assessor:</strong> {{ f.unit['LeadInCertification'] }} - {{ f.unit['LeadNameInCertification'] }}</div>
                  <div><strong>Onsite Co Assessor:</strong> {{ f.unit['CoInCertification'] }} - {{ f.unit['CoNameInCertification'] }}</div>
                </div>
              }
              @if (formError()) {
                <div class="alert alert-danger" role="alert">{{ formError() }}</div>
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
    .refresh-link { cursor: pointer; text-decoration: none; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SaAllotmentPage {
  private readonly api = inject(SiteAssessmentApi);
  protected readonly system = inject(SITE_SYSTEM);
  protected readonly surveillance = this.system === 'surveillance';

  protected readonly units = signal<Row[]>([]);
  protected readonly assessors = signal<Assessor[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly formError = signal('');
  protected readonly form = signal<AllotForm | null>(null);
  protected readonly onsite = ONSITE;
  protected readonly minDate = todayIso();
  protected readonly coAssessors = (leadId: string) => this.assessors().filter((a) => a.userId !== leadId);

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

  protected open(unit: Row): void {
    this.success.set('');
    this.formError.set('');
    this.form.set({ unit, assessmentDate: '', modeOfAssessment: this.surveillance ? ONSITE : '', siteAssessorId: '', coAssessorId: '', meetingLink: '' });
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
