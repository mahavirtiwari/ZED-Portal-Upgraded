import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReasonAsk, ReasonDialog } from './reason-dialog';
import { ActivatedRoute } from '@angular/router';
import { AuthService, MessageResponse, apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { StaffRole } from '../staff-menu';
import { AssessorMobilePanel, canSeeAssessorMobile } from './assessor-mobile';
import { MultiSelect, MultiSelectOption } from './multi-select';
import { CodeName, SurveillanceAgency, SurveillanceAssessor, SurveillanceUsersApi } from './users.api';
import { PagedView, PagerComponent } from '../pager';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ListCount, ListCounts } from '../list-counts';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { plain, resetLinkAsk, sentTo } from './user-display';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';
import { PhoneChip, PhoneSummary, hasPhone, loadPhones, phonesById, releaseMobileAsk, releasePhone } from './assessor-phone';
import { LevelCount, LevelCounts, levelCountTiles } from './level-counts';

interface BronzeDialog {
  agency: SurveillanceAgency;
  allow: boolean;
  reason: string;
  state: string;
  districts: string[];
}

type Kind = 'agencies' | 'assessors';
type ListFilter = 'all' | 'active' | 'blocked' | 'bronze';
/** The login a row menu action is about. */
interface Target {
  kind: Kind;
  userId: string;
  name: string | null;
  email: string | null;
}

/**
 * Surveillance build: "Bronze Surveillance Agencies" (MasterAdmin) and the assessors list (MasterAdmin: all, agency: its
 * own). Port of ZEDCS_SURVEILLANCE User/AssessmentAgencies and User/Assessors. Accounts are created and edited in main;
 * here the MasterAdmin enables Bronze surveillance with the preferred state and districts, and agencies / assessors are
 * blocked or unblocked in the surveillance database. The route's `data.kind` ('agencies' | 'assessors') picks the list.
 * 2026-11-17 (approved staff redesign, as staff-01 / staff-04): the shared head and counts (all, active, blocked,
 * Bronze-allowed; a click filters), the search (and, for the MasterAdmin's assessors, the agency drop-down), a row per
 * login with initials, ID, contact (in full since 2026-11-18, the user: never masked), the Bronze surveillance state (agencies: a button opens the setting;
 * assessors: a switch) and status, and a row menu (Send reset link, View history, Block / Unblock) whose actions confirm
 * first and end with a toast; the block history opens in the side panel. Cards on phones.
 */
@Component({
  selector: 'zed-staff-surveillance-users',
  imports: [FormsModule, MultiSelect, PagerComponent, AssessorMobilePanel, ReasonDialog, PageHead, ListCounts, RowMenu, ConfirmDialog, UserHistoryPanel, PhoneChip, LevelCounts, TextPipe],
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="title()" [subtitle]="'Accounts are created and edited on the ZED portal (main); changes here apply to surveillance only.' | t: 'staff.surveillanceUsers.subtitle'" />
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    @if (totalTiles().length) {
      <!-- 2026-11-18 (the user: "same logic in the assessment agency login"): the agency's own units per level in surveillance. -->
      <h3 class="sv-cap">{{ 'Units Allocated to Your Agency' | t: 'staff.surveillanceUsers.totals.title' }}</h3>
      <zed-list-counts [counts]="totalTiles()" [label]="'Units allocated to your agency per level' | t: 'staff.surveillanceUsers.totals.aria'" />
    }
    <zed-list-counts [counts]="tiles()" [selected]="filter()" [label]="'{noun} by status' | t: 'staff.surveillanceUsers.countsLabel' : { noun: noun() }" (pick)="filter.set($any($event.key))" />

    <div class="zed-card sv-bar">
      <label class="sv-search-box">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="search" class="form-control sv-search" [placeholder]="'Search ID, name or e-mail' | t: 'staff.surveillanceUsers.search.placeholder'" [attr.aria-label]="'Search' | t: 'staff.surveillanceUsers.search.aria'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      </label>
      @if (kind === 'assessors' && showsAgency && agencyOptions().length > 1) {
        <select id="sv-agency" class="form-select sv-agency" [attr.aria-label]="'Agency' | t: 'staff.surveillanceUsers.filter.agency'" [ngModel]="agency()" (ngModelChange)="agency.set($event)">
          <option value="">{{ 'All agencies' | t: 'staff.surveillanceUsers.filter.allAgencies' }}</option>
          @for (o of agencyOptions(); track o.id) { <option [value]="o.id">{{ o.name }} ({{ o.count }})</option> }
        </select>
      }
      <span class="sv-showing">{{ filter() === 'all'
        ? ('{shown} of {total} {noun}' | t: 'staff.surveillanceUsers.showing' : { shown: shownCount(), total: totalCount(), noun: noun().toLowerCase() })
        : ('{shown} of {total} {noun} · {filter}' | t: 'staff.surveillanceUsers.showingFiltered' : { shown: shownCount(), total: totalCount(), noun: noun().toLowerCase(), filter: filterLabel() }) }}</span>
    </div>

    <div class="zed-card sv-list">
      <div class="table-responsive">
        @if (kind === 'agencies') {
          <table class="table table-zed sv-table">
            <thead>
              <tr><th>{{ 'Agency' | t: 'staff.surveillanceUsers.column.agency' }}</th><th>{{ 'SPOC' | t: 'staff.surveillanceUsers.column.spoc' }}</th><th>{{ 'Verification' | t: 'staff.surveillanceUsers.column.verification' }}</th><th class="text-center">{{ 'Assessors' | t: 'staff.surveillanceUsers.column.assessors' }}</th><th class="sv-alloc">{{ 'Allocated' | t: 'staff.surveillanceUsers.column.allocated' }}</th><th>{{ 'Bronze surveillance' | t: 'staff.surveillanceUsers.column.bronze' }}</th><th class="text-center">{{ 'Status' | t: 'staff.surveillanceUsers.column.status' }}</th><th class="text-end">{{ 'Actions' | t: 'staff.surveillanceUsers.column.actions' }}</th></tr>
            </thead>
            <tbody>
              @for (a of agenciesView.page(); track a.userId) {
                <tr [class.is-blocked]="!a.isActive">
                  <td>
                    <div class="sv-user">
                      <span class="sv-avatar" aria-hidden="true">{{ initials(a.userName, a.userId) }}</span>
                      <span class="sv-who">
                        <span class="sv-name">{{ a.userName }}</span>
                        <span class="sv-id">{{ a.userId }}</span>
                        @if (place(a)) { <span class="sv-sub">{{ place(a) }}</span> }
                      </span>
                    </div>
                  </td>
                  <td class="sv-contact" [attr.data-label]="'SPOC' | t: 'staff.surveillanceUsers.column.spoc'">
                    <strong>{{ a.spocName }}</strong>
                    <span [class.no-mobile]="!a.mobileNo">{{ a.mobileNo ? mobile(a.mobileNo) : ('Mobile not saved' | t: 'staff.surveillanceUsers.row.noMobile') }}</span>
                    @if (a.email) { <span class="sv-sub" [title]="a.email">{{ email(a.email) }}</span> }
                  </td>
                  <td [attr.data-label]="'Verification' | t: 'staff.surveillanceUsers.column.verification'">
                    @if (a.desktopVerification) { <span class="sv-pill">{{ 'Desktop verification' | t: 'staff.surveillanceUsers.row.desktopVerification' }}</span> }
                    @if (a.siteVerification) { <span class="sv-pill">{{ 'Site verification' | t: 'staff.surveillanceUsers.row.siteVerification' }}</span> }
                  </td>
                  <td class="text-center sv-count-cell" [attr.data-label]="'Assessors' | t: 'staff.surveillanceUsers.column.assessors'"><strong>{{ a.noOfUsers }}</strong></td>
                  <td class="sv-alloc" [attr.data-label]="'Allocated' | t: 'staff.surveillanceUsers.column.allocated'"><zed-level-counts [counts]="a.levelCounts" [label]="'Units allocated to {name}' | t: 'staff.surveillanceUsers.row.unitsAria' : { name: a.userName || a.userId }" /></td>
                  <td class="bronze-status" [attr.data-label]="'Bronze surveillance' | t: 'staff.surveillanceUsers.column.bronze'">
                    <span class="status-badge" [class.is-success]="a.allowBronzeSurveillance" [class.is-inactive]="!a.allowBronzeSurveillance">{{ a.allowBronzeSurveillance ? ('Allowed' | t: 'staff.surveillanceUsers.row.allowed') : ('Not allowed' | t: 'staff.surveillanceUsers.row.notAllowed') }}</span>
                    @if (!a.allowBronzeSurveillance && a.reasonForRejectionForBS) { <small class="sv-sub">{{ a.reasonForRejectionForBS }}</small> }
                    @if (a.tuPreferredState) { <small class="sv-sub">{{ 'Preferred State:' | t: 'staff.surveillanceUsers.row.preferredState' }} <strong>{{ stateName(a.tuPreferredState) }}</strong></small> }
                  </td>
                  <td class="text-center sv-status-cell" [attr.data-label]="'Status' | t: 'staff.surveillanceUsers.column.status'"><span class="status-badge" [class.is-active]="a.isActive" [class.is-rejected]="!a.isActive">{{ status(a) }}</span></td>
                  <td class="sv-actions">
                    <div class="sv-btns">
                      <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="openBronze(a)">{{ 'Bronze surveillance' | t: 'staff.surveillanceUsers.row.bronzeButton' }}</button>
                      <zed-row-menu [items]="a.isActive ? agencyMenuActive() : agencyMenuBlocked()" [label]="'More actions for {name}' | t: 'staff.surveillanceUsers.row.menuAria' : { name: a.userName || a.userId }"
                                    (picked)="pick($event, { kind: 'agencies', userId: a.userId, name: a.userName, email: a.email })" />
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="8" style="padding: 0"><div class="no-data sv-empty">
                  @if (agencies().length) {
                    {{ 'No agency matches the filters.' | t: 'staff.surveillanceUsers.agencies.noMatch' }}
                    <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">{{ 'Show all agencies' | t: 'staff.surveillanceUsers.agencies.showAllButton' }}</button>
                  } @else {
                    {{ 'No agencies yet. They are added on the ZED portal (main).' | t: 'staff.surveillanceUsers.agencies.empty' }}
                  }
                </div></td></tr>
              }
            </tbody>
          </table>
        } @else {
          <table class="table table-zed sv-table">
            <thead>
              <tr><th>{{ 'Assessor' | t: 'staff.surveillanceUsers.column.assessor' }}</th><th>{{ 'Contact' | t: 'staff.surveillanceUsers.column.contact' }}</th><th class="sv-alloc">{{ 'Allocated' | t: 'staff.surveillanceUsers.column.allocated' }}</th><th>{{ 'Bronze surveillance' | t: 'staff.surveillanceUsers.column.bronze' }}</th><th class="text-center">{{ 'Status' | t: 'staff.surveillanceUsers.column.status' }}</th><th class="text-end">{{ 'Actions' | t: 'staff.surveillanceUsers.column.actions' }}</th></tr>
            </thead>
            <tbody>
              @for (s of assessorsView.page(); track s.userId) {
                <tr [class.is-blocked]="!s.isActive">
                  <td>
                    <div class="sv-user">
                      <span class="sv-avatar" aria-hidden="true">{{ initials(s.userName, s.userId) }}</span>
                      <span class="sv-who">
                        <span class="sv-name">{{ s.userName }}</span>
                        <span class="sv-id">{{ s.userId }}</span>
                        @if (field(s, 'address')) { <span class="sv-sub">{{ field(s, 'address') }}</span> }
                        @if (field(s, 'idProofNumber')) { <span class="sv-sub">{{ 'ID proof {number}' | t: 'staff.surveillanceUsers.row.idProof' : { number: field(s, 'idProofNumber') } }}</span> }
                        @if (showsAgency && s.agencyUserId) {
                          <span class="sv-agency-line"><span class="sv-pill" [title]="s.agencyUserId">{{ s.agencyUserName || s.agencyUserId }}</span></span>
                        }
                      </span>
                    </div>
                  </td>
                  <td class="sv-contact" [attr.data-label]="'Contact' | t: 'staff.surveillanceUsers.column.contact'">
                    <span [class.no-mobile]="!s.mobileNo">{{ s.mobileNo ? mobile(s.mobileNo) : ('Mobile not saved' | t: 'staff.surveillanceUsers.row.noMobile') }}</span>
                    @if (s.email) { <span class="sv-sub" [title]="s.email">{{ email(s.email) }}</span> }
                  </td>
                  <td class="sv-alloc" [attr.data-label]="'Allocated' | t: 'staff.surveillanceUsers.column.allocated'"><zed-level-counts [counts]="s.levelCounts" [label]="'Assessments allocated to {name}' | t: 'staff.surveillanceUsers.row.assessmentsAria' : { name: s.userName || s.userId }" /></td>
                  <td [attr.data-label]="'Bronze surveillance' | t: 'staff.surveillanceUsers.column.bronze'">
                    <label class="bronze-switch form-switch" [class.is-on]="s.allowBronzeSurveillance">
                      <input type="checkbox" role="switch" class="form-check-input" [checked]="!!s.allowBronzeSurveillance" [disabled]="busy()" (change)="setAssessorBronze(s, $any($event.target).checked)" />
                      {{ s.allowBronzeSurveillance ? ('Allowed' | t: 'staff.surveillanceUsers.row.allowed') : ('Not allowed' | t: 'staff.surveillanceUsers.row.notAllowed') }}
                    </label>
                  </td>
                  <td class="text-center sv-status-cell" [attr.data-label]="'Status' | t: 'staff.surveillanceUsers.column.status'"><span class="status-badge" [class.is-active]="s.isActive" [class.is-rejected]="!s.isActive">{{ status(s) }}</span>
                    <!-- 2026-11-18: the registered phone (site assessor app or Bronze surveillance app), Admin and Master Admin only. -->
                    @if (showsMobile) { <zed-phone-chip class="sv-phone" [phone]="phoneOf(s.userId)" /> }</td>
                  <td class="sv-actions">
                    <div class="sv-btns">
                      @if (showsMobile) {
                        <button type="button" class="btn btn-outline-primary" [attr.aria-label]="'Registered mobile of {id}' | t: 'staff.surveillanceUsers.row.mobileAria' : { id: s.userId }" (click)="mobileOf.set(s.userId)">{{ 'Mobile' | t: 'staff.surveillanceUsers.row.mobileButton' }}</button>
                      }
                      <zed-row-menu [items]="assessorMenu(s.userId, !!s.isActive)" [label]="'More actions for {name}' | t: 'staff.surveillanceUsers.row.menuAria' : { name: s.userName || s.userId }"
                                    (picked)="pick($event, { kind: 'assessors', userId: s.userId, name: s.userName, email: s.email })" />
                    </div>
                  </td>
                </tr>
              } @empty {
                <tr class="empty-row"><td colspan="6" style="padding: 0"><div class="no-data sv-empty">
                  @if (assessors().length) {
                    {{ 'No assessor matches the filters.' | t: 'staff.surveillanceUsers.assessors.noMatch' }}
                    <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">{{ 'Show all assessors' | t: 'staff.surveillanceUsers.assessors.showAllButton' }}</button>
                  } @else {
                    {{ 'No assessors yet. They are added on the ZED portal (main).' | t: 'staff.surveillanceUsers.assessors.empty' }}
                  }
                </div></td></tr>
              }
            </tbody>
          </table>
        }
      </div>
      @if (kind === 'agencies') { <zed-pager [pager]="agenciesView" /> } @else { <zed-pager [pager]="assessorsView" /> }
    </div>

    @if (bronze(); as d) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bronze-title">
        <div class="modal-dialog modal-popup sv-dialog"><div class="modal-content">
          <div class="modal-header">
            <h3 class="registration-title m-0" id="bronze-title">{{ 'Bronze Surveillance – {id}' | t: 'staff.surveillanceUsers.bronze.title' : { id: d.agency.userId } }}</h3>
            <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.surveillanceUsers.bronze.closeAria'" (click)="bronze.set(null)"></button>
          </div>
          <div class="modal-body">
            <p class="sv-dialog-who"><strong>{{ d.agency.userName }}</strong>@if (d.agency.spocName) {<span class="muted"> · {{ 'SPOC {name}' | t: 'staff.surveillanceUsers.bronze.spoc' : { name: d.agency.spocName } }}</span>}</p>
            <label class="toggle-card form-switch mb-3" [class.active]="d.allow">
              <input type="checkbox" role="switch" class="form-check-input" name="allow" [(ngModel)]="d.allow" />
              <span><strong>{{ 'Allow Bronze surveillance' | t: 'staff.surveillanceUsers.bronze.allowLabel' }}</strong>
                <small class="muted d-block">{{ 'On: choose the preferred state and districts. Off: give the reason.' | t: 'staff.surveillanceUsers.bronze.allowNote' }}</small></span>
            </label>
            <div class="form-grid">
              @if (d.allow) {
                <label for="bs-state">{{ 'Preferred State' | t: 'staff.surveillanceUsers.bronze.stateLabel' }}</label>
                <select id="bs-state" class="form-select" [ngModel]="d.state" (ngModelChange)="stateChanged(d, $event)">
                  <option value="">{{ 'Select State' | t: 'staff.surveillanceUsers.bronze.statePlaceholder' }}</option>
                  @for (st of states(); track st.code) { <option [value]="st.code">{{ st.name }}</option> }
                </select>
                <label class="top" for="bs-districts">{{ 'Preferred Districts' | t: 'staff.surveillanceUsers.bronze.districtsLabel' }}</label>
                <zed-multi-select inputId="bs-districts" [label]="'Preferred Districts' | t: 'staff.surveillanceUsers.bronze.districtsLabel'" [options]="districts()" [(value)]="d.districts" />
              } @else {
                <label class="top" for="bs-reason">{{ 'Reason' | t: 'staff.surveillanceUsers.bronze.reasonLabel' }}</label>
                <textarea id="bs-reason" class="form-control" maxlength="2000" rows="3" [(ngModel)]="d.reason"></textarea>
              }
            </div>
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" (click)="bronze.set(null)">{{ 'Close' | t: 'staff.surveillanceUsers.bronze.closeButton' }}</button>
            <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="saveBronze(d)">{{ 'Save' | t: 'staff.surveillanceUsers.bronze.saveButton' }}</button>
          </div>
        </div></div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (mobileOf(); as id) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="mobile-title">
        <div class="modal-dialog modal-popup sv-dialog"><div class="modal-content">
          <div class="modal-header">
            <h3 class="registration-title m-0" id="mobile-title">{{ 'Registered Mobile – {id}' | t: 'staff.surveillanceUsers.mobile.title' : { id: id } }}</h3>
            <button type="button" class="btn-close" [attr.aria-label]="'Close' | t: 'staff.surveillanceUsers.mobile.closeAria'" (click)="mobileOf.set(null)"></button>
          </div>
          <div class="modal-body">
            <zed-assessor-mobile [userId]="id" system="surveillance" [plain]="true" [name]="nameOf(id)" (released)="loadPhones()" />
          </div>
          <div class="modal-footer">
            <button type="button" class="btn btn-default" (click)="mobileOf.set(null)">{{ 'Close' | t: 'staff.surveillanceUsers.mobile.closeButton' }}</button>
          </div>
        </div></div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (releaseFor(); as m) {
      <zed-confirm-dialog [ask]="m.ask" [busy]="busy()" [failed]="dialogError()" inputId="sv-release-reason" (confirmed)="releaseMobile(m.target, $event)" (cancel)="closeDialogs()" />
    }
    @if (resetFor(); as r) {
      <zed-confirm-dialog [ask]="r.ask" [busy]="busy()" [failed]="dialogError()" (confirmed)="sendReset(r.target)" (cancel)="closeDialogs()" />
    }
    @if (blockFor(); as b) {
      <zed-confirm-dialog [ask]="b.ask" [busy]="busy()" [failed]="dialogError()" inputId="sv-block-reason" (confirmed)="block(b.target, $event)" (cancel)="closeDialogs()" />
    }
    @if (reasonAsk(); as r) {
      <zed-reason-dialog [ask]="r" [busy]="busy()" [failed]="dialogError()" (confirmed)="unblockWithReason(r, $event)" (cancel)="closeDialogs()" />
    }
    @if (historyFor(); as h) {
      <zed-user-history [subtitle]="(h.target.name || h.target.userId) + ' · ' + h.target.userId" [items]="h.items" [error]="h.error"
                        [fileName]="'history-' + h.target.userId" (closed)="historyFor.set(null)" />
    }
  `,
  styles: `
    .sv-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; padding: 12px 16px; margin-bottom: 16px; }
    .sv-search-box { position: relative; flex: 1 1 280px; max-width: 400px; margin: 0; }
    .sv-search-box svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #6b7f80; stroke-width: 2; }
    .sv-search-box input { padding-left: 36px; }
    .sv-agency { flex: 0 1 300px; width: auto; max-width: 100%; }
    .sv-showing { margin-left: auto; font-size: 13px; color: #5f6f70; }

    .sv-list { padding: 0; overflow: hidden; }
    .sv-table { margin: 0; }
    .sv-table th:first-child, .sv-table td:first-child { padding-left: 14px; }
    .sv-table td { vertical-align: middle; overflow-wrap: anywhere; font-size: 14px; }
    .sv-table tbody tr:hover td { background: var(--zt-pale, #f7fbfb); }
    .sv-user { display: flex; align-items: center; gap: 12px; min-width: 190px; }
    .sv-who, .sv-contact, .bronze-status { min-width: 0; display: flex; flex-direction: column; align-items: flex-start; }
    .sv-avatar { flex: 0 0 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: var(--zt-soft, #d4ebe6);
      color: var(--zt-ink, #173f44); font-weight: 700; font-size: 12.5px; }
    tr.is-blocked .sv-avatar { background: #f6e3e1; color: #a8303a; }
    .sv-name, .sv-contact strong { font-weight: 700; color: var(--zt-ink, #173f44); }
    .sv-id, .sv-sub { font-size: 12.5px; color: #5f6f70; }
    .sv-contact { min-width: 150px; }
    .sv-contact > * { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .sv-pill { display: inline-block; margin: 2px 4px 2px 0; padding: 3px 10px; border-radius: 12px; background: #eef2f2; color: #4d6062; font-size: 12px; font-weight: 600; white-space: nowrap; }
    .sv-agency-line { margin-top: 3px; }
    .sv-alloc { min-width: 170px; }
    .sv-cap { margin: 0 0 8px; font-size: 13.5px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .no-mobile { color: #8a6100; }
    .sv-phone { display: block; margin-top: 6px; }
    .bronze-status { gap: 2px; min-width: 130px; }
    .bronze-switch { display: inline-flex; align-items: center; gap: 8px; margin: 0; font-size: 13px; cursor: pointer; white-space: nowrap; }
    .bronze-switch.is-on { color: #1e7a3c; font-weight: 600; }
    .bronze-switch.form-switch { padding-left: 0; }
    .bronze-switch .form-check-input { float: none; margin: 0; width: 2em; border: 1px solid #888; }
    .sv-btns { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .sv-btns .btn { white-space: nowrap; }
    .sv-empty .btn-link { font-weight: 600; }

    .form-grid > .top { align-self: start; padding-top: 8px; }
    .sv-dialog-who { margin: 0 0 12px; overflow-wrap: anywhere; }
    .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; cursor: pointer; }
    .toggle-card.active { border-color: var(--zt-mid2, #2a8a8c); background: #f4fafa; }
    /* The skin makes pop-up labels bold; on this card only the name is. */
    .modal .modal-popup label.toggle-card { font-weight: 400; color: #232527; }
    .toggle-card.form-switch { padding-left: 12px; }
    .toggle-card.form-switch .form-check-input { flex: none; float: none; margin: 3px 0 0; width: 2em; border: 1px solid #888; }
    .toggle-card strong { color: var(--zt-ink, #173f44); }
    .modal .sv-dialog textarea.form-control { min-height: 0; height: auto; }

    @media (max-width: 767.98px) {
      .sv-search-box, .sv-agency { flex: 1 1 100%; max-width: none; }
      .sv-showing { margin-left: 0; }
      .sv-list { background: none; border: 0; box-shadow: none; }
      .sv-table thead { display: none; }
      .sv-table, .sv-table tbody, .sv-table tr, .sv-table td { display: block; width: 100%; }
      .sv-table tr { position: relative; background: #fff; border: 1px solid #e1eaea; border-radius: 12px; margin-bottom: 12px; padding: 8px 14px; }
      .sv-table tr.empty-row { border: 0; padding: 0; }
      .sv-table td, .sv-table td:first-child { border: 0; padding: 5px 0; text-align: left !important; }
      .sv-table tbody tr:hover td { background: transparent; }
      .sv-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #5f6f70; text-transform: uppercase; }
      .sv-user { min-width: 0; padding-right: 44px; }
      .sv-btns { justify-content: flex-start; }
      .sv-btns zed-row-menu { position: absolute; top: 12px; right: 12px; }
      .modal .sv-dialog .form-grid { grid-template-columns: minmax(0, 1fr); gap: 6px; }
    }
  `,
})
export class SurveillanceUsersPage {
  private readonly api = inject(SurveillanceUsersApi);
  private readonly toast = inject(ToastService);
  protected readonly kind: Kind = inject(ActivatedRoute).snapshot.data['kind'] === 'agencies' ? 'agencies' : 'assessors';
  private readonly roleId = inject(AuthService).currentUser()?.roleId;
  private readonly isMaster = this.roleId === StaffRole.MasterAdmin;
  /** V4: the assessor's registered mobile of the surveillance site assessor app, for the Admin and the MasterAdmin (not agencies). */
  protected readonly showsMobile = this.kind === 'assessors' && canSeeAssessorMobile(this.roleId);
  protected readonly title = computed(() => (this.kind === 'agencies' ? t('staff.surveillanceUsers.agencies.title', 'Bronze Surveillance Agencies')
    : t('staff.surveillanceUsers.assessors.title', 'Assessors')));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.title() }));

  protected readonly agencies = signal<SurveillanceAgency[]>([]);
  protected readonly assessors = signal<SurveillanceAssessor[]>([]);
  protected readonly states = signal<CodeName[]>([]);
  protected readonly districts = signal<MultiSelectOption[]>([]);
  protected readonly search = signal('');
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly bronze = signal<BronzeDialog | null>(null);
  /** The server's refusal, shown in the open confirmation. */
  protected readonly dialogError = signal('');
  protected readonly resetFor = signal<{ target: Target; ask: ConfirmAsk } | null>(null);
  protected readonly blockFor = signal<{ target: Target; ask: ConfirmAsk } | null>(null);
  /** 2026-11-16 (the user): an unblock asks for its reason (recorded and e-mailed to the user). */
  protected readonly reasonAsk = signal<ReasonAsk | null>(null);
  private unblockKind: Kind = 'agencies';
  /** The block history side panel (2026-11-08; panel since 2026-11-17). */
  protected readonly historyFor = signal<{ target: Target; items: HistoryItem[] | null; error: string } | null>(null);
  /** The assessor whose registered mobile is shown in the pop-up. */
  protected readonly mobileOf = signal<string | null>(null);
  protected readonly mobile = plain;
  protected readonly email = plain;

  private menus(word: string): [RowMenuItem[], RowMenuItem[]] {
    return [
      [
        { key: 'reset', label: t('staff.surveillanceUsers.menu.reset', 'Send reset link'), icon: 'mail' },
        { key: 'history', label: t('staff.surveillanceUsers.menu.history', 'View history'), icon: 'history' },
        { key: 'block', label: t('staff.surveillanceUsers.menu.block', 'Block {word}', { word }), icon: 'lock', danger: true },
      ],
      [
        { key: 'history', label: t('staff.surveillanceUsers.menu.history', 'View history'), icon: 'history' },
        { key: 'unblock', label: t('staff.surveillanceUsers.menu.unblock', 'Unblock {word}', { word }), icon: 'unlock' },
      ],
    ];
  }
  private readonly agencyMenus = computed(() => this.menus(t('staff.surveillanceUsers.word.agency', 'agency')));
  private readonly assessorMenus = computed(() => this.menus(t('staff.surveillanceUsers.word.assessor', 'assessor')));
  protected readonly agencyMenuActive = computed(() => this.agencyMenus()[0]);
  protected readonly agencyMenuBlocked = computed(() => this.agencyMenus()[1]);
  protected readonly assessorMenuActive = computed(() => this.assessorMenus()[0]);
  protected readonly assessorMenuBlocked = computed(() => this.assessorMenus()[1]);
  /** 2026-11-18: "Release mobile" for an assessor with a registered phone (Admin and Master Admin; the API refuses others). */
  private readonly releaseItem = computed<RowMenuItem>(() => ({ key: 'release', label: t('staff.surveillanceUsers.menu.release', 'Release mobile'), icon: 'refresh' }));
  private readonly assessorMenuActivePhone = computed(() => [...this.assessorMenuActive().slice(0, 2), this.releaseItem(), ...this.assessorMenuActive().slice(2)]);
  private readonly assessorMenuBlockedPhone = computed(() => [...this.assessorMenuBlocked(), this.releaseItem()]);
  private readonly http = inject(HttpClient);
  /** The registered phones of this portal's apps, by user id (upper case). */
  protected readonly phones = signal<Map<string, PhoneSummary>>(new Map());
  protected readonly releaseFor = signal<{ target: Target; ask: ConfirmAsk } | null>(null);

  protected phoneOf(userId: string): PhoneSummary | undefined {
    return this.phones().get((userId ?? '').trim().toUpperCase());
  }

  protected nameOf(userId: string): string | null {
    return this.assessors().find((a) => a.userId === userId)?.userName ?? null;
  }

  protected assessorMenu(userId: string, active: boolean): RowMenuItem[] {
    const phone = this.showsMobile && hasPhone(this.phoneOf(userId));
    return active ? (phone ? this.assessorMenuActivePhone() : this.assessorMenuActive()) : phone ? this.assessorMenuBlockedPhone() : this.assessorMenuBlocked();
  }

  /** The Phone chips (a failure leaves them "Not registered" rather than failing the list). */
  protected async loadPhones(): Promise<void> {
    if (!this.showsMobile) return;
    try {
      this.phones.set(phonesById(await firstValueFrom(loadPhones(this.http))));
    } catch {
      /* the list works without the chips */
    }
  }

  /** Releases the assessor's registered phone(s) with the reason; the next sign-in registers the new phone. */
  protected async releaseMobile(x: Target, reason: string): Promise<void> {
    await this.confirmed(releasePhone(this.http, x.userId, reason), (m) => {
      this.toast.success(t('staff.surveillanceUsers.toast.released', 'Mobile released'), m);
      void this.loadPhones();
      return false;
    });
  }

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
  protected readonly tiles = computed<ListCount[]>(() => {
    const rows: { isActive: boolean | null; allowBronzeSurveillance: boolean | null }[] =
      this.kind === 'agencies' ? this.agencies() : this.assessorsOfAgency();
    const active = rows.filter((r) => r.isActive).length;
    return [
      { key: 'all', label: t('staff.surveillanceUsers.count.all', 'All {noun}', { noun: this.noun().toLowerCase() }), value: rows.length },
      { key: 'active', label: t('staff.surveillanceUsers.count.active', 'Active'), value: active, tone: 'good' },
      { key: 'blocked', label: t('staff.surveillanceUsers.count.blocked', 'Blocked'), value: rows.length - active, tone: 'bad' },
      { key: 'bronze', label: t('staff.surveillanceUsers.count.bronze', 'Bronze allowed'), value: rows.filter((r) => r.allowBronzeSurveillance).length, tone: 'info' },
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

  /** 2026-11-18: an agency's own units allocated per level (its assessors page); none for other roles. */
  protected readonly levelTotals = signal<LevelCount[] | null>(null);
  protected readonly totalTiles = computed(() => levelCountTiles(this.levelTotals()));

  constructor() {
    void this.load();
    void this.loadPhones();
    if (this.kind === 'assessors' && this.roleId === StaffRole.Agency) void this.loadTotals();
  }

  /** A failure leaves the tiles out (the list works without them). */
  private async loadTotals(): Promise<void> {
    try {
      this.levelTotals.set(await firstValueFrom(this.api.levelCounts()));
    } catch {
      this.levelTotals.set(null);
    }
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
    if (await this.run(this.api.setAgencyBronze(d.agency.userId, req), t('staff.surveillanceUsers.toast.bronzeSaved', 'Bronze surveillance saved'))) this.bronze.set(null);
  }

  protected async setAssessorBronze(s: SurveillanceAssessor, allow: boolean): Promise<void> {
    await this.run(this.api.setAssessorBronze(s.userId, allow), allow
      ? t('staff.surveillanceUsers.toast.bronzeAllowed', 'Bronze surveillance allowed') : t('staff.surveillanceUsers.toast.bronzeNotAllowed', 'Bronze surveillance not allowed'));
  }

  /** A row menu choice: each one confirms first (reset link, block, unblock) or opens the history panel. */
  protected pick(key: string, x: Target): void {
    if (this.busy()) return;
    this.dialogError.set('');
    switch (key) {
      case 'reset': this.resetFor.set({ target: x, ask: resetLinkAsk(x.name, x.userId, x.email, x.kind === 'agencies'
        ? t('staff.surveillanceUsers.reset.agency', 'Surveillance agency') : t('staff.surveillanceUsers.reset.assessor', 'Assessor')) }); break;
      case 'block': this.blockFor.set({ target: x, ask: this.blockAsk(x) }); break;
      case 'unblock':
        this.unblockKind = x.kind;
        this.reasonAsk.set({ action: 'unblock', userId: x.userId, userName: x.name });
        break;
      case 'history': void this.openHistory(x); break;
      case 'release': this.releaseFor.set({ target: x, ask: releaseMobileAsk(x.name, x.userId, this.phoneOf(x.userId)?.model, t('staff.surveillanceUsers.word.assessor', 'assessor')) }); break;
    }
  }

  /** "Block …?" (popup-03): what it does, a required reason; the server always e-mails the user. */
  private blockAsk(x: Target): ConfirmAsk {
    const name = x.name || x.userId;
    const users = x.kind === 'agencies' ? this.agencies().find((a) => a.userId === x.userId)?.noOfUsers : undefined;
    // Two whole sentences: who (with the agency's assessors, one / many) and what blocking does.
    const who = users === undefined ? t('staff.surveillanceUsers.block.who', '{name} ({id}).', { name, id: x.userId })
      : users === 1 ? t('staff.surveillanceUsers.block.whoAssessor', '{name} ({id} · {count} assessor).', { name, id: x.userId, count: users })
      : t('staff.surveillanceUsers.block.whoAssessors', '{name} ({id} · {count} assessors).', { name, id: x.userId, count: users });
    const agency = x.kind === 'agencies';
    return {
      title: t('staff.surveillanceUsers.block.title', 'Block {name}?', { name }),
      message: who + ' ' + (agency
        ? t('staff.surveillanceUsers.block.agencyMessage', 'The agency can no longer sign in to surveillance until unblocked. Nothing is deleted; the reason is kept in the history and e-mailed to the agency.')
        : t('staff.surveillanceUsers.block.assessorMessage', 'The assessor can no longer sign in to surveillance until unblocked. Nothing is deleted; the reason is kept in the history and e-mailed to the assessor.')),
      confirmLabel: agency ? t('staff.surveillanceUsers.block.agencyButton', 'Block agency') : t('staff.surveillanceUsers.block.assessorButton', 'Block assessor'),
      danger: true,
      reason: {
        label: t('staff.surveillanceUsers.block.reasonLabel', 'Reason for blocking'),
        placeholder: t('staff.surveillanceUsers.block.reasonPlaceholder', 'Shown in the history and e-mailed'), maxLength: 2000,
        requiredMessage: t('staff.surveillanceUsers.block.reasonRequired', 'Please enter the reason for blocking.'),
      },
    };
  }

  protected closeDialogs(): void {
    if (this.busy()) return;
    this.resetFor.set(null);
    this.blockFor.set(null);
    this.reasonAsk.set(null);
    this.releaseFor.set(null);
    this.dialogError.set('');
  }

  protected async block(x: Target, reason: string): Promise<void> {
    await this.confirmed(this.api.block(x.kind, x.userId, reason.trim()), (m) => {
      this.toast.success(x.kind === 'agencies' ? t('staff.surveillanceUsers.toast.agencyBlocked', 'Agency blocked') : t('staff.surveillanceUsers.toast.assessorBlocked', 'Assessor blocked'), m);
      return true;
    });
  }

  /** E-mails the user a link to set a new password (refused for accounts whose password the main portal holds). */
  protected async sendReset(x: Target): Promise<void> {
    await this.confirmed(this.api.passwordReset(x.kind, x.userId), (m) => {
      this.toast.success(t('staff.surveillanceUsers.toast.resetSent', 'Reset link sent'), t('staff.surveillanceUsers.toast.resetTo', 'E-mailed to {to}', { to: sentTo(m, x.email) }));
      return false;
    });
  }

  protected async unblockWithReason(r: ReasonAsk, reason: string): Promise<void> {
    const kind = this.unblockKind;
    await this.confirmed(this.api.unblock(kind, r.userId, reason), (m) => {
      this.toast.success(kind === 'agencies' ? t('staff.surveillanceUsers.toast.agencyUnblocked', 'Agency unblocked') : t('staff.surveillanceUsers.toast.assessorUnblocked', 'Assessor unblocked'), m);
      return true;
    });
  }

  private async openHistory(x: Target): Promise<void> {
    this.historyFor.set({ target: x, items: null, error: '' });
    try {
      const entries = await firstValueFrom(this.api.history(x.kind, x.userId));
      if (this.historyFor()?.target === x) this.historyFor.set({ target: x, items: blockHistoryItems(entries), error: '' });
    } catch (err) {
      if (this.historyFor()?.target === x) this.historyFor.set({ target: x, items: [], error: apiErrorMessage(err) });
    }
  }

  /** A confirmed row action: done → the toast (and a reload when `done` says so), the pop-up closes; refused → in the pop-up. */
  private async confirmed(call: Observable<MessageResponse>, done: (message: string) => boolean): Promise<void> {
    this.busy.set(true);
    this.dialogError.set('');
    try {
      const reload = done((await firstValueFrom(call)).message);
      this.busy.set(false);
      this.closeDialogs();
      if (reload) await this.load();
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  /** The Bronze surveillance settings: done → a toast and a reload; refused → a toast with the reason. */
  private async run(call: Observable<MessageResponse>, title: string): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    try {
      this.toast.success(title, (await firstValueFrom(call)).message);
      await this.load();
      return true;
    } catch (err) {
      this.toast.error(t('staff.surveillanceUsers.toast.notSaved', 'Not saved'), apiErrorMessage(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  protected noun(): string {
    return this.kind === 'agencies' ? t('staff.surveillanceUsers.noun.agencies', 'Agencies') : t('staff.surveillanceUsers.noun.assessors', 'Assessors');
  }

  protected filterLabel(): string {
    switch (this.filter()) {
      case 'bronze': return t('staff.surveillanceUsers.filter.bronzeOnly', 'Bronze allowed only');
      case 'active': return t('staff.surveillanceUsers.filter.activeOnly', 'active only');
      case 'blocked': return t('staff.surveillanceUsers.filter.blockedOnly', 'blocked only');
      default: return '';
    }
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

  /** "12 Mill Road, 208001": the agency's address and PIN code. */
  protected place(a: SurveillanceAgency): string {
    return [this.field(a, 'address'), this.field(a, 'pinCode')].filter(Boolean).join(', ');
  }

  protected clearFilters(): void {
    this.filter.set('all');
    this.agency.set('');
    this.search.set('');
  }

  /** The old IdStatus column: Active / In-Active from IsActive. */
  protected status(u: { isActive: boolean | null }): string {
    return u.isActive ? t('staff.surveillanceUsers.status.active', 'Active') : t('staff.surveillanceUsers.status.inactive', 'In-Active');
  }

  /**
   * A column the old lists showed that is not in SurveillanceAgency / SurveillanceAssessor (users.api.ts): the API sends the
   * agency's address and pinCode and the assessor's address and idProofNumber (Users.Address, Pincode, IdProofNumber). The
   * PAN is no longer shown in the list (2026-11-17).
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
