import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { CodeName, RESET_CONFIRM, SurveillanceAgency, SurveillanceAssessor, SurveillanceUsersApi } from './users.api';
import { PagedView, PagerComponent } from '../pager';

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

type ListFilter = 'all' | 'active' | 'blocked' | 'bronze';

/**
 * Surveillance build: "Bronze Surveillance Agencies" (MasterAdmin) and the assessors list (MasterAdmin: all, agency: its
 * own). Port of ZEDCS_SURVEILLANCE User/AssessmentAgencies and User/Assessors. Accounts are created and edited in main;
 * here the MasterAdmin enables Bronze surveillance with the preferred state and districts, and agencies / assessors are
 * blocked or unblocked in the surveillance database. The route's `data.kind` ('agencies' | 'assessors') picks the list.
 * V4 layout: tiles with all, active, blocked and Bronze-allowed users (a click filters), the list in a card with a search
 * box (and, for the MasterAdmin's assessors, an agency filter), the old columns with initials, verification chips and the
 * agency under the name, the Bronze surveillance setting in a panel under the row buttons, a card per user on phones, and
 * the pop-ups with a title bar (Bronze surveillance as a switch card).
 */
@Component({
  selector: 'zed-staff-surveillance-users',
  imports: [FormsModule, MultiSelect, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ kind === 'agencies' ? 'Bronze Surveillance Agencies' : 'Assessors' }}</h3>
        <p class="page-sub">Accounts are created and edited on the ZED portal (main); changes here apply to surveillance only.</p>
      </div>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (message()) { <div class="alert alert-success" role="status">{{ message() }}</div> }
    <div class="sv-stats" role="group" [attr.aria-label]="noun() + ' by status'">
      @for (t of tiles(); track t.key) {
        <button type="button" class="sv-stat" [class]="'tile-' + t.key" [class.is-on]="filter() === t.key" [attr.aria-pressed]="filter() === t.key" (click)="filter.set(t.key)">
          <span class="sv-stat-count">{{ t.count }}</span>
          <span class="sv-stat-label">{{ t.label }}</span>
        </button>
      }
    </div>

    <div class="zed-card sv-list">
      <div class="sv-toolbar">
        <input type="search" class="form-control sv-search" placeholder="Search ID, name or e-mail" aria-label="Search" [ngModel]="search()" (ngModelChange)="search.set($event)" />
        @if (kind === 'assessors' && showsAgency && agencyOptions().length > 1) {
          <select id="sv-agency" class="form-select sv-agency" aria-label="Agency" [ngModel]="agency()" (ngModelChange)="agency.set($event)">
            <option value="">All agencies</option>
            @for (o of agencyOptions(); track o.id) { <option [value]="o.id">{{ o.name }} ({{ o.count }})</option> }
          </select>
        }
        <span class="muted sv-showing">{{ shownCount() }} of {{ totalCount() }} {{ noun().toLowerCase() }}{{ filter() === 'all' ? '' : ' · ' + filterLabel() }}</span>
      </div>

      @if (kind === 'agencies') {
        <!-- Columns of the old User/AssessmentAgencies.cshtml; the Bronze surveillance setting and Reset Link sit in Actions. -->
        <div class="table-responsive">
          <table class="table table-zed table-bordered sv-table">
            <thead>
              <tr><th class="text-center" style="width: 100px">Status</th><th class="text-center">Agency Id</th><th>Agency Details</th><th>Spoc Details</th><th class="text-center">No. of Assessors</th><th class="text-center" style="width: 270px">Actions</th></tr>
            </thead>
            <tbody>
              @for (a of agenciesView.page(); track a.userId) {
                <tr [class.is-blocked]="!a.isActive">
                  <td class="text-center sv-status-cell"><span class="status-badge" [class.is-active]="a.isActive" [class.is-rejected]="!a.isActive">{{ status(a) }}</span></td>
                  <td class="text-center sv-id-cell" data-label="Agency Id"><strong>{{ a.userId }}</strong></td>
                  <td class="sv-details">
                    <div class="sv-user">
                      <span class="sv-avatar" aria-hidden="true">{{ initials(a.userName, a.userId) }}</span>
                      <span class="sv-who">
                        <span class="sv-name">{{ a.userName }}</span>
                        @if (field(a, 'address')) { <span class="sv-line">{{ field(a, 'address') }}</span> }
                        @if (field(a, 'pinCode')) { <span class="sv-line">{{ field(a, 'pinCode') }}</span> }
                        @if (a.desktopVerification || a.siteVerification) {
                          <span class="sv-chips">
                            @if (a.desktopVerification) { <span class="zed-chip">Desktop verification</span> }
                            @if (a.siteVerification) { <span class="zed-chip">Site verification</span> }
                          </span>
                        }
                      </span>
                      <span class="status-badge sv-badge-phone" [class.is-active]="a.isActive" [class.is-rejected]="!a.isActive">{{ status(a) }}</span>
                    </div>
                  </td>
                  <td class="sv-contact" data-label="Spoc Details">
                    <strong>{{ a.spocName }}</strong>
                    @if (a.mobileNo) { <span>{{ a.mobileNo }}</span> }
                    @if (a.email) { <span class="sv-mail">{{ a.email }}</span> }
                  </td>
                  <td class="text-center sv-count-cell" data-label="No. of Assessors"><span class="sv-count">{{ a.noOfUsers }}</span></td>
                  <td class="text-center sv-actions-cell">
                    <div class="row-actions justify-content-center">
                      @if (a.isActive) {
                        <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="block.set({ kind: 'agencies', userId: a.userId, reason: '' })">Block</button>
                      } @else {
                        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="unblock('agencies', a.userId)">UnBlock</button>
                      }
                      <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="openBronze(a)">Bronze Surveillance</button>
                      @if (a.isActive) {
                        <button type="button" class="btn btn-default" [disabled]="busy()" (click)="sendReset('agencies', a.userId)">Reset Link</button>
                      }
                    </div>
                    <div class="bronze-status" [class.is-on]="a.allowBronzeSurveillance">
                      <span class="bronze-label">Bronze surveillance</span>
                      <span class="status-badge" [class.is-success]="a.allowBronzeSurveillance" [class.is-inactive]="!a.allowBronzeSurveillance">{{ a.allowBronzeSurveillance ? 'Allowed' : 'Not allowed' }}</span>
                      @if (!a.allowBronzeSurveillance && a.reasonForRejectionForBS) { <small class="d-block text-muted">{{ a.reasonForRejectionForBS }}</small> }
                      @if (a.tuPreferredState) { <small class="d-block">Preferred State: <strong>{{ stateName(a.tuPreferredState) }}</strong></small> }
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="6" style="padding: 0"><div class="no-data sv-empty">
                  @if (agencies().length) {
                    No agency matches the filters.
                    <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all agencies</button>
                  } @else {
                    No agencies yet. They are added on the ZED portal (main).
                  }
                </div></td></tr>
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="agenciesView" />
      } @else {
        <!-- Columns of the old User/Assessors.cshtml; the Bronze surveillance switch and Reset Link sit in Actions. -->
        <div class="table-responsive">
          <table class="table table-zed table-bordered sv-table">
            <thead>
              <tr><th class="text-center" style="width: 100px">Status</th><th class="text-center">Assessor ID</th><th>Assessor Details</th><th>Assessor Contact Details</th><th class="text-center" style="width: 270px">Action(s)</th></tr>
            </thead>
            <tbody>
              @for (s of assessorsView.page(); track s.userId) {
                <tr [class.is-blocked]="!s.isActive">
                  <td class="text-center sv-status-cell"><span class="status-badge" [class.is-active]="s.isActive" [class.is-rejected]="!s.isActive">{{ status(s) }}</span></td>
                  <td class="text-center sv-id-cell" data-label="Assessor ID"><strong>{{ s.userId }}</strong></td>
                  <td class="sv-details">
                    <div class="sv-user">
                      <span class="sv-avatar" aria-hidden="true">{{ initials(s.userName, s.userId) }}</span>
                      <span class="sv-who">
                        <span class="sv-name">{{ s.userName }}</span>
                        @if (field(s, 'address')) { <span class="sv-line">{{ field(s, 'address') }}</span> }
                        @if (field(s, 'idProofNumber')) { <span class="sv-proof">ID proof: <strong>{{ field(s, 'idProofNumber') }}</strong></span> }
                        @if (showsAgency && s.agencyUserId) {
                          <span class="sv-agency-line"><span class="zed-chip" [title]="s.agencyUserId">{{ s.agencyUserName || s.agencyUserId }}</span></span>
                        }
                      </span>
                      <span class="status-badge sv-badge-phone" [class.is-active]="s.isActive" [class.is-rejected]="!s.isActive">{{ status(s) }}</span>
                    </div>
                  </td>
                  <td class="sv-contact" data-label="Contact">
                    @if (s.mobileNo) { <span>{{ s.mobileNo }}</span> }
                    @if (s.email) { <span class="sv-mail">{{ s.email }}</span> }
                    @if (!s.mobileNo && !s.email) { <span class="sv-mail">No contact saved</span> }
                  </td>
                  <td class="text-center sv-actions-cell">
                    <div class="row-actions justify-content-center">
                      @if (s.isActive) {
                        <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="block.set({ kind: 'assessors', userId: s.userId, reason: '' })">Block</button>
                      } @else {
                        <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="unblock('assessors', s.userId)">UnBlock</button>
                      }
                      @if (s.isActive) {
                        <button type="button" class="btn btn-default" [disabled]="busy()" (click)="sendReset('assessors', s.userId)">Reset Link</button>
                      }
                    </div>
                    <label class="bronze-switch form-switch" [class.is-on]="s.allowBronzeSurveillance">
                      <input type="checkbox" role="switch" class="form-check-input" [checked]="!!s.allowBronzeSurveillance" [disabled]="busy()" (change)="setAssessorBronze(s, $any($event.target).checked)" />
                      Bronze Surveillance: {{ s.allowBronzeSurveillance ? 'Allowed' : 'Not allowed' }}
                    </label>
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="5" style="padding: 0"><div class="no-data sv-empty">
                  @if (assessors().length) {
                    No assessor matches the filters.
                    <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all assessors</button>
                  } @else {
                    No assessors yet. They are added on the ZED portal (main).
                  }
                </div></td></tr>
              }
            </tbody>
          </table>
        </div>
        <zed-pager [pager]="assessorsView" />
      }
    </div>

    @if (bronze(); as d) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bronze-title">
        <div class="modal-dialog modal-popup sv-dialog"><div class="modal-content">
          <div class="modal-header">
            <h3 class="registration-title m-0" id="bronze-title">Bronze Surveillance – {{ d.agency.userId }}</h3>
            <button type="button" class="btn-close" aria-label="Close" (click)="bronze.set(null)"></button>
          </div>
          <div class="modal-body">
            <p class="sv-dialog-who"><strong>{{ d.agency.userName }}</strong>@if (d.agency.spocName) {<span class="muted"> · SPOC {{ d.agency.spocName }}</span>}</p>
            <label class="toggle-card form-switch mb-3" [class.active]="d.allow">
              <input type="checkbox" role="switch" class="form-check-input" name="allow" [(ngModel)]="d.allow" />
              <span><strong>Allow Bronze surveillance</strong>
                <small class="muted d-block">On: choose the preferred state and districts. Off: give the reason.</small></span>
            </label>
            <div class="form-grid">
              @if (d.allow) {
                <label for="bs-state">Preferred State</label>
                <select id="bs-state" class="form-select" [ngModel]="d.state" (ngModelChange)="stateChanged(d, $event)">
                  <option value="">Select State</option>
                  @for (st of states(); track st.code) { <option [value]="st.code">{{ st.name }}</option> }
                </select>
                <label class="top" for="bs-districts">Preferred Districts</label>
                <zed-multi-select inputId="bs-districts" label="Preferred Districts" [options]="districts()" [(value)]="d.districts" />
              } @else {
                <label class="top" for="bs-reason">Reason</label>
                <textarea id="bs-reason" class="form-control" maxlength="2000" rows="3" [(ngModel)]="d.reason"></textarea>
              }
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" (click)="bronze.set(null)">Close</button>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="saveBronze(d)">Save</button>
          </div>
        </div></div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (block(); as b) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="block-title">
        <div class="modal-dialog modal-popup sv-dialog"><div class="modal-content">
          <div class="modal-header">
            <h3 class="registration-title m-0" id="block-title">Reason for Block – {{ b.userId }}</h3>
            <button type="button" class="btn-close" aria-label="Close" (click)="block.set(null)"></button>
          </div>
          <div class="modal-body">
            <p class="sv-block-note">The {{ b.kind === 'agencies' ? 'agency' : 'assessor' }} can no longer sign in to surveillance until unblocked.</p>
            <textarea class="form-control" maxlength="2000" rows="4" aria-label="Reason" [(ngModel)]="b.reason"></textarea>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" (click)="block.set(null)">Close</button>
            <button type="button" class="btn btn-danger" [disabled]="busy() || !b.reason.trim()" (click)="confirmBlock(b)">Block</button>
          </div>
        </div></div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .sv-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .sv-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 18px; text-align: left; min-width: 0;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 1px 2px rgba(35,71,74,.05); cursor: pointer; }
    .sv-stat:hover { border-color: #45a5ad; }
    .sv-stat.is-on { border-color: #45a5ad; box-shadow: inset 0 0 0 1px #45a5ad; background: #eef6f6; }
    .sv-stat-count { font-size: 26px; font-weight: 700; color: #23474a; line-height: 1.1; }
    .sv-stat.tile-active .sv-stat-count { color: #1e7a3c; }
    .sv-stat.tile-blocked .sv-stat-count { color: #a8303a; }
    .sv-stat.tile-bronze .sv-stat-count { color: #8a6100; }
    .sv-stat-label { font-size: 13px; color: #5f6f70; font-weight: 600; }
    .sv-list { padding: 16px; }
    .sv-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
    .sv-toolbar .sv-search { flex: 1 1 260px; max-width: 380px; }
    .sv-toolbar .sv-agency { flex: 0 1 320px; width: auto; max-width: 100%; }
    .sv-showing { font-size: 13px; margin-left: auto; }
    .sv-table { margin-bottom: 8px; }
    .sv-table td { vertical-align: middle; }
    .sv-table tbody tr:hover td { background: #f7fbfb; }
    .sv-table tr.is-blocked td { background: #fbf7f7; }
    .sv-user { display: flex; align-items: flex-start; gap: 12px; min-width: 220px; }
    .sv-who { min-width: 0; display: flex; flex-direction: column; }
    .sv-avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); font-weight: 700; font-size: 13px; letter-spacing: .03em; }
    tr.is-blocked .sv-avatar { background: #f3e9e9; color: #9b4a4a; }
    .sv-name { font-weight: 600; color: #232527; overflow-wrap: anywhere; }
    .sv-line { font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }
    .sv-proof { font-size: 13px; color: #3b4b4c; }
    .sv-chips, .sv-agency-line { margin-top: 4px; }
    .sv-chips .zed-chip, .sv-agency-line .zed-chip { margin: 2px 4px 0 0; }
    .sv-agency-line .zed-chip { background: #f1f0fb; color: #3f3a7a; overflow-wrap: anywhere; }
    .sv-badge-phone { display: none; }
    .sv-contact { min-width: 200px; }
    .sv-contact > * { display: block; line-height: 1.6; overflow-wrap: anywhere; }
    .sv-mail { font-size: 13px; color: #5f6f70; }
    .sv-count { display: inline-block; min-width: 36px; padding: 2px 10px; border-radius: 12px; background: #eef6f6; color: #23474a; font-weight: 700; }
    .bronze-status { margin: 8px auto 0; padding: 6px 10px; border-radius: 8px; background: #f6f8f8; font-size: 13px; max-width: 260px; }
    .bronze-status.is-on { background: #f1f9f4; }
    .bronze-label { display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
    .bronze-switch { display: flex; align-items: center; justify-content: center; gap: 8px; margin: 8px 0 0; padding: 6px 10px; border-radius: 8px;
      background: #f6f8f8; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .bronze-switch.is-on { background: #f1f9f4; color: #1e7a3c; font-weight: 600; }
    .bronze-switch.form-switch { padding-left: 10px; }
    .bronze-switch .form-check-input { float: none; margin: 0; width: 2em; border: 1px solid #888; }
    .sv-empty .btn-link { font-weight: 600; }
    .form-grid > .top { align-self: start; padding-top: 8px; }

    .sv-dialog-who { margin: 0 0 12px; overflow-wrap: anywhere; }
    .sv-block-note { margin: 0 0 10px; font-size: 13px; color: #5f6f70; }
    .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
    .toggle-card.active { border-color: #45a5ad; background: #f4fafa; }
    /* The skin makes pop-up labels bold; on this card only the name is. */
    .modal .modal-popup label.toggle-card { font-weight: 400; color: #232527; }
    .toggle-card.form-switch { padding-left: 12px; }
    .toggle-card.form-switch .form-check-input { flex: none; float: none; margin: 3px 0 0; width: 2em; border: 1px solid #888; }
    .toggle-card strong { color: #23474a; }
    .modal .sv-dialog textarea.form-control { min-height: 0; height: auto; }

    @media (max-width: 767.98px) {
      .sv-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
      .sv-stat { padding: 10px 12px; }
      .sv-stat-count { font-size: 22px; }
      .sv-toolbar .sv-search, .sv-toolbar .sv-agency { flex: 1 1 100%; max-width: none; }
      .sv-showing { margin-left: 0; }
      .sv-table { min-width: 0; }
      .sv-table thead { display: none; }
      .sv-table, .sv-table tbody, .sv-table td { display: block; width: 100%; box-sizing: border-box; }
      .sv-table tr { display: flex; flex-direction: column; border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; }
      .sv-table tr.empty-row { border: 0; padding: 0; }
      .sv-table td { border: 0 !important; padding: 6px 0; text-align: left !important; }
      .sv-table td.sv-details { order: -1; }
      .sv-table tr.is-blocked { background: #fbf7f7; }
      .sv-table tr.is-blocked td, .sv-table tbody tr:hover td { background: transparent; }
      .sv-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .sv-user { min-width: 0; }
      .sv-who { flex: 1 1 auto; }
      .sv-badge-phone { display: inline-block; }
      .sv-status-cell { display: none !important; }
      .sv-contact { min-width: 0; }
      .sv-actions-cell .row-actions { flex-wrap: wrap; justify-content: flex-start !important; }
      .bronze-status { margin-left: 0; max-width: none; }
      .bronze-switch { justify-content: flex-start; }
      .modal .sv-dialog .form-grid { grid-template-columns: minmax(0, 1fr); gap: 6px; }
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

  /** The tile chosen above the list. */
  protected readonly filter = signal<ListFilter>('all');
  /** MasterAdmin, assessors: the agency chosen in the drop-down ('' = all). */
  protected readonly agency = signal('');
  /** The agencies of the loaded assessors, with how many each has, for the drop-down. */
  protected readonly agencyOptions = computed(() => {
    const byId = new Map<string, { id: string; name: string; count: number }>();
    for (const a of this.assessors()) {
      if (!a.agencyUserId) continue;
      const o = byId.get(a.agencyUserId) ?? { id: a.agencyUserId, name: a.agencyUserName || a.agencyUserId, count: 0 };
      o.count++;
      byId.set(a.agencyUserId, o);
    }
    return [...byId.values()].sort((x, y) => x.name.localeCompare(y.name));
  });
  private readonly assessorsOfAgency = computed(() => this.assessors().filter((a) => !this.agency() || a.agencyUserId === this.agency()));
  /** The tiles: all, active, blocked and Bronze-allowed users of the list (of the chosen agency); a click filters. */
  protected readonly tiles = computed(() => {
    const rows: { isActive: boolean | null; allowBronzeSurveillance: boolean | null }[] =
      this.kind === 'agencies' ? this.agencies() : this.assessorsOfAgency();
    const active = rows.filter((r) => r.isActive).length;
    return [
      { key: 'all' as const, label: 'All ' + this.noun().toLowerCase(), count: rows.length },
      { key: 'active' as const, label: 'Active', count: active },
      { key: 'blocked' as const, label: 'Blocked', count: rows.length - active },
      { key: 'bronze' as const, label: 'Bronze allowed', count: rows.filter((r) => r.allowBronzeSurveillance).length },
    ];
  });

  protected readonly filteredAgencies = computed(() => {
    const s = this.search().trim().toLowerCase();
    return this.agencies().filter((a) => this.passes(a) && (!s || [a.userId, a.userName, a.spocName, a.email].some((v) => (v ?? '').toLowerCase().includes(s))));
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly agenciesView = new PagedView(() => this.filteredAgencies());
  protected readonly filteredAssessors = computed(() => {
    const s = this.search().trim().toLowerCase();
    return this.assessorsOfAgency().filter((a) => this.passes(a) && (!s || [a.userId, a.userName, a.email, a.agencyUserId].some((v) => (v ?? '').toLowerCase().includes(s))));
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly assessorsView = new PagedView(() => this.filteredAssessors());
  protected readonly shownCount = computed(() => (this.kind === 'agencies' ? this.filteredAgencies() : this.filteredAssessors()).length);
  protected readonly totalCount = computed(() => (this.kind === 'agencies' ? this.agencies() : this.assessors()).length);

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

  /** The state's districts; on a failed load the list is emptied (never the previous state's) and the error shown. */
  private async loadDistricts(state: string): Promise<void> {
    this.districts.set([]);
    if (!state) return;
    try {
      this.districts.set((await firstValueFrom(this.api.districts(state))).map((x) => ({ value: x.districtCode, label: x.districtName })));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
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

  protected noun(): string {
    return this.kind === 'agencies' ? 'Agencies' : 'Assessors';
  }

  protected filterLabel(): string {
    return this.filter() === 'bronze' ? 'Bronze allowed only' : this.filter() + ' only';
  }

  private passes(u: { isActive: boolean | null; allowBronzeSurveillance: boolean | null }): boolean {
    switch (this.filter()) {
      case 'active': return !!u.isActive;
      case 'blocked': return !u.isActive;
      case 'bronze': return !!u.allowBronzeSurveillance;
      default: return true;
    }
  }

  /** Two letters of the name (or of the user ID) for the round badge. */
  protected initials(name: string | null, userId: string): string {
    const words = (name ?? '').trim().split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w));
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? userId).slice(0, 2);
    return letters.toUpperCase();
  }

  protected clearFilters(): void {
    this.filter.set('all');
    this.agency.set('');
    this.search.set('');
  }

  /** The old IdStatus column: Active / In-Active from IsActive. */
  protected status(u: { isActive: boolean | null }): string {
    return u.isActive ? 'Active' : 'In-Active';
  }

  /**
   * A column the old lists showed that is not in SurveillanceAgency / SurveillanceAssessor (users.api.ts): the API sends the
   * agency's address and pinCode and the assessor's address and idProofNumber (Users.Address, Pincode, IdProofNumber).
   */
  protected field(u: object, key: string): string {
    const v = (u as Record<string, unknown>)[key];
    return v === null || v === undefined ? '' : String(v);
  }

  /** The agency column is only meaningful to the MasterAdmin. */
  protected get showsAgency(): boolean {
    return this.isMaster;
  }
}
