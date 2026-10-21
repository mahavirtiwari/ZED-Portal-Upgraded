import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Row, SiteAssessmentApi } from './site-assessment.api';

/**
 * "Remote/Onsite Assessment" list of an assessor with the site verification sub-role. Port of
 * Views/Assessment/RemoteAssessments.cshtml (Assessment/GetList allotmentType RA). Its Accept/Reject
 * pop-ups had no button opening them and are not ported. VIEW DETAILS opens the SA details page
 * (staff/assessment/sa-details/...); ASSESS opens the remote assessment screen (staff/remote/...).
 */
@Component({
  selector: 'zed-staff-remote-assessments',
  imports: [RouterLink],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="zed-tabs mt-3">
        <div class="d-flex align-items-center justify-content-between mb-1">
          <h3 class="registration-title">Remote/Onsite Assessment</h3>
          <button type="button" class="refresh-link btn btn-link" (click)="load()">
            <img src="/Images/svgicons/refresh.svg" alt="" />
            <span>REFRESH</span>
          </button>
        </div>

        @if (error()) {
          <div class="alert alert-danger" role="alert">{{ error() }}</div>
        }

        <div class="table-responsive">
          <table class="table table-zed table-bordered">
            <thead>
              <tr>
                <th>Action(s)</th>
                <th>Certification Level</th>
                <th>Unit Details</th>
                <th>Unit SPOC Details</th>
                <th>Agency Details</th>
                <th>Mode of Assessment</th>
                <th>Assessment Date</th>
              </tr>
            </thead>
            <tbody>
              @for (s of rows(); track s['ZedId'] + '|' + s['Certification']) {
                <tr>
                  <td>
                    @if (s['ModeOfAssessment'] === 'Onsite Assessment') {
                      <a class="btn btn-primary btn-xs" [routerLink]="['/staff/assessment/sa-details', s['ZedId'], s['Certification']]">VIEW DETAILS</a>
                    } @else if (s['ModeOfAssessment'] === 'Remote Assessment') {
                      <a class="btn btn-primary btn-xs" [href]="remoteLink(s)">ASSESS</a>
                    }
                  </td>
                  <td>{{ s['Certification'] }}</td>
                  <td>
                    <strong class="dash-text-clr">{{ s['ZedId'] }}</strong><br />
                    <strong>{{ s['EnterpriseName'] }}</strong><br />
                    {{ s['UnitAddress'] }}
                  </td>
                  <td><strong>{{ s['UnitSpocName'] }}</strong><br />{{ s['UnitSpocMobileNo'] }}<br />{{ s['UnitSpocEmailId'] }}</td>
                  <td><strong>{{ s['AgencyName'] }}</strong><br />{{ s['CertificationBodyUserId'] }}</td>
                  <td>{{ mode(s) }}</td>
                  <td>{{ s['AssessmentDate'] }}</td>
                </tr>
              } @empty {
                <tr>
                  <td colspan="7" style="padding: 0px"><div class="no-data">No Data</div></td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      </div>
    </div>

    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite">
        <div class="text-center text-white">
          <div class="spinner-border text-light"></div>
          <div><small>Please wait ...</small></div>
        </div>
      </div>
    }
  `,
  styles: `
    .refresh-link { cursor: pointer; text-decoration: none; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class RemoteAssessmentsPage {
  private readonly api = inject(SiteAssessmentApi);
  private readonly legacyUrl = signal('');

  protected readonly rows = signal<Row[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal('');

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      this.rows.set((await firstValueFrom(this.api.remoteAssessments())) ?? []);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected mode(s: Row): string {
    return s['ModeOfAssessment'] === 'Remote Assessment' ? 'Remote' : s['ModeOfAssessment'] === 'Onsite Assessment' ? 'Onsite' : 'Desktop';
  }

  protected remoteLink(s: Row): string {
    return `/staff/remote/${encodeURIComponent(String(s['ZedId'] ?? ''))}/${encodeURIComponent(String(s['Certification'] ?? ''))}`;
  }

}
