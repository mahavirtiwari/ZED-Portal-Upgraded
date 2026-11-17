import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Assessor, Row, SiteAssessmentApi, todayIso } from './site-assessment.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { maskEmail, maskMobile } from '../users/user-display';

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

/** Names of the review stage per milestone, as the old pop-up labelled the BDS row. */
export const STAGE_LABEL: Record<number, string> = { 1: 'Baseline Diagnostic Study', 2: 'Progress Review 1', 3: 'Progress Review 2' };

/**
 * "Allot Consultancy" of a Consultant Organisation (consultancy build). Port of the consultancy
 * Views/Assessment/SaAllotment.cshtml: ACCEPT / RE-ALLOT a unit's milestone with the lead consultant, co-consultants,
 * technical experts, BDS dates and (milestone 1) HAP dates; REJECT with a reason. Multi-selects are plain checkbox
 * lists (no select2); the lead is never offered as a co-consultant.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, the
 * milestone as chips, one search box, the SPOC's mobile and e-mail masked, Accept / Re-allot on the row and Reject in its
 * menu (the reason in the confirmation pop-up), a toast when done.</p>
 */
@Component({
  selector: 'zed-staff-co-allotment',
  imports: [FormsModule, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu, ConfirmDialog],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs" title="Allot Consultancy"
                   subtitle="Accept the milestones allotted to your organisation and choose the consultancy team and the visit dates, or reject them.">
      <button type="button" class="btn btn-ph" (click)="load()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" label="Milestones by status" (pick)="pickStage($event.key)" />

    <div class="zed-card co-filters">
      <input type="search" id="co-allot-search" class="form-control co-q" maxlength="50" placeholder="Search ZED ID, unit, SPOC or consultant"
             aria-label="Search ZED ID, unit, SPOC or consultant" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <zed-chip-filter label="Milestone" [chips]="milestoneChips()" [value]="milestone()" (valueChange)="milestone.set($event)" />
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>Unit</th>
            <th>Desired level</th>
            <th>Milestone</th>
            <th>Unit SPOC</th>
            <th>Consultants</th>
            <th>Status</th>
            <th class="text-end">Actions</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
            <tr [class.co-flag]="!!s['ReasonForRejection'] && !s['SiteAssessorId']">
              <td class="unit unit-cell">
                <b>{{ s['PUnitName'] }}</b>
                <span class="dash-text-clr co-id">{{ s['ZedId'] }}</span>
                <small class="co-addr" [title]="str(s['UnitAddress'])">{{ s['UnitAddress'] }}</small>
              </td>
              <td><span [class]="'lv-tag lv-' + str(s['Certification']).toLowerCase()">{{ s['Certification'] }}</span></td>
              <td><span class="chip is-info">Milestone {{ s['NcCount'] }}</span></td>
              <!-- Masked in the list; the MSME profile has the full values. -->
              <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ maskMobile(str(s['UnitSpocMobileNo'])) }}</span><span class="sub">{{ maskEmail(str(s['UnitSpocEmailId'])) }}</span></td>
              <!-- As the old page: the lead, the co-consultants and the technical experts, each id over its names. -->
              <td class="consultants">
                <div><div class="muted">{{ s['SiteAssessorId'] }}</div>{{ s['SaAssessorName'] }}</div>
                <div><div class="muted">{{ s['CoAssessorId'] }}</div>{{ s['CoConsultantNames'] }}</div>
                <div><div class="muted">{{ s['TechExpert'] }}</div>{{ s['TechnicalExpertNames'] }}</div>
              </td>
              <td>
                @if (s['SiteAssessorId']) { <span class="chip is-good">Allotted</span> }
                @else if (s['ReasonForRejection']) { <span class="chip is-bad" [title]="str(s['ReasonForRejection'])">Rejected</span> }
                @else { <span class="chip is-warn">Waiting</span> }
              </td>
              <td class="text-end text-nowrap">
                @if (s['SiteAssessorId']) {
                  <button type="button" class="btn co-act re-allot allot" (click)="open(s)">Re-allot</button>
                } @else if (!s['ReasonForRejection']) {
                  <button type="button" class="btn btn-primary co-act allot" (click)="open(s)">Accept</button>
                  <zed-row-menu [items]="menu" [label]="'More actions for ' + s['ZedId']" (picked)="act(s, $event)" />
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" style="padding: 0px"><div class="no-data">{{ busy() ? 'Loading…' : 'No Data' }}</div></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="co-allot-title" (click)="close()">
        <div class="modal-dialog modal-lg modal-dialog-centered" (click)="$event.stopPropagation()">
          <div class="modal-content co-pop">
            <div class="modal-header justify-content-between">
              <div>
                <h3 class="co-pop-title" id="co-allot-title">{{ f.unit['SiteAssessorId'] ? 'Re-allot unit' : 'Allot unit' }}</h3>
                <p class="co-pop-sub">{{ f.unit['ZedId'] }} · {{ f.unit['Certification'] }}, Milestone {{ f.milestone }}@if (f.unit['PUnitName']) { · {{ f.unit['PUnitName'] }} }</p>
              </div>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <div class="modal-body">
              <div class="row mb-3">
                <div class="col-sm-4"><div class="stage">{{ stageLabel(f.milestone) }}</div></div>
                <div class="col-sm-4">
                  <label class="form-label" for="BdsFromDate">From<span class="req">*</span></label>
                  <input type="date" id="BdsFromDate" name="BdsFromDate" class="form-control" [min]="minDate" [(ngModel)]="f.bdsFromDate" />
                </div>
                <div class="col-sm-4">
                  <label class="form-label" for="BdsToDate">To<span class="req">*</span></label>
                  <input type="date" id="BdsToDate" name="BdsToDate" class="form-control" [min]="f.bdsFromDate || minDate" [(ngModel)]="f.bdsToDate" />
                </div>
              </div>
              @if (f.milestone === 1) {
                <div class="row mb-3">
                  <div class="col-sm-4"><div class="stage">Handholding Action Plan</div></div>
                  <div class="col-sm-4">
                    <label class="form-label" for="HapFromDate">From<span class="req">*</span></label>
                    <input type="date" id="HapFromDate" name="HapFromDate" class="form-control" [min]="minDate" [(ngModel)]="f.hapFromDate" />
                  </div>
                  <div class="col-sm-4">
                    <label class="form-label" for="HapToDate">To<span class="req">*</span></label>
                    <input type="date" id="HapToDate" name="HapToDate" class="form-control" [min]="f.hapFromDate || minDate" [(ngModel)]="f.hapToDate" />
                  </div>
                </div>
              }
              <div class="row">
                <div class="col-sm-4"><div class="stage">Consultancy Team</div></div>
                <div class="col-sm-8">
                  <label class="form-label" for="LeadConsultant">Lead Consultant<span class="req">*</span></label>
                  <select id="LeadConsultant" name="LeadConsultant" class="form-select mb-3" [(ngModel)]="f.leadConsultantId" (ngModelChange)="leadChanged(f)">
                    <option value="">--Select--</option>
                    @for (a of consultants(); track a.userId) {
                      <option [value]="a.userId">{{ a.userName }}</option>
                    }
                  </select>
                  <fieldset class="mb-3">
                    <legend class="form-label fs-6 mb-1">Co-consultant(s)</legend>
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
                    <legend class="form-label fs-6 mb-1">Technical Expert(s)</legend>
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
                <div class="alert alert-danger mt-2 mb-0" role="alert">{{ formError() }}</div>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-light" (click)="close()">Cancel</button>
              <button type="button" class="btn btn-primary submit" [disabled]="busy()" (click)="allot(f)">Allot</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (rejectFor(); as r) {
      <zed-confirm-dialog [ask]="rejectAsk(r)" [busy]="busy()" [failed]="formError()" inputId="ReasonForRejection"
                          (confirmed)="reject(r, $event)" (cancel)="rejectFor.set(null)" />
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
    .co-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 14px; margin-bottom: 14px; }
    .co-q { flex: 1 1 260px; max-width: 420px; }
    .unit { min-width: 200px; }
    .co-id { display: block; font-size: 12.5px; font-weight: 700; }
    .co-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .consultants > div + div { margin-top: 6px; }
    .consultants .muted { font-size: 12px; color: #7a8a8b; }
    tr.co-flag > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    .co-act { min-width: 82px; margin-right: 6px; font-weight: 600; }
    .co-act.re-allot { background: #fff1d6; border-color: #fff1d6; color: #7a4700; }
    .co-act.re-allot:hover { background: #ffe6b5; }
    .co-pop { border: 0; border-radius: 12px; }
    .co-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .co-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
    .stage { background: #eef6f6; color: #23474a; font-weight: 600; border-radius: 8px; padding: 8px 10px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class CoAllotmentPage {
  private readonly api = inject(SiteAssessmentApi);
  private readonly toast = inject(ToastService);
  protected readonly crumbs = staffCrumbs({ label: 'Allot Consultancy' });
  protected readonly maskEmail = maskEmail;
  protected readonly maskMobile = maskMobile;
  protected readonly str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  protected readonly menu: RowMenuItem[] = [{ key: 'reject', label: 'Reject', danger: true }];

  protected readonly units = signal<Row[]>([]);
  /** The tile chosen ('waiting' / 'allotted' / 'rejected'; null: every unit) and the milestone chip ('' all). */
  protected readonly stage = signal<string | null>(null);
  protected readonly milestone = signal('');
  private readonly stageOf = (r: Row) => (r['SiteAssessorId'] ? 'allotted' : r['ReasonForRejection'] ? 'rejected' : 'waiting');
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.units();
    const by = (k: string) => rows.filter((r) => this.stageOf(r) === k).length;
    return [
      { key: 'all', label: 'All milestones', value: rows.length },
      { key: 'waiting', label: 'Waiting for allotment', value: by('waiting'), tone: 'warn' },
      { key: 'allotted', label: 'Allotted', value: by('allotted'), tone: 'good' },
      { key: 'rejected', label: 'Rejected', value: by('rejected'), tone: 'bad' },
    ];
  });
  protected readonly milestoneChips = computed<FilterChip[]>(() => {
    const rows = this.units();
    return [{ key: '', label: 'All', count: rows.length },
      ...['1', '2', '3'].map((m) => ({ key: m, label: 'Milestone ' + m, count: rows.filter((r) => String(r['NcCount'] ?? '') === m).length }))];
  });
  /** The search box above the list (any column). Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly search = signal('');
  private readonly shown = computed(() => {
    const stage = this.stage();
    const m = this.milestone();
    return this.units().filter((r) => (!stage || this.stageOf(r) === stage) && (!m || String(r['NcCount'] ?? '') === m));
  });
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));
  protected readonly consultants = signal<Assessor[]>([]);
  protected readonly experts = signal<Assessor[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly form = signal<CoForm | null>(null);
  protected readonly rejectFor = signal<Row | null>(null);
  protected readonly minDate = todayIso();
  protected readonly coCandidates = (leadId: string) => this.consultants().filter((a) => a.userId !== leadId);

  constructor() {
    void this.load();
  }

  /** A tile filters the list; "All milestones" (or the chosen tile again) shows every one. */
  protected pickStage(key: string | undefined): void {
    this.stage.set(!key || key === 'all' || key === this.stage() ? null : key);
  }

  protected act(s: Row, key: string): void {
    if (key === 'reject') this.openReject(s);
  }

  protected rejectAsk(s: Row): ConfirmAsk {
    return {
      title: 'Reject unit?',
      message: `${this.str(s['ZedId'])} (${this.str(s['Certification'])}, Milestone ${this.str(s['NcCount'])}) goes back to the ZED team with your reason.`,
      confirmLabel: 'Reject',
      danger: true,
      reason: { label: 'Reason for rejection', maxLength: 100, requiredMessage: 'Please enter the reason for rejection.' },
    };
  }

  protected stageLabel(milestone: number): string {
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
    this.formError.set('');
    this.rejectFor.set(unit);
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
      const lead = this.consultants().find((a) => a.userId === f.leadConsultantId)?.userName;
      this.toast.success(`${f.unit['ZedId']} allotted`, lead ? `Lead consultant: ${lead}.` : null);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }

  protected async reject(unit: Row, reason: string): Promise<void> {
    if (!reason.trim()) {
      this.formError.set('Please enter the reason for rejection.');
      return;
    }
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(this.api.coReject(String(unit['ZedId']), String(unit['Certification']), reason.trim()));
      this.rejectFor.set(null);
      this.toast.success(`${unit['ZedId']} rejected`);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
