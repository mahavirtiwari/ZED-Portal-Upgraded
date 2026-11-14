import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { EditHistoryTable } from '../../msme/edit-history/edit-history';
import { PORTAL_SYSTEM } from '../../portal-system';
import { dashboardSetting } from '../admin-portal';

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

type EditField = keyof StaffMsmeProfileUpdate;

/** One label and value of the report; `edit` = the SuperAdmin's form field; `wide` = the whole row (an address). */
export interface InfoRow {
  label: string;
  source: 'unit' | 'enterprise';
  field: string;
  edit?: EditField;
  wide?: boolean;
}

/** One section of the report (2026-11-14, option B approved): a teal bar and two label-value pairs per row. */
export interface InfoSection {
  title: string;
  rows: InfoRow[];
}

/** The fields of Views/Msme/Profile.cshtml, grouped; Selected Unit and Selected Unit Activity stay separate sections. */
export const PROFILE_SECTIONS: InfoSection[] = [
  {
    title: 'Owner and Enterprise',
    rows: [
      { label: 'ZED ID', source: 'unit', field: 'ZedId' },
      { label: 'Udyam Number', source: 'enterprise', field: 'UdyogAadharNo' },
      { label: 'Owner Name', source: 'enterprise', field: 'OwnerName', edit: 'ownerName' },
      { label: 'Enterprise Name', source: 'enterprise', field: 'EnterpriseName', edit: 'enterpriseName' },
      { label: 'Organisation Type', source: 'enterprise', field: 'OrganisationTypeName' },
      { label: 'Social Category', source: 'enterprise', field: 'SocialCategoryName' },
      { label: 'Gender', source: 'enterprise', field: 'Gender' },
      { label: 'Physically Handicapped', source: 'enterprise', field: 'PH' },
      { label: 'Email Id', source: 'enterprise', field: 'EmailId', edit: 'emailId' },
      { label: 'Mobile No.', source: 'enterprise', field: 'MobileNo' },
      { label: 'PAN', source: 'enterprise', field: 'PanNo' },
    ],
  },
  {
    title: 'Address and Business',
    rows: [
      { label: 'Registered Address', source: 'enterprise', field: 'Address', wide: true },
      { label: 'State', source: 'enterprise', field: 'StateName' },
      { label: 'District', source: 'enterprise', field: 'DistrictName' },
      { label: 'Pincode', source: 'enterprise', field: 'Pincode' },
      { label: 'DIC Name', source: 'enterprise', field: 'DicName' },
      { label: 'Major Activity', source: 'enterprise', field: 'MajorActivityName' },
      { label: 'Enterprise Type', source: 'enterprise', field: 'EnterpriseTypee' },
      { label: 'Incorporation Date', source: 'unit', field: 'IncorporationDate' },
      { label: 'Whether Production Commenced', source: 'unit', field: 'WhetherProdCommenced' },
      { label: 'Commencement Date', source: 'enterprise', field: 'CommmenceDate' },
      { label: 'Total Employee', source: 'enterprise', field: 'TotalEmp' },
      { label: 'Applied Date', source: 'enterprise', field: 'AppliedDate' },
    ],
  },
  {
    title: 'Selected Unit',
    rows: [
      { label: 'Unit Name', source: 'unit', field: 'PUnitName', edit: 'pUnitName', wide: true },
      { label: 'Unit Address', source: 'unit', field: 'PAddress', wide: true },
    ],
  },
  {
    title: 'Selected Unit Activity',
    rows: [
      { label: 'Activity', source: 'unit', field: 'Activity' },
      { label: 'NIC 2 Digit', source: 'unit', field: 'TwoDigitActivity', edit: 'twoDigitActivity' },
      { label: 'NIC 4 Digit', source: 'unit', field: 'FourDigitActivity', edit: 'fourDigitActivity' },
      { label: 'NIC 5 Digit', source: 'unit', field: 'FiveDigitActivity', edit: 'fiveDigitActivity' },
    ],
  },
];

/** A section's rows as table rows: a wide field alone, the others two per row. */
export function pairRows(rows: InfoRow[]): InfoRow[][] {
  const out: InfoRow[][] = [];
  let pending: InfoRow | null = null;
  for (const r of rows) {
    if (r.wide) {
      if (pending) { out.push([pending]); pending = null; }
      out.push([r]);
    } else if (pending) {
      out.push([pending, r]);
      pending = null;
    } else {
      pending = r;
    }
  }
  if (pending) out.push([pending]);
  return out;
}

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
    .pf-unit { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px 10px; margin: -4px 0 14px; }
    .pf-unit strong { font-size: 18px; color: #1d2b2c; }
    .pf-unit .pf-id { color: #5f6f70; font-weight: 600; }
    .pf-chip { display: inline-block; background: #d9eef0; color: #174a4e; border-radius: 4px; padding: 2px 8px; font-size: 12px; font-weight: 700; }
    .pf-section { margin-bottom: 14px; }
    .pf-bar { background: #23656b; color: #fff; font-size: 14px; font-weight: 700; padding: 8px 12px; border-radius: 4px 4px 0 0; margin: 0; }
    .pf-table { width: 100%; margin: 0; border-collapse: collapse; table-layout: fixed; background: #fff; }
    .pf-table td { border: 1px solid #e1ecec; padding: 8px 10px; vertical-align: middle; overflow-wrap: anywhere; font-size: 14px; }
    .pf-table td.pf-label { background: #f4f8f8; color: #5f6f70; font-weight: 600; width: 20%; }
    .pf-table td.pf-value { color: #1d2b2c; font-weight: 600; width: 30%; }
    .pf-table .form-control, .pf-table .form-select { height: 34px; padding: 4px 8px; font-size: 14px; }
    @media (max-width: 720px) {
      .pf-table, .pf-table tbody, .pf-table tr, .pf-table td { display: block; width: 100% !important; }
      .pf-table td.pf-label { border-bottom: 0; padding-bottom: 2px; }
    }
  `,
})
export class StaffMsmeProfilePage {
  private readonly http = inject(HttpClient);
  private readonly roleId = inject(AuthService).currentUser()?.roleId ?? 0;
  protected readonly zedId = inject(ActivatedRoute).snapshot.paramMap.get('zedId') ?? '';
  /** The sections of the report, each as table rows of one or two fields. */
  protected readonly sections = PROFILE_SECTIONS.map((s) => ({ title: s.title, rows: pairRows(s.rows) }));
  protected readonly profile = signal<StaffMsmeProfile | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly success = signal('');
  /** The applicant's change history: MasterAdmin, SuperAdmin, Ministry, CitizenFeedback and QC (as the API allows). */
  protected readonly seesEditHistory = [7, 10, 8, 11, 17].includes(this.roleId);
  protected readonly editHistoryUrl = `/api/staff/msme-edit-history/${encodeURIComponent(this.zedId)}`;

  /** EDIT PROFILE: SuperAdmin only, and only the main portal's procedure updates the unit. */
  protected readonly canEdit = this.roleId === 10 && PORTAL_SYSTEM === 'main' && dashboardSetting(inject(AuthService).currentUser(), 'main', 'edits');
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
      this.error.set(apiErrorMessage(err) === 'Unexpected error occurred. Please try after some time.' ? 'This unit was not found or is not allotted to you.' : apiErrorMessage(err));
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

  /** A field's value; the unit address is put together from its parts. */
  protected value(p: StaffMsmeProfile, r: InfoRow): string {
    return r.field === 'PAddress' ? this.unitAddress() : this.show(r.source === 'unit' ? p.unit : p.enterprise, r.field);
  }

  protected back(): void {
    history.back();
  }
}

function emptyForm(): StaffMsmeProfileUpdate {
  return { ownerName: '', enterpriseName: '', emailId: '', pUnitName: '', twoDigitActivity: '', fourDigitActivity: '', fiveDigitActivity: '' };
}
