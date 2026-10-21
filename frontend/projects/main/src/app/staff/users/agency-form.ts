import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { AgencyRequest, CodeName, District, OrgPartner, UsersApi } from './users.api';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PORTAL_LABELS } from '../../portal-labels';

function emptyAgency(): AgencyRequest {
  return {
    userName: '', spocName: '', emailId: '', mobileNo: '', address: '', pinCode: '', gstNumber: '', states: [], nicSectors: [],
    orgPartnerId: '', desktopVerification: false, siteVerification: false, financialVerification: false, reasonForRejection: '',
    tuPreferredState: '', tuPreferredDistricts: [],
  };
}

/**
 * Add / update an assessment agency (MasterAdmin). Port of Views/User/CertificationBodies.cshtml.
 * The role and the creating user are decided by the API; the generated password is e-mailed to the SPOC.
 * Consultancy build: a Consultant Organisation (Handholding Support / Technology Upgradation), no organising partner,
 * and with Technology Upgradation the applicable state and districts it is auto-allotted TU applications from.
 */
@Component({
  selector: 'zed-staff-agency-form',
  imports: [FormsModule, RouterLink, MultiSelect],
  templateUrl: './agency-form.html',
  styles: `
    .input-group1 { margin-bottom: 4px; }
    .field { margin-bottom: 12px; }
    .help-block { color: #a94442; font-size: 13px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
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
  protected readonly states = signal<MultiSelectOption[]>([]);
  protected readonly sectors = signal<MultiSelectOption[]>([]);
  protected readonly partners = signal<OrgPartner[]>([]);
  protected readonly loading = signal(true);
  protected readonly saving = signal(false);
  protected readonly submitted = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
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
      if (this.userId) {
        const a = await firstValueFrom(this.api.agency(this.userId));
        this.model = {
          userName: a.userName, spocName: a.spocName ?? '', emailId: a.emailId ?? '', mobileNo: a.mobileNo ?? '', address: a.address ?? '',
          pinCode: a.pinCode ?? '', gstNumber: a.gstNumber ?? '', states: a.states, nicSectors: a.nicSectors, orgPartnerId: a.orgPartnerId ?? '',
          desktopVerification: a.desktopVerification, siteVerification: a.siteVerification, financialVerification: a.financialVerification,
          reasonForRejection: a.reasonForRejection ?? '',
          tuPreferredState: a.tuPreferredState ?? '', tuPreferredDistricts: a.tuPreferredDistricts ?? [],
        };
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
    const body: AgencyRequest = this.consultancy
      ? { ...m, orgPartnerId: '', tuPreferredState: m.financialVerification ? m.tuPreferredState : '', tuPreferredDistricts: m.financialVerification ? m.tuPreferredDistricts : [] }
      : m;
    this.saving.set(true);
    try {
      if (this.userId) {
        this.success.set((await firstValueFrom(this.api.updateAgency(this.userId, body))).message);
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
