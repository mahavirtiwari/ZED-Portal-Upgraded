import { HttpClient, HttpErrorResponse } from '@angular/common/http';
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
import { TextPipe, t } from '../../content/page-text';
import { cleanAddress, joinAddress } from '../address';

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

/** One label and value of a card; `edit` = the SuperAdmin's form field; `wide` = the whole row (an address); `oneLine` = one line, cut with "…" and the full value as the tooltip (an e-mail). */
export interface InfoRow {
  readonly label: string;
  source: 'unit' | 'enterprise';
  field: string;
  edit?: EditField;
  wide?: boolean;
  oneLine?: boolean;
  /** A second field shown after the first ("Uttar Pradesh · Basti"). */
  also?: string;
}

/** One fact card of the profile (2026-11-17, the user's staff design 15: four cards in a two-column grid). */
export interface InfoSection {
  readonly title: string;
  icon: 'person' | 'pin' | 'unit' | 'list';
  rows: InfoRow[];
  /** The full-width card under the two-column grid. */
  full?: boolean;
}

/**
 * The fields of Views/Msme/Profile.cshtml, grouped in four cards. The ZED ID and the Udyam number are in the identity header.
 * PAN, e-mail and mobile are shown in full (2026-11-18, the user: never masked on signed-in pages).
 */
export const PROFILE_SECTIONS: InfoSection[] = [
  // 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-15): the four cards hold the design's fields, side by side
  // at equal heights; the other registration fields are kept in a full-width card under them.
  {
    get title() { return t('staff.msmeProfile.section.ownerTitle', 'Owner and enterprise'); },
    icon: 'person',
    rows: [
      { get label() { return t('staff.msmeProfile.field.ownerName', 'Owner name'); }, source: 'enterprise', field: 'OwnerName', edit: 'ownerName' },
      { get label() { return t('staff.msmeProfile.field.enterpriseName', 'Enterprise name'); }, source: 'enterprise', field: 'EnterpriseName', edit: 'enterpriseName' },
      { get label() { return t('staff.msmeProfile.field.panNo', 'PAN'); }, source: 'enterprise', field: 'PanNo' },
      { get label() { return t('staff.msmeProfile.field.enterpriseTypee', 'Enterprise type'); }, source: 'enterprise', field: 'EnterpriseTypee' },
      { get label() { return t('staff.msmeProfile.field.gender', 'Gender'); }, source: 'enterprise', field: 'Gender' },
      { get label() { return t('staff.msmeProfile.field.socialCategoryName', 'Social category'); }, source: 'enterprise', field: 'SocialCategoryName' },
    ],
  },
  {
    get title() { return t('staff.msmeProfile.section.addressTitle', 'Address and business'); },
    icon: 'pin',
    rows: [
      { get label() { return t('staff.msmeProfile.field.address', 'Registered address'); }, source: 'enterprise', field: 'Address' },
      { get label() { return t('staff.msmeProfile.field.stateName', 'State / District'); }, source: 'enterprise', field: 'StateName', also: 'DistrictName' },
      { get label() { return t('staff.msmeProfile.field.emailId', 'Registered e-mail'); }, source: 'enterprise', field: 'EmailId', edit: 'emailId', oneLine: true },
      { get label() { return t('staff.msmeProfile.field.mobileNo', 'Mobile'); }, source: 'enterprise', field: 'MobileNo' },
    ],
  },
  {
    get title() { return t('staff.msmeProfile.section.unitTitle', 'Selected unit'); },
    icon: 'unit',
    rows: [
      { get label() { return t('staff.msmeProfile.field.pUnitName', 'Unit name'); }, source: 'unit', field: 'PUnitName', edit: 'pUnitName' },
      { get label() { return t('staff.msmeProfile.field.pAddress', 'Location'); }, source: 'unit', field: 'PAddress' },
    ],
  },
  {
    get title() { return t('staff.msmeProfile.section.activityTitle', 'Selected unit activity (NIC)'); },
    icon: 'list',
    rows: [
      { get label() { return t('staff.msmeProfile.field.activity', 'Activity'); }, source: 'unit', field: 'Activity' },
      { get label() { return t('staff.msmeProfile.field.twoDigitActivity', 'NIC 2 digit'); }, source: 'unit', field: 'TwoDigitActivity', edit: 'twoDigitActivity' },
      { get label() { return t('staff.msmeProfile.field.fourDigitActivity', 'NIC 4 digit'); }, source: 'unit', field: 'FourDigitActivity', edit: 'fourDigitActivity' },
      { get label() { return t('staff.msmeProfile.field.fiveDigitActivity', 'NIC 5 digit'); }, source: 'unit', field: 'FiveDigitActivity', edit: 'fiveDigitActivity' },
    ],
  },
  {
    get title() { return t('staff.msmeProfile.section.otherTitle', 'Other registration details'); },
    icon: 'list',
    full: true,
    rows: [
      { get label() { return t('staff.msmeProfile.field.organisationTypeName', 'Organisation type'); }, source: 'enterprise', field: 'OrganisationTypeName' },
      { get label() { return t('staff.msmeProfile.field.pH', 'Physically handicapped'); }, source: 'enterprise', field: 'PH' },
      { get label() { return t('staff.msmeProfile.field.pincode', 'Pincode'); }, source: 'enterprise', field: 'Pincode' },
      { get label() { return t('staff.msmeProfile.field.dicName', 'DIC name'); }, source: 'enterprise', field: 'DicName' },
      { get label() { return t('staff.msmeProfile.field.majorActivityName', 'Major activity'); }, source: 'enterprise', field: 'MajorActivityName' },
      { get label() { return t('staff.msmeProfile.field.incorporationDate', 'Incorporation date'); }, source: 'unit', field: 'IncorporationDate' },
      { get label() { return t('staff.msmeProfile.field.whetherProdCommenced', 'Production commenced'); }, source: 'unit', field: 'WhetherProdCommenced' },
      { get label() { return t('staff.msmeProfile.field.commmenceDate', 'Commencement date'); }, source: 'enterprise', field: 'CommmenceDate' },
      { get label() { return t('staff.msmeProfile.field.totalEmp', 'Total employees'); }, source: 'enterprise', field: 'TotalEmp' },
      { get label() { return t('staff.msmeProfile.field.appliedDate', 'Applied date'); }, source: 'enterprise', field: 'AppliedDate' },
    ],
  },
];

/**
 * Staff "View Profile" of a unit (all three portals). Port of Views/Msme/Profile.cshtml (Basic Information, Selected Unit,
 * Selected Unit Activity), read through api/staff/msme-profile/{zedId}, which checks the role and, for agencies and
 * assessors, the allotment. On the main portal the SuperAdmin can EDIT PROFILE (names, e-mail, unit name, NIC codes),
 * as on the old page.
 * 2026-11-17 (the user's staff design 15): an identity header (the unit, its Udyam number, ZED ID, type and levels) with the
 * links to its ZED ID history and assessment details, the facts in four cards on a two-column grid, PAN / e-mail / mobile
 * in full (2026-11-18, the user: no masking, no Show / Hide).
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-15): equal-height card pairs with the design's fields (the
 * others in a full-width card below), the NIC activity as one line, Back with its icon, the edit history as a table with paging.
 */
@Component({
  selector: 'zed-staff-msme-profile',
  imports: [FormsModule, RouterLink, EditHistoryTable, SamePanUnits, PageHead, TextPipe],
  templateUrl: './msme-profile.html',
  styleUrl: './msme-profile.css',
})
export class StaffMsmeProfilePage {
  private readonly http = inject(HttpClient);
  private readonly roleId = inject(AuthService).currentUser()?.roleId ?? 0;
  /** A sub-user's (and a limited dashboard login's) screens; null = every screen of its role. */
  private readonly permissionRoutes = inject(AuthService).currentUser()?.permissionRoutes ?? null;

  private mayOpen(route: string): boolean {
    return !this.permissionRoutes || this.permissionRoutes.some((r) => r === route || route.startsWith(r + '/'));
  }
  protected readonly zedId = inject(ActivatedRoute).snapshot.paramMap.get('zedId') ?? '';
  protected readonly sections = PROFILE_SECTIONS.filter((x) => !x.full);
  protected readonly more = PROFILE_SECTIONS.find((x) => x.full)!;
  protected readonly crumbs = computed(() => staffCrumbs({ label: t('staff.msmeProfile.crumb', 'MSME Profile') }));
  /** ZED ID history: the logins with that screen (Master Admin and the dashboard logins). */
  /** 2026-11-22 (Consultancy Operation Admin audit: the button opened a "no access" page): a sub-user only when it was given it. */
  protected readonly historyLink = [7, 10, 11, 17].includes(this.roleId) && this.mayOpen('/staff/history') ? ['/staff/history'] : null;
  /** Assessment details of each level (not on the consultancy portal: handholding has no assessment pages). */
  protected readonly assessmentLinks = computed(() => {
    if (PORTAL_SYSTEM === 'consultancy' || ![7, 2, 3, 10, 8, 11, 17].includes(this.roleId)) return [];
    const levels = this.profile()?.certifications ?? [];
    return levels.map((c) => ({ level: c, link: ['/staff/assessment/da-details', this.zedId, c], label: levels.length > 1 ? t('staff.msmeProfile.assessmentLevelLink', 'Assessment details · {level}', { level: c }) : t('staff.msmeProfile.assessmentLink', 'Assessment details') }));
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
    // 2026-11-21 (UI audit W8): the empty parts of the stored address ("Block:- ,") are left out.
    return joinAddress(...['PAddress', 'PDistrictName', 'PStateName', 'PPin'].map((f) => this.text(u, f))) || '-';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.profile.set(await firstValueFrom(this.http.get<StaffMsmeProfile>(this.url)));
    } catch (err) {
      // 2026-11-21 (UI audit W6): a 404 (the API's bare "Not Found") says which ZED ID was not found.
      this.error.set(err instanceof HttpErrorResponse && err.status === 404
        ? t('staff.msmeProfile.notFoundIdError', 'No unit with ZED ID {zedId} was found, or it is not allotted to you.', { zedId: this.zedId })
        : apiErrorMessage(err) === 'Unexpected error occurred. Please try after some time.'
          ? t('staff.msmeProfile.notFoundError', 'This unit was not found or is not allotted to you.') : apiErrorMessage(err));
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
      this.success.set(r.message || t('staff.msmeProfile.toast.saved', 'Success'));
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
    if (r.field === 'Address') return cleanAddress(this.text(r.source === 'unit' ? p.unit : p.enterprise, r.field)) || '-';
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

  protected back(): void {
    history.back();
  }
}

function emptyForm(): StaffMsmeProfileUpdate {
  return { ownerName: '', enterpriseName: '', emailId: '', pUnitName: '', twoDigitActivity: '', fourDigitActivity: '', fiveDigitActivity: '' };
}
