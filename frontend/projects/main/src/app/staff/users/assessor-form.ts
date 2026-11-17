import { Component, computed, inject, signal } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { PORTAL_SYSTEM } from '../../portal-system';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { staffCrumbs } from '../staff-crumbs';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { ToastService } from '../toast';
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
  imports: [FormsModule, NgTemplateOutlet, RouterLink, MultiSelect, AssessorMobilePanel, PageHead, ConfirmDialog, ReasonDialog, UserHistoryPanel],
  styleUrl: './assessor-form-scope.scss',
  templateUrl: './assessor-form.html',
})
export class AssessorFormPage {
  private readonly api = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly toast = inject(ToastService);

  protected readonly userId: string | null = inject(ActivatedRoute).snapshot.paramMap.get('userId');
  protected readonly isAgency = this.auth.currentUser()?.roleId === StaffRole.Agency;
  protected readonly isNew = !this.userId;
  /** Agencies create and edit their assessors; the MasterAdmin only views them. */
  protected readonly canEdit = signal(this.isNew && this.isAgency);
  /**
   * V4: the saved assessor's registered mobile of the site assessor app (one phone per assessor), for the Admin and the
   * MasterAdmin only (never agencies), on the main portal (Consultancy has no site assessor app).
   */
  protected readonly showsMobile = !this.isNew && canSeeAssessorMobile(this.auth.currentUser()?.roleId) && inject(STAFF_SYSTEM) === 'main';

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

  constructor() {
    void this.load();
  }

  // ---- 2026-11-17 (staff-05): page head, actions and right rail ----

  /** Who may block, unblock, send a reset link and see the history (StaffAssessorsController: Agency and MasterAdmin). */
  protected readonly managesLogin = this.isAgency || this.auth.currentUser()?.roleId === StaffRole.MasterAdmin;

  protected get crumbs() {
    return staffCrumbs({ label: this.consultancy ? 'Consultants/Experts' : 'Assessors', link: this.backLink }, { label: this.userId ?? 'Add' });
  }

  /** The head's actions: a saved assessor, once loaded. */
  protected get actions(): boolean {
    return !this.isNew && this.managesLogin && this.isActive() !== null;
  }

  /** The agency the assessor belongs to (the details carry its ID only). */
  protected readonly agencyUserId = signal<string | null>(null);

  /** The agency's own name when the agency itself looks at its assessor. */
  protected get agencyName(): string | null {
    const me = this.auth.currentUser();
    return this.isAgency && me && me.userId === this.agencyUserId() ? me.userName || null : null;
  }

  protected get agencyWord(): string {
    return this.consultancy ? 'Consultant Organisation' : 'Assessment agency';
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

  protected openWords(n: number): string {
    return `${n} ${this.consultancy ? 'case' : 'assessment'}${n === 1 ? '' : 's'}`;
  }

  /** Coverage: the states, sectors and areas collapse to a count or the first one, until "View all". */
  protected readonly coverageOpen = signal(false);

  protected labelsOf(values: readonly string[], options: readonly MultiSelectOption[]): string[] {
    return values.map((v) => options.find((o) => o.value === v)?.label ?? v);
  }

  protected firstOf(values: readonly string[], options: readonly MultiSelectOption[]): string {
    if (!values.length) return 'None selected';
    const first = this.labelsOf(values.slice(0, 1), options)[0];
    return values.length > 1 ? `${first} +${values.length - 1} more` : first;
  }

  /** The confirmation open: block (with its reason) or the reset link. */
  protected readonly confirming = signal<'block' | 'reset' | null>(null);
  protected readonly confirmBusy = signal(false);
  protected readonly confirmFailed = signal('');

  protected readonly confirmAsk = computed<ConfirmAsk | null>(() => {
    const kind = this.confirming();
    const name = this.model.userName || this.userId!;
    if (kind === 'reset') return resetLinkAsk(this.model.userName, this.userId!, this.model.emailId);
    if (kind !== 'block') return null;
    const n = this.openCount();
    const who = this.consultancy ? 'consultant/expert' : 'assessor';
    const open = n
      ? ` ${this.openWords(n)} allotted to this ${who} ${n === 1 ? 'is' : 'are'} still open; ${this.isAgency ? 'you' : 'the ' + (this.consultancy ? 'organisation' : 'agency')} will need to re-allot ${n === 1 ? 'it' : 'them'}.`
      : '';
    return {
      title: `Block ${name}?`,
      message: `${name} (${this.userId}) will not be able to sign in.${open} Nothing is deleted; you can unblock at any time.`,
      confirmLabel: 'Block ' + this.noun.toLowerCase(),
      danger: true,
      reason: {
        label: 'Reason for blocking', placeholder: `Shown in the ${who}'s history`, requiredMessage: 'Please enter the reason for blocking.', maxLength: 2000,
        hint: `Kept in the history and e-mailed to the ${who}.`,
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
        this.toast.success(this.noun + ' blocked', r.message);
      } else {
        const r = await firstValueFrom(this.api.passwordReset('assessors', this.userId));
        this.toast.success('Reset link sent', 'E-mailed to ' + sentTo(r.message, this.model.emailId));
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
      this.toast.success(this.noun + ' unblocked', r.message);
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
      this.historyItems.set(blockHistoryItems(entries, this.consultancy ? 'organisation' : 'agency'));
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
    if (!this.consultancy) return [{ value: 'BronzeAssessor', label: 'Bronze Assessor' }, { value: 'Assessor', label: 'Assessor' }];
    const choices = [{ value: 'Consultant', label: 'Consultant/Expert' }];
    if (this.offersTechnicalExpert) choices.push({ value: 'TechnicalExpert', label: 'Technical Expert' });
    return choices;
  }

  /** Typing in a multi-select's filter box changes nothing. */
  protected markDirty(event: Event): void {
    if (!(event.target as HTMLElement | null)?.matches?.('input[type=search]')) this.dirty.set(true);
  }

  protected get saveNote(): string {
    if (this.isNew && this.searches && !this.lookupDone) return 'Search the certified professional to continue.';
    if (this.isNew && this.verifyOff && !this.offDetailsValid) return 'Enter the certificate number, PAN, name, e-mail and mobile number to continue.';
    if (this.dirty()) return 'Not saved yet.';
    return this.isNew ? 'Fill in the details, then Create.' : 'No unsaved changes.';
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
    return this.consultancy ? 'Consultant/Expert' : 'Assessor';
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

  protected get title(): string {
    if (!this.isAgency) return this.noun + ' Details';
    return this.isNew ? 'Add ' + this.noun : 'Update ' + this.noun + ' Details';
  }

  protected get subtitle(): string {
    const noun = this.noun.toLowerCase();
    if (!this.isAgency) return `Details of the ${noun} (view only).`;
    if (!this.isNew) return `Address, ID proof, states, sectors and areas of the ${noun}.`;
    if (this.typed) return 'Enter the name, e-mail and mobile number of the technical expert.';
    if (this.verifyOff) return `Enter the certificate number, PAN, name, e-mail and mobile number of the ${noun} as on the certificate.`;
    return this.byApi
      ? 'Search the certified professional by certificate number and PAN; the name, e-mail and mobile come from that record.'
      : 'Search the certified professional by certificate number and registered e-mail; the name, e-mail and mobile come from that record.';
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
        this.error.set('Please enter the Certificate Number and a valid PAN (e.g. ABCDE1234F).');
        return;
      }
    } else if (!m.assessorType || !m.certificateNo.trim() || !m.professionalEmail.trim()) {
      this.error.set('Please enter the Certificate Number and the Registered Email Id.');
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
    return this.canEdit() ? `${masked} (leave blank to keep)` : masked;
  }

  protected async submit(): Promise<void> {
    if (!this.canEdit()) return;
    this.submitted.set(true);
    this.error.set('');
    const m = this.model;
    if (this.isNew && this.typed && [m.userName, m.emailId, m.mobileNo].some((v) => !v.trim())) {
      this.error.set('Please enter the name, e-mail and mobile number.');
      return;
    }
    if (this.isNew && this.verifyOff) {
      if (!m.assessorType || !m.certificateNo.trim() || [m.pan, m.userName, m.emailId, m.mobileNo].some((v) => !v.trim())) {
        this.error.set('Please enter the certificate number, PAN, name, e-mail and mobile number.');
        return;
      }
      if (!this.panValid) {
        this.error.set('Please enter a valid PAN (e.g. ABCDE1234F).');
        return;
      }
      if (!EMAIL_PATTERN.test(m.emailId.trim())) {
        this.error.set('Please enter a valid Email ID.');
        return;
      }
      if (!MOBILE_PATTERN.test(m.mobileNo.trim())) {
        this.error.set('Please enter a valid 10 digit mobile number.');
        return;
      }
    }
    if (!this.consultancy && this.levels().length && !this.ticks().length) {
      this.error.set('Please tick at least one certification level and mode the assessor may assess.');
      return;
    }
    if (this.editsMobile && !MOBILE_PATTERN.test(m.mobileNo.trim())) {
      this.error.set('Please enter a valid 10 digit mobile number.');
      return;
    }
    if (this.isNew && this.searches && !this.lookupDone) {
      this.error.set('Please SEARCH the certified professional first.');
      return;
    }
    const keepsStoredId = !this.isNew && m.idProofType === this.storedIdProofType() && !!this.maskedIdProof();
    if (!m.address.trim() || !m.pinCode.trim() || !m.idProofType || (!m.idProofNumber.trim() && !keepsStoredId)) {
      this.error.set('Please enter valid data.');
      return;
    }
    if (!this.consultancy && !m.sectorActivity) {
      this.error.set('Please select whether the assessor assesses Manufacturing, Services or Both.');
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
        this.toast.success(this.noun + ' updated', r.message);
        this.dirty.set(false);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
