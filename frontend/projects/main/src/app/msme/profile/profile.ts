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

/** "AN•••••82C": the first two and the last three characters (the whole value when it is that short). */
export function masked(value: string): string {
  const v = value.trim();
  if (v.length <= 5) return v;
  return `${v.slice(0, 2)}•••••${v.slice(-3)}`;
}

/** "ka•••••@gmail.com": the first two characters of the name and the domain. */
export function maskedEmail(value: string): string {
  const at = value.lastIndexOf('@');
  if (at < 1) return masked(value);
  return `${value.slice(0, Math.min(2, at))}•••••${value.slice(at)}`;
}

/** Status meaning "certified" per level (as the dashboard): 6 for Bronze, 16 for the others. */
const certifiedStatus = (code: string): number => (code === 'Bronze' ? 6 : 16);

/**
 * MSME "Enterprise profile". Port of Views/Msme/ViewProfile.cshtml; 2026-11-17 the user's approved design: a left section
 * menu (Enterprise, Contact, Units / plants, Unit activity (NIC), Account & security, Edit history), the header card
 * (size, certification, pledge), the Udyam details read only with the PAN masked, the contact with the change of the
 * registered e-mail (OTP to the new address), the unit as a card and its NIC activity as the 2 > 4 > 5-digit hierarchy
 * with "Edit activity" choosing another activity of the MSME's own Udyam record. Basic information and documents are
 * entered only in the ZED MSME app; nothing else is edited here.
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
  protected readonly showPan = signal(false);
  protected readonly showContact = signal(false);
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
  protected readonly pledgeOn = computed(() => this.text(this.dash()?.msme ?? {}, 'PledgeOn'));

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

  protected readonly masked = masked;
  protected readonly maskedEmail = maskedEmail;

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
