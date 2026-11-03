import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PORTAL_SYSTEM } from '../../portal-system';
import { STAFF_SYSTEM, StaffRole } from '../staff-menu';
import { assessorTypeLabel, initialsOf } from './assessor-list';
import { AssessorMobilePanel, canSeeAssessorMobile } from './assessor-mobile';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { Professional, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';

interface AssessorModel {
  assessorType: string;
  certificateNo: string;
  professionalEmail: string;
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
}

function emptyAssessor(): AssessorModel {
  return {
    assessorType: '', certificateNo: '', professionalEmail: '', userName: '', emailId: '', mobileNo: '', address: '', pinCode: '',
    idProofType: '', idProofNumber: '', states: [], nicSectors: [], areasOfKnowledge: [], reasonForRejection: '', sectorActivity: '',
  };
}

/**
 * Add / update an assessor (agency) or view one (MasterAdmin). Port of Views/User/Assessor.cshtml.
 * For a new assessor the agency looks up the certified professional by certificate number and
 * registered e-mail; name, e-mail and mobile come from that record (the API repeats the lookup). V4 layout: a profile card
 * (initials, ID, certificate, type, sector type and status) above a saved assessor, numbered sections (type and
 * certificate, contact, ID proof, what the assessor assesses, block reason), the type, ID proof and sector type as choice
 * chips, the lookup in a shaded box that names the professional found, and a sticky save bar showing unsaved changes.
 */
@Component({
  selector: 'zed-staff-assessor-form',
  imports: [FormsModule, RouterLink, MultiSelect, AssessorMobilePanel],
  templateUrl: './assessor-form.html',
  styles: `
    fieldset { min-width: 0; }
    .form-grid > .top { align-self: start; padding-top: 8px; }
    .readonly { background-color: #eef1f2 !important; }
    .help-block { color: #a94442; font-size: 13px; }
    .af-label { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .form-grid .form-control.af-short { max-width: 160px; }
    .form-grid .form-control.af-mid { max-width: 320px; }

    .af-profile { display: flex; flex-wrap: wrap; align-items: center; gap: 14px 16px; padding: 16px 20px; }
    .af-avatar { flex: 0 0 48px; width: 48px; height: 48px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); font-weight: 700; font-size: 16px; letter-spacing: .03em; }
    .af-who { flex: 1 1 220px; min-width: 0; }
    .af-name { display: block; font-size: 18px; font-weight: 700; color: #23474a; overflow-wrap: anywhere; }
    .af-id { display: block; font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }
    .af-tags { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
    .af-tags .zed-chip { margin: 0; }
    .af-sector { background: #f1f0fb; color: #3f3a7a; }

    .af-section { padding: 18px 20px 20px; }
    .af-head { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; color: #23474a; margin: 0 0 16px; }
    .af-no { flex: none; width: 28px; height: 28px; border-radius: 50%; background: #45a5ad; color: #fff; font-size: 14px; display: grid; place-items: center; }
    .af-hint { font-size: 13px; color: #5f6f70; margin: 0 0 10px; }

    /* Choice chips: one radio per pill (assessor type, ID proof, sector type). */
    .af-chips { display: flex; flex-wrap: wrap; gap: 8px; min-height: 38px; align-items: center; }
    .af-chip { position: relative; display: inline-flex; align-items: center; gap: 8px; margin: 0; padding: 7px 16px; border-radius: 20px;
      border: 1px solid #cbd9da; background: #fff; color: #2f7c83; font-weight: 600; font-size: 14px; cursor: pointer; }
    .af-chip input { position: absolute; opacity: 0; width: 1px; height: 1px; margin: 0; pointer-events: none; }
    .af-chip::before { content: ''; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #9fbfc1; background: #fff; box-sizing: border-box; }
    .af-chip:hover { background: #eef6f6; border-color: #45a5ad; }
    .af-chip.active { background: #45a5ad; border-color: #45a5ad; color: #fff; }
    .af-chip.active::before { border: 4px solid #fff; background: #45a5ad; }
    .af-chip:has(input:focus-visible) { outline: 2px solid #2f7c83; outline-offset: 2px; }
    .af-chip.is-off { opacity: .5; cursor: not-allowed; background: #f4f6f6; }
    fieldset:disabled .af-chip { cursor: default; }
    fieldset:disabled .af-chip:not(.active) { background: #f4f6f6; color: #7d8c8d; }

    .lookup { background: #f5fafa; border: 1px solid #e1eded; border-radius: 10px; padding: 12px 14px; margin-top: 16px; }
    .af-found { display: flex; align-items: center; gap: 12px; margin-top: 12px; padding: 10px 12px; border-radius: 10px; background: #e6f6ec; color: #1e7a3c; font-size: 14px; }
    .af-found .af-avatar { flex-basis: 40px; width: 40px; height: 40px; font-size: 14px; }
    #selfieimg { max-height: 90px; border-radius: 8px; }

    /* Save bar: stays at the bottom of the window while there are changes. */
    .save-bar { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 0 0 18px; padding: 12px 16px;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .save-bar.is-dirty { border-color: #e9c46a; background: #fffcf2; }
    .save-bar > span { flex: 1 1 180px; min-width: 0; }
    .unsaved { font-weight: 600; color: #8a6100; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .af-section { padding: 14px; }
      .form-grid .form-control.af-short, .form-grid .form-control.af-mid { max-width: none; }
      .lookup .filter-bar > .filter { max-width: none; flex-basis: 100%; }
    }
  `,
})
export class AssessorFormPage {
  private readonly api = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);

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
  protected readonly storedIdProofType = signal<string | null>(null);
  protected readonly states = signal<MultiSelectOption[]>([]);
  protected readonly sectors = signal<MultiSelectOption[]>([]);
  protected readonly areas = signal<MultiSelectOption[]>([]);
  /** Lookup result; required (and still matching the certificate/e-mail fields) before a new assessor can be created. */
  protected readonly professional = signal<{ key: string; data: Professional } | null>(null);
  protected readonly loading = signal(true);
  protected readonly searching = signal(false);
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
  protected readonly success = signal('');
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
    if (this.isNew && !this.typed && !this.lookupDone) return 'Search the certified professional to continue.';
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

  protected get title(): string {
    if (!this.isAgency) return this.noun + ' Details';
    return this.isNew ? 'Add ' + this.noun : 'Update ' + this.noun + ' Details';
  }

  protected get subtitle(): string {
    const noun = this.noun.toLowerCase();
    if (!this.isAgency) return `Details of the ${noun} (view only).`;
    if (!this.isNew) return `Address, ID proof, states, sectors and areas of the ${noun}.`;
    return this.typed
      ? 'Enter the name, e-mail and mobile number of the technical expert.'
      : 'Search the certified professional by certificate number and registered e-mail; the name, e-mail and mobile come from that record.';
  }

  protected get lookupDone(): boolean {
    const p = this.professional();
    return !!p && p.key === this.lookupKey();
  }

  private lookupKey(): string {
    return [this.model.assessorType, this.model.certificateNo.trim(), this.model.professionalEmail.trim().toLowerCase()].join('|');
  }

  private async load(): Promise<void> {
    try {
      const options = await firstValueFrom(this.api.assessorOptions());
      this.states.set(options.states.map((s) => ({ value: s, label: s })));
      this.sectors.set(options.sectors.map((s) => ({ value: s.sectorCode, label: `${s.sectorCode}-${s.sectorName}` })));
      this.areas.set(options.areasOfKnowledge.map((a) => ({ value: a, label: a })));
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
        };
        this.agencyActivity.set(a.agencySectorActivity ?? null);
        this.maskedIdProof.set(a.idProofNumberMasked);
        this.storedIdProofType.set(a.idProofType);
        this.isActive.set(a.isActive);
        this.canEdit.set(a.canEdit && this.isAgency);
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
    Object.assign(this.model, { certificateNo: '', professionalEmail: '', userName: '', emailId: '', mobileNo: '', address: '', pinCode: '' });
  }

  protected async searchProfessional(): Promise<void> {
    this.error.set('');
    this.professional.set(null);
    const m = this.model;
    Object.assign(m, { userName: '', emailId: '', mobileNo: '', address: '', pinCode: '' });
    if (!m.assessorType || !m.certificateNo.trim() || !m.professionalEmail.trim()) {
      this.error.set('Please enter the Certificate Number and the Registered Email Id.');
      return;
    }
    this.searching.set(true);
    try {
      const p = await firstValueFrom(this.api.lookupProfessional(m.assessorType, m.certificateNo.trim(), m.professionalEmail.trim()));
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
    this.success.set('');
    const m = this.model;
    if (this.isNew && this.typed && [m.userName, m.emailId, m.mobileNo].some((v) => !v.trim())) {
      this.error.set('Please enter the name, e-mail and mobile number.');
      return;
    }
    if (this.isNew && !this.typed && !this.lookupDone) {
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
            ...(this.typed ? { userName: m.userName.trim(), emailId: m.emailId.trim(), mobileNo: m.mobileNo.trim() } : {}),
          }),
        );
        await this.router.navigate(['/staff/users/my-assessors'], { state: { message: r.message } });
      } else {
        const r = await firstValueFrom(
          this.api.updateAssessor(this.userId!, {
            address: m.address, pinCode: m.pinCode, idProofType: m.idProofType, idProofNumber: m.idProofNumber, states: m.states,
            nicSectors: m.nicSectors, areasOfKnowledge: m.areasOfKnowledge, reasonForRejection: m.reasonForRejection, sectorActivity: m.sectorActivity,
          }),
        );
        this.success.set(r.message);
        this.dirty.set(false);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
