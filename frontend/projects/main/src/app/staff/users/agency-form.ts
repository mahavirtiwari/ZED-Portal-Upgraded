import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { AgencyRequest, CodeName, District, OrgPartner, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { SchemeTicksPanel } from '../scheme-verification/scheme-ticks-panel';

/** The server's formats (StaffUserRules): shown as you type, so they are fixed before submit. */
const PIN = /^\d{6}$/;
const MOBILE = /^\d{10}$/;
const GST = /^[0-9A-Za-z]{1,20}$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** One section of the progress list on the left. */
interface FormSection {
  id: string;
  label: string;
  hint: string;
  done: boolean;
}

function emptyAgency(): AgencyRequest {
  return {
    userName: '', spocName: '', emailId: '', mobileNo: '', address: '', pinCode: '', gstNumber: '', states: [], nicSectors: [],
    orgPartnerId: '', desktopVerification: false, siteVerification: false, financialVerification: false, reasonForRejection: '',
    tuPreferredState: '', tuPreferredDistricts: [], sectorActivity: '',
  };
}

/**
 * Add / update an assessment agency (MasterAdmin). Port of Views/User/CertificationBodies.cshtml.
 * The role and the creating user are decided by the API; the generated password is e-mailed to the SPOC.
 * Consultancy build: a Consultant Organisation (Handholding Support or Technology Intervention, not both; no Desktop
 * Verification), no organising partner, and with Technology Intervention the applicable state and districts it is
 * auto-allotted TU applications from. V4 layout: numbered section cards (organisation, SPOC contact, coverage, category,
 * login), sector type and categories as choice cards with a one-line explanation, and a sticky save bar that shows
 * unsaved changes and the last error.
 * 2026-11-17 (approved staff redesign, staff-02): the sections listed on the left with a tick as each becomes valid, the
 * category under Coverage, "On submit" (what happens next) on the right, PIN / GSTIN / e-mail / mobile checked as you type
 * against the server's formats, and the save bar says how many sections are complete. Every field and rule is kept; the
 * Login section (User ID, status, reason for block) is shown when updating.
 */
@Component({
  selector: 'zed-staff-agency-form',
  imports: [FormsModule, RouterLink, MultiSelect, PageHead, TextPipe, SchemeTicksPanel],
  templateUrl: './agency-form.html',
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-02 values. */
    .af { display: grid; grid-template-columns: 260px minmax(0, 1fr) 280px; gap: 20px; align-items: start; }
    .af-left, .af-rail { position: sticky; top: 12px; }
    .af-nav { padding: 8px; margin: 0; }
    .af-step { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 10px 12px; border: 0; border-radius: 10px; background: none; text-align: left; }
    .af-step:hover { background: #f1f9f9; }
    .af-step.current { background: #e6f2f3; }
    .af-dot { flex: none; width: 24px; height: 24px; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid #17373b; color: #17373b; font-size: 11px; font-weight: 700; }
    .af-step.done .af-dot { background: #2f9e58; border-color: #2f9e58; }
    .af-dot svg, .ok, .ic, .step svg { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .af-dot svg { width: 14px; height: 14px; stroke: #fff; stroke-width: 3; }
    .af-step-text { display: flex; flex-direction: column; min-width: 0; }
    .af-step-text strong { font-size: 13.5px; color: #17373b; }
    .af-step-text small { font-size: 11.5px; font-weight: 500; color: #6f8487; }
    .req-note { margin: 10px 4px 0; font-size: 12px; color: #6f8487; }
    .form-section { padding: 0; overflow: hidden; scroll-margin-top: 12px; }
    .section-head { display: flex; align-items: center; gap: 12px; margin: 0; padding: 13px 20px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; }
    .step { flex: none; width: 30px; height: 30px; border-radius: 8px; background: #e6f2f3; color: #24666b; display: grid; place-items: center; }
    .step svg { width: 16px; height: 16px; }
    .ic { flex: none; width: 16px; height: 16px; }
    .fs-body { padding: 18px 24px 20px; display: flex; flex-direction: column; gap: 14px; }
    .fld { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
    .fld > label, .lbl { margin: 0; font-size: 12.5px; font-weight: 600; color: #17373b; text-transform: none; }
    .fld .form-control, .fld .form-select { min-height: 40px; border-radius: 9px; font-size: 13px; }
    .fld-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px 16px; align-items: start; }
    .fld-row.pin-row { grid-template-columns: 200px 300px; }
    .fs-note { display: flex; align-items: center; gap: 6px; align-self: end; margin: 0 0 11px; font-size: 12px; font-weight: 500; color: #6f8487; }
    .fs-note .ic { width: 14px; height: 14px; }
    .fs-hint { font-size: 12px; color: #6f8487; }
    .seg { display: inline-flex; padding: 3px; border-radius: 9px; background: #eef3f3; }
    .seg label { position: relative; flex: 1; margin: 0; padding: 6px 18px; border-radius: 7px; text-align: center; cursor: pointer; color: #6f8487; font-size: 13px; font-weight: 500; }
    .seg label.active { background: #fff; color: #24666b; font-weight: 700; box-shadow: inset 0 0 0 1.5px #24666b; }
    .seg input { position: absolute; opacity: 0; inset: 0; cursor: pointer; }
    .seg label:focus-within { outline: 2px solid var(--zt-mid2, #2a8a8c); }
    .checks { display: flex; flex-wrap: wrap; gap: 10px 36px; min-height: 36px; align-items: center; }
    .chk { display: flex; align-items: center; gap: 12px; margin: 0; font-size: 13.5px; font-weight: 600; color: #17373b; cursor: pointer; text-transform: none; }
    .chk .form-check-input { flex: none; float: none; width: 20px; height: 20px; margin: 0; border: 1.5px solid #24666b; border-radius: 5px; }
    .chk small { display: block; font-weight: 400; color: #9a5f06; }
    .chk.locked { color: #8a9899; cursor: not-allowed; }
    .login-id { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .user-id { font: 700 14px/1.5 SFMono-Regular, Consolas, monospace; color: #24666b; }
    .af-rail { padding: 0; margin: 0; overflow: hidden; }
    .af-rail h4 { margin: 0; padding: 18px 24px 16px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; color: #17373b; }
    .af-rail ul { list-style: none; margin: 0; padding: 18px 20px; display: flex; flex-direction: column; gap: 16px; font-size: 12px; font-weight: 500; color: #3d5559; }
    .af-rail li { display: flex; align-items: flex-start; gap: 12px; }
    .help-block { color: #c8473c; font-size: 12.5px; }
    .save-bar { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 20px 0 18px; padding: 16px 24px;
      background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .save-bar.is-dirty { border-color: #e9c46a; background: #fffcf2; }
    .save-bar .btn { min-width: 110px; min-height: 40px; }
    .save-bar .btn-primary { min-width: 170px; }
    .save-progress { display: inline-flex; align-items: center; gap: 12px; font-size: 13.5px; font-weight: 500; color: #3d5559; }
    .ok { flex: none; width: 20px; height: 20px; }
    .ok circle { fill: #2f9e58; stroke: none; }
    .ok path { stroke: #fff; stroke-width: 2.4; }
    .unsaved { font-weight: 600; color: #9a5f06; }
    .save-error { font-weight: 600; color: #c8473c; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 1199.98px) {
      .af { grid-template-columns: 220px minmax(0, 1fr); }
      .af-rail { position: static; grid-column: 2; }
    }
    @media (max-width: 767.98px) {
      .af { grid-template-columns: minmax(0, 1fr); }
      .af-left { position: static; }
      .af-rail { grid-column: auto; }
      .fld-row, .fld-row.pin-row { grid-template-columns: minmax(0, 1fr); }
      .fs-body, .section-head { padding-left: 14px; padding-right: 14px; }
      .save-bar > span { flex-basis: 100%; }
    }
  `,
})
export class AgencyFormPage {
  private readonly api = inject(UsersApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);

  protected readonly userId: string | null = inject(ActivatedRoute).snapshot.paramMap.get('userId');
  protected readonly isEdit = !!this.userId;
  protected readonly consultancy = PORTAL_SYSTEM === 'consultancy';
  protected readonly labels = PORTAL_LABELS;
  protected readonly word = computed(() => (this.consultancy ? t('staff.agencyForm.word.organisation', 'organisation') : t('staff.agencyForm.word.agency', 'agency')));
  protected readonly title = computed(() => (this.isEdit ? t('staff.agencyForm.editTitle', 'Update {agency} Details', { agency: PORTAL_LABELS.agency })
    : t('staff.agencyForm.addTitle', 'Add {agency}', { agency: PORTAL_LABELS.agency })));
  protected readonly crumbs = computed(() => staffCrumbs({ label: PORTAL_LABELS.agencies, link: '/staff/users/agencies' },
    { label: this.userId ?? t('staff.agencyForm.crumb.add', 'Add') }));
  protected readonly subtitle = computed(() => (this.isEdit
    ? t('staff.agencyForm.editSubtitle', 'Details, categories and applicable states of the {agency}.', { agency: PORTAL_LABELS.agency.toLowerCase() })
    : t('staff.agencyForm.addSubtitle', 'The login ID is generated and the login details are e-mailed to the SPOC.')));
  /** The right rail: what happens on submit / update. */
  protected readonly railPoints = computed(() => (this.isEdit
    ? [t('staff.agencyForm.rail.update.point1', 'Changes apply as soon as you update.'),
       t('staff.agencyForm.rail.update.point2', 'The SPOC e-mail address is where login details and messages go.'),
       t('staff.agencyForm.rail.update.point3', 'Block, unblock and reset links are on the list (⋮ menu).'),
       t('staff.agencyForm.rail.update.point4', 'Levels are switched in Agency Level Allocation.')]
    : [t('staff.agencyForm.rail.submit.point1', 'A login ID is generated for the {word}.', { word: this.word() }),
       t('staff.agencyForm.rail.submit.point2', 'The login details are e-mailed to the SPOC.'),
       t('staff.agencyForm.rail.submit.point3', 'The {word} can then add its {assessors}.', { word: this.word(), assessors: PORTAL_LABELS.assessors.toLowerCase() }),
       ...(this.consultancy ? [] : [t('staff.agencyForm.rail.submit.point4', 'Levels are switched on in Agency Level Allocation.')])]));
  /** 2026-11-18 (staff-02): the line icons of the section heads and "On submit" (person, mail, people, shield). */
  protected readonly icon = {
    building: 'M3 21h18 M5 21V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16 M9 7h2 M13 7h2 M9 11h2 M13 11h2 M9 15h2 M13 15h2',
    person: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z',
    pin: 'M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z M12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z',
    lock: 'M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z M7 11V7a5 5 0 0 1 10 0v4',
    mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z M22 6l-10 7L2 6',
    people: 'M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M23 21v-2a4 4 0 0 0-3-3.87 M16 3.13a4 4 0 0 1 0 7.75',
    shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z',
    info: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01',
  };
  protected readonly railIcons: string[] = this.isEdit
    ? [this.icon.info, this.icon.mail, this.icon.lock, this.icon.shield]
    : [this.icon.person, this.icon.mail, this.icon.people, this.icon.shield];
  protected readonly tuStates = signal<CodeName[]>([]);
  protected readonly districts = signal<MultiSelectOption[]>([]);

  protected model: AgencyRequest = emptyAgency();
  /** Manufacturing / Services / Both; a Master Admin limited to one category is offered that one only (migration 0057). */
  protected activities = SECTOR_ACTIVITIES;
  protected readonly activityHelp = computed<Record<SectorActivity, string>>(() => ({
    Manufacturing: t('staff.agencyForm.cover.manufacturingTooltip', 'Manufacturing MSMEs only.'),
    Services: t('staff.agencyForm.cover.servicesTooltip', 'Service MSMEs only.'),
    Both: t('staff.agencyForm.cover.bothTooltip', 'Manufacturing and service MSMEs.'),
  }));
  protected readonly states = signal<MultiSelectOption[]>([]);
  protected readonly sectors = signal<MultiSelectOption[]>([]);
  protected readonly partners = signal<OrgPartner[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal('');
  /** Something was changed since the page loaded or was last saved (shown in the save bar). */
  protected readonly dirty = signal(false);
  /** Edit: the account's status as loaded (null while loading or when adding). */
  protected readonly isActive = signal<boolean | null>(null);
  protected readonly sortedPartners = computed(() => [...this.partners()].sort((a, b) => a.name.localeCompare(b.name)));

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      const options = await firstValueFrom(this.api.agencyOptions());
      this.states.set(options.states.map((s) => ({ value: s, label: s })));
      this.sectors.set(
        options.sectors.map((s) => ({ value: s.sectorCode, label: `${s.sectorCode}-${s.sectorName}` })).sort((a, b) => a.label.localeCompare(b.label)),
      );
      this.tuStates.set(options.tuStates ?? []);
      if (options.scopeSector) {
        const only = options.scopeSector;
        this.activities = SECTOR_ACTIVITIES.filter((x) => x.value === only);
        if (!this.userId) this.model.sectorActivity = only;
      }
      if (this.userId) {
        const a = await firstValueFrom(this.api.agency(this.userId));
        this.model = {
          userName: a.userName, spocName: a.spocName ?? '', emailId: a.emailId ?? '', mobileNo: a.mobileNo ?? '', address: a.address ?? '',
          pinCode: a.pinCode ?? '', gstNumber: a.gstNumber ?? '', states: a.states, nicSectors: a.nicSectors, orgPartnerId: a.orgPartnerId ?? '',
          desktopVerification: a.desktopVerification, siteVerification: a.siteVerification, financialVerification: a.financialVerification,
          reasonForRejection: a.reasonForRejection ?? '',
          tuPreferredState: a.tuPreferredState ?? '', tuPreferredDistricts: a.tuPreferredDistricts ?? [], sectorActivity: a.sectorActivity ?? '',
        };
        this.isActive.set(a.isActive);
        if (this.consultancy && this.model.tuPreferredState) await this.loadDistricts(this.model.tuPreferredState, false);
        // As before, an existing agency keeps its organising partner (or none); it cannot be moved to another one.
        this.partners.set(a.orgPartnerId ? [{ userId: a.orgPartnerId, name: a.orgPartnerName || a.orgPartnerId }] : []);
      } else {
        this.partners.set(options.orgPartners);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** A field was changed (not the filter box of a multiple choice list). */
  protected changed(e: Event): void {
    if ((e.target as HTMLInputElement | null)?.type !== 'search') this.dirty.set(true);
  }

  /** Consultancy: districts of the chosen Technology Upgradation state. */
  protected async stateChanged(state: string): Promise<void> {
    this.model.tuPreferredState = state;
    await this.loadDistricts(state, true);
  }

  private async loadDistricts(state: string, reset: boolean): Promise<void> {
    if (reset) this.model.tuPreferredDistricts = [];
    if (!state) {
      this.districts.set([]);
      return;
    }
    try {
      const list: District[] = await firstValueFrom(this.api.districts(state));
      this.districts.set(list.map((d) => ({ value: d.districtCode, label: d.districtName })));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  /** Consultancy: Handholding Support (site) and Technology Intervention (financial) exclude each other, as the old form's script. */
  protected siteLocked(): boolean {
    return this.consultancy && this.model.financialVerification && !this.model.siteVerification;
  }

  protected financialLocked(): boolean {
    return this.consultancy && this.model.siteVerification && !this.model.financialVerification;
  }

  protected setSiteVerification(on: boolean): void {
    this.model.siteVerification = on;
    if (on && this.consultancy && this.model.financialVerification) void this.setFinancialVerification(false);
  }

  protected async setFinancialVerification(on: boolean): Promise<void> {
    this.model.financialVerification = on;
    if (!this.consultancy) return;
    if (on) {
      this.model.siteVerification = false;
    } else {
      // As the old script: unticking clears the applicable state and districts.
      this.model.tuPreferredState = '';
      await this.loadDistricts('', true);
    }
  }

  protected partnerLabel(p: OrgPartner): string {
    return this.isEdit ? p.name : `${p.name} - [${p.userId}]`;
  }

  /** The sections and whether each is complete (ticks on the left). */
  protected sections(): FormSection[] {
    const m = this.model;
    const list: FormSection[] = [
      { id: 'sec-org', label: this.consultancy ? t('staff.agencyForm.nav.organisation', 'Organisation') : t('staff.agencyForm.nav.agency', 'Agency'),
        hint: t('staff.agencyForm.nav.orgHint', 'Name, address, GSTIN'),
        done: !!m.userName.trim() && !!m.address.trim() && PIN.test(m.pinCode.trim()) && this.gstOk() },
      { id: 'sec-spoc', label: t('staff.agencyForm.nav.spoc', 'SPOC contact'), hint: t('staff.agencyForm.nav.spocHint', 'Login and messages go here'),
        done: !!m.spocName.trim() && EMAIL.test(m.emailId.trim()) && MOBILE.test(m.mobileNo.trim()) },
      { id: 'sec-cover', label: t('staff.agencyForm.nav.cover', 'Coverage'), hint: t('staff.agencyForm.nav.coverHint', 'States, sectors, category'),
        done: (m.desktopVerification || m.siteVerification || m.financialVerification) && (this.consultancy || !!m.sectorActivity) },
    ];
    if (this.isEdit) list.push({ id: 'sec-login', label: t('staff.agencyForm.nav.login', 'Login'), hint: t('staff.agencyForm.nav.loginHint', 'User ID, status'), done: true });
    return list;
  }

  /** The first section not complete yet (tinted in the list, as the design's current section). */
  protected currentId(): string | null {
    return this.sections().find((s) => !s.done)?.id ?? null;
  }

  protected doneCount(): number {
    return this.sections().filter((s) => s.done).length;
  }

  protected progressText(): string {
    const list = this.sections();
    const next = list.find((s) => !s.done);
    return next
      ? t('staff.agencyForm.save.progress', '{done} of {total} sections complete. Finish {section} to create the {word}.',
        { done: this.doneCount(), total: list.length, section: next.label, word: this.word() })
      : t('staff.agencyForm.save.progressDone', 'All {total} sections complete. Create the {word}.', { total: list.length, word: this.word() });
  }

  protected goTo(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  private gstOk(): boolean {
    const g = (this.model.gstNumber ?? '').trim();
    return !g || GST.test(g);
  }

  /** A field's message: its format as soon as something is typed, "required" after a submit. */
  protected fieldError(field: 'pinCode' | 'gstNumber' | 'emailId' | 'mobileNo'): string {
    const v = (this.model[field] ?? '').trim();
    if (!v) {
      if (!this.submitted()) return '';
      switch (field) {
        case 'pinCode': return t('staff.agencyForm.requiredError', 'This is required.');
        case 'emailId': return t('staff.agencyForm.error.emailRequired', 'Email required.');
        case 'mobileNo': return t('staff.agencyForm.error.mobileRequired', 'Mobile No required.');
        default: return '';
      }
    }
    switch (field) {
      case 'pinCode': return PIN.test(v) ? '' : t('staff.agencyForm.error.pin', 'Enter the 6 digit PIN code.');
      case 'gstNumber': return this.gstOk() ? '' : t('staff.agencyForm.error.gst', 'Letters and digits only, up to 20.');
      case 'emailId': return EMAIL.test(v) ? '' : t('staff.agencyForm.error.email', 'Enter a valid e-mail address.');
      case 'mobileNo': return MOBILE.test(v) ? '' : t('staff.agencyForm.error.mobile', 'Enter the 10 digit mobile number.');
    }
  }

  protected missing(value: string): boolean {
    return this.submitted() && !value.trim();
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    const m = this.model;
    if ([m.userName, m.spocName, m.emailId, m.mobileNo, m.address, m.pinCode].some((v) => !v.trim()) ||
        (['pinCode', 'gstNumber', 'emailId', 'mobileNo'] as const).some((f) => this.fieldError(f))) {
      this.error.set(t('staff.agencyForm.error.invalid', 'Please enter valid data.'));
      return;
    }
    if (!m.desktopVerification && !m.siteVerification && !m.financialVerification) {
      this.error.set(t('staff.agencyForm.error.noCategory', 'Please select atleast one verification.'));
      return;
    }
    if (!this.consultancy && !m.sectorActivity) {
      this.error.set(t('staff.agencyForm.error.noSectorType', 'Please select whether the agency assesses Manufacturing, Services or Both.'));
      return;
    }
    const body: AgencyRequest = this.consultancy
      ? { ...m, orgPartnerId: '', tuPreferredState: m.financialVerification ? m.tuPreferredState : '', tuPreferredDistricts: m.financialVerification ? m.tuPreferredDistricts : [] }
      : m;
    this.saving.set(true);
    try {
      if (this.userId) {
        this.toast.success(t('staff.agencyForm.toast.updated', '{name} updated', { name: m.userName }), (await firstValueFrom(this.api.updateAgency(this.userId, body))).message);
        this.dirty.set(false);
      } else {
        const r = await firstValueFrom(this.api.createAgency(body));
        await this.router.navigate(['/staff/users/agencies'], { state: { message: r.message } });
        return;
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
