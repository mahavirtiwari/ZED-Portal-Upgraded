import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Assessor, ONSITE, REMOTE, Row, SITE_SYSTEM, SiteAssessmentApi, isWebLink, todayIso } from './site-assessment.api';
import { CoAllotmentPage } from './co-allotment';
import { PagedView, PagerComponent, searchRows } from '../pager';
import { mayAssess } from '../users/assessor-scope';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { ChipFilter, FilterChip } from '../chip-filter';
import { ToastService } from '../toast';
import { maskEmail, maskMobile } from '../users/user-display';

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
 * <p>2026-11-17 (approved staff redesign, "same look"): the page head, the counts as tiles that filter the list, the mode as
 * chips, one search box, the SPOC's mobile and e-mail masked, Allot / Re-allot on the row, a toast when done.</p>
 */
@Component({
  selector: 'zed-staff-sa-allotment',
  imports: [FormsModule, CoAllotmentPage, PagerComponent, PageHead, ListCounts, ChipFilter],
  host: { class: 'list-v2 d-block' },
  template: `
    @if (system === 'consultancy') {
      <zed-staff-co-allotment />
    } @else {
    <zed-page-head [crumbs]="crumbs" [title]="pageTitle" [subtitle]="subtitle">
      <button type="button" class="btn btn-ph" (click)="load()">Refresh</button>
    </zed-page-head>
    <zed-list-counts [counts]="counts()" [selected]="stage() ?? 'all'" label="Units by status" (pick)="pickStage($event.key)" />

    <div class="zed-card sa-filters">
      <input type="search" id="sa-allot-search" class="form-control sa-q" maxlength="50" placeholder="Search ZED ID, unit, SPOC or assessor"
             aria-label="Search ZED ID, unit, SPOC or assessor" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <zed-chip-filter label="Mode" [chips]="modeChips()" [value]="mode()" (valueChange)="mode.set($event)" />
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
            <th>Level</th>
            <th>Unit SPOC</th>
            @if (surveillance) { <th>Surveillance Date</th> }
            <th>Mode</th>
            <th>Assessors</th>
            <th>Status</th>
            <th class="text-end">Action</th>
          </tr>
        </thead>
        <tbody>
          @for (s of view.page(); track s['ZedId'] + '|' + s['Certification']) {
            <tr>
              <td class="unit unit-cell">
                <b>{{ s['PUnitName'] }}</b>
                <span class="dash-text-clr sa-id">{{ s['ZedId'] }}</span>
                <small class="sa-addr" [title]="s['UnitAddress'] ?? ''">{{ s['UnitAddress'] }}</small>
              </td>
              <td>
                <span [class]="'lv-tag lv-' + lc(s['Certification'])">{{ s['Certification'] }}</span>
                @if (surveillance && s['SurveillanceNo']) { <span class="sub">{{ s['SurveillanceNo'] }}</span> }
              </td>
              <!-- Masked in the list; the MSME profile has the full values. -->
              <td><b>{{ s['UnitSpocName'] }}</b><span class="sub">{{ maskMobile(str(s['UnitSpocMobileNo'])) }}</span><span class="sub">{{ maskEmail(str(s['UnitSpocEmailId'])) }}</span></td>
              @if (surveillance) { <td class="text-nowrap">{{ s['AssessmentDate'] }}</td> }
              <td>@if (modeOf(s); as m) { <span class="chip is-info">{{ m }}</span> }</td>
              <td class="stack">
                <div><span class="muted">{{ s['SiteAssessorId'] }}</span> <strong>{{ s['SaAssessorName'] }}</strong></div>
                @if (surveillance) {
                  <div><span class="muted">{{ s['CoAssessorId'] }}</span> <strong>{{ s['CoAssessorName'] }}</strong></div>
                } @else if (s['CoAssessorName']) {
                  <div><strong>{{ s['CoAssessorName'] }}</strong></div>
                }
              </td>
              <td>
                @if (s['SiteAssessorId']) { <span class="chip is-good">Allotted</span> }
                @else if (s['ReasonForRejection']) { <span class="chip is-bad">Rejected</span> }
                @else { <span class="chip is-warn">Waiting</span> }
              </td>
              <td class="text-end text-nowrap">
                @if (s['SiteAssessorId']) {
                  <button type="button" class="btn sa-act re-allot" (click)="open(s)">Re-allot</button>
                } @else if (!s['ReasonForRejection']) {
                  <button type="button" class="btn btn-primary sa-act" (click)="open(s)">Allot</button>
                }
              </td>
            </tr>
          } @empty {
            <tr>
              <td [attr.colspan]="surveillance ? 8 : 7" style="padding: 0px"><div class="no-data">{{ busy() ? 'Loading…' : 'No Data' }}</div></td>
            </tr>
          }
        </tbody>
      </table>
    </div>
    <zed-pager [pager]="view" />
    </div>

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="allot-title" (click)="close()">
        <div class="modal-dialog modal-dialog-centered" (click)="$event.stopPropagation()">
          <div class="modal-content sa-pop">
            <div class="modal-header justify-content-between">
              <div>
                <h3 class="sa-pop-title" id="allot-title">{{ f.unit['SiteAssessorId'] ? 'Re-allot unit' : 'Allot unit' }}</h3>
                <p class="sa-pop-sub">{{ f.unit['ZedId'] }} · {{ f.unit['Certification'] }}@if (f.unit['PUnitName']) { · {{ f.unit['PUnitName'] }} }</p>
              </div>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            <div class="modal-body">
              <div class="mb-3">
                <label class="form-label" for="FinalSaDate">{{ surveillance ? 'Surveillance Assessment Date' : 'Assessment Date' }}<span class="req">*</span></label>
                <input type="date" id="FinalSaDate" name="FinalSaDate" class="form-control" [min]="minDate" [(ngModel)]="f.assessmentDate" />
              </div>
              <div class="mb-3">
                <label class="form-label" for="ModeOfAssessment">Mode of Assessment<span class="req">*</span></label>
                <select id="ModeOfAssessment" name="ModeOfAssessment" class="form-select" [(ngModel)]="f.modeOfAssessment">
                  <option value="">--Select--</option>
                  <!-- Surveillance stores Onsite but the assessment runs on the meeting link (the old page showed "Remote Assessment"). -->
                  <!-- 2026-11-14: a main unit whose level is assessed remotely (Desktop + Remote, Remote only) is allotted Remote. -->
                  @if (remoteUnit(f.unit)) {
                    <option [value]="remote">Remote Assessment</option>
                  } @else {
                    <option [value]="onsite">{{ surveillance && !onsiteVisit(f.unit) ? 'Remote Assessment' : 'Onsite Assessment' }}</option>
                  }
                </select>
              </div>
              @if (needsLink(f.unit)) {
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
              <button type="button" class="btn btn-light" (click)="close()">Cancel</button>
              <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="allot(f)">Allot</button>
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
    .sa-filters { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 16px; padding: 12px 14px; margin-bottom: 14px; }
    .sa-q { flex: 1 1 260px; max-width: 420px; }
    .unit { min-width: 200px; }
    .sa-id { display: block; font-size: 12.5px; font-weight: 700; }
    .sa-addr { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 260px; }
    .stack > div + div { margin-top: 6px; }
    .sa-act { min-width: 82px; font-weight: 600; }
    .sa-act.re-allot { background: #fff1d6; border-color: #fff1d6; color: #7a4700; }
    .sa-act.re-allot:hover { background: #ffe6b5; }
    .sa-pop { border: 0; border-radius: 12px; }
    .sa-pop-title { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .sa-pop-sub { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
    .original { background: #eef6f6; border-radius: 10px; padding: 10px 12px; display: grid; gap: 4px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SaAllotmentPage {
  private readonly api = inject(SiteAssessmentApi);
  private readonly toast = inject(ToastService);
  protected readonly system = inject(SITE_SYSTEM);
  protected readonly surveillance = this.system === 'surveillance';
  protected readonly maskEmail = maskEmail;
  protected readonly maskMobile = maskMobile;
  protected readonly str = (v: unknown) => (v === null || v === undefined ? '' : String(v));

  protected readonly units = signal<Row[]>([]);
  /** The tile chosen ('waiting' / 'allotted' / 'rejected'; null: every unit) and the mode chip ('' all). */
  protected readonly stage = signal<string | null>(null);
  protected readonly mode = signal('');
  /** The search box above the list (any column). Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly search = signal('');
  private readonly shown = computed(() => {
    const stage = this.stage();
    const mode = this.mode();
    return this.units().filter((r) => (!stage || this.stageOf(r) === stage) && (!mode || this.modeOf(r) === mode));
  });
  protected readonly view = new PagedView(() => searchRows(this.shown(), this.search()));
  protected readonly assessors = signal<Assessor[]>([]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  protected readonly form = signal<AllotForm | null>(null);
  protected readonly onsite = ONSITE;
  protected readonly remote = REMOTE;

  protected readonly pageTitle = this.surveillance ? 'Allot Surveillance Assessments (Site)' : 'Allot SA Assessments';
  protected readonly crumbs = staffCrumbs({ label: this.pageTitle });
  protected readonly subtitle = this.surveillance
    ? 'Allot the surveillance assessments to your assessors with the date and the meeting link, or re-allot them.'
    : 'Allot the site assessments to your assessors with the date and the mode, or re-allot them.';

  /** Allotted, rejected or waiting (the status chip of the row). */
  private stageOf(r: Row): string {
    return r['SiteAssessorId'] ? 'allotted' : r['ReasonForRejection'] ? 'rejected' : 'waiting';
  }

  /** A tile filters the list; "All units" (or the chosen tile again) shows every unit. */
  protected pickStage(key: string | undefined): void {
    this.stage.set(!key || key === 'all' || key === this.stage() ? null : key);
  }

  protected lc(v: unknown): string {
    return String(v ?? '').toLowerCase();
  }

  /** The unit's mode for the list: surveillance Onsite / Remote, a main unit's flow (Remote) or its allotted mode. */
  protected modeOf(s: Row): string {
    if (this.surveillance) return s['AssessmentMode'] === 'Onsite' ? 'Onsite' : 'Remote';
    if (s['AssessmentMode'] === 'Remote') return 'Remote';
    const m = String(s['ModeOfAssessment'] ?? '');
    return m === 'Remote Assessment' ? 'Remote' : m === 'Onsite Assessment' ? 'Onsite' : '';
  }

  protected readonly counts = computed<ListCount[]>(() => {
    const rows = this.units();
    const by = (k: string) => rows.filter((r) => this.stageOf(r) === k).length;
    return [
      { key: 'all', label: 'All units', value: rows.length },
      { key: 'waiting', label: 'Waiting for allotment', value: by('waiting'), tone: 'warn' },
      { key: 'allotted', label: 'Allotted', value: by('allotted'), tone: 'good' },
      { key: 'rejected', label: 'Rejected', value: by('rejected'), tone: 'bad' },
    ];
  });

  /** The units by mode (Onsite / Remote), as chips. */
  protected readonly modeChips = computed<FilterChip[]>(() => {
    const rows = this.units();
    return [
      { key: '', label: 'All', count: rows.length },
      { key: 'Onsite', label: 'Onsite', count: rows.filter((r) => this.modeOf(r) === 'Onsite').length },
      { key: 'Remote', label: 'Remote', count: rows.filter((r) => this.modeOf(r) === 'Remote').length },
    ];
  });

  /** 2026-11-14: a main unit whose level's flow is remote (the server sends AssessmentMode). */
  protected remoteUnit(unit: Row): boolean {
    return !this.surveillance && unit['AssessmentMode'] === 'Remote';
  }

  /** 2026-11-14 (Onsite surveillance): a surveillance unit whose level is surveilled by an onsite visit. */
  protected onsiteVisit(unit: Row): boolean {
    return this.surveillance && unit['AssessmentMode'] === 'Onsite';
  }

  /** Surveillance (except an onsite visit) and main remote assessments are held on a meeting link. */
  protected needsLink(unit: Row): boolean {
    return (this.surveillance && !this.onsiteVisit(unit)) || this.remoteUnit(unit);
  }
  protected readonly minDate = todayIso();
  /** V4: only assessors who assess the unit's kind (Manufacturing / Services; not set = no limit). */
  protected assessorsFor(unit: Row): Assessor[] {
    const category = unit['SectorCategory'];
    const level = String(unit['Certification'] ?? '');
    // 2026-11-14: only assessors ticked for the unit's level in its mode (remote or onsite).
    return this.assessors().filter((a) => (!category || !a.sectorActivity || a.sectorActivity === 'Both' || a.sectorActivity === category)
      // A meeting-link surveillance keeps today's list (no mode to tick for it).
      && (this.surveillance && !this.onsiteVisit(unit) ? true : mayAssess(a, level, this.remoteUnit(unit) ? 'Remote' : 'Onsite')));
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
    this.formError.set('');
    const value = (column: string) => (unit[column] === null || unit[column] === undefined ? '' : String(unit[column]));
    this.form.set({
      unit,
      assessmentDate: '',
      modeOfAssessment: this.surveillance ? ONSITE : this.remoteUnit(unit) ? REMOTE : '',
      siteAssessorId: value('SiteAssessorId'),
      coAssessorId: '',
      meetingLink: this.needsLink(unit) ? value('MeetingLink') : '',
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
    if (this.needsLink(f.unit) && !isWebLink(f.meetingLink)) {
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
          ...(this.needsLink(f.unit) ? { meetingLink: f.meetingLink.trim() } : {}),
        }),
      );
      this.form.set(null);
      const to = this.assessors().find((a) => a.userId === f.siteAssessorId)?.userName;
      this.toast.success(`${f.unit['ZedId']} allotted`, to ? `To ${to}.` : null);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
      return;
    } finally {
      this.busy.set(false);
    }
    await this.load();
  }
}
