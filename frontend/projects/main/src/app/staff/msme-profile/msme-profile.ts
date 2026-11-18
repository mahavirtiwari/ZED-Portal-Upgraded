import { HttpClient } from '@angular/common/http';
import { SamePanUnits } from './same-pan';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { EditHistoryTable } from '../../msme/edit-history/edit-history';
import { PORTAL_SYSTEM } from '../../portal-system';
import { dashboardSetting } from '../admin-portal';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';

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

/** One label and value of a card; `edit` = the SuperAdmin's form field; `wide` = the whole row (an address); `mask` = hidden until Show. */
export interface InfoRow {
  label: string;
  source: 'unit' | 'enterprise';
  field: string;
  edit?: EditField;
  wide?: boolean;
  mask?: 'pan' | 'email' | 'mobile';
  /** A second field shown after the first ("Uttar Pradesh · Basti"). */
  also?: string;
}

/** One fact card of the profile (2026-11-17, the user's staff design 15: four cards in a two-column grid). */
export interface InfoSection {
  title: string;
  icon: 'person' | 'pin' | 'unit' | 'list';
  rows: InfoRow[];
  /** The full-width card under the two-column grid. */
  full?: boolean;
}

/**
 * The fields of Views/Msme/Profile.cshtml, grouped in four cards. The ZED ID and the Udyam number are in the identity header.
 * PAN, e-mail and mobile are masked until Show.
 */
export const PROFILE_SECTIONS: InfoSection[] = [
  // 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-15): the four cards hold the design's fields, side by side
  // at equal heights; the other registration fields are kept in a full-width card under them.
  {
    title: 'Owner and enterprise',
    icon: 'person',
    rows: [
      { label: 'Owner name', source: 'enterprise', field: 'OwnerName', edit: 'ownerName' },
      { label: 'Enterprise name', source: 'enterprise', field: 'EnterpriseName', edit: 'enterpriseName' },
      { label: 'PAN', source: 'enterprise', field: 'PanNo', mask: 'pan' },
      { label: 'Enterprise type', source: 'enterprise', field: 'EnterpriseTypee' },
      { label: 'Gender', source: 'enterprise', field: 'Gender' },
      { label: 'Social category', source: 'enterprise', field: 'SocialCategoryName' },
    ],
  },
  {
    title: 'Address and business',
    icon: 'pin',
    rows: [
      { label: 'Registered address', source: 'enterprise', field: 'Address' },
      { label: 'State / District', source: 'enterprise', field: 'StateName', also: 'DistrictName' },
      { label: 'Registered e-mail', source: 'enterprise', field: 'EmailId', edit: 'emailId', mask: 'email' },
      { label: 'Mobile', source: 'enterprise', field: 'MobileNo', mask: 'mobile' },
    ],
  },
  {
    title: 'Selected unit',
    icon: 'unit',
    rows: [
      { label: 'Unit name', source: 'unit', field: 'PUnitName', edit: 'pUnitName' },
      { label: 'Location', source: 'unit', field: 'PAddress' },
    ],
  },
  {
    title: 'Selected unit activity (NIC)',
    icon: 'list',
    rows: [
      { label: 'Activity', source: 'unit', field: 'Activity' },
      { label: 'NIC 2 digit', source: 'unit', field: 'TwoDigitActivity', edit: 'twoDigitActivity' },
      { label: 'NIC 4 digit', source: 'unit', field: 'FourDigitActivity', edit: 'fourDigitActivity' },
      { label: 'NIC 5 digit', source: 'unit', field: 'FiveDigitActivity', edit: 'fiveDigitActivity' },
    ],
  },
  {
    title: 'Other registration details',
    icon: 'list',
    full: true,
    rows: [
      { label: 'Organisation type', source: 'enterprise', field: 'OrganisationTypeName' },
      { label: 'Physically handicapped', source: 'enterprise', field: 'PH' },
      { label: 'Pincode', source: 'enterprise', field: 'Pincode' },
      { label: 'DIC name', source: 'enterprise', field: 'DicName' },
      { label: 'Major activity', source: 'enterprise', field: 'MajorActivityName' },
      { label: 'Incorporation date', source: 'unit', field: 'IncorporationDate' },
      { label: 'Production commenced', source: 'unit', field: 'WhetherProdCommenced' },
      { label: 'Commencement date', source: 'enterprise', field: 'CommmenceDate' },
      { label: 'Total employees', source: 'enterprise', field: 'TotalEmp' },
      { label: 'Applied date', source: 'enterprise', field: 'AppliedDate' },
    ],
  },
];

/** A value with only its ends showing ("AB•••••34F", "ab•••••@mail.test", "94•••••133"). */
export function maskValue(value: string, kind: 'pan' | 'email' | 'mobile'): string {
  const v = value.trim();
  if (!v) return v;
  const dots = '•••••';
  if (kind === 'email') {
    const at = v.indexOf('@');
    if (at < 0) return v.slice(0, 2) + dots;
    return v.slice(0, Math.min(2, at)) + dots + v.slice(at);
  }
  return v.length <= 5 ? v.slice(0, 1) + dots : v.slice(0, 2) + dots + v.slice(-3);
}

/**
 * Staff "View Profile" of a unit (all three portals). Port of Views/Msme/Profile.cshtml (Basic Information, Selected Unit,
 * Selected Unit Activity), read through api/staff/msme-profile/{zedId}, which checks the role and, for agencies and
 * assessors, the allotment. On the main portal the SuperAdmin can EDIT PROFILE (names, e-mail, unit name, NIC codes),
 * as on the old page.
 * 2026-11-17 (the user's staff design 15): an identity header (the unit, its Udyam number, ZED ID, type and levels) with the
 * links to its ZED ID history and assessment details, the facts in four cards on a two-column grid, PAN / e-mail / mobile
 * masked until Show.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-15): equal-height card pairs with the design's fields (the
 * others in a full-width card below), the NIC activity as one line, Back with its icon, the edit history as a table with paging.
 */
@Component({
  selector: 'zed-staff-msme-profile',
  imports: [FormsModule, RouterLink, EditHistoryTable, SamePanUnits, PageHead],
  templateUrl: './msme-profile.html',
  styleUrl: './msme-profile.css',
})
export class StaffMsmeProfilePage {
  private readonly http = inject(HttpClient);
  private readonly roleId = inject(AuthService).currentUser()?.roleId ?? 0;
  protected readonly zedId = inject(ActivatedRoute).snapshot.paramMap.get('zedId') ?? '';
  protected readonly sections = PROFILE_SECTIONS.filter((x) => !x.full);
  protected readonly more = PROFILE_SECTIONS.find((x) => x.full)!;
  protected readonly crumbs = staffCrumbs({ label: 'MSME Profile' });
  /** The masked fields shown in full (Show). */
  protected readonly revealed = signal<ReadonlySet<string>>(new Set());
  /** ZED ID history: the logins with that screen (Master Admin and the dashboard logins). */
  protected readonly historyLink = [7, 10, 11, 17].includes(this.roleId) ? ['/staff/history'] : null;
  /** Assessment details of each level (not on the consultancy portal: handholding has no assessment pages). */
  protected readonly assessmentLinks = computed(() => {
    if (PORTAL_SYSTEM === 'consultancy' || ![7, 2, 3, 10, 8, 11, 17].includes(this.roleId)) return [];
    const levels = this.profile()?.certifications ?? [];
    return levels.map((c) => ({ level: c, link: ['/staff/assessment/da-details', this.zedId, c], label: levels.length > 1 ? `Assessment details · ${c}` : 'Assessment details' }));
  });
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
    if (r.field === 'PAddress') return this.unitAddress();
    const row = r.source === 'unit' ? p.unit : p.enterprise;
    if (r.also) return [this.text(row, r.field), this.text(row, r.also)].filter((x) => x.trim()).join(' · ') || '-';
    return this.show(row, r.field);
  }

  /** staff-15: the NIC activity as one line ("Manufacturing › 10 Food products › 1020 …" and the 5-digit code under it). */
  protected nicLine(p: StaffMsmeProfile): { path: string; leaf: string } {
    const u = p.unit;
    return {
      path: ['Activity', 'TwoDigitActivity', 'FourDigitActivity'].map((f) => this.text(u, f).trim()).filter(Boolean).join(' › ') || '-',
      leaf: this.text(u, 'FiveDigitActivity').trim(),
    };
  }

  /** The unit's name for the header: the enterprise, else the unit. */
  protected name(p: StaffMsmeProfile): string {
    return this.text(p.enterprise, 'EnterpriseName') || this.text(p.unit, 'PUnitName') || this.zedId;
  }

  /** A masked field's text: its ends only until Show. */
  protected masked(p: StaffMsmeProfile, r: InfoRow): string {
    const v = this.text(r.source === 'unit' ? p.unit : p.enterprise, r.field);
    if (!v) return '-';
    return r.mask && !this.revealed().has(r.field) ? maskValue(v, r.mask) : v;
  }

  protected hasValue(p: StaffMsmeProfile, r: InfoRow): boolean {
    return !!this.text(r.source === 'unit' ? p.unit : p.enterprise, r.field).trim();
  }

  protected toggle(field: string): void {
    this.revealed.update((s) => {
      const next = new Set(s);
      if (!next.delete(field)) next.add(field);
      return next;
    });
  }

  protected back(): void {
    history.back();
  }
}

function emptyForm(): StaffMsmeProfileUpdate {
  return { ownerName: '', enterpriseName: '', emailId: '', pUnitName: '', twoDigitActivity: '', fourDigitActivity: '', fiveDigitActivity: '' };
}
