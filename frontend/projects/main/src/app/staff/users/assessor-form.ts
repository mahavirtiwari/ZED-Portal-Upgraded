import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { PORTAL_SYSTEM } from '../../portal-system';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { staffCrumbs } from '../staff-crumbs';
import { STAFF_SYSTEM, StaffRole, agencyKindOf } from '../staff-menu';
import { ToastService } from '../toast';
import { SchemeTicksPanel } from '../scheme-verification/scheme-ticks-panel';
import { assessorTypeLabel, initialsOf } from './assessor-list';
import { AssessorMobilePanel, canSeeAssessorMobile } from './assessor-mobile';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { ReasonAsk, ReasonDialog } from './reason-dialog';
import { resetLinkAsk, sentTo } from './user-display';
import { AssessmentModeName, AssessorAssessment, LevelModes, Professional, SECTOR_ACTIVITIES, SectorActivity, UsersApi, VerificationMode } from './users.api';

interface AssessorModel {
  assessorType: string;
  certificateNo: string;
  professionalEmail: string;
  /** The professional's PAN (verification off, or by another portal's API). */
  pan: string;
  userName: string;
  emailId: string;
  mobileNo: string;
  address: string;
  pinCode: string;
  idProofType: string;
  idProofNumber: string;
  states: string[];
  nicSectors: string[];
  areasOfKnowledge: string[];
  reasonForRejection: string;
  /** Main (V4): Manufacturing, Services or Both, within the agency's. */
  sectorActivity: SectorActivity | '';
  /** Main (2026-11-14): the ticked modes by level code. */
  assessments: Record<string, AssessmentModeName[]>;
}

/** The grid's columns. */
export const ASSESSMENT_MODES: AssessmentModeName[] = ['Desktop', 'Remote', 'Onsite'];

/** The old Users.AssessorType of the ticks (the professional lookup and the legacy lists still read it). */
export function typeOfTicks(t: Record<string, AssessmentModeName[]>): string {
  const levels = Object.keys(t).filter((k) => t[k]?.length);
  return !levels.length ? '' : levels.every((k) => k.toLowerCase() === 'bronze') ? 'BronzeAssessor' : 'Assessor';
}

/** 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the line icons of staff-05 (24px grid, stroked). */
const ICON = {
  back: 'M19 12H5 M12 19l-7-7 7-7',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
  unlock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 9.9-1',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 6v6l4 2',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z M9 12l2 2 4-4',
  person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
  building: 'M3 21h18 M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M9 15h2 M13 15h2',
  pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
  info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
} as const;

const PAN_PATTERN = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MOBILE_PATTERN = /^\d{10}$/;

function emptyAssessor(): AssessorModel {
  return {
    assessorType: '', certificateNo: '', professionalEmail: '', pan: '', userName: '', emailId: '', mobileNo: '', address: '', pinCode: '',
    idProofType: '', idProofNumber: '', states: [], nicSectors: [], areasOfKnowledge: [], reasonForRejection: '', sectorActivity: '',
    assessments: {},
  };
}

/**
 * Add / update an assessor (agency) or view one (MasterAdmin). Port of Views/User/Assessor.cshtml.
 * How a new assessor's certified professional is verified is the Admin's choice per portal (Settings -> Professional
 * Verification, the options' `verification`): Off (the default) - the agency types the certificate number, PAN, name, e-mail
 * and mobile; TrainingPortal - the old lookup by certificate number and registered e-mail; Api - another portal's API by
 * certificate number and PAN. With a lookup, name, e-mail and mobile come from that record (the API repeats the lookup). V4 layout: a profile card
 * (initials, ID, certificate, type, sector type and status) above a saved assessor, numbered sections (type and
 * certificate, contact, ID proof, what the assessor assesses, block reason), the type, ID proof and sector type as choice
 * chips, the lookup in a shaded box that names the professional found, and a sticky save bar showing unsaved changes.
 * 2026-11-17 (approved staff redesign, staff-05): the staff page head (crumbs, a "View only" tag, Block / Unblock, Reset link,
 * History and Back), each action confirmed in a pop-up and reported in a toast; a right rail (the agency, the coverage
 * collapsed to counts with "View all", the open assessments count) that stacks under the form on narrow screens.
 */
@Component({
  selector: 'zed-staff-assessor-form',
  imports: [FormsModule, NgTemplateOutlet, RouterLink, MultiSelect, AssessorMobilePanel, PageHead, ConfirmDialog, ReasonDialog, UserHistoryPanel, TextPipe, SchemeTicksPanel],
  styleUrls: ['./assessor-form-scope.scss', './assessor-form-view.scss'],
  templateUrl: './assessor-form.html',
})
export class AssessorFormPage {
  private readonly api = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly userId: string | null = inject(ActivatedRoute).snapshot.paramMap.get('userId');
  protected readonly isAgency = this.auth.currentUser()?.roleId === StaffRole.Agency;
  /** 2026-11-20: the signed-in agency is an incentive verification agency (desktop / onsite): its assessors are ticked for schemes. */
  protected readonly incentiveAgency = this.isAgency && agencyKindOf(this.auth.currentUser()?.subRoles ?? []) !== 'assessment';
  protected readonly isNew = !this.userId;
  /** Agencies create and edit their assessors; the MasterAdmin only views them. */
  protected readonly canEdit = signal(this.isNew && this.isAgency);
  /**
   * V4: the saved assessor's / consultant's registered mobile (one phone per user in the site assessor app, and on
   * Consultancy the consultant app; 2026-11-18 on every portal), for the Admin and the MasterAdmin only (never agencies),
   * at the top of the right rail so it is seen without scrolling.
   */
  protected readonly showsMobile = !this.isNew && canSeeAssessorMobile(this.auth.currentUser()?.roleId);
  protected readonly mobileSystem = inject(STAFF_SYSTEM);

  protected model: AssessorModel = emptyAssessor();
  protected readonly maskedIdProof = signal<string | null>(null);
  /** The PAN the agency entered (Users.PanNo), shown next to the certificate. */
  protected readonly panNo = signal<string | null>(null);
  protected readonly storedIdProofType = signal<string | null>(null);
  protected readonly states = signal<MultiSelectOption[]>([]);
  protected readonly sectors = signal<MultiSelectOption[]>([]);
  protected readonly areas = signal<MultiSelectOption[]>([]);
  /** Lookup result; required (and still matching the certificate/e-mail fields) before a new assessor can be created. */
  protected readonly professional = signal<{ key: string; data: Professional } | null>(null);
  protected readonly loading = signal(true);
  protected readonly searching = signal(false);
  /** The portal's professional verification (Off until the options say otherwise, as on the server). */
  protected readonly verification = signal<VerificationMode>('Off');
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly activities = SECTOR_ACTIVITIES;
  /** The agency's sector type (an assessor cannot cover more); null: not set, no limit. */
  protected readonly agencyActivity = signal<SectorActivity | null>(null);
  protected allowed(a: SectorActivity): boolean {
    const agency = this.agencyActivity();
    return !agency || agency === 'Both' || agency === a;
  }
  protected readonly error = signal('');
  /** Status of a saved assessor (shown on the profile card); null for a new one. */
  protected readonly isActive = signal<boolean | null>(null);
  /** A field was changed since the page loaded or was last saved (the save bar says so). */
  protected readonly dirty = signal(false);
  protected readonly idProofs = ['Aadhaar Card', 'PAN Card'];
  /** Number of the section before Contact details (the type and certificate section is shown for a new assessor only). */
  protected readonly first = this.isNew ? 1 : 0;
  protected readonly initials = initialsOf;
  protected readonly typeLabel = assessorTypeLabel;
  protected readonly icon = ICON;

  /** 2026-11-18: a saved assessor the signed-in user cannot edit (the Master Admin): the compact contact card (e-mail, mobile and PAN in full since 2026-11-18). */
  protected get viewOnly(): boolean {
    return !this.isNew && !this.canEdit();
  }

  /** "PAN card · ABCDE1234F" in full; "Aadhaar card · •••••9012" (the server sends an Aadhaar number with its last four only). */
  protected get idProofLine(): string {
    const p = this.model.idProofType;
    const type = p === 'Aadhaar Card' ? t('staff.assessorForm.view.aadhaarCard', 'Aadhaar card') : p === 'PAN Card' ? t('staff.assessorForm.view.panCard', 'PAN card')
      : p ? p.replace(/ Card$/, ' card') : '';
    const masked = this.maskedIdProof()?.replace(/^[Xx*•]+/, '•••••') ?? '';
    return [type, masked].filter(Boolean).join(' · ') || t('staff.assessorForm.view.notSaved', 'Not saved');
  }

  /** The ID proof choice as shown (the stored value stays "Aadhaar Card" / "PAN Card"). */
  protected idProofName(p: string): string {
    return p === 'Aadhaar Card' ? t('staff.assessorForm.idProof.aadhaar', 'Aadhaar Card') : p === 'PAN Card' ? t('staff.assessorForm.idProof.pan', 'PAN Card') : p;
  }

  /** A mode as shown (the stored value stays Desktop / Remote / Onsite). */
  protected modeName(m: AssessmentModeName): string {
    switch (m) {
      case 'Desktop': return t('staff.assessorForm.scope.mode.desktop', 'Desktop');
      case 'Remote': return t('staff.assessorForm.scope.mode.remote', 'Remote');
      case 'Onsite': return t('staff.assessorForm.scope.mode.onsite', 'Onsite');
      default: return m;
    }
  }

  /** The medal colour of a level row (bronze, silver, gold, zedx). */
  protected medal(code: string): string {
    const c = code.toLowerCase().replace(/[^a-z]/g, '');
    return ['bronze', 'silver', 'gold', 'zedx'].includes(c) ? c : 'other';
  }

  constructor() {
    void this.load();
  }

  // ---- 2026-11-17 (staff-05): page head, actions and right rail ----

  /** Who may block, unblock, send a reset link and see the history (StaffAssessorsController: Agency and MasterAdmin). */
  protected readonly managesLogin = this.isAgency || this.auth.currentUser()?.roleId === StaffRole.MasterAdmin;

  protected get crumbs() {
    return staffCrumbs({ label: this.consultancy ? t('staff.assessorForm.crumb.consultants', 'Consultants/Experts') : t('staff.assessorForm.crumb.assessors', 'Assessors'), link: this.backLink },
      { label: this.userId ?? t('staff.assessorForm.crumb.add', 'Add') });
  }

  /** The head's actions: a saved assessor, once loaded. */
  protected get actions(): boolean {
    return !this.isNew && this.managesLogin && this.isActive() !== null;
  }

  /** The agency the assessor belongs to (the details carry its ID only). */
  protected readonly agencyUserId = signal<string | null>(null);

  /** The agency's name for the Master Admin (from its agency list; the details carry the ID only). */
  private readonly agencyListName = signal<string | null>(null);

  /** The agency's own name when the agency itself looks at its assessor; else the name from the Master Admin's list. */
  protected get agencyName(): string | null {
    const me = this.auth.currentUser();
    if (this.isAgency) return me && me.userId === this.agencyUserId() ? me.userName || null : null;
    return this.agencyListName();
  }

  /** 2026-11-18 (staff-05: "Mahavir Agency / ZEDAA0080"): the Master Admin's agencies, for the name (optional). */
  private async loadAgencyName(id: string): Promise<void> {
    try {
      const row = (await firstValueFrom(this.api.agencies())).find((a) => a.UserId === id);
      this.agencyListName.set(row?.UserName || null);
    } catch {
      /* optional: the card shows the ID */
    }
  }

  protected get agencyWord(): string {
    return this.consultancy ? t('staff.assessorForm.rail.agency.organisationTitle', 'Consultant Organisation') : t('staff.assessorForm.rail.agency.title', 'Assessment agency');
  }

  /** Assessments allotted to the assessor and not certified yet (null: not known; the rail block is hidden). */
  protected readonly openCount = signal<number | null>(null);

  private async loadOpenCount(): Promise<void> {
    try {
      this.openCount.set((await firstValueFrom(this.api.assessorOpenAssessments(this.userId!))).count ?? null);
    } catch {
      /* optional: the rail block and the pop-up line stay hidden */
    }
  }

  /** The rail's line: "3 assessments allotted and not certified yet." (one and many as two wordings). */
  protected openLine(n: number): string {
    return this.consultancy
      ? (n === 1 ? t('staff.assessorForm.rail.open.case', '{count} case allotted and not certified yet.', { count: n })
        : t('staff.assessorForm.rail.open.cases', '{count} cases allotted and not certified yet.', { count: n }))
      : (n === 1 ? t('staff.assessorForm.rail.open.assessment', '{count} assessment allotted and not certified yet.', { count: n })
        : t('staff.assessorForm.rail.open.assessments', '{count} assessments allotted and not certified yet.', { count: n }));
  }

  /** Coverage: the states, sectors and areas collapse to a count or the first one, until "View all". */
  protected readonly coverageOpen = signal(false);

  protected labelsOf(values: readonly string[], options: readonly MultiSelectOption[]): string[] {
    return values.map((v) => options.find((o) => o.value === v)?.label ?? v);
  }

  protected firstOf(values: readonly string[], options: readonly MultiSelectOption[]): string {
    if (!values.length) return t('staff.assessorForm.rail.coverage.none', 'None selected');
    const first = this.labelsOf(values.slice(0, 1), options)[0];
    return values.length > 1 ? t('staff.assessorForm.rail.coverage.firstMore', '{first} +{count} more', { first, count: values.length - 1 }) : first;
  }

  /** The confirmation open: block (with its reason) or the reset link. */
  protected readonly confirming = signal<'block' | 'reset' | null>(null);
  protected readonly confirmBusy = signal(false);
  protected readonly confirmFailed = signal('');

  protected readonly confirmAsk = computed<ConfirmAsk | null>(() => {
    const kind = this.confirming();
    const name = this.model.userName || this.userId!;
    if (kind === 'reset') return resetLinkAsk(this.model.userName, this.userId!, this.model.emailId,
      this.consultancy ? t('staff.assessorForm.reset.consultant', 'Consultant') : t('staff.assessorForm.reset.assessor', 'Assessor'));
    if (kind !== 'block') return null;
    const n = this.openCount();
    const who = this.consultancy ? t('staff.assessorForm.block.whoConsultant', 'consultant/expert') : t('staff.assessorForm.block.whoAssessor', 'assessor');
    const by = this.isAgency ? t('staff.assessorForm.block.byYou', 'you')
      : this.consultancy ? t('staff.assessorForm.block.byOrganisation', 'the organisation') : t('staff.assessorForm.block.byAgency', 'the agency');
    const v = { count: n, who, by };
    // One and many as two wordings each (plural forms differ).
    const open = !n ? ''
      : this.consultancy
        ? (n === 1 ? t('staff.assessorForm.block.openCase', '{count} case allotted to this {who} is still open; {by} will need to re-allot it.', v)
          : t('staff.assessorForm.block.openCases', '{count} cases allotted to this {who} are still open; {by} will need to re-allot them.', v))
        : (n === 1 ? t('staff.assessorForm.block.openAssessment', '{count} assessment allotted to this {who} is still open; {by} will need to re-allot it.', v)
          : t('staff.assessorForm.block.openAssessments', '{count} assessments allotted to this {who} are still open; {by} will need to re-allot them.', v));
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): popup-03: a lock tile, the ID under the title, red bullets.
    return {
      title: t('staff.assessorForm.block.title', 'Block {name}?', { name }),
      subtitle: this.userId,
      icon: 'lock',
      points: [t('staff.assessorForm.block.point1', '{name} will not be able to sign in.', { name }), open,
        t('staff.assessorForm.block.point3', 'Nothing is deleted; you can unblock at any time.')].filter(Boolean),
      confirmLabel: t('staff.assessorForm.block.confirmButton', 'Block {noun}', { noun: this.noun.toLowerCase() }),
      danger: true,
      reason: {
        label: t('staff.assessorForm.block.reasonLabel', 'Reason for blocking'),
        placeholder: t('staff.assessorForm.block.reasonPlaceholder', "Shown in the {who}'s history", { who }),
        requiredMessage: t('staff.assessorForm.block.reasonRequired', 'Please enter the reason for blocking.'), maxLength: 2000,
        hint: t('staff.assessorForm.block.reasonHint', 'Kept in the history and e-mailed to the {who}.', { who }),
      },
    };
  });

  protected ask(kind: 'block' | 'reset'): void {
    this.confirmFailed.set('');
    this.confirming.set(kind);
  }

  protected closeConfirm(): void {
    if (!this.confirmBusy()) this.confirming.set(null);
  }

  protected async confirmed(reason: string): Promise<void> {
    const kind = this.confirming();
    if (!kind || !this.userId) return;
    this.confirmBusy.set(true);
    this.confirmFailed.set('');
    try {
      if (kind === 'block') {
        const r = await firstValueFrom(this.api.block('assessors', this.userId, reason));
        this.isActive.set(false);
        this.model.reasonForRejection = reason;
        this.toast.success(t('staff.assessorForm.toast.blocked', '{noun} blocked', { noun: this.noun }), r.message);
      } else {
        const r = await firstValueFrom(this.api.passwordReset('assessors', this.userId));
        this.toast.success(t('staff.assessorForm.toast.resetSent', 'Reset link sent'), t('staff.assessorForm.toast.resetTo', 'E-mailed to {to}', { to: sentTo(r.message, this.model.emailId) }));
      }
      this.confirming.set(null);
    } catch (err) {
      this.confirmFailed.set(apiErrorMessage(err));
    } finally {
      this.confirmBusy.set(false);
    }
  }

  /** Unblock keeps the reason pop-up of the lists (zed-reason-dialog). */
  protected readonly unblockAsk = signal<ReasonAsk | null>(null);

  protected askUnblock(): void {
    this.confirmFailed.set('');
    this.unblockAsk.set({ action: 'unblock', userId: this.userId!, userName: this.model.userName || null });
  }

  protected closeUnblock(): void {
    if (!this.confirmBusy()) this.unblockAsk.set(null);
  }

  protected async unblock(reason: string): Promise<void> {
    if (!this.userId) return;
    this.confirmBusy.set(true);
    this.confirmFailed.set('');
    try {
      const r = await firstValueFrom(this.api.unblock('assessors', this.userId, reason));
      this.isActive.set(true);
      this.model.reasonForRejection = reason;
      this.toast.success(t('staff.assessorForm.toast.unblocked', '{noun} unblocked', { noun: this.noun }), r.message);
      this.unblockAsk.set(null);
    } catch (err) {
      this.confirmFailed.set(apiErrorMessage(err));
    } finally {
      this.confirmBusy.set(false);
    }
  }

  /** The block / unblock history side panel (null items while loading). */
  protected readonly historyOpen = signal(false);
  protected readonly historyItems = signal<HistoryItem[] | null>(null);
  protected readonly historyError = signal('');

  protected async openHistory(): Promise<void> {
    if (!this.userId) return;
    this.historyItems.set(null);
    this.historyError.set('');
    this.historyOpen.set(true);
    try {
      const entries = await firstValueFrom(this.api.assessorHistory(this.userId));
      this.historyItems.set(blockHistoryItems(entries, this.consultancy ? t('staff.assessorForm.history.organisationWord', 'organisation') : t('staff.assessorForm.history.agencyWord', 'agency')));
    } catch (err) {
      this.historyError.set(apiErrorMessage(err));
    }
  }

  /** Main (2026-11-14, approved): the levels of the grid and their modes. */
  protected readonly levels = signal<LevelModes[]>([]);
  protected readonly modes = ASSESSMENT_MODES;

  protected ticked(level: string, mode: AssessmentModeName): boolean {
    return !!this.model.assessments[level]?.includes(mode);
  }

  /** A tick changed: the old type follows the ticks (one kind of assessor). */
  protected tick(level: string, mode: AssessmentModeName, on: boolean): void {
    const now = new Set(this.model.assessments[level] ?? []);
    if (on) now.add(mode); else now.delete(mode);
    this.model.assessments = { ...this.model.assessments, [level]: ASSESSMENT_MODES.filter((m) => now.has(m)) };
    this.model.assessorType = typeOfTicks(this.model.assessments);
    this.dirty.set(true);
  }

  private ticks(): AssessorAssessment[] {
    return Object.entries(this.model.assessments).filter(([, m]) => m.length).map(([level, modes]) => ({ level, modes }));
  }

  protected get typeChoices(): { value: string; label: string }[] {
    if (!this.consultancy)
      return [{ value: 'BronzeAssessor', label: t('staff.assessorForm.type.bronzeAssessor', 'Bronze Assessor') }, { value: 'Assessor', label: t('staff.assessorForm.type.assessor', 'Assessor') }];
    const choices = [{ value: 'Consultant', label: t('staff.assessorForm.type.consultant', 'Consultant/Expert') }];
    if (this.offersTechnicalExpert) choices.push({ value: 'TechnicalExpert', label: t('staff.assessorForm.type.technicalExpert', 'Technical Expert') });
    return choices;
  }

  /** Typing in a multi-select's filter box changes nothing. */
  protected markDirty(event: Event): void {
    if (!(event.target as HTMLElement | null)?.matches?.('input[type=search]')) this.dirty.set(true);
  }

  protected get saveNote(): string {
    if (this.isNew && this.searches && !this.lookupDone) return t('staff.assessorForm.save.searchFirst', 'Search the certified professional to continue.');
    if (this.isNew && this.verifyOff && !this.offDetailsValid) return t('staff.assessorForm.save.enterDetails', 'Enter the certificate number, PAN, name, e-mail and mobile number to continue.');
    if (this.dirty()) return t('staff.assessorForm.save.unsaved', 'Not saved yet.');
    return this.isNew ? t('staff.assessorForm.save.fillIn', 'Fill in the details, then Create.') : t('staff.assessorForm.save.noChanges', 'No unsaved changes.');
  }

  protected get backLink(): string {
    return this.isAgency ? '/staff/users/my-assessors' : '/staff/users/assessors';
  }

  /**
   * Consultancy build: a CO adds Consultant/Experts (RoleId 3, found by certificate number and registered e-mail like
   * main's assessors) and, when it has the SiteVerification sub-role, Technical Experts (RoleId 33, name, e-mail and
   * mobile typed in), as on the old form.
   */
  protected readonly consultancy = PORTAL_SYSTEM === 'consultancy';
  /** The signed-in user's SiteVerification sub-role (the old form's UserHelper.CheckSubRole("SiteVerification")). */
  protected readonly siteVerification = (this.auth.currentUser()?.subRoles ?? []).includes('SiteVerification');

  protected get noun(): string {
    return this.consultancy ? t('staff.assessorForm.noun.consultant', 'Consultant/Expert') : t('staff.assessorForm.noun.assessor', 'Assessor');
  }

  /** Consultancy: Technical Expert is offered only to a CO with SiteVerification. */
  protected get offersTechnicalExpert(): boolean {
    return this.consultancy && this.siteVerification;
  }

  /** Consultancy: the Applicable States only with SiteVerification, as on the old form; elsewhere always. */
  protected get showStates(): boolean {
    return !this.consultancy || this.siteVerification;
  }

  /** Consultancy technical expert: no lookup, the details are typed. */
  protected get typed(): boolean {
    return this.consultancy && this.model.assessorType === 'TechnicalExpert';
  }

  /** Verification off: a certified professional's certificate number, PAN, name, e-mail and mobile are typed (no SEARCH). */
  protected get verifyOff(): boolean {
    return !this.typed && this.verification() === 'Off';
  }

  /** Verification by another portal's API: certificate number and PAN, then SEARCH. */
  protected get byApi(): boolean {
    return !this.typed && this.verification() === 'Api';
  }

  /** The professional is searched (training portal or API) before Create. */
  protected get searches(): boolean {
    return !this.typed && this.verification() !== 'Off';
  }

  /** Name, e-mail and mobile are typed on the form (technical experts, verification off). */
  protected get typesIdentity(): boolean {
    return this.isNew && (this.typed || this.verifyOff);
  }

  /** 2026-11-13: the agency changes an assessor's mobile number on its edit page (the list's Mobile No button left). */
  protected get editsMobile(): boolean {
    return !this.isNew && this.canEdit();
  }

  protected get panValid(): boolean {
    return PAN_PATTERN.test(this.model.pan.trim());
  }

  /** Verification off: the typed certificate number, PAN, name, e-mail and mobile are filled in and valid (Create is enabled). */
  protected get offDetailsValid(): boolean {
    const m = this.model;
    return !!m.assessorType && !!m.certificateNo.trim() && this.panValid && !!m.userName.trim() && EMAIL_PATTERN.test(m.emailId.trim()) &&
      MOBILE_PATTERN.test(m.mobileNo.trim());
  }

  protected panChanged(value: string | null): void {
    this.model.pan = (value ?? '').toUpperCase();
  }

  // 2026-11-18 (staff-05): "Assessor details" in sentence case; the view has no subtitle (the "View only" pill says it).
  protected get title(): string {
    const noun = this.noun;
    if (!this.isAgency) return t('staff.assessorForm.viewTitle', '{noun} details', { noun });
    return this.isNew ? t('staff.assessorForm.addTitle', 'Add {noun}', { noun }) : t('staff.assessorForm.editTitle', 'Update {noun} details', { noun });
  }

  protected get subtitle(): string | null {
    const noun = this.noun.toLowerCase();
    if (!this.isAgency) return null;
    if (!this.isNew) return t('staff.assessorForm.editSubtitle', 'Address, ID proof, states, sectors and areas of the {noun}.', { noun });
    if (this.typed) return t('staff.assessorForm.typedSubtitle', 'Enter the name, e-mail and mobile number of the technical expert.');
    if (this.verifyOff) return t('staff.assessorForm.verifyOffSubtitle', 'Enter the certificate number, PAN, name, e-mail and mobile number of the {noun} as on the certificate.', { noun });
    return this.byApi
      ? t('staff.assessorForm.apiSubtitle', 'Search the certified professional by certificate number and PAN; the name, e-mail and mobile come from that record.')
      : t('staff.assessorForm.lookupSubtitle', 'Search the certified professional by certificate number and registered e-mail; the name, e-mail and mobile come from that record.');
  }

  protected get lookupDone(): boolean {
    const p = this.professional();
    return !!p && p.key === this.lookupKey();
  }

  private lookupKey(): string {
    const second = this.byApi ? this.model.pan.trim() : this.model.professionalEmail.trim().toLowerCase();
    return [this.verification(), this.model.assessorType, this.model.certificateNo.trim(), second].join('|');
  }

  private async load(): Promise<void> {
    try {
      const options = await firstValueFrom(this.api.assessorOptions());
      this.states.set(options.states.map((s) => ({ value: s, label: s })));
      this.sectors.set(options.sectors.map((s) => ({ value: s.sectorCode, label: `${s.sectorCode}-${s.sectorName}` })));
      this.areas.set(options.areasOfKnowledge.map((a) => ({ value: a, label: a })));
      const mode = options.verification?.mode;
      this.verification.set(mode === 'TrainingPortal' || mode === 'Api' ? mode : 'Off');
      this.levels.set(this.consultancy ? [] : options.levels ?? []);
      if (this.isNew && !this.consultancy) {
        const own = (await firstValueFrom(this.api.agencySectorActivity())).message;
        this.agencyActivity.set(own === 'Manufacturing' || own === 'Services' || own === 'Both' ? own : null);
      }
      if (this.userId) {
        const a = await firstValueFrom(this.api.assessor(this.userId));
        this.model = {
          ...emptyAssessor(),
          assessorType: (this.consultancy ? a.userType : a.assessorType) ?? '', certificateNo: a.certificateNo ?? '', userName: a.userName, emailId: a.emailId ?? '',
          mobileNo: a.mobileNo ?? '', address: a.address ?? '', pinCode: a.pinCode ?? '', idProofType: a.idProofType ?? '',
          states: a.states, nicSectors: a.nicSectors, areasOfKnowledge: a.areasOfKnowledge, reasonForRejection: a.reasonForRejection ?? '',
          sectorActivity: a.sectorActivity ?? '',
          assessments: Object.fromEntries((a.assessments ?? []).map((x) => [x.level, x.modes])),
        };
        this.agencyActivity.set(a.agencySectorActivity ?? null);
        this.maskedIdProof.set(a.idProofNumberMasked);
        this.panNo.set(a.panNo ?? null);
        this.storedIdProofType.set(a.idProofType);
        this.isActive.set(a.isActive);
        this.agencyUserId.set(a.agencyUserId ?? null);
        if (a.agencyUserId && this.auth.currentUser()?.roleId === StaffRole.MasterAdmin) void this.loadAgencyName(a.agencyUserId);
        this.canEdit.set(a.canEdit && this.isAgency);
        void this.loadOpenCount();
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** Changing the type clears the looked-up details, as the old page did. */
  protected typeChanged(): void {
    this.professional.set(null);
    Object.assign(this.model, { certificateNo: '', professionalEmail: '', pan: '', userName: '', emailId: '', mobileNo: '', address: '', pinCode: '' });
  }

  protected async searchProfessional(): Promise<void> {
    this.error.set('');
    this.professional.set(null);
    const m = this.model;
    Object.assign(m, { userName: '', emailId: '', mobileNo: '', address: '', pinCode: '' });
    if (this.byApi) {
      if (!m.assessorType || !m.certificateNo.trim() || !this.panValid) {
        this.error.set(t('staff.assessorForm.error.lookupPan', 'Please enter the Certificate Number and a valid PAN (e.g. ABCDE1234F).'));
        return;
      }
    } else if (!m.assessorType || !m.certificateNo.trim() || !m.professionalEmail.trim()) {
      this.error.set(t('staff.assessorForm.error.lookupEmail', 'Please enter the Certificate Number and the Registered Email Id.'));
      return;
    }
    this.searching.set(true);
    try {
      const p = await firstValueFrom(this.byApi
        ? this.api.lookupProfessionalByPan(m.assessorType, m.certificateNo.trim(), m.pan.trim())
        : this.api.lookupProfessional(m.assessorType, m.certificateNo.trim(), m.professionalEmail.trim()));
      Object.assign(m, { userName: p.name, emailId: p.email, mobileNo: p.mobileNo, address: p.address ?? '', pinCode: p.pinCode ?? '' });
      this.professional.set({ key: this.lookupKey(), data: p });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.searching.set(false);
    }
  }

  protected missing(value: string): boolean {
    return this.submitted() && !value.trim();
  }

  protected get idProofPlaceholder(): string {
    const masked = this.maskedIdProof();
    if (!masked || this.model.idProofType !== this.storedIdProofType()) return '';
    return this.canEdit() ? t('staff.assessorForm.idProof.keepPlaceholder', '{masked} (leave blank to keep)', { masked }) : masked;
  }

  protected async submit(): Promise<void> {
    if (!this.canEdit()) return;
    this.submitted.set(true);
    this.error.set('');
    const m = this.model;
    if (this.isNew && this.typed && [m.userName, m.emailId, m.mobileNo].some((v) => !v.trim())) {
      this.error.set(t('staff.assessorForm.error.typedDetails', 'Please enter the name, e-mail and mobile number.'));
      return;
    }
    if (this.isNew && this.verifyOff) {
      if (!m.assessorType || !m.certificateNo.trim() || [m.pan, m.userName, m.emailId, m.mobileNo].some((v) => !v.trim())) {
        this.error.set(t('staff.assessorForm.error.offDetails', 'Please enter the certificate number, PAN, name, e-mail and mobile number.'));
        return;
      }
      if (!this.panValid) {
        this.error.set(t('staff.assessorForm.error.pan', 'Please enter a valid PAN (e.g. ABCDE1234F).'));
        return;
      }
      if (!EMAIL_PATTERN.test(m.emailId.trim())) {
        this.error.set(t('staff.assessorForm.error.email', 'Please enter a valid Email ID.'));
        return;
      }
      if (!MOBILE_PATTERN.test(m.mobileNo.trim())) {
        this.error.set(t('staff.assessorForm.error.mobile', 'Please enter a valid 10 digit mobile number.'));
        return;
      }
    }
    if (!this.consultancy && this.levels().length && !this.ticks().length) {
      this.error.set(t('staff.assessorForm.error.noScope', 'Please tick at least one certification level and mode the assessor may assess.'));
      return;
    }
    if (this.editsMobile && !MOBILE_PATTERN.test(m.mobileNo.trim())) {
      this.error.set(t('staff.assessorForm.error.mobile', 'Please enter a valid 10 digit mobile number.'));
      return;
    }
    if (this.isNew && this.searches && !this.lookupDone) {
      this.error.set(t('staff.assessorForm.error.searchFirst', 'Please SEARCH the certified professional first.'));
      return;
    }
    const keepsStoredId = !this.isNew && m.idProofType === this.storedIdProofType() && !!this.maskedIdProof();
    if (!m.address.trim() || !m.pinCode.trim() || !m.idProofType || (!m.idProofNumber.trim() && !keepsStoredId)) {
      this.error.set(t('staff.assessorForm.error.invalid', 'Please enter valid data.'));
      return;
    }
    if (!this.consultancy && !m.sectorActivity) {
      this.error.set(t('staff.assessorForm.error.noSectorType', 'Please select whether the assessor assesses Manufacturing, Services or Both.'));
      return;
    }
    this.saving.set(true);
    try {
      if (this.isNew) {
        const r = await firstValueFrom(
          this.api.createAssessor({
            assessorType: m.assessorType, certificateNo: m.certificateNo.trim(), professionalEmail: m.professionalEmail.trim(),
            address: m.address, pinCode: m.pinCode, idProofType: m.idProofType, idProofNumber: m.idProofNumber,
            states: m.states, nicSectors: m.nicSectors, areasOfKnowledge: m.areasOfKnowledge, sectorActivity: m.sectorActivity,
            ...(this.typesIdentity ? { userName: m.userName.trim(), emailId: m.emailId.trim(), mobileNo: m.mobileNo.trim() } : {}),
            ...(this.verifyOff || this.byApi ? { pan: m.pan.trim() } : {}),
            ...(this.consultancy ? {} : { assessments: this.ticks() }),
          }),
        );
        await this.router.navigate(['/staff/users/my-assessors'], { state: { message: r.message } });
      } else {
        const r = await firstValueFrom(
          this.api.updateAssessor(this.userId!, {
            address: m.address, pinCode: m.pinCode, idProofType: m.idProofType, idProofNumber: m.idProofNumber, states: m.states,
            nicSectors: m.nicSectors, areasOfKnowledge: m.areasOfKnowledge, reasonForRejection: m.reasonForRejection, sectorActivity: m.sectorActivity,
            mobileNo: m.mobileNo.trim(),
            ...(this.consultancy || !this.levels().length ? {} : { assessments: this.ticks() }),
          }),
        );
        this.toast.success(t('staff.assessorForm.toast.updated', '{noun} updated', { noun: this.noun }), r.message);
        this.dirty.set(false);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
