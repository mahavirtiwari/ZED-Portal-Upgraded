import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

export type ProfileRow = Record<string, string | number | boolean | null>;

export interface StaffMsmeProfile {
  unit: ProfileRow;
  enterprise: ProfileRow;
  certifications: string[];
}

/** Link to the staff profile of a unit (replaces the legacy {portal}/Msme/Profile/{zedId} links). */
export function staffProfileLink(zedId: string): string {
  return `/staff/msme-profile/${encodeURIComponent(zedId)}`;
}

/** Label / field of the two tables of Views/Msme/Profile.cshtml. */
const UNIT_FIELDS: [string, string][] = [
  ['ZED ID', 'ZedId'], ['Unit Name', 'PUnitName'], ['Unit Address', 'PAddress'], ['District', 'PDistrictName'], ['State', 'PStateName'],
  ['PIN Code', 'PPin'], ['Activity', 'Activity'], ['NIC 2 Digit', 'TwoDigitActivity'], ['NIC 4 Digit', 'FourDigitActivity'],
  ['NIC 5 Digit', 'FiveDigitActivity'], ['Date of Incorporation', 'IncorporationDate'], ['Production Commenced', 'WhetherProdCommenced'],
];

const ENTERPRISE_FIELDS: [string, string][] = [
  ['Udyam Registration Number', 'UdyogAadharNo'], ['Enterprise Name', 'EnterpriseName'], ['Owner Name', 'OwnerName'],
  ['Type of Organisation', 'OrganisationTypeName'], ['Social Category', 'SocialCategoryName'], ['Gender', 'Gender'], ['Specially Abled', 'PH'],
  ['PAN', 'PanNo'], ['Address', 'Address'], ['State', 'StateName'], ['District', 'DistrictName'], ['PIN Code', 'Pincode'],
  ['Mobile No', 'MobileNo'], ['Email ID', 'EmailId'], ['Major Activity', 'MajorActivityName'], ['Enterprise Type', 'EnterpriseTypee'],
  ['Date of Commencement', 'CommmenceDate'], ['Total Employees', 'TotalEmp'], ['DIC Name', 'DicName'], ['Udyam Applied Date', 'AppliedDate'],
];

/**
 * Staff "View Profile" of a unit (all three portals). Port of Views/Msme/Profile.cshtml, read through
 * api/staff/msme-profile/{zedId}, which checks the role and, for agencies and assessors, the allotment.
 */
@Component({
  selector: 'zed-staff-msme-profile',
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <h3 class="registration-title">MSME Profile</h3>
            <button type="button" class="btn btn-back" (click)="back()">BACK</button>
          </div>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (profile(); as p) {
            @if (p.certifications.length) {
              <p class="text-muted">Certifications: {{ p.certifications.join(', ') }}</p>
            }
            <div class="panel panel-default mb-3">
              <div class="panel-heading"><h5 class="m-0">Unit Details</h5></div>
              <table class="table table-bordered mb-0">
                <tbody>
                  @for (f of unitFields; track f[1]) {
                    <tr><th scope="row" style="width: 35%">{{ f[0] }}</th><td [attr.data-field]="f[1]">{{ show(p.unit, f[1]) }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="panel panel-default">
              <div class="panel-heading"><h5 class="m-0">Enterprise Details (Udyam)</h5></div>
              <table class="table table-bordered mb-0">
                <tbody>
                  @for (f of enterpriseFields; track f[1]) {
                    <tr><th scope="row" style="width: 35%">{{ f[0] }}</th><td [attr.data-field]="f[1]">{{ show(p.enterprise, f[1]) }}</td></tr>
                  }
                </tbody>
              </table>
            </div>
          } @else if (loading()) {
            <p role="status">Loading…</p>
          }
        </div>
      </div>
    </div>
  `,
})
export class StaffMsmeProfilePage {
  private readonly http = inject(HttpClient);
  protected readonly zedId = inject(ActivatedRoute).snapshot.paramMap.get('zedId') ?? '';
  protected readonly unitFields = UNIT_FIELDS;
  protected readonly enterpriseFields = ENTERPRISE_FIELDS;
  protected readonly profile = signal<StaffMsmeProfile | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.profile.set(await firstValueFrom(this.http.get<StaffMsmeProfile>(`/api/staff/msme-profile/${encodeURIComponent(this.zedId)}`)));
    } catch (err) {
      this.error.set(apiErrorMessage(err) === 'Unexpected error occured. Please try after some time.' ? 'This unit was not found or is not allotted to you.' : apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected show(row: ProfileRow, field: string): string {
    const v = row[field];
    return v === null || v === undefined || v === '' ? '-' : String(v);
  }

  protected back(): void {
    history.back();
  }
}
