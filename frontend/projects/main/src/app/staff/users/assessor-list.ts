import { ContentTextComponent } from '../../content/content-text';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { AssessorRow, BlockHistoryEntry, RESET_CONFIRM, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';
import { ClientPager, PagerComponent } from '../pager';
import { ScopeItem, scopeChips } from './assessor-scope';
import { PageHead } from '../../msme/shared/page-head';

/** Which assessors the list shows: the status tiles, the type tabs and the sector type / agency drop-downs. */
type StatusFilter = 'all' | 'active' | 'blocked';
type SectorFilter = '' | SectorActivity | 'none';

/** Block (a reason; the open assessments it leaves) or the block history (2026-11-08). */
type Dialog =
  | { kind: 'block'; row: AssessorRow; reason: string; open: number | null }
  | { kind: 'history'; row: AssessorRow; entries: BlockHistoryEntry[] | null };

/** Two letters for the round badge beside a name (first and last word). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** The stored assessor / user type as people read it (BronzeAssessor → Bronze Assessor). */
export function assessorTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'BronzeAssessor': return 'Bronze Assessor';
    case 'TechnicalExpert': return 'Technical Expert';
    default: return type ?? '';
  }
}

/**
 * MasterAdmin list of all assessors (optionally of one agency, `?agencyId=`, and verification type,
 * `?type=DA|SA|FA`). Port of Views/User/AssessorList.cshtml: search, page size and paging in the page. V4 layout: tiles
 * with all, active and blocked assessors (a click filters), pill tabs per assessor type with their counts, the sector type
 * and agency drop-downs beside the search box, a row per assessor with initials, the type and sector type as chips,
 * contact with icons and the agency under its ID, status badges, and a card per assessor on phones.
 */
@Component({
  selector: 'zed-staff-assessor-list',
  imports: [FormsModule, RouterLink, PagerComponent, DatePipe, ContentTextComponent, PageHead],
  template: `
    <!-- 2026-11-14 (approved frame A): the shared header. -->
    <zed-page-head [crumbs]="[{ label: 'Home', link: '/staff' }, { label: consultancy ? 'Consultants' : labels.assessors }]"
                   [title]="(consultancy ? 'Consultants' : labels.assessors) + (agencyId ? ' of ' + agencyId : '')" />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="as-stats" role="group" [attr.aria-label]="noun + ' by status'">
      @for (t of tiles(); track t.key) {
        <button type="button" class="as-stat" [class]="'tile-' + t.key" [class.is-on]="status() === t.key" [attr.aria-pressed]="status() === t.key" (click)="setStatus(t.key)">
          <span class="as-stat-count">{{ t.count }}</span>
          <span class="as-stat-label">{{ t.label }}</span>
        </button>
      }
    </div>

    <div class="zed-card as-list">
      @if (!consultancy && types().length > 1) {
        <div class="as-tabs" role="tablist" aria-label="Assessor type">
          <button type="button" role="tab" class="as-tab" [class.active]="!level()" [attr.aria-selected]="!level()" (click)="setLevel('')">
            All types <span class="tab-count">{{ rows().length }}</span>
          </button>
          @for (t of types(); track t.value) {
            <button type="button" role="tab" class="as-tab" [class.active]="level() === t.value" [attr.aria-selected]="level() === t.value" (click)="setLevel(t.value)">
              {{ t.label }} <span class="tab-count">{{ t.count }}</span>
            </button>
          }
        </div>
      }
      <div class="as-toolbar">
        <input type="search" class="form-control as-search" maxlength="50" placeholder="Search ID, name, mobile, e-mail or agency" aria-label="Search assessors"
               [ngModel]="search()" (ngModelChange)="pager.setSearch($event)" />
        @if (!consultancy) {
          <select class="form-select as-select" aria-label="Sector type" [ngModel]="sector()" (ngModelChange)="setSector($event)">
            <option value="">All sector types</option>
            @for (s of sectorOptions(); track s.value) { <option [value]="s.value">{{ s.label }} ({{ s.count }})</option> }
          </select>
        }
        @if (agencies().length > 1) {
          <select class="form-select as-select as-agency" [attr.aria-label]="labels.agency" [ngModel]="agency()" (ngModelChange)="setAgency($event)">
            <option value="">All {{ labels.agencies.toLowerCase() }}</option>
            @for (a of agencies(); track a.id) { <option [value]="a.id">{{ a.name }} ({{ a.count }})</option> }
          </select>
        }
        <span class="muted as-showing">{{ pager.total() }} of {{ rows().length }} {{ noun.toLowerCase() }}</span>
      </div>

      <div class="table-responsive">
        <table class="table table-zed as-table">
          <thead>
            <tr>
              <th class="text-center" style="width: 56px">S.No</th>
              @if (consultancy) {
                <!-- ZEDCS_CONSULTANCY Frontend/User/AssessorList.cshtml -->
                <th>Consultant Details</th>
                <th>Consultant Organisation Details</th>
                <th class="text-center">No. Of Consulting Completed</th>
              } @else {
                <th>Assessor Details</th>
                <th>Type and Sector</th>
                <th>Contact</th>
                <th>{{ labels.agency }} Details</th>
              }
              <th class="text-center" style="width: 100px">Status</th>
              <th class="text-center" style="width: 140px">Action(s)</th>
            </tr>
          </thead>
          <tbody>
            @for (s of page(); track s.UserId) {
              <tr class="filterClass" [class.is-blocked]="!s.IsActive">
                <td class="text-center as-sno">{{ s.RowNumber }}</td>
                <td class="as-person-cell">
                  <div class="as-user">
                    <span class="as-avatar" aria-hidden="true">{{ initials(s.UserName) }}</span>
                    <span class="as-who">
                      <span class="as-name">{{ s.UserName }}</span>
                      <span class="as-id">{{ s.UserId }}@if (s.PanNo) { · PAN {{ s.PanNo }} }</span>
                    </span>
                    <span class="status-badge as-badge-phone" [class.is-active]="s.IsActive" [class.is-rejected]="!s.IsActive">{{ s.IdStatus }}</span>
                  </div>
                  @if (consultancy) {
                    <div class="as-contact as-contact-under">
                      @if (s.MobileNo) { <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg>{{ s.MobileNo }}</span> } @else { <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg><span class="no-mobile">Mobile not saved</span></span> }
                      @if (s.Email) { <span class="as-mail"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v9H2z M2 4l6 4.5L14 4"/></svg>{{ s.Email }}</span> }
                      @if (s.Address) { <span class="as-address clamp-2" [title]="s.Address">{{ s.Address }}</span> }
                    </div>
                  }
                </td>
                @if (!consultancy) {
                  <td class="as-type-cell" data-label="Type and Sector">
                    @for (c of chips(s.Assessments); track c) { <span class="zed-chip">{{ c }}</span> } @empty { <span class="zed-chip">{{ typeLabel(s.AssessorType) }}</span> }
                    @if (s.SectorActivity) {
                      <span class="sector-chip" [class]="'sector-' + s.SectorActivity.toLowerCase()">{{ s.SectorActivity }}</span>
                    } @else {
                      <span class="sector-chip sector-none">Sector type not set</span>
                    }
                  </td>
                  <td class="as-contact" data-label="Contact">
                    @if (s.MobileNo) { <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg>{{ s.MobileNo }}</span> } @else { <span><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 1.5h2l1 3-1.5 1a8 8 0 0 0 4.5 4.5l1-1.5 3 1v2a1.5 1.5 0 0 1-1.5 1.5A11.5 11.5 0 0 1 3 3a1.5 1.5 0 0 1 1.5-1.5z"/></svg><span class="no-mobile">Mobile not saved</span></span> }
                    @if (s.Email) { <span class="as-mail"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2 3.5h12v9H2z M2 4l6 4.5L14 4"/></svg>{{ s.Email }}</span> }
                    @if (s.Address) { <span class="as-address clamp-2" [title]="s.Address">{{ s.Address }}</span> }
                  </td>
                }
                <td class="as-agency-cell" [attr.data-label]="consultancy ? 'Consultant Organisation' : labels.agency">
                  <span class="as-agency-name">{{ s.AgencyUserName }}</span>
                  <span class="as-id">{{ s.AgencyUserId }}</span>
                </td>
                @if (consultancy) {
                  <!-- The live page prints 0 for each milestone (no count is read). -->
                  <td class="text-center as-milestones" data-label="No. Of Consulting Completed">
                    <div>Milestone 1: <strong>0</strong></div><div>Milestone 2: <strong>0</strong></div><div>Milestone 3: <strong>0</strong></div>
                  </td>
                }
                <td class="text-center as-status-cell">
                  <span class="status-badge" [class.is-active]="s.IsActive" [class.is-rejected]="!s.IsActive">{{ s.IdStatus }}</span>
                  @if (!s.IsActive && (s.BlockReason || s.BlockedOn)) {
                    <small class="as-block-note" data-block-note>
                      @if (s.BlockReason) { “{{ s.BlockReason }}” }
                      @if (s.BlockedOn) { <span class="text-nowrap">· {{ s.BlockedOn | date: 'dd MMM yyyy' }}</span> }
                    </small>
                  }
                </td>
                <td class="text-center as-actions-cell">
                  <div class="row-actions justify-content-center">
                    <a [routerLink]="['/staff/users/assessors', s.UserId]" class="btn btn-outline-primary">View</a>
                    <!-- V4 addition (not on the old consultancy list): Reset Link. -->
                    @if (s.IsActive) {
                      <button type="button" class="btn btn-default" [disabled]="busy()" (click)="sendReset(s)">Reset Link</button>
                      <button type="button" class="btn btn-outline-danger" [disabled]="busy()" (click)="openBlock(s)">Block</button>
                    } @else {
                      <button type="button" class="btn btn-outline-success" [disabled]="busy()" (click)="unblock(s)">Unblock</button>
                    }
                    <button type="button" class="btn btn-default" [disabled]="busy()" (click)="openHistory(s)"><i class="fa fa-history" aria-hidden="true"></i> History</button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row">
                <td colspan="7" style="padding: 0">
                  @if (rows().length) {
                    <div class="no-data">
                      No {{ consultancy ? 'consultant' : labels.assessor.toLowerCase() }} matches the filters.
                      <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">Show all</button>
                    </div>
                  } @else {
                    <div class="no-data">No Data Entered</div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>
    @if (dialog(); as d) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="as-dialog-title" (click)="close()">
        <div class="modal-dialog modal-popup" (click)="$event.stopPropagation()">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="as-dialog-title">
                {{ d.kind === 'block' ? 'Block ' + (consultancy ? 'Consultant' : labels.assessor) : 'History: ' + d.row.UserName + ' (' + d.row.UserId + ')' }}
              </h3>
              <button type="button" class="btn-close" aria-label="Close" (click)="close()"></button>
            </div>
            @if (d.kind === 'block') {
              <form (ngSubmit)="block()" novalidate>
                <div class="modal-body">
                  <p class="muted"><strong>{{ d.row.UserName }} ({{ d.row.UserId }})</strong></p>
                  <zed-text key="staff.users.assessorBlock.note" box="muted"><p class="muted">The login can't sign in on the web or the app, and can't be allotted or carry out
                    any {{ consultancy ? 'consultancy' : 'assessment' }} until unblocked.</p></zed-text>
                  @if (d.open) {
                    <div class="alert alert-warning py-2" role="status" data-open-warning>
                      {{ d.open }} {{ consultancy ? 'case' : 'assessment' }}{{ d.open === 1 ? '' : 's' }} allotted to this {{ consultancy ? 'consultant' : labels.assessor.toLowerCase() }}
                      {{ d.open === 1 ? 'is' : 'are' }} still open. The {{ consultancy ? 'organisation' : labels.agency.toLowerCase() }} will need to re-allot {{ d.open === 1 ? 'it' : 'them' }}.
                    </div>
                  }
                  <label class="form-label" for="as-block-reason">Reason<span class="req">*</span></label>
                  <textarea id="as-block-reason" name="reason" class="form-control" rows="3" maxlength="2000" [(ngModel)]="d.reason"
                            placeholder="Why the login is blocked"></textarea>
                  @if (dialogError()) { <span class="help-block" role="alert">{{ dialogError() }}</span> }
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-default" (click)="close()">Cancel</button>
                  <button type="submit" class="btn btn-danger" [disabled]="busy()">Block</button>
                </div>
              </form>
            } @else {
              <div class="modal-body">
                @if (d.entries === null) {
                  <p class="muted">Loading…</p>
                } @else {
                  <ol class="as-history">
                    @for (e of d.entries; track $index) {
                      <li [class.is-blocked]="e.action === 'Blocked'">
                        <strong>{{ e.action }}</strong>
                        <span class="muted d-block">{{ e.actionDate | date: 'dd MMM yyyy, h:mm a' }}{{ e.actionBy ? ' · by ' + e.actionBy + roleName(e.actionByRole) : '' }}</span>
                        @if (e.reason) { <span class="d-block">“{{ e.reason }}”</span> }
                      </li>
                    } @empty {
                      <li class="as-history-empty">No block or unblock recorded yet.</li>
                    }
                  </ol>
                }
              </div>
              <div class="modal-footer"><button type="button" class="btn btn-default" (click)="close()">Close</button></div>
            }
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">Loading…</span></div>
    }
  `,
  styles: `
    .as-stats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .as-stat { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; padding: 14px 18px; text-align: left; min-width: 0;
      background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 1px 2px rgba(35,71,74,.05); cursor: pointer; }
    .as-stat:hover { border-color: #45a5ad; }
    .as-stat.is-on { border-color: #45a5ad; box-shadow: inset 0 0 0 1px #45a5ad; background: #eef6f6; }
    .as-stat-count { font-size: 26px; font-weight: 700; color: #23474a; line-height: 1.1; }
    .as-stat.tile-active .as-stat-count { color: #1e7a3c; }
    .as-stat.tile-blocked .as-stat-count { color: #a8303a; }
    .as-stat-label { font-size: 13px; color: #5f6f70; font-weight: 600; }

    .as-list { padding: 16px; }
    .as-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 14px; }
    .as-tab { display: inline-flex; align-items: center; gap: 8px; padding: 6px 16px; border-radius: 20px; border: 1px solid #d9eef0; background: #d9eef0;
      color: #174a4e; font-weight: 600; font-size: 14px; cursor: pointer; white-space: nowrap; }
    .as-tab:hover { background: #c5e5e8; border-color: #45a5ad; }
    .as-tab.active { background: #23656b; border-color: #23656b; color: #fff; }
    .tab-count { font-size: 12px; background: rgba(255,255,255,.25); border-radius: 10px; padding: 0 8px; }
    .as-tab:not(.active) .tab-count { background: #eef6f6; color: #23474a; }
    .as-toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 12px; }
    .as-search { flex: 1 1 260px; max-width: 380px; }
    .as-select { flex: 0 1 210px; width: auto; min-width: 0; }
    .as-agency { flex-basis: 260px; }
    .as-showing { font-size: 13px; margin-left: auto; }

    .as-table { margin-bottom: 8px; }
    .as-table td { vertical-align: middle; overflow-wrap: anywhere; font-size: 14px; }
    .as-table tbody tr:hover td { background: #f7fbfb; }
    .as-table tr.is-blocked td { background: #fbf7f7; }
    .as-sno { color: #5f6f70; }
    .as-user { display: flex; align-items: center; gap: 12px; min-width: 175px; }
    .as-who { min-width: 0; }
    .as-avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); font-weight: 700; font-size: 13px; letter-spacing: .03em; }
    tr.is-blocked .as-avatar { background: #f3e9e9; color: #9b4a4a; }
    .as-name { display: block; font-weight: 600; color: #232527; }
    .as-id { display: block; font-size: 12px; color: #6b7f80; letter-spacing: .3px; }
    .as-badge-phone { display: none; }
    .as-type-cell { min-width: 140px; }
    .as-type-cell .zed-chip { margin: 0 0 4px; white-space: nowrap; }
    .sector-chip { display: table; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 600; white-space: nowrap; background: #e6f6ec; color: #1e7a3c; }
    .sector-chip.sector-services { background: #f1f0fb; color: #3f3a7a; }
    .sector-chip.sector-both { background: #eef6f6; color: #2f7c83; }
    .sector-chip.sector-none { background: #fff4d6; color: #8a6100; }
    .as-contact { min-width: 230px; }
    .as-contact span { display: flex; align-items: center; gap: 6px; line-height: 1.6; }
    .as-contact .as-mail { font-size: 13px; color: #5f6f70; }
    .as-contact .as-address { display: -webkit-box; font-size: 12px; color: #6b7f80; line-height: 1.45; margin-top: 2px; }
    .as-contact svg { flex: 0 0 13px; width: 13px; height: 13px; fill: none; stroke: #2f7c83; stroke-width: 1.4; stroke-linejoin: round; }
    .as-contact-under { margin: 8px 0 0 50px; min-width: 0; }
    .clamp-2 { -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .as-agency-cell { min-width: 150px; }
    .as-agency-name { display: block; font-weight: 600; color: #23474a; }
    .as-actions-cell { overflow-wrap: normal !important; }
    .as-actions-cell .row-actions { flex-wrap: nowrap; }
    .as-actions-cell .btn { white-space: nowrap; }
    .no-data .btn-link { font-weight: 600; }

    @media (max-width: 767.98px) {
      .as-stats { gap: 8px; }
      .as-stat { padding: 10px 12px; }
      .as-stat-count { font-size: 22px; }
      .as-tabs { flex-wrap: nowrap; overflow-x: auto; padding-bottom: 4px; scrollbar-width: thin; }
      .as-search, .as-select { flex: 1 1 100%; max-width: none; }
      .as-showing { margin-left: 0; }
      .as-table { min-width: 0; }
      .as-table thead { display: none; }
      .as-table, .as-table tbody, .as-table tr, .as-table td { display: block; width: 100%; box-sizing: border-box; }
      .as-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; }
      .as-table tr.empty-row { border: 0; padding: 0; }
      .as-table td { border: 0; padding: 6px 0; text-align: left !important; }
      .as-table tr.is-blocked { background: #fbf7f7; }
      .as-table tr.is-blocked td, .as-table tbody tr:hover td { background: transparent; }
      .as-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .as-sno, .as-status-cell { display: none !important; }
      .as-user { min-width: 0; }
      .as-who { flex: 1 1 auto; }
      .as-badge-phone { display: inline-block; }
      .as-type-cell .zed-chip { margin: 0 6px 0 0; }
      .sector-chip { display: inline-block; }
      .as-contact, .as-agency-cell, .as-type-cell { min-width: 0; }
      .as-contact-under { margin-left: 0; }
      .as-actions-cell .row-actions { flex-wrap: wrap; justify-content: flex-start !important; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .as-block-note { display: block; margin-top: 4px; font-size: 12px; color: #6b5a5a; overflow-wrap: anywhere; }
    .as-history { list-style: none; margin: 0; padding: 0; }
    .as-history li { position: relative; padding: 8px 0 8px 22px; border-bottom: 1px solid #eef1f2; font-size: 14px; }
    .as-history li::before { content: ''; position: absolute; left: 4px; top: 14px; width: 10px; height: 10px; border-radius: 50%; background: #1e7a3c; }
    .as-history li.is-blocked::before { background: #a8303a; }
    .as-history li.as-history-empty { padding-left: 0; color: #5f6f70; }
    .as-history li.as-history-empty::before { display: none; }
  `,
})
export class AssessorListPage {
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly labels = LABELS[this.system];
  protected readonly noun = this.consultancy ? 'Consultants' : this.labels.assessors;
  private readonly api = inject(UsersApi);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly agencyId = this.query.get('agencyId') ?? '';
  protected readonly type = this.query.get('type') ?? '';
  /** Every assessor the server sent; the filters below pick the rows the pager gets. */
  protected readonly rows = signal<AssessorRow[]>([]);
  protected readonly status = signal<StatusFilter>('all');
  protected readonly level = signal('');
  protected readonly sector = signal<SectorFilter>('');
  protected readonly agency = signal('');
  /** Paged (20 per page) and searched (any value of the row) in the browser, as before. */
  protected readonly pager = new ClientPager<AssessorRow>(20);
  protected readonly search = this.pager.search;
  protected readonly page = this.pager.page;
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly busy = signal(false);
  protected readonly dialog = signal<Dialog | null>(null);
  protected readonly dialogError = signal('');
  protected readonly initials = initialsOf;
  protected readonly typeLabel = assessorTypeLabel;
  /** 2026-11-14: the levels and modes the assessor may do. */
  protected readonly chips = (v: unknown) => scopeChips(Array.isArray(v) ? (v as ScopeItem[]) : null);

  protected readonly tiles = computed(() => {
    const rows = this.rows();
    const active = rows.filter((r) => r.IsActive).length;
    return [
      { key: 'all' as const, label: 'All ' + this.noun.toLowerCase(), count: rows.length },
      { key: 'active' as const, label: 'Active', count: active },
      { key: 'blocked' as const, label: 'Blocked', count: rows.length - active },
    ];
  });

  /** The assessor types in the list (Bronze Assessor first), with their counts. */
  protected readonly types = computed(() => {
    const counts = new Map<string, number>();
    for (const r of this.rows()) if (r.AssessorType) counts.set(r.AssessorType, (counts.get(r.AssessorType) ?? 0) + 1);
    return [...counts.entries()]
      .sort(([a], [b]) => (a === 'BronzeAssessor' ? -1 : b === 'BronzeAssessor' ? 1 : a.localeCompare(b)))
      .map(([value, count]) => ({ value, label: assessorTypeLabel(value), count }));
  });

  protected readonly sectorOptions = computed(() => {
    const rows = this.rows();
    const options: { value: SectorFilter; label: string; count: number }[] = SECTOR_ACTIVITIES.map((a) => ({
      value: a.value, label: a.label, count: rows.filter((r) => r.SectorActivity === a.value).length,
    }));
    const none = rows.filter((r) => !r.SectorActivity).length;
    if (none) options.push({ value: 'none', label: 'Not set', count: none });
    return options;
  });

  /** The agencies of the listed assessors, by name. */
  protected readonly agencies = computed(() => {
    const map = new Map<string, { id: string; name: string; count: number }>();
    for (const r of this.rows()) {
      if (!r.AgencyUserId) continue;
      const a = map.get(r.AgencyUserId) ?? { id: r.AgencyUserId, name: r.AgencyUserName || r.AgencyUserId, count: 0 };
      a.count++;
      map.set(r.AgencyUserId, a);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  private readonly filtered = computed(() => {
    const status = this.status();
    const level = this.level();
    const sector = this.sector();
    const agency = this.agency();
    return this.rows().filter((r) =>
      (status === 'all' || (status === 'active') === r.IsActive)
      && (!level || r.AssessorType === level)
      && (!sector || (sector === 'none' ? !r.SectorActivity : r.SectorActivity === sector))
      && (!agency || r.AgencyUserId === agency),
    );
  });

  constructor() {
    void this.load();
  }

  protected setStatus(value: StatusFilter): void {
    this.status.set(value);
    this.pager.set(this.filtered());
  }

  protected setLevel(value: string): void {
    this.level.set(value);
    this.pager.set(this.filtered());
  }

  protected setSector(value: SectorFilter): void {
    this.sector.set(value);
    this.pager.set(this.filtered());
  }

  protected setAgency(value: string): void {
    this.agency.set(value);
    this.pager.set(this.filtered());
  }

  protected clearFilters(): void {
    this.status.set('all');
    this.level.set('');
    this.sector.set('');
    this.agency.set('');
    this.pager.setSearch('');
    this.pager.set(this.filtered());
  }

  /** E-mails the assessor a link to set a new password. */
  protected async sendReset(s: AssessorRow): Promise<void> {
    if (!window.confirm(RESET_CONFIRM)) return;
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(this.api.passwordReset('assessors', s.UserId))).message);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async openBlock(s: AssessorRow): Promise<void> {
    this.success.set('');
    this.dialogError.set('');
    this.dialog.set({ kind: 'block', row: s, reason: '', open: null });
    try {
      const open = (await firstValueFrom(this.api.assessorOpenAssessments(s.UserId))).count;
      const d = this.dialog();
      if (d?.kind === 'block' && d.row === s) this.dialog.set({ ...d, open });
    } catch {
      /* the warning is optional */
    }
  }

  protected async block(): Promise<void> {
    const d = this.dialog();
    if (d?.kind !== 'block') return;
    if (!d.reason.trim()) {
      this.dialogError.set('Please enter the reason for blocking.');
      return;
    }
    if (await this.act(this.api.block('assessors', d.row.UserId, d.reason.trim()), true)) this.dialog.set(null);
  }

  protected async unblock(s: AssessorRow): Promise<void> {
    if (!window.confirm(`Are you sure that you want to unblock ${s.UserName} (${s.UserId})?`)) return;
    await this.act(this.api.unblock('assessors', s.UserId), false);
  }

  protected async openHistory(s: AssessorRow): Promise<void> {
    this.dialogError.set('');
    this.dialog.set({ kind: 'history', row: s, entries: null });
    try {
      const entries = await firstValueFrom(this.api.assessorHistory(s.UserId));
      const d = this.dialog();
      if (d?.kind === 'history' && d.row === s) this.dialog.set({ ...d, entries });
    } catch (err) {
      this.dialog.set(null);
      this.error.set(apiErrorMessage(err));
    }
  }

  protected close(): void {
    if (!this.busy()) this.dialog.set(null);
  }

  protected roleName(role: number | null): string {
    return role === 7 ? ' (Master Admin)' : role === 2 ? (this.consultancy ? ' (organisation)' : ' (agency)') : role === 1 ? ' (Admin)' : '';
  }

  private async act(call: ReturnType<UsersApi['unblock']>, inDialog: boolean): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(call)).message);
      await this.load();
      return true;
    } catch (err) {
      (inDialog ? this.dialogError : this.error).set(apiErrorMessage(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      this.rows.set(await firstValueFrom(this.api.allAssessors(this.agencyId, this.type)));
      this.pager.set(this.filtered());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }
}
