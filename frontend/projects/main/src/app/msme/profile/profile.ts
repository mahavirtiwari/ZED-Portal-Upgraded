import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { AlertDialog, AlertMessage, errorAlert, successAlert } from '../shared/alert-dialog';
import { ProfileApi, ProfileRow, UdyamActivity } from './profile.api';

/** One row of the "Basic Information" table: label and the column it shows. */
interface InfoRow {
  label: string;
  source: 'msme' | 'basicInfo';
  field: string;
}

const BASIC_INFO: InfoRow[] = [
  { label: 'ZED ID:', source: 'msme', field: 'ZedId' },
  { label: 'Udyam Number:', source: 'basicInfo', field: 'UdyogAadharNo' },
  { label: 'Owner Name:', source: 'basicInfo', field: 'OwnerName' },
  { label: 'Enterprise Name:', source: 'basicInfo', field: 'EnterpriseName' },
  { label: 'Organisation Type:', source: 'basicInfo', field: 'OrganisationTypeName' },
  { label: 'Social Category:', source: 'basicInfo', field: 'SocialCategoryName' },
  { label: 'Gender:', source: 'basicInfo', field: 'Gender' },
  { label: 'E-mail (Udyam):', source: 'basicInfo', field: 'EmailId' },
  { label: 'Mobile No.:', source: 'basicInfo', field: 'MobileNo' },
  { label: 'Physically Handicapped:', source: 'basicInfo', field: 'PH' },
  { label: 'PanNo:', source: 'basicInfo', field: 'PanNo' },
  { label: 'Registered Address:', source: 'basicInfo', field: 'Address' },
  { label: 'State:', source: 'basicInfo', field: 'StateName' },
  { label: 'District:', source: 'basicInfo', field: 'DistrictName' },
  { label: 'Pincode:', source: 'basicInfo', field: 'Pincode' },
  { label: 'Major Activity:', source: 'basicInfo', field: 'MajorActivityName' },
  { label: 'Enterprise Type:', source: 'basicInfo', field: 'EnterpriseTypee' },
  { label: 'Incorporation Date:', source: 'msme', field: 'IncorporationDate' },
  { label: 'Whether Production Commenced:', source: 'msme', field: 'WhetherProdCommenced' },
  { label: 'Commencement Date:', source: 'basicInfo', field: 'CommmenceDate' },
  { label: 'Total Employee:', source: 'basicInfo', field: 'TotalEmp' },
  { label: 'DIC Name:', source: 'basicInfo', field: 'DicName' },
  { label: 'Applied Date:', source: 'basicInfo', field: 'AppliedDate' },
];

const MAIN_FIELDS = ['EnterpriseName', 'UdyogAadharNo', 'OwnerName', 'EnterpriseTypee', 'PanNo', 'Address', 'DistrictName', 'StateName'];

/**
 * MSME "View Profile". Port of Views/Msme/ViewProfile.cshtml: basic information, selected unit and
 * unit activity, with "Edit Activity" choosing another activity of the MSME's own Udyam record.
 */
@Component({
  selector: 'zed-msme-profile',
  host: { class: 'd-block' },
  imports: [AlertDialog, FormsModule, RouterLink],
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfilePage {
  private readonly api = inject(ProfileApi);

  protected readonly rows = BASIC_INFO;
  /** The main details first; "Show all details" adds the rest (2026-11-07 redesign). */
  protected readonly showAll = signal(false);
  protected readonly shownRows = computed(() =>
    this.showAll() ? BASIC_INFO.filter((r) => r.field !== 'ZedId') : BASIC_INFO.filter((r) => MAIN_FIELDS.includes(r.field)),
  );
  /** 2026-11-14: only the rows with a value (no walls of dashes). */
  protected readonly filledRows = computed(() => this.shownRows().filter((r) => this.value(r)));
  /** "Show all details" only when it would show more. */
  protected readonly hasMoreRows = computed(() =>
    BASIC_INFO.some((r) => r.field !== 'ZedId' && !MAIN_FIELDS.includes(r.field) && this.value(r)));
  protected readonly enterpriseName = computed(() => this.text(this.basicInfo(), 'EnterpriseName') || this.text(this.msme(), 'EnterpriseName'));
  protected readonly entType = computed(() =>
    this.text(this.basicInfo(), 'EnterpriseTypee') || this.text(this.msme(), 'EnterpriseType') || this.text(this.msme(), 'EnterpriseTypee'));
  /** Udyam · ZED ID · type, under the enterprise name of the summary card. */
  protected readonly summaryLine = computed(() =>
    [this.text(this.basicInfo(), 'UdyogAadharNo'), this.text(this.msme(), 'ZedId'), this.entType()].filter((x) => x).join(' · '));

  /** The label without the legacy trailing colon. */
  protected label(row: InfoRow): string {
    return row.label.replace(/:$/, '');
  }
  protected readonly registeredEmail = signal('');
  /** Change of the registered e-mail: enter the new address, then the OTP sent to it. */
  protected readonly emailStep = signal<'idle' | 'enter' | 'otp'>('idle');
  protected newEmail = '';
  protected emailOtp = '';
  protected readonly msme = signal<ProfileRow>({});
  protected readonly basicInfo = signal<ProfileRow>({});
  protected readonly busy = signal(false);
  /** Error / success pop-up (the legacy swal). */
  protected readonly alert = signal<AlertMessage | null>(null);

  protected readonly editMode = signal(false);
  protected readonly activities = signal<UdyamActivity[]>([]);
  protected readonly selected = signal('');
  /** UPDATE is only offered once a different activity is chosen (as before). */
  protected readonly changed = computed(() => !!this.selected() && this.selected() !== this.text(this.msme(), 'FiveDigitActivity'));

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

  protected readonly unitAddress = computed(() => {
    const m = this.msme();
    return ['PAddress', 'PDistrictName', 'PStateName', 'PPin'].map((f) => this.text(m, f)).filter((x) => x.trim()).join(', ');
  });

  constructor() {
    void this.load();
  }

  protected value(row: InfoRow): string {
    return this.text(row.source === 'msme' ? this.msme() : this.basicInfo(), row.field);
  }

  protected text(row: ProfileRow, field: string): string {
    const v = row[field];
    return v === null || v === undefined ? '' : String(v);
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
