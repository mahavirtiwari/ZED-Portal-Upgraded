import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Assessor, Row, SiteAssessmentApi, todayIso } from './site-assessment.api';
import { PagedView, PagerComponent } from '../pager';

interface CoForm {
  unit: Row;
  milestone: number;
  leadConsultantId: string;
  coConsultantIds: string[];
  technicalExpertIds: string[];
  bdsFromDate: string;
  bdsToDate: string;
  hapFromDate: string;
  hapToDate: string;
}

interface RejectForm {
  unit: Row;
  reason: string;
}

/** Names of the review stage per milestone, as the old pop-up labelled the BDS row. */
export const STAGE_LABEL: Record<number, string> = { 1: 'Baseline Diagnostic Study', 2: 'Progress Review 1', 3: 'Progress Review 2' };

/**
 * "Allot Consultancy" of a Consultant Organisation (consultancy build). Port of the consultancy
 * Views/Assessment/SaAllotment.cshtml: ACCEPT / RE-ALLOT a unit's milestone with the lead consultant, co-consultants,
 * technical experts, BDS dates and (milestone 1) HAP dates; REJECT with a reason. Multi-selects are plain checkbox
 * lists (no select2); the lead is never offered as a co-consultant.
 */
@Component({
  selector: 'zed-staff-co-allotment',
  imports: [FormsModule, PagerComponent],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="Dashboard-msme">
        <div class="row mt-3">
          <div class="col-sm-10">
            <h3 class="registration-title">Allot Consultancy</h3>
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

        <div class="table-responsive">
          <table class="table table-bordered table-zed">
            <thead>
              <tr>
                <th>Action(s)</th>
                <th>Desired Certification</th>
                <th>Milestone</th>
                <th>Unit Details</th>
                <th>Unit SPOC Details</th>
                <th>Consultant Details</th>
              </tr>
            </thead>
            <tbody>
              @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
                <tr>
                  <td>
                    @if (s['SiteAssessorId']) {
                      <button type="button" class="btn btn-primary btn-xs allot" (click)="open(s)">RE-ALLOT</button>
                    } @else if (!s['ReasonForRejection']) {
                      <button type="button" class="btn btn-primary btn-xs allot" (click)="open(s)">ACCEPT</button>
                      <button type="button" class="btn btn-default btn-xs reject" (click)="openReject(s)">REJECT</button>
                    } @else {
                      <div class="alert alert-danger p-1 mb-0">REJECTED</div>
                    }
                  </td>
                  <td>{{ s['Certification'] }}</td>
                  <td><label>Milestone {{ s['NcCount'] }}</label></td>
                  <td>
                    <strong class="dash-text-clr">{{ s['ZedId'] }}</strong><br />
                    <strong>{{ s['PUnitName'] }}</strong><br />
                    {{ s['UnitAddress'] }}
                  </td>
                  <td><strong>{{ s['UnitSpocName'] }}</strong><br />{{ s['UnitSpocMobileNo'] }}<br />{{ s['UnitSpocEmailId'] }}</td>
                  <!-- As the old page: the lead, the co-consultants and the technical experts, each id over its names. -->
                  <td class="consultants">
                    {{ s['SiteAssessorId'] }}<br />
                    {{ s['SaAssessorName'] }}<br /><br />
                    {{ s['CoAssessorId'] }}<br />
                    {{ s['CoConsultantNames'] }}<br /><br />
                    {{ s['TechExpert'] }}<br />
                    {{ s['TechnicalExpertNames'] }}
                  </td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="6" style="padding: 0px"><div class="no-data">No Data</div></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="view" />
      </div>
    </div>

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="co-allot-title" (click)="close()">
        <div class="modal-dialog modal-lg modal-popup" (click)="$event.stopPropagation()">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between">
                <h3 class="registration-title" id="co-allot-title">Allot Unit</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="close()"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <p class="mb-2"><strong class="dash-text-clr">{{ f.unit['ZedId'] }}</strong> ({{ f.unit['Certification'] }}, Milestone {{ f.milestone }})</p>
              <div class="row mb-3">
                <div class="col-sm-4"><div class="panel panel-info p-2">{{ stage(f.milestone) }}</div></div>
                <div class="col-sm-4">
                  <label for="BdsFromDate">From<span style="color: red">*</span></label>
                  <input type="date" id="BdsFromDate" name="BdsFromDate" class="form-control" [min]="minDate" [(ngModel)]="f.bdsFromDate" />
                </div>
                <div class="col-sm-4">
                  <label for="BdsToDate">To<span style="color: red">*</span></label>
                  <input type="date" id="BdsToDate" name="BdsToDate" class="form-control" [min]="f.bdsFromDate || minDate" [(ngModel)]="f.bdsToDate" />
                </div>
              </div>
              @if (f.milestone === 1) {
                <div class="row mb-3">
                  <div class="col-sm-4"><div class="panel panel-info p-2">Handholding Action Plan</div></div>
                  <div class="col-sm-4">
                    <label for="HapFromDate">From<span style="color: red">*</span></label>
                    <input type="date" id="HapFromDate" name="HapFromDate" class="form-control" [min]="minDate" [(ngModel)]="f.hapFromDate" />
                  </div>
                  <div class="col-sm-4">
                    <label for="HapToDate">To<span style="color: red">*</span></label>
                    <input type="date" id="HapToDate" name="HapToDate" class="form-control" [min]="f.hapFromDate || minDate" [(ngModel)]="f.hapToDate" />
                  </div>
                </div>
              }
              <div class="row">
                <div class="col-sm-4"><div class="panel panel-info p-2">Consultancy Team</div></div>
                <div class="col-sm-8">
                  <label for="LeadConsultant">Lead Consultant<span style="color: red">*</span></label>
                  <select id="LeadConsultant" name="LeadConsultant" class="form-control mb-2" [(ngModel)]="f.leadConsultantId" (ngModelChange)="leadChanged(f)">
                    <option value="">--Select--</option>
                    @for (a of consultants(); track a.userId) {
                      <option [value]="a.userId">{{ a.userName }}</option>
                    }
                  </select>
                  <fieldset class="mb-2">
                    <legend class="fs-6 mb-1">Co-consultant(s)</legend>
                    @for (a of coCandidates(f.leadConsultantId); track a.userId) {
                      <div class="form-check">
                        <input type="checkbox" class="form-check-input co" [id]="'co-' + a.userId" [checked]="f.coConsultantIds.includes(a.userId)" (change)="toggle(f.coConsultantIds, a.userId)" />
                        <label class="form-check-label" [for]="'co-' + a.userId">{{ a.userName }} ({{ a.userId }})</label>
                      </div>
                    } @empty {
                      <small class="text-muted">No other consultants.</small>
                    }
                  </fieldset>
                  <fieldset>
                    <legend class="fs-6 mb-1">Technical Expert(s)</legend>
                    @for (a of experts(); track a.userId) {
                      <div class="form-check">
                        <input type="checkbox" class="form-check-input expert" [id]="'te-' + a.userId" [checked]="f.technicalExpertIds.includes(a.userId)" (change)="toggle(f.technicalExpertIds, a.userId)" />
                        <label class="form-check-label" [for]="'te-' + a.userId">{{ a.userName }} ({{ a.userId }})</label>
                      </div>
                    } @empty {
                      <small class="text-muted">No technical experts.</small>
                    }
                  </fieldset>
                </div>
              </div>
              @if (formError()) {
                <div class="alert alert-danger mt-2" role="alert">{{ formError() }}</div>
              }
            </div>
            <div class="modal-footer" style="text-align: left">
              <button type="button" class="btn btn-default" (click)="close()">CANCEL</button>
              <button type="button" class="btn btn-primary submit" [disabled]="busy()" (click)="allot(f)">ALLOT</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (rejectForm(); as r) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="co-reject-title" (click)="rejectForm.set(null)">
        <div class="modal-dialog" (click)="$event.stopPropagation()">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between">
                <h3 class="registration-title" id="co-reject-title">Reject Unit</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="rejectForm.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <label for="ReasonForRejection">Reason for Rejection<span style="color: red">*</span></label>
              <textarea id="ReasonForRejection" name="ReasonForRejection" class="form-control" maxlength="100" style="max-width: 100%" [(ngModel)]="r.reason"></textarea>
              @if (formError()) {
                <div class="alert alert-danger mt-2" role="alert">{{ formError() }}</div>
              }
            </div>
            <div class="modal-footer" style="text-align: left">
              <button type="button" class="btn btn-default" (click)="rejectForm.set(null)">CANCEL</button>
              <button type="button" class="btn btn-primary submit-reject" [disabled]="busy()" (click)="reject(r)">REJECT</button>
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
  `,
  styles: `
    .refresh-link { cursor: pointer; text-decoration: none; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class CoAllotmentPage {
  private readonly api = inject(SiteAssessmentApi);

  protected readonly units = signal<Row[]>([]);
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() => this.units());
  protected readonly consultants = signal<Assessor[]>([]);
  protected readonly experts = signal<Assessor[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly formError = signal('');
  protected readonly form = signal<CoForm | null>(null);
  protected readonly rejectForm = signal<RejectForm | null>(null);
  protected readonly minDate = todayIso();
  protected readonly coCandidates = (leadId: string) => this.consultants().filter((a) => a.userId !== leadId);

  constructor() {
    void this.load();
  }

  protected stage(milestone: number): string {
    return STAGE_LABEL[milestone] ?? STAGE_LABEL[1];
  }

  protected async load(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      const data = await firstValueFrom(this.api.coAllotments());
      this.units.set(data.units ?? []);
      this.consultants.set(data.consultants ?? []);
      this.experts.set(data.technicalExperts ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected open(unit: Row): void {
    this.success.set('');
    this.formError.set('');
    const ids = (v: unknown) => (Array.isArray(v) ? v.map(String) : []);
    this.form.set({
      unit,
      milestone: Number(unit['NcCount']) || 1,
      leadConsultantId: String(unit['SiteAssessorId'] ?? ''),
      coConsultantIds: ids(unit['CoConsultantIds']),
      technicalExpertIds: ids(unit['TechnicalExpertIds']),
      bdsFromDate: '',
      bdsToDate: '',
      hapFromDate: '',
      hapToDate: '',
    });
  }

  protected openReject(unit: Row): void {
    this.success.set('');
    this.formError.set('');
    this.rejectForm.set({ unit, reason: '' });
  }

  protected close(): void {
    this.form.set(null);
  }

  protected leadChanged(f: CoForm): void {
    f.coConsultantIds = f.coConsultantIds.filter((id) => id !== f.leadConsultantId);
  }

  protected toggle(list: string[], id: string): void {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.push(id);
  }

  protected async allot(f: CoForm): Promise<void> {
    const hap = f.milestone === 1;
    if (!f.leadConsultantId || !f.bdsFromDate || !f.bdsToDate || (hap && (!f.hapFromDate || !f.hapToDate))) {
      this.formError.set('Please select required data.');
      return;
    }
    if (f.bdsToDate < f.bdsFromDate || (hap && f.hapToDate < f.hapFromDate)) {
      this.formError.set('The To date cannot be before the From date.');
      return;
    }
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(
        this.api.coAllot({
          zedId: String(f.unit['ZedId']),
          certification: String(f.unit['Certification']),
          leadConsultantId: f.leadConsultantId,
          coConsultantIds: f.coConsultantIds.filter((id) => id !== f.leadConsultantId),
          technicalExpertIds: [...f.technicalExpertIds],
          bdsFromDate: f.bdsFromDate,
          bdsToDate: f.bdsToDate,
          hapFromDate: hap ? f.hapFromDate : null,
          hapToDate: hap ? f.hapToDate : null,
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

  protected async reject(r: RejectForm): Promise<void> {
    if (!r.reason.trim()) {
      this.formError.set('Please enter the reason for rejection.');
      return;
    }
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(this.api.coReject(String(r.unit['ZedId']), String(r.unit['Certification']), r.reason.trim()));
      this.rejectForm.set(null);
      this.success.set(`${r.unit['ZedId']} rejected.`);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
