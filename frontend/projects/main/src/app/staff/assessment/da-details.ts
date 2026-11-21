import { HttpErrorResponse } from '@angular/common/http';
import { SamePanUnits } from '../msme-profile/same-pan';
import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { AuthService as QoAuth } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
import { ReviewActionsBar, ReviewRemarksDialog, RemarksTarget } from '../monitoring/review-actions';
import { NO_REVIEW, RemarksKind } from '../monitoring/review.api';
import { AppFormValuesPanel } from './app-form-values';
import { FormChecksPanel } from './form-checks';
import { CHECKPOINT_CHIP_STYLES, Checkpoint, CheckpointDialog, CheckpointSaveRequest, CheckpointValue, checkpointsOf } from './checkpoint-dialog';
import { ASSESSMENT_SYSTEM, DETAILS_STYLES, flag, num, text } from './assessment-shared';
import { AssessmentApi, DaDetails, FinalSubmitCheck, NcRound, OpenedType, Row, canonicalLevel, isZedId } from './assessment.api';
import { RequirementVideo } from '../../msme/shared/requirement-video';
import { ThreadMessage, hasContent, message } from '../../msme/shared/nc-thread';
import { ParameterChip, ParameterNav, ParameterProgress, ParameterStatus, parameterChip, parameterComplete, parameterProgress, parameterStatus, requirementStatus } from '../../msme/shared/parameter-status';
import { Location } from '@angular/common';
import { PageHead } from '../../msme/shared/page-head';
import { QualityObservationsPanel } from '../quality/quality-observations-panel';
import { SubmitChecklist, allTicked } from '../quality/submit-checklist';
import { ChecklistRecords } from '../quality/checklist-records';
import { QoTarget } from '../quality/quality.api';
import { StepTracker } from '../../msme/shared/step-tracker';
import { staffCrumbs } from '../staff-crumbs';
import { UNIT_VIEW_STYLES, desktopStage, ncLines, unitResult } from './da-details.layout';
import { RoundState, TrackItem, aboveCapacity, basicRaised, ncTracker } from './da-details.overview';
import { LevelMedal } from './level-medal';
import { DashIcon } from '../../msme/dashboard/dash-icon';
import { DaAllotmentBanner } from './da-allotment-banner';
import { cleanAddress } from '../address';

/**
 * 2026-11-17 (the user's staff design 14): the tab bar's names. 2026-11-18 (the new staff-14 series): five tabs: the NC 1 … NC 5
 * tabs became one "Non-conformances" tab with a round switcher inside (tab ids 4..8 still name the round shown).
 * 2026-11-19: Admin-editable page wording (Texts → Page wording), so worked out when shown.
 */
export function tabLabel(id: number): string {
  switch (id) {
    case 1: return t('staff.daDetails.tab.overview.label', 'Assessment overview');
    case 2: return t('staff.daDetails.tab.basic.label', 'Basic information');
    case 9: return t('staff.daDetails.tab.esg.label', 'ESG compliance');
    case 3: return t('staff.daDetails.tab.params.label', 'Parameters');
    case 4: return t('staff.daDetails.tab.nc.label', 'Non-conformances');
    default: return '';
  }
}

/** The basic information items of the unit's form (1 to 11; staff-14d numbers them so). */
export const BASIC_ITEMS = 11;

/** Tab ids of the old page: 1 overview, 2 basic info, 9 ESG, 3 parameters, 4..8 NC1..NC5 (the heading above a tab). */
export function tabTitle(id: number): string {
  switch (id) {
    case 1: return t('staff.daDetails.tabTitle.overview.title', 'Assessment Summary');
    case 2: return t('staff.daDetails.tabTitle.basic.title', 'Basic Information');
    case 3: return t('staff.daDetails.tabTitle.params.title', 'Parameters');
    case 9: return t('staff.daDetails.tabTitle.esg.title', 'Esg Compliance');
    default: return id >= 4 && id <= 8 ? t('staff.daDetails.tabTitle.nc.title', 'Non-Conformance(s) {round}', { round: id - 3 }) : '';
  }
}

/** Surveillance's DaDetails.cshtml numbers the tabs in their order: ESG 3, parameters 4, NC n at n + 4. */
const SURVEILLANCE_TAB_NUMBERS: Record<number, number> = { 1: 1, 2: 2, 9: 3, 3: 4, 4: 5, 5: 6, 6: 7, 7: 8, 8: 9 };

const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_FILES = 5;

interface ConformanceEdit { requirement: Row; conformance: string; remarks: string }
interface ValidationEdit { row: Row | null; verified: string; remarks: string }
interface EvidenceEdit { evidence: Row; verified: string; source: string; remarks: string; files: File[] }
interface FinalSubmitEdit { check: FinalSubmitCheck; remarks: string; confirmed: boolean; ticked: string[] }

/** A key fact of the assessment summary card (label above, value below; `sub` grey beside it, e.g. the agency's ID). */
export interface SummaryFact { label: string; value: string; wide?: boolean; sub?: string; medal?: boolean }


/**
 * Desktop assessment review page. Port of Views/Assessment/DaDetails.cshtml for the desktop assessor
 * (validate photos, products, evidences and conformance, exemptions, final submit) and read-only for
 * the other roles of the old page, with the agency / master-admin review actions (edit remarks, final
 * submit, send back, reject: the old Monitoring actions) where the server allows them (`permissions.review`).
 * Bootstrap tabs and modals are signal-controlled markup.
 */
@Component({
  selector: 'zed-staff-da-details',
  imports: [QualityObservationsPanel, ChecklistRecords, SubmitChecklist, FormsModule, NgTemplateOutlet, RouterLink, ReviewActionsBar, ReviewRemarksDialog, ContentTextComponent, AppFormValuesPanel, FormChecksPanel, CheckpointDialog, RequirementVideo, PageHead, SamePanUnits, StepTracker, LevelMedal, DashIcon, DaAllotmentBanner, TextPipe],
  templateUrl: './da-details.html',
  styles: [DETAILS_STYLES, CHECKPOINT_CHIP_STYLES, UNIT_VIEW_STYLES],
  styleUrls: ['./da-details.css', './da-details.params.css', './da-details.basic.css', './da-details.nc.css'],
  host: { '(document:keydown.escape)': 'preview.set(null)' },
})
export class DaDetailsPage {
  /** Route parameters. */
  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();

  private readonly api = inject(AssessmentApi);
  /** Surveillance build: the ESG tab as on that portal's page (S.No column, black panel headings, tab numbers). */
  protected readonly surveillanceSystem = inject(ASSESSMENT_SYSTEM) === 'surveillance';
  protected readonly t = text;
  /** 2026-11-21 (UI audit W8): addresses without their empty parts ("Block:- ,"). */
  protected readonly address = cleanAddress;
  protected readonly f = flag;
  protected readonly n = num;
  protected readonly tabTitle = tabTitle;
  protected readonly tabLabel = tabLabel;
  protected readonly tabNumber = (id: number) => (this.surveillanceSystem ? SURVEILLANCE_TAB_NUMBERS[id] ?? id : id);

  protected readonly data = signal<DaDetails | null>(null);

  // 2026-11-16 (approved): the ZED team's quality observations (panel above the tabs, "+ Observation" on a requirement).
  protected readonly qoAbouts = ['Desktop', 'Agency'];
  protected readonly qoTarget = signal<QoTarget | null>(null);
  private readonly qoAuth = inject(QoAuth);
  /** Only the Master Admin (and its operation admins) raise them; the panel hides what the login may not see. */
  protected readonly qoMaster = computed(() => this.qoAuth.currentUser()?.roleId === 7);
  protected readonly qoTargets = computed<QoTarget[]>(() =>
    (this.data()?.requirements ?? []).map((r) => ({
      type: 'Requirement' as const,
      id: String(r['Id'] ?? ''),
      label: `${r['SectionCode'] ?? ''}.${r['RequirementCode'] ?? ''} ${(r['RequirementName'] as string | undefined) ?? ''}`.trim(),
    })));

  protected observe(r: Record<string, unknown>): void {
    this.qoTarget.set(this.qoTargets().find((t) => t.id === String(r['Id'] ?? '')) ?? null);
  }
  protected readonly loading = signal(false);
  protected readonly error = signal('');
  protected readonly notice = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly tab = signal(1);
  /** Parameter (section Id) shown in the parameters tab; the first one when none is picked. */
  protected readonly selectedSection = signal<string | null>(null);
  protected readonly preview = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly modalError = signal('');

  protected readonly conformanceEdit = signal<ConformanceEdit | null>(null);
  protected readonly checkpointEdit = signal<{ requirement: Row; checkpoints: Checkpoint[]; title: string } | null>(null);
  protected readonly productEdit = signal<ValidationEdit | null>(null);
  protected readonly siteExteriorEdit = signal<ValidationEdit | null>(null);
  protected readonly evidenceEdit = signal<EvidenceEdit | null>(null);
  protected readonly finalSubmitEdit = signal<FinalSubmitEdit | null>(null);

  private request = 0;

  protected readonly level = computed(() => canonicalLevel(this.certification()));
  /** 2026-11-14 (frame A): "Pump Engineers · Bronze" (the ZED ID until the unit is loaded). */
  protected readonly headTitle = computed(() => {
    const d = this.data();
    const unit = text(this.msme(), 'PUnitName') || text(this.msme(), 'ZedId') || d?.zedId || t('staff.daDetails.head.fallbackTitle', 'Assessment details');
    return `${unit} · ${text(this.msme(), 'Certification') || d?.certification || this.level() || ''}`.replace(/ · $/, '');
  });
  /**
   * 2026-11-21 (UI audit C1): Home › Assessment details › the unit (as the browser tab, "Assessment Details"); the desktop
   * assessor, whose menu has Desktop verification, also gets that list before it. Other logins open the page from their own
   * lists (monitoring, completed, ...), so it no longer says "Desktop verification" for them.
   */
  protected readonly headCrumbs = computed(() => staffCrumbs(
    ...(this.data()?.role === 'DesktopAssessor'
      ? [{ label: t('staff.daDetails.crumb.verification', 'Desktop verification'), link: '/staff/assessment/da-verification' }] : []),
    { label: t('staff.daDetails.crumb.details', 'Assessment details') },
    { label: text(this.msme(), 'ZedId') || this.data()?.zedId || t('staff.daDetails.crumb.unit', 'Unit') },
  ));
  /** 2026-11-17 (design 14): the result beside the title, the stage tracker and the NC rounds, from the record's columns. */
  protected readonly result = computed(() => unitResult(this.msme()));
  protected readonly stage = computed(() => desktopStage(this.msme()));
  protected readonly ncList = computed(() => ncLines(this.msme()));
  private readonly location = inject(Location);
  protected goBack(): void {
    this.location.back();
  }
  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly perms = computed(() => this.data()?.permissions ?? { canAssess: false, canFinalSubmit: false, canWithdrawExemption: false, review: NO_REVIEW });
  protected readonly review = computed(() => this.perms().review ?? NO_REVIEW);
  protected readonly remarksTarget = signal<RemarksTarget | null>(null);
  protected readonly isAssessorRole = computed(() => this.data()?.role === 'DesktopAssessor');
  /**
   * 2026-11-18 (the user: "show assessment detail during the allocation in the login of assessment agency"): the agency's
   * unit not yet accepted (the server sends `allotment` only then). The page is a read-only preview of what the applicant
   * submitted: no conformance, verdicts, assessor remarks or buttons; the banner offers Accept / Re-allot and Reject.
   */
  protected readonly allotment = computed(() => this.data()?.allotment ?? null);
  protected readonly previewMode = computed(() => !!this.allotment()?.preview);
  protected readonly isQc = computed(() => this.data()?.role === 'QC');
  protected readonly status = computed(() => num(this.msme(), 'CertificationStatus'));
  protected readonly ncCount = computed(() => num(this.msme(), 'NcCount'));
  /** Round the assessor works on: 0 before the first final submit, else the current NC round. */
  protected readonly currentRound = computed(() => (this.status() === 4 ? this.ncCount() : 0));

  protected readonly selfies = computed(() => (this.data()?.photos ?? []).filter((p) => text(p, 'PhotoType') === 'Selfie'));
  protected readonly siteExterior = computed(() => (this.data()?.photos ?? []).filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos'));
  protected readonly esg = computed(() => (this.data()?.esgCheckList ?? []).filter((r) => text(r, 'CheckListType') === 'ESG'));
  protected readonly social = computed(() => (this.data()?.esgCheckList ?? []).filter((r) => text(r, 'CheckListType') === 'SOCIAL/OHS'));

  /**
   * NC tabs shown on the old page: NC n when NcCount and SecNcCount are at least n. V4: also the current round when it was
   * raised only on App Forms fields found not valid (no section in the round, so SecNcCount stays behind): its tab holds the
   * round's Final Submit.
   */
  protected readonly ncTabs = computed(() => {
    const m = this.msme();
    const current = this.currentRound();
    return (this.data()?.ncRounds ?? []).map((r) => r.ncCount)
      .filter((n) => num(m, 'NcCount') > n - 1 && (num(m, 'SecNcCount') > n - 1 || n === current));
  });

  /** Surveillance: answers from the Bronze surveillance app and the location of the original ZED assessment. */
  protected readonly surveillance = computed(() => this.data()?.surveillance ?? null);
  protected readonly zedMapUrl = computed(() => {
    const l = this.surveillance()?.zedLocation;
    const lat = Number(l?.['ZedLatitude']);
    const lng = Number(l?.['ZedLongitude']);
    return Number.isFinite(lat) && Number.isFinite(lng) && l?.['ZedLatitude'] ? `https://www.google.com/maps?q=${lat},${lng}` : '';
  });

  /**
   * The key facts of the "Assessment summary" card, three to a row (2026-11-17, design 14); the NC dates are in the
   * non-conformances card; the address takes the whole last row.
   */
  protected readonly summaryFacts = computed<SummaryFact[]>(() => {
    const m = this.msme();
    const v = (column: string) => text(m, column);
    // 2026-11-18 (staff-14a): four to a row; the agency and assessor by name with the ID beside it; the level with its medal.
    const named = (id: string, name: string): SummaryFact['value'] => v(name) || v(id);
    const facts: SummaryFact[] = [
      { label: t('staff.daDetails.summary.zedId.label', 'ZED ID'), value: v('ZedId') },
      { label: t('staff.daDetails.summary.unitName.label', 'Unit name'), value: v('PUnitName') },
      { label: t('staff.daDetails.summary.udyam.label', 'Udyam registration'), value: v('UdyogAadharNo') },
      { label: t('staff.daDetails.summary.level.label', 'Level'), value: v('Certification'), medal: true },
      { label: t('staff.daDetails.summary.submission.label', 'Document submission'), value: v('BasicInfoStatus') },
      { label: t('staff.daDetails.summary.allocated.label', 'Verification allocated'), value: v('DocVerifiAllot') },
      { label: t('staff.daDetails.summary.completed.label', 'Completed'), value: v('CompletedOn') },
      { label: t('staff.daDetails.summary.mode.label', 'Mode'), value: t('staff.daDetails.summary.modeDesktop.text', 'Desktop') },
    ];
    if (!this.isQc()) {
      facts.push(
        { label: t('staff.daDetails.summary.agency.label', 'Assessment agency'), value: named('CertificationBodyUserId', 'AgencyName'), sub: v('AgencyName') ? v('CertificationBodyUserId') : '' },
        { label: t('staff.daDetails.summary.assessor.label', 'Desktop assessor'), value: named('DesktopAssessorId', 'DesktopAssessorName'), sub: v('DesktopAssessorName') ? v('DesktopAssessorId') : '' },
      );
    }
    return facts;
  });

  // ------------------------------------------------------------------ 2026-11-18: the new staff-14 series

  /** "Desktop · Assessor One · Mahavir Agency" at the right end of the tab bar. */
  protected readonly metaLine = computed(() =>
    [t('staff.daDetails.tab.metaDesktop.label', 'Desktop'), text(this.msme(), 'DesktopAssessorName'), text(this.msme(), 'AgencyName')].filter(Boolean).join(' · '));
  /** ZED ID history is the Admin's and the dashboard logins' screen (staff route guard: 7, 10, 11, 17). */
  protected readonly historyLink = computed(() => [7, 10, 11, 17].includes(this.qoAuth.currentUser()?.roleId ?? 0));
  protected readonly basicItems = BASIC_ITEMS;
  protected readonly basicRaisedCount = computed(() => basicRaised(this.data()));
  protected readonly aboveCapacity = computed(() => aboveCapacity(this.msme()));
  /** Parameters that conform (every requirement Yes) and that do not (a requirement No). */
  protected readonly paramCounts = computed(() => {
    const st = (this.data()?.sections ?? []).map((s) => this.sectionStatus(s));
    return { yes: st.filter((x) => x === 'Yes').length, no: st.filter((x) => x === 'No').length };
  });
  /** The rail's "This tab" / "This parameter" chip: the observations on what the tab shows (staff-14a, 14b). */
  protected readonly qoScope = computed(() => {
    const d = this.data();
    if (!d) return null;
    const req = (rows: Row[]) => rows.map((r) => `Requirement|${text(r, 'Id')}`);
    if (this.tab() === 3) {
      const s = this.activeSection();
      return { label: t('staff.daDetails.rail.chip.parameter', 'This parameter'), keys: s ? req(this.requirementsOf(s, d.requirements)) : [] };
    }
    if (this.ncTab()) {
      const keys = new Set(this.tracker().map((i) => i.key));
      return { label: t('staff.daDetails.rail.chip.tab', 'This tab'), keys: req(d.requirements.filter((r) => keys.has(`${text(r, 'SectionCode')}.${text(r, 'RequirementCode')}`))) };
    }
    return { label: t('staff.daDetails.rail.chip.tab', 'This tab'), keys: this.tab() === 1 ? ['Overall|'] : [] };
  });
  /** The non-conformance tracker of the overview and the "By requirement" view (staff-14a, staff-14c). */
  protected readonly tracker = computed(() => ncTracker(this.data()));
  protected readonly trackerOpen = computed(() => this.tracker().filter((i) => i.outcome !== 'accepted').length);
  /** An item's state in a round, as shown. */
  protected stateLabel(state: RoundState): string {
    switch (state) {
      case 'accepted': return t('staff.daDetails.state.accepted.label', 'Accepted');
      case 'rejected': return t('staff.daDetails.state.rejected.label', 'Not accepted');
      case 'open': return t('staff.daDetails.state.open.label', 'Open');
      default: return t('staff.daDetails.state.none.label', 'Not needed');
    }
  }

  /** The state of an NC round in the overview's tracker (the code value stays for the chip's colour). */
  protected ncStateText(state: string | null): string {
    switch (state) {
      case 'Open': return t('staff.daDetails.tracker.state.open.chip', 'Open');
      case 'Replied': return t('staff.daDetails.tracker.state.replied.chip', 'Replied');
      default: return t('staff.daDetails.tracker.state.closed.chip', 'Closed');
    }
  }

  /** A parameter / requirement / checkpoint chip as shown (the code value stays in data-v). */
  protected chipText(value: ParameterChip): string {
    switch (value) {
      case 'Yes': return t('staff.daDetails.status.yes.chip', 'Yes');
      case 'No': return t('staff.daDetails.status.no.chip', 'No');
      case 'Partial': return t('staff.daDetails.status.partial.chip', 'Partial');
      case 'Pending': return t('staff.daDetails.status.pending.chip', 'Pending');
      case 'Exempt': return t('staff.daDetails.status.exempt.chip', 'Exempt');
      default: return value;
    }
  }

  /** The Non-conformances tab: its view and, in "By requirement", the round filter (0 all) and the cards opened. */
  protected readonly ncView = signal<'req' | 'round'>('req');
  protected readonly ncFilter = signal(0);
  protected readonly ncOpenCards = signal<ReadonlySet<string>>(new Set());
  protected readonly ncTab = computed(() => this.tab() >= 4 && this.tab() <= 8);
  protected readonly shownTrack = computed(() => {
    const f = this.ncFilter();
    return f ? this.tracker().filter((i) => i.rounds.some((r) => r.round === f && r.state !== 'none')) : this.tracker();
  });
  /** NC items raised over all rounds (an item raised in three rounds counts three times). */
  protected sumRaised(): number {
    return this.tracker().reduce((sum, i) => sum + i.rounds.filter((r) => r.state !== 'none').length, 0);
  }
  protected roundCount(n: number): number {
    return this.tracker().filter((i) => i.rounds.some((r) => r.round === n && r.state !== 'none')).length;
  }

  /**
   * Opens the Non-conformances tab: the assessor whose round is open lands on that round ("By round", where its buttons are);
   * everyone else on "By requirement".
   */
  protected openNc(view?: 'req' | 'round', round?: number): void {
    const rounds = this.ncTabs();
    if (!rounds.length) return;
    const cur = this.currentRound();
    const r = round && rounds.includes(round) ? round : rounds.includes(cur) ? cur : rounds[rounds.length - 1];
    this.ncView.set(view ?? (cur > 0 && this.canChange(cur) ? 'round' : 'req'));
    this.tab.set(r + 3);
  }

  protected toggleNcCard(key: string): void {
    const next = new Set(this.ncOpenCards());
    if (next.has(key)) next.delete(key); else next.add(key);
    this.ncOpenCards.set(next);
  }

  protected collapseAllNc(): void {
    this.ncOpenCards.set(this.ncOpenCards().size ? new Set() : new Set(this.shownTrack().map((i) => i.key)));
  }

  /** The conversation of a tracked requirement up to its last round (the "By round" thread). */
  protected trackThread(i: TrackItem): ThreadMessage[] {
    return i.row ? this.ncThread(i.row, this.round(i.last), i.last) : [];
  }

  /** Basic information: All / Needs attention (not accepted) / Accepted. */
  protected readonly basicFilter = signal<'all' | 'attention' | 'accepted'>('all');
  protected basicShown(raised: boolean): boolean {
    const f = this.basicFilter();
    return f === 'all' || (f === 'attention') === raised;
  }

  /** Parameters tab: requirement cards closed by the user (all open at first). */
  protected readonly closedReqs = signal<ReadonlySet<string>>(new Set());
  protected toggleReq(id: string): void {
    const next = new Set(this.closedReqs());
    if (next.has(id)) next.delete(id); else next.add(id);
    this.closedReqs.set(next);
  }

  /** The parameter before / after the one shown (the header's arrows). */
  protected stepSection(delta: number): void {
    const list = this.data()?.sections ?? [];
    const i = list.indexOf(this.activeSection() as Row);
    const next = list[i + delta];
    if (next) this.selectSection(next);
  }
  protected sectionIndex(): number {
    return (this.data()?.sections ?? []).indexOf(this.activeSection() as Row) + 1;
  }

  /** The parameter shown in the parameters tab. */
  protected readonly activeSection = computed<Row | null>(() => {
    const sections = this.data()?.sections ?? [];
    const id = this.selectedSection();
    return sections.find((s) => text(s, 'Id') === id) ?? sections[0] ?? null;
  });

  /** NC tab shown (tabs 4..8 are NC1..NC5), 0 elsewhere. */
  protected readonly ncRoundNumber = computed(() => (this.tab() >= 4 && this.tab() <= 8 ? this.tab() - 3 : 0));
  /** Parameters of the NC round shown that have requirements in that round. */
  protected readonly ncSections = computed(() => {
    const rd = this.round(this.ncRoundNumber());
    return (rd?.sections ?? []).filter((s) => this.requirementsOf(s, rd?.requirements).length > 0);
  });
  /** NC tabs: the round's parameter list (status from the round's conformance) and the selected parameter. */
  protected readonly rn = new ParameterNav<Row, Row>({
    sections: () => this.ncSections(),
    id: (s) => text(s, 'Id'),
    requirements: (s) => this.requirementsOf(s, this.round(this.ncRoundNumber())?.requirements),
    conformance: (r) => r['Conformance'],
    answered: (r) => checkpointsOf(this.data()?.checkpoints, r['Id']).some((c) => c.desktop?.value),
  });

  protected readonly mapUrl = computed(() => {
    const l = this.data()?.location;
    const lat = Number(l?.['Latitude']);
    const lng = Number(l?.['Longitude']);
    return Number.isFinite(lat) && Number.isFinite(lng) && l?.['Latitude'] ? `https://www.google.com/maps?q=${lat},${lng}` : '';
  });

  constructor() {
    effect(() => {
      const zedId = this.zedId();
      const level = this.level();
      untracked(() => void this.load(zedId, level, true));
    });
  }

  // ------------------------------------------------------------------ view helpers

  protected round(n: number): NcRound | undefined {
    return this.data()?.ncRounds.find((r) => r.ncCount === n);
  }

  /** Site exterior photos of the round before NC n (round 0 for NC1). */
  protected previousPhotos(n: number): Row[] {
    const photos = n <= 1 ? (this.data()?.photos ?? []) : (this.round(n - 1)?.photos ?? []);
    return photos.filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos');
  }

  protected roundPhotos(n: number): Row[] {
    return (this.round(n)?.photos ?? []).filter((p) => text(p, 'PhotoType') === 'SiteExteriorPhotos');
  }

  protected requirementsOf(section: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected subOptionsOf(o: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter(
      (s) => text(s, 'SectionCode') === text(o, 'SectionCode') && text(s, 'RequirementCode') === text(o, 'RequirementCode') && text(s, 'OptionCode') === text(o, 'OptionCode'),
    );
  }

  protected evidencesOf(r: Row, rows: Row[] | undefined): Row[] {
    return (rows ?? []).filter((e) => text(e, 'SectionCode') === text(r, 'SectionCode') && text(e, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  /** The evidences of a requirement that belong to a checkpoint (its ids in CheckpointAnswers, migration 0039). */
  protected checkpointEvidences(r: Row, o: Row, rows: Row[] | undefined): Row[] {
    const ids = new Set((this.checkpointOf(r, o)?.evidences ?? []).map((e) => String(e.id)));
    return ids.size ? this.evidencesOf(r, rows).filter((e) => ids.has(text(e, 'Id'))) : [];
  }

  /** The assessor may validate this evidence now (opened, validation required, the assessment open to them). */
  protected canValidate(e: Row): boolean {
    return this.canChange(0) && flag(e, 'ValidationRequired') && flag(e, 'Opened');
  }

  /** The evidence a checkpoint's Validate button opens: the first not yet validated, else the first (Edit). */
  protected evidenceToValidate(list: Row[]): Row | null {
    const open = list.filter((e) => this.canValidate(e));
    return open.find((e) => !text(e, 'IsVerified')) ?? open[0] ?? null;
  }

  /** The evidences of a requirement that belong to none of its checkpoints (the whole requirement's). */
  protected looseEvidences(r: Row, rows: Row[] | undefined): Row[] {
    const ids = new Set(checkpointsOf(this.data()?.checkpoints, r['Id']).flatMap((c) => c.evidences.map((e) => String(e.id))));
    return this.evidencesOf(r, rows).filter((e) => !ids.has(text(e, 'Id')));
  }

  protected oldProductsOf(p: Row, n: number): Row[] {
    return (this.round(n)?.oldProducts ?? []).filter((o) => text(o, 'ProductParentId') === text(p, 'ProductParentId'));
  }

  /**
   * Status of a requirement row: its conformance when given; "Partial" while only some of its checkpoints are answered
   * (or one is answered Partial); "Pending" when nothing is answered yet.
   */
  protected requirementStatus(r: Row): ParameterStatus {
    return requirementStatus(text(r, 'Conformance'), checkpointsOf(this.data()?.checkpoints, r['Id']).some((c) => c.desktop?.value));
  }

  /** Status of a parameter from its requirements: all Yes, any No, some answered (Partial) or nothing answered (Pending). */
  protected sectionStatus(s: Row): ParameterStatus {
    return parameterStatus(this.requirementsOf(s, this.data()?.requirements).map((r) => this.requirementStatus(r)));
  }

  protected exempted(s: Row): boolean {
    return text(s, 'IsAssessmentExcempted') === 'Yes';
  }

  /** Requirements of a parameter with a conformance given (done) out of all its requirements. */
  protected sectionProgress(s: Row): ParameterProgress {
    return parameterProgress(this.requirementsOf(s, this.data()?.requirements).map((r) => r['Conformance']));
  }

  /** Chip of a parameter in the list: "Exempt" for an exempted parameter, else its status. */
  protected navStatus(s: Row): ParameterChip {
    return parameterChip(this.sectionStatus(s), this.exempted(s));
  }

  /** Parameters complete (every requirement decided: status Yes or No; exempted ones count as complete). */
  protected readonly completeCount = computed(() => (this.data()?.sections ?? []).filter((s) => parameterComplete(this.sectionProgress(s), this.exempted(s))).length);

  protected selectSection(s: Row): void {
    this.selectedSection.set(text(s, 'Id'));
  }

  /** Responses of the round being shown (NcCount = the round) for a requirement: its conformance and remarks are answered there. */
  protected currentRoundEvidences(r: Row, rd: NcRound | undefined, nc: number): Row[] {
    return this.evidencesOf(r, rd?.evidences).filter((e) => num(e, 'NcCount') === nc);
  }

  /**
   * NC tabs: the requirement's conversation up to round `nc`, oldest first: the desktop assessor's remark that raised NC1
   * (with the documents it was raised on), then per round the unit's reply (comments, files) and the assessor's verdict.
   */
  protected ncThread(r: Row, rd: NcRound | undefined, nc: number): ThreadMessage[] {
    const d = this.data();
    if (!d) return [];
    const same = (x: Row) => text(x, 'SectionCode') === text(r, 'SectionCode') && text(x, 'RequirementCode') === text(r, 'RequirementCode');
    const desk = d.requirements.find(same);
    const out: ThreadMessage[] = [
      message('assessor', t('staff.daDetails.thread.raised.label', 'NC1 raised'), {
        text: text(desk, 'AssessorRemarks'),
        conformance: text(desk, 'Conformance'),
        all: this.evidencesOf(r, d.evidences).map((e) => ({ name: text(e, 'EvidenceName'), url: text(e, 'FileUrl'), opened: true })),
      }),
    ];
    const rows = this.evidencesOf(r, rd?.evidences);
    const rounds = [...new Set(rows.map((e) => num(e, 'NcCount')))].filter((k) => k > 0 && k <= nc).sort((a, b) => a - b);
    for (const k of rounds) {
      const group = rows.filter((e) => num(e, 'NcCount') === k);
      const first = (column: string) => group.map((e) => text(e, column)).find(Boolean) ?? '';
      out.push(message('msme', t('staff.daDetails.thread.round.label', 'NC{round}', { round: k }), {
        date: first('SyncedDate'),
        text: first('RequirementMsmeRemarks'),
        all: group.map((e) => ({ name: text(e, 'EvidenceName'), url: text(e, 'FileUrl'), opened: flag(e, 'Opened'), row: e })),
      }));
      const current = k === nc;
      out.push(message('assessor', t('staff.daDetails.thread.round.label', 'NC{round}', { round: k }), {
        text: (current && text(r, 'AssessorRemarks')) || first('RequirementRemarks'),
        conformance: (current && text(r, 'Conformance')) || first('Conformance'),
      }));
    }
    if (!rounds.includes(nc) && text(r, 'Conformance')) {
      out.push(message('assessor', t('staff.daDetails.thread.round.label', 'NC{round}', { round: nc }), { text: text(r, 'AssessorRemarks'), conformance: text(r, 'Conformance') }));
    }
    return out.filter(hasContent);
  }

  protected screenshots(e: Row): string[] {
    const s = e['Screenshots'];
    return Array.isArray(s) ? (s as string[]) : [];
  }

  /** The assessor may change rows of this round now. */
  protected canChange(round: number): boolean {
    return this.perms().canAssess && this.currentRound() === round;
  }

  protected noRows(rows: Row[], column: string): Row[] {
    return rows.filter((r) => text(r, column) === 'No');
  }

  // ------------------------------------------------------------------ opening documents

  protected openImage(src: unknown, type?: OpenedType, row?: Row): void {
    if (typeof src === 'string' && src) this.preview.set(src);
    if (type && row) this.markOpened(type, row);
  }

  /** Records that the assessor opened a document (the old SaveTimestamp), then refreshes the page data. */
  protected markOpened(type: OpenedType, row: Row): void {
    if (!this.perms().canAssess) return;
    const d = this.data();
    if (!d) return;
    firstValueFrom(this.api.opened(d.zedId, d.certification, type, row['Id']))
      .then(() => this.reload())
      .catch((err) => this.notice.set({ ok: false, text: apiErrorMessage(err) }));
  }

  // ------------------------------------------------------------------ assessor actions

  protected editConformance(r: Row): void {
    this.modalError.set('');
    // A requirement with checkpoints (migration 0039) is answered checkpoint by checkpoint; its conformance follows.
    const checkpoints = checkpointsOf(this.data()?.checkpoints, r['Id']);
    if (checkpoints.length) {
      this.checkpointEdit.set({ requirement: r, checkpoints, title: `${text(r, 'SectionCode')}.${text(r, 'RequirementCode')}` });
      return;
    }
    this.conformanceEdit.set({ requirement: r, conformance: text(r, 'Conformance'), remarks: text(r, 'AssessorRemarks') });
  }

  protected async saveCheckpoints(body: CheckpointSaveRequest): Promise<void> {
    const e = this.checkpointEdit();
    const d = this.data();
    if (!e || !d) return;
    await this.save(this.api.checkpoints(d.zedId, d.certification, e.requirement['Id'], body), () => this.checkpointEdit.set(null));
  }

  /** The checkpoint of an option row of a requirement row (migration 0039), when the requirement has checkpoints. */
  protected checkpointOf(r: Row, o: Row): Checkpoint | undefined {
    return checkpointsOf(this.data()?.checkpoints, r['Id']).find((c) => c.optionCode === text(o, 'OptionCode').trim());
  }

  /** The requirement is answered checkpoint by checkpoint. */
  protected hasCheckpoints(r: Row): boolean {
    return checkpointsOf(this.data()?.checkpoints, r['Id']).length > 0;
  }

  /** The desktop assessor's answer of a checkpoint (an option row of a requirement row), when given. */
  protected answerOf(r: Row, o: Row): CheckpointValue | null {
    return this.checkpointOf(r, o)?.desktop?.value ?? null;
  }

  protected async saveConformance(): Promise<void> {
    const e = this.conformanceEdit();
    const d = this.data();
    if (!e || !d) return;
    if (!e.conformance) return this.modalError.set(t('staff.daDetails.conformance.chooseError', 'Please select the conformance.'));
    if (e.conformance === 'No' && !e.remarks.trim()) return this.modalError.set(t('staff.daDetails.remarksError', 'Please enter remarks.'));
    await this.save(this.api.conformance(d.zedId, d.certification, e.requirement['Id'], e.conformance, e.remarks.trim()), () => this.conformanceEdit.set(null));
  }

  protected editProduct(p: Row): void {
    this.modalError.set('');
    this.productEdit.set({ row: p, verified: text(p, 'IsVerified'), remarks: text(p, 'AssessorRemarks') });
  }

  protected async saveProduct(): Promise<void> {
    const e = this.productEdit();
    const d = this.data();
    if (!e?.row || !d) return;
    if (!this.validation(e)) return;
    await this.save(this.api.validateProduct(d.zedId, d.certification, e.row['Id'], e.verified, e.remarks.trim()), () => this.productEdit.set(null));
  }

  protected editSiteExterior(first: Row | undefined): void {
    this.modalError.set('');
    this.siteExteriorEdit.set({ row: null, verified: text(first, 'IsVerified'), remarks: text(first, 'AssessorRemarks') });
  }

  protected async saveSiteExterior(): Promise<void> {
    const e = this.siteExteriorEdit();
    const d = this.data();
    if (!e || !d) return;
    if (!this.validation(e)) return;
    await this.save(this.api.validateSiteExterior(d.zedId, d.certification, e.verified, e.remarks.trim()), () => this.siteExteriorEdit.set(null));
  }

  protected editEvidence(ev: Row): void {
    this.modalError.set('');
    this.evidenceEdit.set({ evidence: ev, verified: text(ev, 'IsVerified'), source: text(ev, 'SourceOfValidation'), remarks: text(ev, 'AssessorRemarks'), files: [] });
  }

  protected pickFiles(event: Event): void {
    const e = this.evidenceEdit();
    if (!e) return;
    const files = Array.from((event.target as HTMLInputElement).files ?? []);
    const ok = files.length <= MAX_FILES && files.every((f) => f.size > 0 && f.size <= MAX_FILE_BYTES && (f.type === 'application/pdf' || f.type.startsWith('image/')));
    if (!ok) {
      (event.target as HTMLInputElement).value = '';
      this.modalError.set(t('staff.daDetails.evidence.filesError', 'Please upload valid document (PDF / JPG), less than 2 MB each.'));
      this.evidenceEdit.set({ ...e, files: [] });
      return;
    }
    this.modalError.set('');
    this.evidenceEdit.set({ ...e, files });
  }

  protected async saveEvidence(): Promise<void> {
    const e = this.evidenceEdit();
    const d = this.data();
    if (!e || !d) return;
    if (!e.verified) return this.modalError.set(t('staff.daDetails.evidence.verifiedError', 'Please select whether the evidence is verified.'));
    if (e.verified === 'Yes' && !e.source.trim()) return this.modalError.set(t('staff.daDetails.evidence.sourceError', 'Please enter the source of validation.'));
    if (e.verified === 'Yes' && e.files.length === 0) return this.modalError.set(t('staff.daDetails.evidence.noFileError', 'Please upload valid pdf document.'));
    if (e.verified === 'No' && !e.remarks.trim()) return this.modalError.set(t('staff.daDetails.remarksError', 'Please enter remarks.'));
    await this.save(
      this.api.validateEvidence(d.zedId, d.certification, e.evidence['Id'], e.verified, e.source.trim(), e.remarks.trim(), e.files),
      () => this.evidenceEdit.set(null),
    );
  }

  protected async setExemption(section: Row, value: 'Yes' | 'No'): Promise<void> {
    const d = this.data();
    if (!d || text(section, 'IsAssessmentExcempted') === value) return;
    this.busy.set(true);
    try {
      const res = await firstValueFrom(this.api.exemption(d.zedId, d.certification, section['Id'], value));
      this.notice.set({ ok: true, text: res.message });
      await this.reload();
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
      await this.reload();
    } finally {
      this.busy.set(false);
    }
  }

  protected async openFinalSubmit(): Promise<void> {
    const d = this.data();
    if (!d) return;
    this.busy.set(true);
    try {
      const check = await firstValueFrom(this.api.checkFinalSubmit(d.zedId, d.certification));
      if (!check.allowed) {
        this.notice.set({ ok: false, text: check.message ?? t('staff.daDetails.finalSubmit.incompleteError', 'Please complete the assessment before final submit.') });
        return;
      }
      this.modalError.set('');
      this.finalSubmitEdit.set({ check, remarks: '', confirmed: false, ticked: [] });
    } catch (err) {
      this.notice.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected async finalSubmit(): Promise<void> {
    const e = this.finalSubmitEdit();
    const d = this.data();
    if (!e || !d || !this.canFinalSubmit(e)) return;
    if (!e.remarks.trim()) return this.modalError.set(t('staff.daDetails.finalSubmit.remarksError', 'Please enter assessor final remarks.'));
    await this.save(this.api.finalSubmit(d.zedId, d.certification, e.remarks.trim(), e.ticked), () => this.finalSubmitEdit.set(null));
  }

  /** The fairness box and (2026-11-17) every item of the Admin's assessor final submit checklist ticked. */
  protected canFinalSubmit(e: FinalSubmitEdit): boolean {
    return e.confirmed && allTicked(e.check.checklist ?? [], e.ticked);
  }

  /** Rows of the round being submitted, for the NC summary of the final-submit pop-up. */
  protected submitRound(): { photos: Row[]; products: Row[]; sections: Row[]; requirements: Row[]; options: Row[]; subOptions: Row[] } {
    const d = this.data();
    const n = this.currentRound();
    if (!d) return { photos: [], products: [], sections: [], requirements: [], options: [], subOptions: [] };
    if (n === 0) return { photos: this.siteExterior(), products: d.products, sections: d.sections, requirements: d.requirements, options: d.options, subOptions: d.subOptions };
    const r = this.round(n);
    return {
      photos: this.roundPhotos(n),
      products: r?.products ?? [],
      sections: r?.sections ?? [],
      requirements: r?.requirements ?? [],
      options: r?.options ?? [],
      subOptions: r?.subOptions ?? [],
    };
  }

  protected refresh(): void {
    void this.reload();
  }

  // ------------------------------------------------------------------ agency review

  /** Opens the "Agency Remarks" pop-up for an assessor finding (product, requirement or site exterior photo). */
  protected editRemarks(kind: RemarksKind, row: Row | undefined): void {
    if (!row || !this.review().editRemarks) return;
    this.remarksTarget.set({ kind, id: row['Id'], remarks: text(row, 'AssessorRemarks') });
  }

  protected async reviewed(message: string): Promise<void> {
    this.remarksTarget.set(null);
    this.notice.set({ ok: true, text: message });
    await this.reload();
  }

  // ------------------------------------------------------------------ plumbing

  private validation(e: ValidationEdit): boolean {
    if (!e.verified) {
      this.modalError.set(t('staff.daDetails.validation.requiredError', 'This is required.'));
      return false;
    }
    if (e.verified === 'No' && !e.remarks.trim()) {
      this.modalError.set(t('staff.daDetails.remarksError', 'Please enter remarks.'));
      return false;
    }
    return true;
  }

  private async save(call: Observable<{ message: string }>, close: () => void): Promise<void> {
    this.busy.set(true);
    this.modalError.set('');
    try {
      await firstValueFrom(call);
      close();
      this.notice.set({ ok: true, text: t('staff.daDetails.toast.updated', 'Data Updated') });
      await this.reload();
    } catch (err) {
      this.modalError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private reload(): Promise<void> {
    return this.load(this.zedId(), this.level(), false);
  }

  private async load(zedId: string, level: string | null, first: boolean): Promise<void> {
    const request = ++this.request;
    this.error.set('');
    if (!isZedId(zedId) || !level) {
      this.data.set(null);
      this.error.set(t('staff.daDetails.invalidError', 'Invalid request.'));
      return;
    }
    this.loading.set(true);
    try {
      const data = await firstValueFrom(this.api.details(zedId, level));
      if (request !== this.request) return;
      this.data.set(data);
      if (first) this.tab.set(1);
    } catch (err) {
      if (request !== this.request) return;
      this.data.set(null);
      this.error.set(
        err instanceof HttpErrorResponse && err.status === 404
          ? t('staff.daDetails.notFoundError', 'Assessment details are not available, or this assessment is not allotted to you.')
          : apiErrorMessage(err),
      );
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }
}
