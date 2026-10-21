import { Component, computed, inject, signal } from '@angular/core';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
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
  { label: 'Email Id:', source: 'basicInfo', field: 'EmailId' },
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

/**
 * MSME "View Profile". Port of Views/Msme/ViewProfile.cshtml: basic information, selected unit and
 * unit activity, with "Edit Activity" choosing another activity of the MSME's own Udyam record.
 */
@Component({
  selector: 'zed-msme-profile',
  host: { class: 'd-block' },
  templateUrl: './profile.html',
  styleUrl: './profile.scss',
})
export class ProfilePage {
  private readonly api = inject(ProfileApi);

  protected readonly rows = BASIC_INFO;
  protected readonly msme = signal<ProfileRow>({});
  protected readonly basicInfo = signal<ProfileRow>({});
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  protected readonly editMode = signal(false);
  protected readonly activities = signal<UdyamActivity[]>([]);
  protected readonly selected = signal('');
  /** UPDATE is only offered once a different activity is chosen (as before). */
  protected readonly changed = computed(() => !!this.selected() && this.selected() !== this.text(this.msme(), 'FiveDigitActivity'));

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
    this.success.set('');
    const list = await this.call(this.api.activities());
    if (!list) return;
    this.activities.set(list);
    this.selected.set(this.text(this.msme(), 'FiveDigitActivity'));
    this.editMode.set(true);
  }

  protected cancelEdit(): void {
    this.error.set('');
    this.editMode.set(false);
  }

  protected async updateActivity(): Promise<void> {
    if (!this.changed()) return;
    const res = await this.call(this.api.updateActivity(this.selected()));
    if (!res) return;
    this.editMode.set(false);
    await this.load();
    this.success.set('Activity updated successfully.');
  }

  private async load(): Promise<void> {
    const res = await this.call(this.api.get());
    if (!res) return;
    this.msme.set(res.msme ?? {});
    this.basicInfo.set(res.basicInfo ?? {});
  }

  /** Runs a request with the loading overlay; shows the API message on failure. */
  private async call<T>(req: Observable<T>): Promise<T | null> {
    this.busy.set(true);
    this.error.set('');
    try {
      return await firstValueFrom(req);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
