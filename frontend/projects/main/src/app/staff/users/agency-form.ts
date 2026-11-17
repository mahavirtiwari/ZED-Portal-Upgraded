import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { AgencyRequest, CodeName, District, OrgPartner, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';

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
  imports: [FormsModule, RouterLink, MultiSelect, PageHead],
  templateUrl: './agency-form.html',
  styles: `
    .af { display: grid; grid-template-columns: 240px minmax(0, 1fr) 260px; gap: 20px; align-items: start; }
    .af-left, .af-rail { position: sticky; top: 12px; }
    .af-nav { padding: 8px; margin: 0; }
    .af-step { display: flex; align-items: flex-start; gap: 12px; width: 100%; padding: 10px; border: 0; border-radius: 10px; background: none; text-align: left; }
    .af-step:hover { background: #f2f8f7; }
    .af-dot { flex: none; width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; border: 2px solid #c9d6d7; color: #5f6f70; font-size: 12px; font-weight: 700; }
    .af-step.done .af-dot { background: #2e9e57; border-color: #2e9e57; }
    .af-dot svg { width: 15px; height: 15px; fill: none; stroke: #fff; stroke-width: 3; stroke-linecap: round; stroke-linejoin: round; }
    .af-step-text { display: flex; flex-direction: column; min-width: 0; }
    .af-step-text strong { font-size: 14px; color: var(--zt-ink, #173f44); }
    .af-step-text small { font-size: 12px; color: #5f6f70; }
    .req-note { margin: 10px 4px 0; font-size: 12.5px; color: #5f6f70; }
    .form-section { padding: 0; overflow: hidden; scroll-margin-top: 12px; }
    .section-head { display: flex; align-items: center; gap: 10px; margin: 0; padding: 14px 20px; border-bottom: 1px solid #e6eeee; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .step { width: 26px; height: 26px; border-radius: 8px; background: #e6f1ef; display: grid; place-items: center; font-size: 13px; }
    .fs-body { padding: 16px 20px 18px; display: flex; flex-direction: column; gap: 14px; }
    .fld { display: flex; flex-direction: column; gap: 4px; min-width: 0; }
    .fld > label, .lbl { margin: 0; font-size: 13.5px; font-weight: 600; color: #3b4b4c; text-transform: none; }
    .fld-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; align-items: start; }
    .fs-note { align-self: end; margin: 0 0 10px; font-size: 12.5px; color: #5f6f70; }
    .fs-hint { font-size: 12.5px; color: #5f6f70; }
    .seg { display: inline-flex; padding: 3px; border-radius: 10px; background: #eef3f3; }
    .seg label { position: relative; flex: 1; margin: 0; padding: 7px 14px; border-radius: 8px; text-align: center; cursor: pointer; color: #5f6f70; font-weight: 600; }
    .seg label.active { background: #fff; color: var(--zt-ink, #173f44); box-shadow: inset 0 0 0 2px var(--zt-dark, #1f5c61); }
    .seg input { position: absolute; opacity: 0; inset: 0; cursor: pointer; }
    .seg label:focus-within { outline: 2px solid var(--zt-mid2, #2a8a8c); }
    .checks { display: flex; flex-wrap: wrap; gap: 8px 22px; }
    .chk { display: flex; align-items: flex-start; gap: 8px; margin: 0; font-weight: 600; color: #24393b; cursor: pointer; text-transform: none; }
    .chk .form-check-input { flex: none; float: none; margin: 2px 0 0; }
    .chk small { display: block; font-weight: 400; color: #8a6100; }
    .chk.locked { color: #8a9899; cursor: not-allowed; }
    .login-id { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .user-id { font: 700 14px/1.5 SFMono-Regular, Consolas, monospace; color: var(--zt-mid2, #2a8a8c); }
    .af-rail { padding: 16px 18px; margin: 0; }
    .af-rail h4 { margin: 0 0 10px; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .af-rail ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 10px; font-size: 13px; color: #3d5254; }
    .af-rail li::marker { color: var(--zt-mid2, #2a8a8c); }
    .help-block { color: #a94442; font-size: 12.5px; }
    .save-bar { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 4px 0 18px; padding: 12px 18px;
      background: #fff; border: 1px solid #e1eaea; border-radius: 12px; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .save-bar.is-dirty { border-color: #e9c46a; background: #fffcf2; }
    .save-bar .btn { min-width: 110px; height: 40px; font-weight: 700; }
    .save-progress { font-size: 13.5px; color: #3d5254; }
    .save-progress.all { color: #1e6b3c; font-weight: 600; }
    .unsaved { font-weight: 600; color: #8a6100; }
    .save-error { font-weight: 600; color: #a8303a; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 1199.98px) {
      .af { grid-template-columns: 220px minmax(0, 1fr); }
      .af-rail { position: static; grid-column: 2; }
    }
    @media (max-width: 767.98px) {
      .af { grid-template-columns: minmax(0, 1fr); }
      .af-left { position: static; }
      .af-rail { grid-column: auto; }
      .fld-row { grid-template-columns: minmax(0, 1fr); }
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
  protected readonly word = this.consultancy ? 'organisation' : 'agency';
  protected readonly title = this.isEdit ? `Update ${PORTAL_LABELS.agency} Details` : `Add ${PORTAL_LABELS.agency}`;
  protected readonly crumbs = staffCrumbs({ label: PORTAL_LABELS.agencies, link: '/staff/users/agencies' }, { label: this.userId ?? 'Add' });
  protected readonly subtitle = this.isEdit
    ? `Details, categories and applicable states of the ${PORTAL_LABELS.agency.toLowerCase()}.`
    : 'The login ID is generated and the login details are e-mailed to the SPOC.';
  /** The right rail: what happens on submit / update. */
  protected readonly railPoints = this.isEdit
    ? ['Changes apply as soon as you update.', 'The SPOC e-mail address is where login details and messages go.',
       'Block, unblock and reset links are on the list (⋮ menu).', 'Levels are switched in Agency Level Allocation.']
    : [`A login ID is generated for the ${this.consultancy ? 'organisation' : 'agency'}.`, 'The login details are e-mailed to the SPOC.',
       `The ${this.consultancy ? 'organisation' : 'agency'} can then add its ${PORTAL_LABELS.assessors.toLowerCase()}.`,
       ...(this.consultancy ? [] : ['Levels are switched on in Agency Level Allocation.'])];
  protected readonly tuStates = signal<CodeName[]>([]);
  protected readonly districts = signal<MultiSelectOption[]>([]);

  protected model: AgencyRequest = emptyAgency();
  /** Manufacturing / Services / Both; a Master Admin limited to one category is offered that one only (migration 0057). */
  protected activities = SECTOR_ACTIVITIES;
  protected readonly activityHelp: Record<SectorActivity, string> = {
    Manufacturing: 'Manufacturing MSMEs only.',
    Services: 'Service MSMEs only.',
    Both: 'Manufacturing and service MSMEs.',
  };
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
      { id: 'sec-org', label: this.consultancy ? 'Organisation' : 'Agency', hint: 'Name, address, GSTIN',
        done: !!m.userName.trim() && !!m.address.trim() && PIN.test(m.pinCode.trim()) && this.gstOk() },
      { id: 'sec-spoc', label: 'SPOC contact', hint: 'Login and messages go here',
        done: !!m.spocName.trim() && EMAIL.test(m.emailId.trim()) && MOBILE.test(m.mobileNo.trim()) },
      { id: 'sec-cover', label: 'Coverage', hint: 'States, sectors, category',
        done: (m.desktopVerification || m.siteVerification || m.financialVerification) && (this.consultancy || !!m.sectorActivity) },
    ];
    if (this.isEdit) list.push({ id: 'sec-login', label: 'Login', hint: 'User ID, status', done: true });
    return list;
  }

  protected doneCount(): number {
    return this.sections().filter((s) => s.done).length;
  }

  protected progressText(): string {
    const list = this.sections();
    const next = list.find((s) => !s.done);
    return next
      ? `${this.doneCount()} of ${list.length} sections complete. Finish ${next.label} to create the ${this.word}.`
      : `All ${list.length} sections complete. Create the ${this.word}.`;
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
    if (!v) return this.submitted() && field !== 'gstNumber' ? { pinCode: 'This is required.', emailId: 'Email required.', mobileNo: 'Mobile No required.' }[field] : '';
    switch (field) {
      case 'pinCode': return PIN.test(v) ? '' : 'Enter the 6 digit PIN code.';
      case 'gstNumber': return this.gstOk() ? '' : 'Letters and digits only, up to 20.';
      case 'emailId': return EMAIL.test(v) ? '' : 'Enter a valid e-mail address.';
      case 'mobileNo': return MOBILE.test(v) ? '' : 'Enter the 10 digit mobile number.';
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
      this.error.set('Please enter valid data.');
      return;
    }
    if (!m.desktopVerification && !m.siteVerification && !m.financialVerification) {
      this.error.set('Please select atleast one verification.');
      return;
    }
    if (!this.consultancy && !m.sectorActivity) {
      this.error.set('Please select whether the agency assesses Manufacturing, Services or Both.');
      return;
    }
    const body: AgencyRequest = this.consultancy
      ? { ...m, orgPartnerId: '', tuPreferredState: m.financialVerification ? m.tuPreferredState : '', tuPreferredDistricts: m.financialVerification ? m.tuPreferredDistricts : [] }
      : m;
    this.saving.set(true);
    try {
      if (this.userId) {
        this.toast.success(`${m.userName} updated`, (await firstValueFrom(this.api.updateAgency(this.userId, body))).message);
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
