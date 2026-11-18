import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { levelLogo, levelName } from '../shared/levels';
import { Crumb, PageHead } from '../shared/page-head';
import { ProfileApi, ProfileDashboard, ProfileRow, UdyamActivity } from './profile.api';
import { PROFILE_PAGE_SECTIONS, ProfileSection, ProfileShell } from './profile-shell';

/** One row of the Udyam details: label and the column it shows. */
interface InfoRow {
  label: string;
  source: 'msme' | 'basicInfo';
  field: string;
}

/** The Udyam details beyond the six of the Enterprise card, under "Show all details". */
const MORE_INFO: InfoRow[] = [
  { label: 'Organisation Type', source: 'basicInfo', field: 'OrganisationTypeName' },
  { label: 'Social Category', source: 'basicInfo', field: 'SocialCategoryName' },
  { label: 'Gender', source: 'basicInfo', field: 'Gender' },
  { label: 'E-mail (Udyam)', source: 'basicInfo', field: 'EmailId' },
  { label: 'Physically Handicapped', source: 'basicInfo', field: 'PH' },
  { label: 'Pincode', source: 'basicInfo', field: 'Pincode' },
  { label: 'Major Activity', source: 'basicInfo', field: 'MajorActivityName' },
  { label: 'Incorporation Date', source: 'msme', field: 'IncorporationDate' },
  { label: 'Whether Production Commenced', source: 'msme', field: 'WhetherProdCommenced' },
  { label: 'Commencement Date', source: 'basicInfo', field: 'CommmenceDate' },
  { label: 'Total Employee', source: 'basicInfo', field: 'TotalEmp' },
  { label: 'DIC Name', source: 'basicInfo', field: 'DicName' },
  { label: 'Applied Date', source: 'basicInfo', field: 'AppliedDate' },
];

/** One step of the NIC hierarchy: the code (2, 4 or 5 digits; none for the major activity) and its description. */
interface NicStep {
  code: string;
  text: string;
}

/** "24 - Basic metals" -> 24 and "Basic metals"; a value without a leading code is all description. */
function nicStep(value: string): NicStep {
  const m = /^\s*(\d{2,5})\s*(?:[-–:.]\s*)?(.*)$/.exec(value);
  return m ? { code: m[1], text: m[2].trim() } : { code: '', text: value.trim() };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * 2026-11-18 (the user's applicant designs: "PLEDGE TAKEN 13 NOV 2026"): a date as the procedures give it ("November 13, 2026",
 * FORMAT 'MMMM d, yyyy'; also 13/11/2026 and 2026-11-13) written d MMM yyyy; anything else as it is.
 */
export function shortDate(value: string): string {
  const v = value.trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (m) return fmt(+m[3], +m[2], +m[1], v);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(v);
  if (m) return fmt(+m[1], +m[2], +m[3], v);
  m = /^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})$/.exec(v);
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m![1].slice(0, 3).toLowerCase());
    if (month >= 0) return fmt(+m[2], month + 1, +m[3], v);
  }
  return v;
}

function fmt(day: number, month: number, year: number, fallback: string): string {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? `${day} ${MONTHS[month - 1]} ${year}` : fallback;
}

/** What the profile completeness counts (each true when the page has it). */
export interface CompletenessFacts {
  /** A registered e-mail (only ever set with an OTP sent to it, so verified). */
  email: boolean;
  /** The unit activity down to its 5-digit NIC code. */
  activity: boolean;
  /** The selected unit / plant (its name or address). */
  unit: boolean;
  mobile: boolean;
  pan: boolean;
  address: boolean;
}

/** The hint for each missing fact, in the order they are suggested (the ones the applicant can do here first). */
const COMPLETENESS_HINTS: readonly { key: keyof CompletenessFacts; hint: string }[] = [
  { key: 'email', hint: 'Verify a registered e-mail under Contact' },
  { key: 'activity', hint: 'Set the unit activity (NIC) under Units / plants' },
  { key: 'unit', hint: 'Your unit / plant is not on record yet' },
  { key: 'mobile', hint: 'Add your mobile number on the Udyam portal' },
  { key: 'pan', hint: 'Add your PAN on the Udyam portal' },
  { key: 'address', hint: 'Add your registered address on the Udyam portal' },
];

/**
 * 2026-11-18 (the user's applicant designs, "Profile completeness"): the share of the six profile facts the page has (registered
 * e-mail, unit activity, unit, mobile, PAN, registered address), each counting the same, rounded down so 100% means all of
 * them; the hint names the first missing one. Only facts the page already reads (nothing invented: no second contact person,
 * which ZED does not record).
 */
export function profileCompleteness(facts: CompletenessFacts): { percent: number; hint: string } {
  const missing = COMPLETENESS_HINTS.filter((h) => !facts[h.key]);
  const percent = Math.floor(((COMPLETENESS_HINTS.length - missing.length) / COMPLETENESS_HINTS.length) * 100);
  if (!missing.length) return { percent, hint: 'All your profile details are in place.' };
  const more = missing.length - 1;
  return { percent, hint: more ? `${missing[0].hint}; ${more} more detail${more === 1 ? '' : 's'} missing.` : `${missing[0].hint} to reach 100%.` };
}

/** Status meaning "certified" per level (as the dashboard): 6 for Bronze, 16 for the others. */
const certifiedStatus = (code: string): number => (code === 'Bronze' ? 6 : 16);

/**
 * MSME "Enterprise profile". Port of Views/Msme/ViewProfile.cshtml; 2026-11-17 the user's approved design: a left section
 * menu (Enterprise, Contact, Units / plants, Unit activity (NIC), Account & security, Edit history), the header card
 * (size, certification, pledge), the Udyam details read only (2026-11-18 the user: the PAN, e-mail and mobile in full, no Show / Hide), the contact with the change of the
 * registered e-mail (OTP to the new address), the unit as a card and its NIC activity as the 2 > 4 > 5-digit hierarchy
 * with "Edit activity" choosing another activity of the MSME's own Udyam record. Basic information and documents are
 * entered only in the ZED MSME app; nothing else is edited here. 2026-11-18 (the user's applicant designs): the design's sizes, the
 * pledge date as d MMM yyyy, "Verified" after the mobile when it is the Udyam record's, and the profile completeness card.
 */
@Component({
  selector: 'zed-msme-profile',
  host: { class: 'd-block' },
  imports: [AlertDialog, FormsModule, RouterLink, PageHead, ProfileShell],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfilePage {
  private readonly api = inject(ProfileApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly crumbs: Crumb[] = [{ label: 'Home', link: '/msme/dashboard' }, { label: 'Profile' }];
  /** The section highlighted in the menu (the last one picked). */
  protected readonly active = signal<ProfileSection>('enterprise');

  protected readonly msme = signal<ProfileRow>({});
  protected readonly basicInfo = signal<ProfileRow>({});
  /** The dashboard's data for the header's chips; null until (or unless) it answers. */
  protected readonly dash = signal<ProfileDashboard | null>(null);
  /** The number of recorded changes for the menu; null when not known. */
  protected readonly changes = signal<number | null>(null);

  /** The rest of the Udyam details: "Show all details" (only when there is more to show). */
  protected readonly showAll = signal(false);
  protected readonly moreRows = computed(() => MORE_INFO.filter((r) => this.value(r)));
  protected readonly fullAddress = signal(false);

  protected readonly enterpriseName = computed(() => this.text(this.basicInfo(), 'EnterpriseName') || this.text(this.msme(), 'EnterpriseName'));
  protected readonly entType = computed(() =>
    this.text(this.basicInfo(), 'EnterpriseTypee') || this.text(this.dash()?.msme ?? {}, 'EnterpriseType') || this.text(this.msme(), 'EnterpriseTypee'));
  protected readonly zedId = computed(() => this.text(this.msme(), 'ZedId'));
  protected readonly pan = computed(() => this.text(this.basicInfo(), 'PanNo'));
  protected readonly mobile = computed(() => this.text(this.basicInfo(), 'MobileNo'));
  protected readonly address = computed(() => this.text(this.basicInfo(), 'Address'));
  protected readonly place = computed(() =>
    [this.text(this.basicInfo(), 'StateName'), this.text(this.basicInfo(), 'DistrictName')].filter((x) => x.trim()).join(' · '));
  protected readonly pledgeOn = computed(() => shortDate(this.text(this.dash()?.msme ?? {}, 'PledgeOn')));

  /** The highest level the unit is certified at (dashboard statuses), with its name and logo; null before one. */
  protected readonly level = computed(() => {
    const d = this.dash();
    if (!d) return null;
    const codes = ['Bronze', 'Silver', 'Gold', ...(d.levels ?? []).map((l) => l.code)];
    const code = codes.filter((c) => Number(d.certStatus?.[`${c}Status`] ?? 0) === certifiedStatus(c)).pop();
    return code ? { code, name: levelName(code), logo: levelLogo(code) } : null;
  });

  protected readonly unitAddress = computed(() => {
    const m = this.msme();
    return ['PAddress', 'PDistrictName', 'PStateName', 'PPin'].map((f) => this.text(m, f)).filter((x) => x.trim()).join(', ');
  });
  protected readonly hasUnit = computed(() => !!(this.text(this.msme(), 'PUnitName') || this.unitAddress()));
  protected readonly unitCount = computed(() => (this.hasUnit() ? 1 : null));

  /** The unit's activity as the hierarchy: the major activity, then the 2-, 4- and 5-digit NIC codes. */
  protected readonly nic = computed<NicStep[]>(() => {
    const m = this.msme();
    const major = this.text(m, 'Activity');
    const steps = ['TwoDigitActivity', 'FourDigitActivity', 'FiveDigitActivity'].map((f) => this.text(m, f)).filter((x) => x.trim()).map(nicStep);
    return major.trim() ? [{ code: '', text: major.trim() }, ...steps] : steps;
  });

  protected readonly registeredEmail = signal('');
  /** 2026-11-18: the mobile is the one the Udyam service accepted at registration (api/msme/profile's mobileVerified). */
  protected readonly mobileVerified = signal(false);
  /** The profile has answered (the completeness card waits for it). */
  protected readonly loaded = signal(false);

  /** 2026-11-18 (the user's applicant designs): the completeness card under the section menu. */
  protected readonly completeness = computed(() => profileCompleteness({
    email: !!this.registeredEmail().trim(),
    activity: !!this.text(this.msme(), 'FiveDigitActivity').trim(),
    unit: this.hasUnit(),
    mobile: !!this.mobile().trim(),
    pan: !!this.pan().trim(),
    address: !!this.address().trim(),
  }));
  /** Change of the registered e-mail: enter the new address, then the OTP sent to it. */
  protected readonly emailStep = signal<'idle' | 'enter' | 'otp'>('idle');
  protected newEmail = '';
  protected emailOtp = '';
  protected readonly busy = signal(false);
  /** Error / success pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);

  protected readonly editMode = signal(false);
  protected readonly activities = signal<UdyamActivity[]>([]);
  protected readonly selected = signal('');
  /** UPDATE is only offered once a different activity is chosen (as before). */
  protected readonly changed = computed(() => !!this.selected() && this.selected() !== this.text(this.msme(), 'FiveDigitActivity'));

  constructor() {
    void this.load().then(() => {
      // From the menu of Change password / Edit history: /msme/profile#contact etc.
      const f = this.route.snapshot.fragment as ProfileSection | null;
      if (f && PROFILE_PAGE_SECTIONS.includes(f)) setTimeout(() => this.go(f));
    });
    // The header's chips and the menu's count: best effort, hidden when they do not answer.
    firstValueFrom(this.api.dashboard()).then((d) => this.dash.set(d ?? null)).catch(() => undefined);
    firstValueFrom(this.api.editHistoryTotal()).then((r) => this.changes.set(typeof r?.total === 'number' ? r.total : null)).catch(() => undefined);
  }

  /** The menu: highlights the section and scrolls to it. */
  protected go(section: ProfileSection): void {
    this.active.set(section);
    document.getElementById(`sec-${section}`)?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  protected value(row: InfoRow): string {
    return this.text(row.source === 'msme' ? this.msme() : this.basicInfo(), row.field);
  }

  protected text(row: ProfileRow, field: string): string {
    const v = row[field];
    return v === null || v === undefined ? '' : String(v);
  }

  protected startEmailChange(): void {
    this.newEmail = '';
    this.emailOtp = '';
    this.emailStep.set('enter');
  }

  protected cancelEmailChange(): void {
    this.emailStep.set('idle');
  }

  protected async sendEmailOtp(): Promise<void> {
    const email = this.newEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || email.length > 100) {
      this.alert.set(errorAlert('Please enter a valid e-mail address.'));
      return;
    }
    const res = await this.call(this.api.sendEmailOtp(email));
    if (!res) return;
    this.newEmail = email;
    this.emailOtp = '';
    this.emailStep.set('otp');
  }

  protected async verifyEmailOtp(): Promise<void> {
    if (!/^[0-9]{6}$/.test(this.emailOtp.trim())) {
      this.alert.set(errorAlert('Please enter the 6-digit OTP.'));
      return;
    }
    const res = await this.call(this.api.verifyEmailOtp(this.emailOtp.trim()));
    if (!res) return;
    this.registeredEmail.set(res.email);
    this.emailStep.set('idle');
    this.alert.set(successAlert('Your registered e-mail has been changed.'));
  }

  protected async editActivity(): Promise<void> {
    const list = await this.call(this.api.activities());
    if (!list) return;
    this.activities.set(list);
    this.selected.set(this.text(this.msme(), 'FiveDigitActivity'));
    this.editMode.set(true);
  }

  protected cancelEdit(): void {
    this.editMode.set(false);
  }

  protected async updateActivity(): Promise<void> {
    if (!this.changed()) return;
    const res = await this.call(this.api.updateActivity(this.selected()));
    if (!res) return;
    this.editMode.set(false);
    await this.load();
    this.alert.set(successAlert('Activity updated successfully.'));
  }

  private async load(): Promise<void> {
    const res = await this.call(this.api.get());
    if (!res) return;
    this.msme.set(res.msme ?? {});
    this.basicInfo.set(res.basicInfo ?? {});
    this.registeredEmail.set(res.registeredEmail ?? '');
    this.mobileVerified.set(res.mobileVerified === true);
    this.loaded.set(true);
  }

  /** Runs a request with the loading overlay; shows the API message in the pop-up on failure. */
  private async call<T>(req: Observable<T>): Promise<T | null> {
    this.busy.set(true);
    try {
      return await firstValueFrom(req);
    } catch (err) {
      this.alert.set(errorAlert(apiErrorMessage(err)));
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
