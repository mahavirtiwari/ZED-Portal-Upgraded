import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { EditHistoryTable } from '../../msme/edit-history/edit-history';
import { PORTAL_SYSTEM } from '../../portal-system';

export type ProfileRow = Record<string, string | number | boolean | null>;

export interface StaffMsmeProfile {
  unit: ProfileRow;
  enterprise: ProfileRow;
  certifications: string[];
}

/** Body of PUT api/staff/msme-profile/{zedId} (the SuperAdmin's EDIT PROFILE). */
export interface StaffMsmeProfileUpdate {
  ownerName: string;
  enterpriseName: string;
  emailId: string;
  pUnitName: string;
  twoDigitActivity: string;
  fourDigitActivity: string;
  fiveDigitActivity: string;
}

/** Link to the staff profile of a unit (replaces the legacy {portal}/Msme/Profile/{zedId} links). */
export function staffProfileLink(zedId: string): string {
  return `/staff/msme-profile/${encodeURIComponent(zedId)}`;
}

/** One row of the "Basic Information" table: label, the table it comes from and, if the SuperAdmin may edit it, its form field. */
interface InfoRow {
  label: string;
  source: 'unit' | 'enterprise';
  field: string;
  edit?: 'ownerName' | 'enterpriseName' | 'emailId';
}

/** Labels and order of Views/Msme/Profile.cshtml ("Basic Information"). */
const BASIC_INFO: InfoRow[] = [
  { label: 'ZED ID:', source: 'unit', field: 'ZedId' },
  { label: 'Udyam Number:', source: 'enterprise', field: 'UdyogAadharNo' },
  { label: 'Owner Name:', source: 'enterprise', field: 'OwnerName', edit: 'ownerName' },
  { label: 'Enterprise Name:', source: 'enterprise', field: 'EnterpriseName', edit: 'enterpriseName' },
  { label: 'Organisation Type:', source: 'enterprise', field: 'OrganisationTypeName' },
  { label: 'Social Category:', source: 'enterprise', field: 'SocialCategoryName' },
  { label: 'Gender:', source: 'enterprise', field: 'Gender' },
  { label: 'Email Id:', source: 'enterprise', field: 'EmailId', edit: 'emailId' },
  { label: 'Mobile No.:', source: 'enterprise', field: 'MobileNo' },
  { label: 'Physically Handicapped:', source: 'enterprise', field: 'PH' },
  { label: 'PanNo:', source: 'enterprise', field: 'PanNo' },
  { label: 'Registered Address:', source: 'enterprise', field: 'Address' },
  { label: 'State:', source: 'enterprise', field: 'StateName' },
  { label: 'District:', source: 'enterprise', field: 'DistrictName' },
  { label: 'Pincode:', source: 'enterprise', field: 'Pincode' },
  { label: 'Major Activity:', source: 'enterprise', field: 'MajorActivityName' },
  { label: 'Enterprise Type:', source: 'enterprise', field: 'EnterpriseTypee' },
  { label: 'Incorporation Date:', source: 'unit', field: 'IncorporationDate' },
  { label: 'Whether Production Commenced:', source: 'unit', field: 'WhetherProdCommenced' },
  { label: 'Commencement Date:', source: 'enterprise', field: 'CommmenceDate' },
  { label: 'Total Employee:', source: 'enterprise', field: 'TotalEmp' },
  { label: 'DIC Name:', source: 'enterprise', field: 'DicName' },
  { label: 'Applied Date:', source: 'enterprise', field: 'AppliedDate' },
];

/**
 * Staff "View Profile" of a unit (all three portals). Port of Views/Msme/Profile.cshtml (Basic Information, Selected Unit,
 * Selected Unit Activity), read through api/staff/msme-profile/{zedId}, which checks the role and, for agencies and
 * assessors, the allotment. On the main portal the SuperAdmin can EDIT PROFILE (names, e-mail, unit name, NIC codes),
 * as on the old page.
 */
@Component({
  selector: 'zed-staff-msme-profile',
  imports: [FormsModule, EditHistoryTable],
  templateUrl: './msme-profile.html',
  styles: `
    .title-with-action { display: flex; justify-content: space-between; align-items: center; }
  `,
})
export class StaffMsmeProfilePage {
  private readonly http = inject(HttpClient);
  private readonly roleId = inject(AuthService).currentUser()?.roleId ?? 0;
  protected readonly zedId = inject(ActivatedRoute).snapshot.paramMap.get('zedId') ?? '';
  protected readonly rows = BASIC_INFO;
  protected readonly profile = signal<StaffMsmeProfile | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly success = signal('');
  /** The applicant's change history: MasterAdmin, SuperAdmin, Ministry, CitizenFeedback and QC (as the API allows). */
  protected readonly seesEditHistory = [7, 10, 8, 11, 17].includes(this.roleId);
  protected readonly editHistoryUrl = `/api/staff/msme-edit-history/${encodeURIComponent(this.zedId)}`;

  /** EDIT PROFILE: SuperAdmin only, and only the main portal's procedure updates the unit. */
  protected readonly canEdit = this.roleId === 10 && PORTAL_SYSTEM === 'main';
  protected readonly editing = signal(false);
  protected readonly saving = signal(false);
  protected form: StaffMsmeProfileUpdate = emptyForm();
  private readonly sectors = signal<string[]>([]);
  /** The NIC 2 digit drop-down: the sector master, plus the unit's present value if it is not in it. */
  protected readonly sectorOptions = computed(() => {
    const current = this.text(this.profile()?.unit ?? {}, 'TwoDigitActivity');
    const list = this.sectors();
    return current && !list.includes(current) ? [current, ...list] : list;
  });

  protected readonly unitAddress = computed(() => {
    const u = this.profile()?.unit ?? {};
    return ['PAddress', 'PDistrictName', 'PStateName', 'PPin'].map((f) => this.text(u, f)).filter((x) => x.trim()).join(', ') || '-';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.profile.set(await firstValueFrom(this.http.get<StaffMsmeProfile>(this.url)));
    } catch (err) {
      this.error.set(apiErrorMessage(err) === 'Unexpected error occured. Please try after some time.' ? 'This unit was not found or is not allotted to you.' : apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  private get url(): string {
    return `/api/staff/msme-profile/${encodeURIComponent(this.zedId)}`;
  }

  protected async startEdit(): Promise<void> {
    const p = this.profile();
    if (!p) return;
    this.success.set('');
    this.error.set('');
    this.form = {
      ownerName: this.text(p.enterprise, 'OwnerName'), enterpriseName: this.text(p.enterprise, 'EnterpriseName'),
      emailId: this.text(p.enterprise, 'EmailId'), pUnitName: this.text(p.unit, 'PUnitName'),
      twoDigitActivity: this.text(p.unit, 'TwoDigitActivity'), fourDigitActivity: this.text(p.unit, 'FourDigitActivity'),
      fiveDigitActivity: this.text(p.unit, 'FiveDigitActivity'),
    };
    this.editing.set(true);
    if (!this.sectors().length) {
      try {
        this.sectors.set(await firstValueFrom(this.http.get<string[]>('/api/staff/msme-profile/sectors')));
      } catch (err) {
        this.error.set(apiErrorMessage(err));
      }
    }
  }

  protected cancelEdit(): void {
    this.error.set('');
    this.editing.set(false);
  }

  protected async update(): Promise<void> {
    this.error.set('');
    this.saving.set(true);
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(this.url, this.form));
      this.editing.set(false);
      await this.load();
      this.success.set(r.message || 'Success');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } finally {
      this.saving.set(false);
    }
  }

  protected text(row: ProfileRow, field: string): string {
    const v = row[field];
    return v === null || v === undefined ? '' : String(v);
  }

  protected show(row: ProfileRow, field: string): string {
    return this.text(row, field) || '-';
  }

  protected back(): void {
    history.back();
  }
}

function emptyForm(): StaffMsmeProfileUpdate {
  return { ownerName: '', enterpriseName: '', emailId: '', pUnitName: '', twoDigitActivity: '', fourDigitActivity: '', fiveDigitActivity: '' };
}
