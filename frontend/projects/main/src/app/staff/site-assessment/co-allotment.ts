import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Router, RouterLink } from '@angular/router';
import { Assessor, Row, SiteAssessmentApi, milestoneReviewLink, todayIso } from './site-assessment.api';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { TextPipe, t } from '../../content/page-text';

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
export function stageLabel(milestone: number): string {
  switch (milestone) {
    case 2: return t('staff.coAllotment.stage.review1.label', 'Progress Review 1');
    case 3: return t('staff.coAllotment.stage.review2.label', 'Progress Review 2');
    default: return t('staff.coAllotment.stage.bds.label', 'Baseline Diagnostic Study');
  }
}

/**
 * "Allot Consultancy" of a Consultant Organisation (consultancy build). Port of the consultancy
 * Views/Assessment/SaAllotment.cshtml: ACCEPT / RE-ALLOT a unit's milestone with the lead consultant, co-consultants,
 * technical experts, BDS dates and (milestone 1) HAP dates; REJECT with a reason. Multi-selects are plain checkbox
 * lists (no select2); the lead is never offered as a co-consultant.
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, the
 * milestone as chips, one search box, the SPOC's mobile and e-mail in full (2026-11-18, the user), Accept / Re-allot on the row and Reject in its
 * menu (the reason in the confirmation pop-up), a toast when done.</p>
 */
@Component({
  selector: 'zed-staff-co-allotment',
  imports: [FormsModule, PagerComponent, PageHead, ListCounts, ChipFilter, RowMenu, ConfirmDialog, RouterLink, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="'Allot Consultancy' | t: 'staff.coAllotment.title'"
                   [subtitle]="'Accept the milestones allotted to your organisation and choose the consultancy team and the visit dates, or reject them.' | t: 'staff.coAllotment.sub'">
      <button type="button" class="btn btn-ph" (click)="load()">{{ 'Refresh' | t: 'staff.coAllotment.refreshButton' }}</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" [label]="'Milestones by status' | t: 'staff.coAllotment.counts.aria'" (pick)="pickStage($event.key)" />

    <div class="zed-card co-filters">
      <input type="search" id="co-allot-search" class="form-control co-q" maxlength="50" [placeholder]="'Search ZED ID, unit, SPOC or consultant' | t: 'staff.coAllotment.search.placeholder'"
             [attr.aria-label]="'Search ZED ID, unit, SPOC or consultant' | t: 'staff.coAllotment.search.placeholder'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <zed-chip-filter [label]="'Milestone' | t: 'staff.coAllotment.milestone.label'" [chips]="milestoneChips()" [value]="milestone()" (valueChange)="milestone.set($event)" />
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          <tr>
            <th>{{ 'Unit' | t: 'staff.coAllotment.column.unit' }}</th>
            <th>{{ 'Desired level' | t: 'staff.coAllotment.column.level' }}</th>
            <th>{{ 'Milestone' | t: 'staff.coAllotment.column.milestone' }}</th>
            <th>{{ 'Unit SPOC' | t: 'staff.coAllotment.column.spoc' }}</th>
            <th>{{ 'Consultants' | t: 'staff.coAllotment.column.consultants' }}</th>
            <th>{{ 'Status' | t: 'staff.coAllotment.column.status' }}</th>
            <th class="text-end">{{ 'Actions' | t: 'staff.coAllotment.column.actions' }}</th>
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
              <td><span class="chip is-info">{{ 'Milestone {number}' | t: 'staff.coAllotment.row.milestone.chip' : { number: s['NcCount'] } }}</span></td>
              <!-- Masked in the list; the MSME profile has the full values. -->
              <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ str(s['UnitSpocMobileNo']) }}</span><span class="sub mail-cut" [title]="str(s['UnitSpocEmailId'])">{{ str(s['UnitSpocEmailId']) }}</span></td>
              <!-- As the old page: the lead, the co-consultants and the technical experts, each id over its names. -->
              <td class="consultants">
                <div><div class="muted">{{ s['SiteAssessorId'] }}</div>{{ s['SaAssessorName'] }}</div>
                <div><div class="muted">{{ s['CoAssessorId'] }}</div>{{ s['CoConsultantNames'] }}</div>
                <div><div class="muted">{{ s['TechExpert'] }}</div>{{ s['TechnicalExpertNames'] }}</div>
              </td>
              <td>
                @if (s['SiteAssessorId']) { <span class="chip is-good">{{ 'Allotted' | t: 'staff.coAllotment.status.allotted.chip' }}</span> }
                @else if (s['ReasonForRejection']) { <span class="chip is-bad" [title]="str(s['ReasonForRejection'])">{{ 'Rejected' | t: 'staff.coAllotment.status.rejected.chip' }}</span> }
                @else { <span class="chip is-warn">{{ 'Waiting' | t: 'staff.coAllotment.status.waiting.chip' }}</span> }
              </td>
              <td class="text-end text-nowrap">
                @if (s['SiteAssessorId']) {
                  <button type="button" class="btn co-act re-allot allot" (click)="open(s)">{{ 'Re-allot' | t: 'staff.coAllotment.reallotButton' }}</button>
                } @else if (!s['ReasonForRejection']) {
                  <button type="button" class="btn btn-primary co-act allot" (click)="open(s)">{{ 'Accept' | t: 'staff.coAllotment.acceptButton' }}</button>
                }
                <!-- 2026-11-18 (the user: "accept, reject, view details and other option similar to combination one"). -->
                <a class="btn btn-outline-primary co-act co-view" [routerLink]="detailsLink(s)">{{ 'View details' | t: 'staff.coAllotment.viewDetailsButton' }}</a>
                <zed-row-menu [items]="menu(s)" [label]="'More actions for {zedId}' | t: 'staff.coAllotment.row.menuAria' : { zedId: s['ZedId'] }" (picked)="act(s, $event)" />
              </td>
            </tr>
          } @empty {
            <tr>
              <td colspan="7" style="padding: 0px"><div class="no-data">{{ busy() ? ('Loading…' | t: 'staff.coAllotment.loading.text') : ('No unit to show. Units waiting for consultants, and those you have allotted, are listed here.' | t: 'staff.coAllotment.empty') }}</div></td>
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
                <h3 class="co-pop-title" id="co-allot-title">{{ f.unit['SiteAssessorId'] ? ('Re-allot unit' | t: 'staff.coAllotment.dialog.reallotTitle') : ('Allot unit' | t: 'staff.coAllotment.dialog.allotTitle') }}</h3>
                <p class="co-pop-sub">{{ f.unit['ZedId'] }} · {{ '{level}, Milestone {number}' | t: 'staff.coAllotment.dialog.unit.sub' : { level: f.unit['Certification'], number: f.milestone } }}@if (f.unit['PUnitName']) { · {{ f.unit['PUnitName'] }} }</p>
              </div>
              <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.coAllotment.dialog.closeAria'" (click)="close()"></button>
            </div>
            <div class="modal-body">
              <div class="row mb-3">
                <div class="col-sm-4"><div class="stage">{{ stageLabel(f.milestone) }}</div></div>
                <div class="col-sm-4">
                  <label class="form-label" for="BdsFromDate">{{ 'From' | t: 'staff.coAllotment.dialog.from.label' }}<span class="req">*</span></label>
                  <input type="date" id="BdsFromDate" name="BdsFromDate" class="form-control" [min]="minDate" [(ngModel)]="f.bdsFromDate" />
                </div>
                <div class="col-sm-4">
                  <label class="form-label" for="BdsToDate">{{ 'To' | t: 'staff.coAllotment.dialog.to.label' }}<span class="req">*</span></label>
                  <input type="date" id="BdsToDate" name="BdsToDate" class="form-control" [min]="f.bdsFromDate || minDate" [(ngModel)]="f.bdsToDate" />
                </div>
              </div>
              @if (f.milestone === 1) {
                <div class="row mb-3">
                  <div class="col-sm-4"><div class="stage">{{ 'Handholding Action Plan' | t: 'staff.coAllotment.stage.hap.label' }}</div></div>
                  <div class="col-sm-4">
                    <label class="form-label" for="HapFromDate">{{ 'From' | t: 'staff.coAllotment.dialog.from.label' }}<span class="req">*</span></label>
                    <input type="date" id="HapFromDate" name="HapFromDate" class="form-control" [min]="minDate" [(ngModel)]="f.hapFromDate" />
                  </div>
                  <div class="col-sm-4">
                    <label class="form-label" for="HapToDate">{{ 'To' | t: 'staff.coAllotment.dialog.to.label' }}<span class="req">*</span></label>
                    <input type="date" id="HapToDate" name="HapToDate" class="form-control" [min]="f.hapFromDate || minDate" [(ngModel)]="f.hapToDate" />
                  </div>
                </div>
              }
              <div class="row">
                <div class="col-sm-4"><div class="stage">{{ 'Consultancy Team' | t: 'staff.coAllotment.dialog.team.label' }}</div></div>
                <div class="col-sm-8">
                  <label class="form-label" for="LeadConsultant">{{ 'Lead Consultant' | t: 'staff.coAllotment.dialog.lead.label' }}<span class="req">*</span></label>
                  <select id="LeadConsultant" name="LeadConsultant" class="form-select mb-3" [(ngModel)]="f.leadConsultantId" (ngModelChange)="leadChanged(f)">
                    <option value="">{{ '--Select--' | t: 'staff.coAllotment.dialog.selectLabel' }}</option>
                    @for (a of consultants(); track a.userId) {
                      <option [value]="a.userId">{{ a.userName }}</option>
                    }
                  </select>
                  <fieldset class="mb-3">
                    <legend class="form-label fs-6 mb-1">{{ 'Co-consultant(s)' | t: 'staff.coAllotment.dialog.co.label' }}</legend>
                    @for (a of coCandidates(f.leadConsultantId); track a.userId) {
                      <div class="form-check">
                        <input type="checkbox" class="form-check-input co" [id]="'co-' + a.userId" [checked]="f.coConsultantIds.includes(a.userId)" (change)="toggle(f.coConsultantIds, a.userId)" />
                        <label class="form-check-label" [for]="'co-' + a.userId">{{ a.userName }} ({{ a.userId }})</label>
                      </div>
                    } @empty {
                      <small class="text-muted">{{ 'No other consultants.' | t: 'staff.coAllotment.dialog.co.empty' }}</small>
                    }
                  </fieldset>
                  <fieldset>
                    <legend class="form-label fs-6 mb-1">{{ 'Technical Expert(s)' | t: 'staff.coAllotment.dialog.experts.label' }}</legend>
                    @for (a of experts(); track a.userId) {
                      <div class="form-check">
                        <input type="checkbox" class="form-check-input expert" [id]="'te-' + a.userId" [checked]="f.technicalExpertIds.includes(a.userId)" (change)="toggle(f.technicalExpertIds, a.userId)" />
                        <label class="form-check-label" [for]="'te-' + a.userId">{{ a.userName }} ({{ a.userId }})</label>
                      </div>
                    } @empty {
                      <small class="text-muted">{{ 'No technical experts.' | t: 'staff.coAllotment.dialog.experts.empty' }}</small>
                    }
                  </fieldset>
                </div>
              </div>
              @if (formError()) {
                <div class="alert alert-danger mt-2 mb-0" role="alert">{{ formError() }}</div>
              }
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-light" (click)="close()">{{ 'Cancel' | t: 'staff.coAllotment.dialog.cancelButton' }}</button>
              <button type="button" class="btn btn-primary submit" [disabled]="busy()" (click)="allot(f)">{{ 'Allot' | t: 'staff.coAllotment.dialog.allotButton' }}</button>
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
          <div><small>{{ 'Please wait ...' | t: 'staff.coAllotment.wait.text' }}</small></div>
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
    .co-act.co-view { min-width: 0; }
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
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.coAllotment.title', 'Allot Consultancy') }));
  protected readonly str = (v: unknown) => (v === null || v === undefined ? '' : String(v));
  private readonly router = inject(Router);

  /** The milestone review page of the unit (Consultancy's assessment details; read-only for the CO before it allots). */
  protected detailsLink(s: Row): string {
    return milestoneReviewLink(this.str(s['ZedId']), this.str(s['Certification']), this.str(s['NcCount']));
  }

  /** The row menu: the details, the profile, and Reject (before the first allotment, once). */
  protected menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [
      { key: 'details', label: t('staff.coAllotment.menu.details.label', 'View details'), icon: 'eye' },
      { key: 'profile', label: t('staff.coAllotment.menu.profile.label', 'View MSME profile'), icon: 'people' },
    ];
    if (!s['SiteAssessorId'] && !s['ReasonForRejection']) items.push({ key: 'reject', label: t('staff.coAllotment.menu.reject.label', 'Reject'), danger: true });
    return items;
  }

  protected readonly units = signal<Row[]>([]);
  /** The tile chosen ('waiting' / 'allotted' / 'rejected'; null: every unit) and the milestone chip ('' all). */
  protected readonly stage = signal<string | null>(null);
  protected readonly milestone = signal('');
  private readonly stageOf = (r: Row) => (r['SiteAssessorId'] ? 'allotted' : r['ReasonForRejection'] ? 'rejected' : 'waiting');
  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.units();
    const by = (k: string) => rows.filter((r) => this.stageOf(r) === k).length;
    return [
      { key: 'all', label: t('staff.coAllotment.count.all.label', 'All milestones'), value: rows.length },
      { key: 'waiting', label: t('staff.coAllotment.count.waiting.label', 'Waiting for allotment'), value: by('waiting'), tone: 'warn' },
      { key: 'allotted', label: t('staff.coAllotment.count.allotted.label', 'Allotted'), value: by('allotted'), tone: 'good' },
      { key: 'rejected', label: t('staff.coAllotment.count.rejected.label', 'Rejected'), value: by('rejected'), tone: 'bad' },
    ];
  });
  protected readonly milestoneChips = computed<FilterChip[]>(() => {
    const rows = this.units();
    return [{ key: '', label: t('staff.coAllotment.milestone.all.chip', 'All'), count: rows.length },
      ...['1', '2', '3'].map((m) => ({ key: m, label: t('staff.coAllotment.milestone.chip', 'Milestone {number}', { number: m }), count: rows.filter((r) => String(r['NcCount'] ?? '') === m).length }))];
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
    if (key === 'details') void this.router.navigateByUrl(this.detailsLink(s));
    else if (key === 'profile') void this.router.navigateByUrl(`/staff/msme-profile/${encodeURIComponent(this.str(s['ZedId']))}`);
    else if (key === 'reject') this.openReject(s);
  }

  protected rejectAsk(s: Row): ConfirmAsk {
    return {
      title: t('staff.coAllotment.reject.title', 'Reject unit?'),
      message: t('staff.coAllotment.reject.message', '{zedId} ({level}, Milestone {number}) goes back to the ZED team with your reason.',
        { zedId: this.str(s['ZedId']), level: this.str(s['Certification']), number: this.str(s['NcCount']) }),
      confirmLabel: t('staff.coAllotment.reject.confirmButton', 'Reject'),
      danger: true,
      reason: { label: t('staff.coAllotment.reject.reasonLabel', 'Reason for rejection'), maxLength: 100,
        requiredMessage: t('staff.coAllotment.reject.reasonRequired.message', 'Please enter the reason for rejection.') },
    };
  }

  protected readonly stageLabel = stageLabel;

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
      this.formError.set(t('staff.coAllotment.dialog.required.error', 'Please select required data.'));
      return;
    }
    if (f.bdsToDate < f.bdsFromDate || (hap && f.hapToDate < f.hapFromDate)) {
      this.formError.set(t('staff.coAllotment.dialog.dates.error', 'The To date cannot be before the From date.'));
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
      this.toast.success(t('staff.coAllotment.toast.allotted', '{zedId} allotted', { zedId: f.unit['ZedId'] }),
        lead ? t('staff.coAllotment.toast.allottedLead', 'Lead consultant: {name}.', { name: lead }) : null);
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
      this.formError.set(t('staff.coAllotment.reject.reasonRequired.message', 'Please enter the reason for rejection.'));
      return;
    }
    this.busy.set(true);
    this.formError.set('');
    try {
      await firstValueFrom(this.api.coReject(String(unit['ZedId']), String(unit['Certification']), reason.trim()));
      this.rejectFor.set(null);
      this.toast.success(t('staff.coAllotment.toast.rejected', '{zedId} rejected', { zedId: unit['ZedId'] }));
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
