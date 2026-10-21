import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { AgencyRequest, OrgPartner, UsersApi } from './users.api';

function emptyAgency(): AgencyRequest {
  return {
    userName: '', spocName: '', emailId: '', mobileNo: '', address: '', pinCode: '', gstNumber: '', states: [], nicSectors: [],
    orgPartnerId: '', desktopVerification: false, siteVerification: false, financialVerification: false, reasonForRejection: '',
  };
}

/**
 * Add / update an assessment agency (MasterAdmin). Port of Views/User/CertificationBodies.cshtml.
 * The role and the creating user are decided by the API; the generated password is e-mailed to the SPOC.
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
      if (this.userId) {
        const a = await firstValueFrom(this.api.agency(this.userId));
        this.model = {
          userName: a.userName, spocName: a.spocName ?? '', emailId: a.emailId ?? '', mobileNo: a.mobileNo ?? '', address: a.address ?? '',
          pinCode: a.pinCode ?? '', gstNumber: a.gstNumber ?? '', states: a.states, nicSectors: a.nicSectors, orgPartnerId: a.orgPartnerId ?? '',
          desktopVerification: a.desktopVerification, siteVerification: a.siteVerification, financialVerification: a.financialVerification,
          reasonForRejection: a.reasonForRejection ?? '',
        };
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
    this.saving.set(true);
    try {
      if (this.userId) {
        this.success.set((await firstValueFrom(this.api.updateAgency(this.userId, m))).message);
      } else {
        const r = await firstValueFrom(this.api.createAgency(m));
        await this.router.navigate(['/staff/users/agencies'], { state: { message: r.message } });
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
