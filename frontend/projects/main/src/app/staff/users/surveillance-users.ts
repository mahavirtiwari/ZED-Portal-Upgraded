import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { CodeName, RESET_CONFIRM, SurveillanceAgency, SurveillanceAssessor, SurveillanceUsersApi } from './users.api';

interface BronzeDialog {
  agency: SurveillanceAgency;
  allow: boolean;
  reason: string;
  state: string;
  districts: string[];
}

interface BlockDialog {
  kind: 'agencies' | 'assessors';
  userId: string;
  reason: string;
}

/**
 * Surveillance build: "Bronze Surveillance Agencies" (MasterAdmin) and the assessors list (MasterAdmin: all, agency: its
 * own). Port of ZEDCS_SURVEILLANCE User/AssessmentAgencies and User/Assessors. Accounts are created and edited in main;
 * here the MasterAdmin enables Bronze surveillance with the preferred state and districts, and agencies / assessors are
 * blocked or unblocked in the surveillance database. The route's `data.kind` ('agencies' | 'assessors') picks the list.
 */
@Component({
  selector: 'zed-staff-surveillance-users',
  imports: [FormsModule, MultiSelect],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-12">
          <h3 class="registration-title">{{ kind === 'agencies' ? 'Bronze Surveillance Agencies' : 'Assessors' }}</h3>
          <p class="text-muted small">Accounts are created and edited on the ZED portal (main); changes here apply to surveillance only.</p>
          @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
          @if (message()) { <div class="alert alert-success" role="status">{{ message() }}</div> }
          <input class="form-control mb-2" style="max-width: 320px" placeholder="Search" aria-label="Search" [ngModel]="search()" (ngModelChange)="search.set($event)" />

          @if (kind === 'agencies') {
            <table class="table table-bordered">
              <thead>
                <tr><th>Status</th><th>Agency</th><th>SPOC</th><th>Assessors</th><th>Bronze Surveillance</th><th>Preferred State</th><th>Action(s)</th></tr>
              </thead>
              <tbody>
                @for (a of filteredAgencies(); track a.userId) {
                  <tr>
                    <td>{{ a.isActive ? 'Active' : 'In-Active' }}</td>
                    <td><strong>{{ a.userId }}</strong><br />{{ a.userName }}</td>
                    <td>{{ a.spocName }}<br />{{ a.email }}<br />{{ a.mobileNo }}</td>
                    <td>{{ a.noOfUsers }}</td>
                    <td>{{ a.allowBronzeSurveillance ? 'Allowed' : 'Not allowed' }}@if (!a.allowBronzeSurveillance && a.reasonForRejectionForBS) { <br /><small>{{ a.reasonForRejectionForBS }}</small> }</td>
                    <td>{{ stateName(a.tuPreferredState) }}</td>
                    <td>
                      <button type="button" class="btn btn-primary btn-sm mb-1" [disabled]="busy()" (click)="openBronze(a)">Bronze Surveillance</button><br />
                      @if (a.isActive) {
                        <button type="button" class="btn btn-default btn-sm" [disabled]="busy()" (click)="block.set({ kind: 'agencies', userId: a.userId, reason: '' })">Block</button>
                      } @else {
                        <button type="button" class="btn btn-default btn-sm" [disabled]="busy()" (click)="unblock('agencies', a.userId)">Unblock</button>
                      }
                      @if (a.isActive) {
                        <br /><button type="button" class="btn btn-default btn-sm mt-1" [disabled]="busy()" (click)="sendReset('agencies', a.userId)">Reset Link</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="7"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          } @else {
            <table class="table table-bordered">
              <thead>
                <tr><th>Status</th><th>Assessor</th><th>Contact</th><th>Agency</th><th>Bronze Surveillance</th><th>Action(s)</th></tr>
              </thead>
              <tbody>
                @for (s of filteredAssessors(); track s.userId) {
                  <tr>
                    <td>{{ s.isActive ? 'Active' : 'In-Active' }}</td>
                    <td><strong>{{ s.userId }}</strong><br />{{ s.userName }}</td>
                    <td>{{ s.email }}<br />{{ s.mobileNo }}</td>
                    <td>{{ s.agencyUserId }}<br />{{ s.agencyUserName }}</td>
                    <td>
                      <label class="d-flex align-items-center gap-2 m-0">
                        <input type="checkbox" [checked]="!!s.allowBronzeSurveillance" [disabled]="busy()" (change)="setAssessorBronze(s, $any($event.target).checked)" />
                        {{ s.allowBronzeSurveillance ? 'Allowed' : 'Not allowed' }}
                      </label>
                    </td>
                    <td>
                      @if (s.isActive) {
                        <button type="button" class="btn btn-default btn-sm" [disabled]="busy()" (click)="block.set({ kind: 'assessors', userId: s.userId, reason: '' })">Block</button>
                      } @else {
                        <button type="button" class="btn btn-default btn-sm" [disabled]="busy()" (click)="unblock('assessors', s.userId)">Unblock</button>
                      }
                      @if (s.isActive) {
                        <br /><button type="button" class="btn btn-default btn-sm mt-1" [disabled]="busy()" (click)="sendReset('assessors', s.userId)">Reset Link</button>
                      }
                    </td>
                  </tr>
                } @empty {
                  <tr><td colspan="6"><div class="no-data">No Data</div></td></tr>
                }
              </tbody>
            </table>
          }
        </div>
      </div>
    </div>

    @if (bronze(); as d) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bronze-title">
        <div class="modal-dialog"><div class="modal-content"><div class="modal-body">
          <h3 class="registration-title" id="bronze-title">Bronze Surveillance – {{ d.agency.userId }}</h3>
          <label class="d-flex align-items-center gap-2 mb-2"><input type="checkbox" name="allow" [(ngModel)]="d.allow" /> Allow Bronze surveillance</label>
          @if (d.allow) {
            <label class="d-block" for="bs-state">Preferred State</label>
            <select id="bs-state" class="form-control mb-2" [ngModel]="d.state" (ngModelChange)="stateChanged(d, $event)">
              <option value="">Select State</option>
              @for (st of states(); track st.code) { <option [value]="st.code">{{ st.name }}</option> }
            </select>
            <label class="d-block" for="bs-districts">Preferred Districts</label>
            <zed-multi-select inputId="bs-districts" label="Preferred Districts" [options]="districts()" [(value)]="d.districts" />
          } @else {
            <label class="d-block" for="bs-reason">Reason</label>
            <textarea id="bs-reason" class="form-control" maxlength="2000" [(ngModel)]="d.reason"></textarea>
          }
          <div class="mt-3 d-flex gap-2">
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="saveBronze(d)">Save</button>
            <button type="button" class="btn btn-default" (click)="bronze.set(null)">Close</button>
          </div>
        </div></div></div>
      </div>
    }

    @if (block(); as b) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="block-title">
        <div class="modal-dialog"><div class="modal-content"><div class="modal-body">
          <h3 class="registration-title" id="block-title">Reason for Block – {{ b.userId }}</h3>
          <textarea class="form-control" maxlength="2000" aria-label="Reason" [(ngModel)]="b.reason"></textarea>
          <div class="mt-3 d-flex gap-2">
            <button type="button" class="btn btn-primary" [disabled]="busy() || !b.reason.trim()" (click)="confirmBlock(b)">Block</button>
            <button type="button" class="btn btn-default" (click)="block.set(null)">Close</button>
          </div>
        </div></div></div>
      </div>
    }
  `,
})
export class SurveillanceUsersPage {
  private readonly api = inject(SurveillanceUsersApi);
  protected readonly kind: 'agencies' | 'assessors' = inject(ActivatedRoute).snapshot.data['kind'] === 'agencies' ? 'agencies' : 'assessors';
  private readonly isMaster = inject(AuthService).currentUser()?.roleId === StaffRole.MasterAdmin;

  protected readonly agencies = signal<SurveillanceAgency[]>([]);
  protected readonly assessors = signal<SurveillanceAssessor[]>([]);
  protected readonly states = signal<CodeName[]>([]);
  protected readonly districts = signal<MultiSelectOption[]>([]);
  protected readonly search = signal('');
  protected readonly error = signal('');
  protected readonly message = signal('');
  protected readonly busy = signal(false);
  protected readonly bronze = signal<BronzeDialog | null>(null);
  protected readonly block = signal<BlockDialog | null>(null);

  protected readonly filteredAgencies = computed(() => {
    const s = this.search().trim().toLowerCase();
    return this.agencies().filter((a) => !s || [a.userId, a.userName, a.spocName, a.email].some((v) => (v ?? '').toLowerCase().includes(s)));
  });
  protected readonly filteredAssessors = computed(() => {
    const s = this.search().trim().toLowerCase();
    return this.assessors().filter((a) => !s || [a.userId, a.userName, a.email, a.agencyUserId].some((v) => (v ?? '').toLowerCase().includes(s)));
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      if (this.kind === 'agencies') {
        const [agencies, states] = await Promise.all([firstValueFrom(this.api.agencies()), firstValueFrom(this.api.states())]);
        this.agencies.set(agencies);
        this.states.set(states);
      } else {
        this.assessors.set(await firstValueFrom(this.api.assessors()));
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected stateName(code: string | null): string {
    return this.states().find((s) => s.code === code)?.name ?? code ?? '-';
  }

  protected async openBronze(a: SurveillanceAgency): Promise<void> {
    this.error.set('');
    try {
      const details = await firstValueFrom(this.api.agency(a.userId));
      const state = details.agency.tuPreferredState ?? '';
      await this.loadDistricts(state);
      this.bronze.set({ agency: a, allow: !!details.agency.allowBronzeSurveillance, reason: details.agency.reasonForRejectionForBS ?? '', state, districts: details.districts });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected async stateChanged(d: BronzeDialog, state: string): Promise<void> {
    d.state = state;
    d.districts = [];
    await this.loadDistricts(state);
  }

  private async loadDistricts(state: string): Promise<void> {
    this.districts.set(state ? (await firstValueFrom(this.api.districts(state))).map((x) => ({ value: x.districtCode, label: x.districtName })) : []);
  }

  protected async saveBronze(d: BronzeDialog): Promise<void> {
    const req = d.allow ? { allow: true, preferredState: d.state, districts: d.districts } : { allow: false, reason: d.reason };
    if (await this.run(this.api.setAgencyBronze(d.agency.userId, req))) this.bronze.set(null);
  }

  protected async setAssessorBronze(s: SurveillanceAssessor, allow: boolean): Promise<void> {
    await this.run(this.api.setAssessorBronze(s.userId, allow));
  }

  protected async confirmBlock(b: BlockDialog): Promise<void> {
    if (await this.run(this.api.block(b.kind, b.userId, b.reason.trim()))) this.block.set(null);
  }

  /** E-mails the user a link to set a new password (refused for accounts whose password the main portal holds). */
  protected async sendReset(kind: 'agencies' | 'assessors', userId: string): Promise<void> {
    if (!window.confirm(RESET_CONFIRM)) return;
    await this.run(this.api.passwordReset(kind, userId));
  }

  protected async unblock(kind: 'agencies' | 'assessors', userId: string): Promise<void> {
    if (!window.confirm('Are you sure that you want to unblock this user?')) return;
    await this.run(this.api.unblock(kind, userId));
  }

  private async run(call: Observable<MessageResponse>): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    this.message.set('');
    try {
      this.message.set((await firstValueFrom(call)).message);
      await this.load();
      return true;
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /** The agency column is only meaningful to the MasterAdmin. */
  protected get showsAgency(): boolean {
    return this.isMaster;
  }
}
