import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { AgencyRequest, CodeName, District, OrgPartner, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';

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
 */
@Component({
  selector: 'zed-staff-agency-form',
  imports: [FormsModule, RouterLink, MultiSelect],
  templateUrl: './agency-form.html',
  styles: `
    .req-note { font-size: 13px; color: #5f6f70; margin: -6px 0 10px; }
    .form-section { padding: 0; overflow: hidden; }
    .section-head { display: flex; gap: 12px; align-items: center; padding: 14px 20px; border-bottom: 1px solid #dfe9ea; background: #f7fbfb; }
    .step { flex: 0 0 30px; height: 30px; border-radius: 50%; background: #45a5ad; color: #fff; display: grid; place-items: center; font-weight: 700; font-size: 14px; }
    .section-head h4 { margin: 0; font-size: 16px; font-weight: 700; color: #23474a; }
    .section-head p { margin: 2px 0 0; font-size: 13px; color: #5f6f70; }
    .form-section > .form-grid, .form-section > .choice-grid, .form-section > .login-note { margin: 18px 20px; }
    .form-section > .form-grid.mt-3 { margin-top: 0 !important; }
    .short { max-width: 280px; }
    /* The old skin writes span.label in capitals; here it is a field label like the others. */
    .form-grid > span.label { text-transform: none; letter-spacing: normal; padding: 0; font-size: 14px; font-weight: 600; color: #3b4b4c; }
    .choice-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 10px; }
    .choice-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0;
      cursor: pointer; font-weight: 400; color: #232527; background: #fff; text-transform: none; }
    .choice-card:hover { border-color: #9ccdd1; }
    .choice-card.active { border-color: #45a5ad; background: #f4fafa; box-shadow: inset 0 0 0 1px #45a5ad; }
    .choice-card.locked { cursor: not-allowed; background: #f6f7f7; }
    .choice-card.locked .choice-name { color: #8a9899; }
    .choice-card .form-check-input { flex: none; margin: 3px 0 0; float: none; }
    .choice-name { display: block; font-weight: 700; color: #23474a; }
    .choice-card small { display: block; font-size: 12.5px; line-height: 1.4; margin-top: 2px; }
    .login-id { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; }
    .user-id { font: 700 14px/1.5 SFMono-Regular, Consolas, 'Liberation Mono', monospace; color: #2f7c83; }
    .login-note { padding: 10px 14px; border-radius: 10px; background: #eef6f6; color: #23474a; font-size: 14px; }
    .help-block { color: #a94442; font-size: 13px; }

    /* Save bar: stays at the bottom of the window. */
    .save-bar { position: sticky; bottom: 0; z-index: 5; display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 4px 0 18px; padding: 12px 16px;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .save-bar.is-dirty { border-color: #e9c46a; background: #fffcf2; }
    .unsaved { font-weight: 600; color: #8a6100; }
    .save-error { font-weight: 600; color: #a8303a; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .section-head { padding: 12px 14px; }
      .form-section > .form-grid, .form-section > .choice-grid, .form-section > .login-note { margin: 14px; }
      .short { max-width: none; }
      .save-bar > span { flex-basis: 100%; }
    }
  `,
})
export class AgencyFormPage {
  private readonly api = inject(UsersApi);
  private readonly router = inject(Router);

  protected readonly userId: string | null = inject(ActivatedRoute).snapshot.paramMap.get('userId');
  protected readonly isEdit = !!this.userId;
  protected readonly consultancy = PORTAL_SYSTEM === 'consultancy';
  protected readonly labels = PORTAL_LABELS;
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
  protected readonly success = signal('');
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

  protected missing(value: string): boolean {
    return this.submitted() && !value.trim();
  }

  protected async submit(): Promise<void> {
    this.submitted.set(true);
    this.error.set('');
    this.success.set('');
    const m = this.model;
    if ([m.userName, m.spocName, m.emailId, m.mobileNo, m.address, m.pinCode].some((v) => !v.trim())) {
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
        this.success.set((await firstValueFrom(this.api.updateAgency(this.userId, body))).message);
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
