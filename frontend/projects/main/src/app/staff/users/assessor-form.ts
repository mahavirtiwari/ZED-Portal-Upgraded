import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { Professional, UsersApi } from './users.api';

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
}

function emptyAssessor(): AssessorModel {
  return {
    assessorType: '', certificateNo: '', professionalEmail: '', userName: '', emailId: '', mobileNo: '', address: '', pinCode: '',
    idProofType: '', idProofNumber: '', states: [], nicSectors: [], areasOfKnowledge: [], reasonForRejection: '',
  };
}

/**
 * Add / update an assessor (agency) or view one (MasterAdmin). Port of Views/User/Assessor.cshtml.
 * For a new assessor the agency looks up the certified professional by certificate number and
 * registered e-mail; name, e-mail and mobile come from that record (the API repeats the lookup).
 */
@Component({
  selector: 'zed-staff-assessor-form',
  imports: [FormsModule, RouterLink, MultiSelect],
  templateUrl: './assessor-form.html',
  styles: `
    .field { margin-bottom: 12px; }
    .readonly { background-color: lightgray !important; }
    .help-block { color: #a94442; font-size: 13px; }
    #selfieimg { max-height: 90px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
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
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected get backLink(): string {
    return this.isAgency ? '/staff/users/my-assessors' : '/staff/users/assessors';
  }

  protected get title(): string {
    if (!this.isAgency) return 'Assessor Details';
    return this.isNew ? 'Add Assessor' : 'Update Assessor Details';
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
      if (this.userId) {
        const a = await firstValueFrom(this.api.assessor(this.userId));
        this.model = {
          ...emptyAssessor(),
          assessorType: a.assessorType ?? '', certificateNo: a.certificateNo ?? '', userName: a.userName, emailId: a.emailId ?? '',
          mobileNo: a.mobileNo ?? '', address: a.address ?? '', pinCode: a.pinCode ?? '', idProofType: a.idProofType ?? '',
          states: a.states, nicSectors: a.nicSectors, areasOfKnowledge: a.areasOfKnowledge, reasonForRejection: a.reasonForRejection ?? '',
        };
        this.maskedIdProof.set(a.idProofNumberMasked);
        this.storedIdProofType.set(a.idProofType);
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
    if (this.isNew && !this.lookupDone) {
      this.error.set('Please SEARCH the certified professional first.');
      return;
    }
    const keepsStoredId = !this.isNew && m.idProofType === this.storedIdProofType() && !!this.maskedIdProof();
    if (!m.address.trim() || !m.pinCode.trim() || !m.idProofType || (!m.idProofNumber.trim() && !keepsStoredId)) {
      this.error.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      if (this.isNew) {
        const r = await firstValueFrom(
          this.api.createAssessor({
            assessorType: m.assessorType, certificateNo: m.certificateNo.trim(), professionalEmail: m.professionalEmail.trim(),
            address: m.address, pinCode: m.pinCode, idProofType: m.idProofType, idProofNumber: m.idProofNumber,
            states: m.states, nicSectors: m.nicSectors, areasOfKnowledge: m.areasOfKnowledge,
          }),
        );
        await this.router.navigate(['/staff/users/my-assessors'], { state: { message: r.message } });
      } else {
        const r = await firstValueFrom(
          this.api.updateAssessor(this.userId!, {
            address: m.address, pinCode: m.pinCode, idProofType: m.idProofType, idProofNumber: m.idProofNumber, states: m.states,
            nicSectors: m.nicSectors, areasOfKnowledge: m.areasOfKnowledge, reasonForRejection: m.reasonForRejection,
          }),
        );
        this.success.set(r.message);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
