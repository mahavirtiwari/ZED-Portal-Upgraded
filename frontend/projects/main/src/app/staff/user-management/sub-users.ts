import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { IndianTimePipe } from '../utc-time';
import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ListCount, ListCounts } from '../list-counts';
import { ListSearchComponent, PagedView, PagerComponent, searchRows } from '../pager';
import { RowMenu, RowMenuItem } from '../row-menu';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { plain } from '../users/user-display';
import { STAFF_SYSTEM } from '../staff-menu';

interface PermissionOption {
  key: string;
  label: string;
}

interface SubUser {
  userId: string;
  userName: string;
  email: string | null;
  mobileNo: string | null;
  permissions: string[];
  isActive: boolean;
  createdAt: string;
  lastLoginAt: string | null;
  locked: boolean;
  /** 2026-11-16: the state codes it may see; empty = every state. */
  states?: string[];
  /** 2026-11-16, operation admins: the assessment agencies it may see; empty = every agency. */
  agencies?: string[];
}

interface ScopeOption {
  code: string;
  name: string;
}

interface SubUsersResponse {
  accountType: string;
  permissions: PermissionOption[];
  users: SubUser[];
  states?: ScopeOption[];
  /** Master Admin only. */
  agencies?: ScopeOption[] | null;
}

interface SubUserForm {
  userName: string;
  email: string;
  mobileNo: string;
  permissions: string[];
  isActive: boolean;
  states: string[];
  agencies: string[];
}

type LoginStatus = 'active' | 'locked' | 'blocked';

/** A row menu action waiting for its confirmation. */
interface PendingAction {
  key: 'reset' | 'block' | 'unblock';
  user: SubUser;
  ask: ConfirmAsk;
}

const API = '/api/staff/sub-users';

/**
 * MasterAdmin → Operation Admins, agency → Sub-Users (new in V4): logins for the owner's own staff. A sub-user signs in
 * with its own ID and works as the owner (same role and data) on the screens ticked here; the login ID is generated and
 * the password mailed to the sub-user.
 * 2026-11-17 (approved staff-20 / popup-02): the page head with the Add button, the shared count tiles (all, active, locked,
 * blocked; a click filters), the search bar, the list with the contact (in full since 2026-11-18, the user: never masked), the screens as chips (four at most, then
 * "+N more"; one "All N screens" chip when it has every one), a locked login flagged in amber with a lock, and per row Edit
 * plus a row menu: a new password (on a locked login "Unlock", as the new password also lifts the lock), Block / Unblock,
 * each after a confirmation, and a toast once done. The pop-up has two columns: details and scope on the left, the screens
 * as switches on the right, and a fixed footer.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-20 / popup-02 values: 34px light avatars, 13.5 / 12.5px
 * text, an uppercase grey scope pill, ACTIONS on the right, a 62px toolbar card; the pop-up with a white head (icon tile, grey
 * square close), the states and agencies as drop-down multi-selects (so it fits a laptop screen without scrolling), 42px
 * screen tiles with 40 x 22 switches (teal outline when on) and 40px title-case buttons; the tab title names the page.
 */
@Component({
  selector: 'zed-staff-sub-users',
  imports: [FormsModule, DatePipe, IndianTimePipe, NgTemplateOutlet, PagerComponent, ListSearchComponent, MultiSelect, PageHead, ListCounts, RowMenu, ConfirmDialog, TextPipe],
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="typePlural()"
                   [subtitle]="'They sign in with their own User ID and work as your login on the screens you give them. Their work is recorded under your login.' | t: 'staff.subUsers.subtitle'">
      <button type="button" class="btn btn-primary" [disabled]="!options().length" (click)="add()">{{ '+ Add {type}' | t: 'staff.subUsers.addButton' : { type: accountType() } }}</button>
    </zed-page-head>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <zed-list-counts [counts]="tiles()" [selected]="status()" [label]="'Logins by status' | t: 'staff.subUsers.countsLabel'" (pick)="pickStatus($event.key)" />
    <div class="zed-card su-toolbar">
      <zed-list-search [(value)]="search" [placeholder]="'Search users' | t: 'staff.subUsers.search.placeholder'" inputId="sub-users-search" [found]="view.total()" />
      <span class="muted su-showing">{{ showingText() }}</span>
    </div>
    <div class="zed-card su-list">
      <div class="table-responsive">
        <table class="table table-zed su-table">
          <thead>
            <tr>
              <th>{{ 'User' | t: 'staff.subUsers.column.user' }}</th><th>{{ 'Contact' | t: 'staff.subUsers.column.contact' }}</th><th>{{ 'Screens' | t: 'staff.subUsers.column.screens' }}</th><th>{{ 'Scope' | t: 'staff.subUsers.column.scope' }}</th><th>{{ 'Last login' | t: 'staff.subUsers.column.lastLogin' }}</th>
              <th class="text-center" style="width: 110px">{{ 'Status' | t: 'staff.subUsers.column.status' }}</th><th class="text-end" style="width: 120px">{{ 'Actions' | t: 'staff.subUsers.column.actions' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (u of view.page(); track u.userId) {
              <tr [class.is-blocked]="!u.isActive">
                <td>
                  <div class="su-user">
                    <span class="su-avatar" aria-hidden="true">{{ initials(u) }}</span>
                    <span class="su-who">
                      <span class="su-name">{{ u.userName }}</span>
                      <span class="su-id">{{ u.userId }}</span>
                    </span>
                    <ng-container *ngTemplateOutlet="badge; context: { $implicit: u, phone: true }" />
                  </div>
                </td>
                <!-- 2026-11-18 (the user): the mobile and e-mail in full (never masked); a long e-mail is cut with "…" and its tooltip. -->
                <td class="su-contact" [attr.data-label]="'Contact' | t: 'staff.subUsers.column.contact'">
                  @if (u.mobileNo) { <span>{{ mobileOf(u) }}</span> } @else { <span class="no-mobile">{{ 'Mobile not saved' | t: 'staff.subUsers.row.noMobile' }}</span> }
                  @if (u.email) { <span class="su-mail" [title]="u.email">{{ mailOf(u) }}</span> }
                </td>
                <td class="su-screens" [attr.data-label]="'Screens' | t: 'staff.subUsers.column.screens'">
                  @if (hasAll(u)) {
                    <span class="zed-chip su-chip-all">{{ 'All {count} screens' | t: 'staff.subUsers.row.allScreens' : { count: options().length } }}</span>
                  } @else {
                    @for (p of u.permissions.slice(0, 4); track p) { <span class="zed-chip">{{ label(p) }}</span> }
                    @if (u.permissions.length > 4) {
                      <span class="zed-chip su-chip-more" [title]="moreLabels(u)">{{ '+{count} more' | t: 'staff.subUsers.row.moreScreens' : { count: u.permissions.length - 4 } }}</span>
                    }
                  }
                  @if (!u.permissions.length) { <span class="su-mail">{{ 'No screens' | t: 'staff.subUsers.row.noScreens' }}</span> }
                </td>
                <td class="su-scope" [attr.data-label]="'Scope' | t: 'staff.subUsers.column.scope'"><span class="su-scope-pill" data-scope>{{ scopeText(u) }}</span></td>
                <td class="su-login" [attr.data-label]="'Last Login' | t: 'staff.subUsers.row.lastLoginLabel'">
                  @if (u.lastLoginAt) { {{ u.lastLoginAt | indianTime: 'dd MMM yyyy, HH:mm' }} } @else { <span class="su-never">{{ 'Never signed in' | t: 'staff.subUsers.row.never' }}</span> }
                  <small class="d-block muted">{{ 'Added {date}' | t: 'staff.subUsers.row.added' : { date: u.createdAt | date: 'dd MMM yyyy' } }}</small>
                </td>
                <td class="text-center su-status-cell"><ng-container *ngTemplateOutlet="badge; context: { $implicit: u }" /></td>
                <td class="text-end su-actions-cell">
                  <div class="su-actions">
                    <button type="button" class="btn btn-outline-primary" (click)="edit(u)">{{ 'Edit' | t: 'staff.subUsers.row.editButton' }}</button>
                    <zed-row-menu [items]="menuOf(u)" [label]="'More actions for {name}' | t: 'staff.subUsers.row.menuAria' : { name: u.userName }" (picked)="picked(u, $event)" />
                  </div>
                </td>
              </tr>
            } @empty {
              @if (!busy()) {
                <tr class="empty-row">
                  <td colspan="7" style="padding: 0">
                    <div class="no-data su-empty">
                      @if (users().length) {
                        {{ 'No login matches the filters.' | t: 'staff.subUsers.noMatch' }}
                        <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">{{ 'Show all logins' | t: 'staff.subUsers.showAllButton' }}</button>
                      } @else {
                        {{ 'No {types} yet.' | t: 'staff.subUsers.empty' : { types: typePlural().toLowerCase() } }}
                        @if (options().length) {
                          <button type="button" class="btn btn-link p-0 ms-1" (click)="add()">{{ 'Add the first {type}' | t: 'staff.subUsers.emptyAddButton' : { type: accountType().toLowerCase() } }}</button>
                        }
                      }
                    </div>
                  </td>
                </tr>
              }
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="view" />
    </div>
    <ng-template #badge let-u let-phone="phone">
      <span class="status-badge" [class.su-badge-phone]="phone" [class.is-active]="statusOf(u) === 'active'" [class.is-pending]="statusOf(u) === 'locked'"
            [class.is-rejected]="statusOf(u) === 'blocked'">
        @if (statusOf(u) === 'locked') { <svg class="su-lock" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4" /></svg> }
        {{ statusLabel(u) }}
      </span>
    </ng-template>

    @if (form(); as f) {
      <!-- 2026-11-17 (approved popup-02): two columns (details and scope | screens), sized to a laptop screen, the footer always in view. -->
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="sub-user-title">
        <div class="modal-dialog modal-popup su-dialog">
          <div class="modal-content su-content">
            <div class="su-head">
              <span class="su-icon" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z" /></svg></span>
              <div>
                <h3 class="m-0" id="sub-user-title">{{ editing() ? ('Edit {id}' | t: 'staff.subUsers.form.editTitle' : { id: editing() }) : ('Add {type}' | t: 'staff.subUsers.form.addTitle' : { type: accountType() }) }}</h3>
                <small class="su-sub">{{ editing() ? f.userName : ('The User ID is generated and the login details are e-mailed to the user.' | t: 'staff.subUsers.form.addSub') }}</small>
              </div>
              <button type="button" class="su-x" data-dismiss [attr.aria-label]="'Close' | t: 'staff.subUsers.form.closeAria'" (click)="close()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12" /></svg></button>
            </div>
            <form class="su-form" (ngSubmit)="save()" novalidate>
              <div class="modal-body su-body">
                <div class="su-col">
                  <div class="su-field">
                    <label for="sub-name">{{ 'Name' | t: 'staff.subUsers.form.nameLabel' }}<span class="req">*</span></label>
                    <input class="form-control" id="sub-name" name="userName" maxlength="100" [placeholder]="'Full name' | t: 'staff.subUsers.form.namePlaceholder'" [ngModel]="f.userName" (ngModelChange)="patch('userName', $event)"
                           [class.is-invalid]="!!fieldErrors().userName" [attr.aria-invalid]="!!fieldErrors().userName" [attr.aria-describedby]="fieldErrors().userName ? 'sub-name-err' : null" />
                    @if (fieldErrors().userName; as e) { <span class="help-block" id="sub-name-err">{{ e }}</span> }
                  </div>
                  <div class="su-field">
                    <label for="sub-email">{{ 'E-mail' | t: 'staff.subUsers.form.emailLabel' }}<span class="req">*</span></label>
                    <input class="form-control" id="sub-email" name="email" type="email" maxlength="100" [placeholder]="'name@organisation.in' | t: 'staff.subUsers.form.emailPlaceholder'" [ngModel]="f.email" (ngModelChange)="patch('email', $event)"
                           [class.is-invalid]="!!fieldErrors().email" [attr.aria-invalid]="!!fieldErrors().email" [attr.aria-describedby]="fieldErrors().email ? 'sub-email-err' : null" />
                    @if (fieldErrors().email; as e) { <span class="help-block" id="sub-email-err">{{ e }}</span> }
                  </div>
                  <div class="su-field">
                    <label for="sub-mobile">{{ 'Mobile number' | t: 'staff.subUsers.form.mobileLabel' }}</label>
                    <input class="form-control" id="sub-mobile" name="mobileNo" maxlength="10" inputmode="numeric" [placeholder]="'10 digits (optional)' | t: 'staff.subUsers.form.mobilePlaceholder'" [ngModel]="f.mobileNo" (ngModelChange)="patch('mobileNo', $event)"
                           [class.is-invalid]="!!fieldErrors().mobileNo" [attr.aria-invalid]="!!fieldErrors().mobileNo" [attr.aria-describedby]="fieldErrors().mobileNo ? 'sub-mobile-err' : null" />
                    @if (fieldErrors().mobileNo; as e) { <span class="help-block" id="sub-mobile-err">{{ e }}</span> }
                  </div>
                  <!-- 2026-11-16 (approved): the states (and, for an operation admin, the assessment agencies) it may see. -->
                  <h4 class="su-section">{{ 'Scope' | t: 'staff.subUsers.form.scopeTitle' }}</h4>
                  <div class="su-field" data-scope-states>
                    <label class="su-label" for="sub-states">{{ 'States' | t: 'staff.subUsers.form.statesLabel' }} <small>· {{ 'none selected = every state' | t: 'staff.subUsers.form.statesNote' }}</small></label>
                    <zed-multi-select variant="dropdown" [label]="'States' | t: 'staff.subUsers.form.statesLabel'" inputId="sub-states" [allText]="'every state' | t: 'staff.subUsers.form.statesAll'" [options]="stateOptions()" [value]="f.states"
                                      (valueChange)="patch('states', $event)" />
                  </div>
                  @if (agencyOptions(); as ag) {
                    <div class="su-field" data-scope-agencies>
                      <!-- 2026-11-21 (UI audit): Consultant organisations on the Consultancy portal. -->
                      <label class="su-label" for="sub-agencies">{{ agenciesLabel() }} <small>· {{ consultancy ? ('none selected = every consultant organisation' | t: 'staff.subUsers.form.consultancy.agenciesNote') : ('none selected = every agency' | t: 'staff.subUsers.form.agenciesNote') }}</small></label>
                      <zed-multi-select variant="dropdown" [label]="agenciesLabel()" inputId="sub-agencies" [allText]="consultancy ? ('every consultant organisation' | t: 'staff.subUsers.form.consultancy.agenciesAll') : ('every agency' | t: 'staff.subUsers.form.agenciesAll')" [options]="ag" [value]="f.agencies"
                                        (valueChange)="patch('agencies', $event)" />
                    </div>
                  }
                  <p class="su-hint">{{ scopeNote() }}</p>
                  @if (editing()) {
                    <h4 class="su-section">{{ 'Access' | t: 'staff.subUsers.form.accessTitle' }}</h4>
                    <label class="toggle-card form-switch" [class.active]="f.isActive" for="sub-active">
                      <input class="form-check-input" type="checkbox" role="switch" id="sub-active" name="isActive" [checked]="f.isActive" (change)="patch('isActive', !f.isActive)" />
                      <span><strong>{{ 'Active' | t: 'staff.subUsers.form.activeLabel' }}</strong><small class="muted d-block">{{ 'Switch off to block this login; it can no longer sign in.' | t: 'staff.subUsers.form.activeNote' }}</small></span>
                    </label>
                  }
                </div>
                <div class="su-col">
                  <div class="su-screens-head">
                    <h4 id="sub-screens">{{ 'Screens' | t: 'staff.subUsers.form.screensTitle' }}<span class="req">*</span> <small class="su-given">{{ '{count} of {total} given' | t: 'staff.subUsers.form.screensGiven' : { count: f.permissions.length, total: options().length } }}</small></h4>
                    <span class="su-bulk">
                      <button type="button" class="btn btn-link p-0" (click)="patch('permissions', allKeys())">{{ 'Select all' | t: 'staff.subUsers.form.selectAllButton' }}</button> ·
                      <button type="button" class="btn btn-link p-0" (click)="patch('permissions', [])">{{ 'Clear' | t: 'staff.subUsers.form.clearButton' }}</button>
                    </span>
                  </div>
                  @if (fieldErrors().permissions; as e) { <span class="help-block su-perms-err" id="sub-screens-err">{{ e }}</span> }
                  <div class="su-perms" role="group" aria-labelledby="sub-screens" [class.is-invalid]="!!fieldErrors().permissions" [attr.aria-describedby]="fieldErrors().permissions ? 'sub-screens-err' : null">
                    @for (p of options(); track p.key) {
                      <label class="toggle-card form-switch" [class.active]="f.permissions.includes(p.key)" [for]="'perm-' + p.key">
                        <input class="form-check-input" type="checkbox" role="switch" [id]="'perm-' + p.key" [name]="'perm-' + p.key"
                               [checked]="f.permissions.includes(p.key)" (change)="toggle(p.key)" />
                        <span class="su-perm-name">{{ screenName(p) }}</span>
                      </label>
                    }
                  </div>
                  <p class="su-note"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z M12 16v-4 M12 8h.01" /></svg><span>{{ 'Work done by {who} is recorded under your login. You can change the screens or block the login at any time.' | t: 'staff.subUsers.form.note' : { who: whoWord() } }}</span></p>
                </div>
              </div>
              <!-- 2026-11-21 (UI audit F2): the error above the footer, outside the scrolling body, so it is always in view. -->
              @if (formError()) { <div class="alert alert-danger su-form-error" role="alert">{{ formError() }}</div> }
              <div class="modal-footer su-foot">
                <span class="su-foot-note">{{ 'Fields marked * are required.' | t: 'staff.subUsers.form.requiredNote' }}</span>
                <span class="su-foot-actions">
                  <button type="button" class="btn btn-default" (click)="close()">{{ 'Cancel' | t: 'staff.subUsers.form.cancelButton' }}</button>
                  <button type="submit" class="btn btn-primary" [disabled]="busy()">{{ editing() ? ('Save changes' | t: 'staff.subUsers.form.saveButton') : ('Add {type}' | t: 'staff.subUsers.form.addButton' : { type: accountType().toLowerCase() }) }}</button>
                </span>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (pending(); as p) {
      <zed-confirm-dialog [ask]="p.ask" [busy]="busy()" [failed]="pendingError()" (confirmed)="confirmed(p)" (cancel)="pending.set(null)" />
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styleUrl: './sub-users-dialog.css',
  styles: `
    .su-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px 16px; min-height: 62px; padding: 12px 16px; margin-bottom: 16px; }
    .su-toolbar zed-list-search { margin: 0; flex: 0 1 340px; }
    .su-showing { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .su-list { padding: 0; overflow: hidden; }
    .su-table { margin-bottom: 0; }
    .su-table td { vertical-align: middle; }
    .su-table tbody tr:hover td { background: #f4fafa; }
    .su-table tr.is-blocked td { background: #fdf6f5; }
    .su-user { display: flex; align-items: center; gap: 10px; min-width: 180px; }
    .su-who { min-width: 0; }
    .su-avatar { flex: 0 0 34px; width: 34px; height: 34px; border-radius: 50%; display: inline-flex; align-items: center; justify-content: center;
      color: #24666b; background: #e6f2f3; font-weight: 800; font-size: 11.5px; }
    tr.is-blocked .su-avatar { background: #fbe9e7; color: #c8473c; }
    .su-name { display: block; font-size: 13.5px; font-weight: 700; color: #17373b; overflow-wrap: anywhere; }
    .su-id { display: block; font-size: 11.5px; font-weight: 600; color: #6f8487; }
    /* 2026-11-21 (UI audit L7): the badge beside the name is for phones only (the skin's .staff-page.staff-page .status-badge
       outranked the plain rule, so ACTIVE showed twice on desktop). */
    .status-badge.su-badge-phone { display: none !important; }
    .su-lock { width: 11px; height: 11px; margin-right: 2px; vertical-align: -1px; fill: none; stroke: currentColor; stroke-width: 2.4; }
    .su-contact { min-width: 150px; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .su-contact span { display: block; line-height: 17px; overflow-wrap: anywhere; }
    .su-contact .su-mail { white-space: normal; overflow-wrap: break-word; }
    .su-mail, .su-never { font-size: 11.5px; font-weight: 500; color: #6f8487; }
    .no-mobile { color: #9a5f06; }
    .su-screens { min-width: 200px; max-width: 330px; }
    .su-screens .zed-chip { display: inline-block; margin: 2px 4px 2px 0; }
    .su-scope-pill { display: inline-block; padding: 4px 11px; border-radius: 11px; background: #ecf0f0; color: #6f8487; font-size: 10.5px; font-weight: 700;
      letter-spacing: .4px; line-height: 14px; text-transform: uppercase; white-space: nowrap; }
    .su-login { white-space: nowrap; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .su-login small { font-size: 11.5px; color: #6f8487; }
    .su-chip-all { background: #e5f5ea !important; color: #2f9e58 !important; }
    .su-chip-more { background: #fff !important; border: 1px dashed #9cc7cb; cursor: help; }
    .su-actions { display: inline-flex; align-items: center; gap: 8px; }
    .su-actions .btn { min-height: 30px; padding: 3px 12px; font-size: 12.5px; white-space: nowrap; }
    .su-empty .btn-link { font-weight: 600; }

    @media (max-width: 767.98px) {
      .su-toolbar zed-list-search { flex: 1 1 100%; }
      .su-list { padding: 0; background: none; border: 0; box-shadow: none; }
      .su-table { min-width: 0; }
      .su-table thead { display: none; }
      .su-table, .su-table tbody, .su-table tr, .su-table td { display: block; width: 100%; box-sizing: border-box; }
      .su-table tr { border: 1px solid #dde7e8; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; overflow: hidden; background: #fff; }
      .su-table tr.empty-row { border: 0; padding: 0; }
      .su-table td { border: 0; padding: 6px 0; text-align: left !important; max-width: none; }
      .su-table tr.is-blocked { background: #fdf6f5; }
      .su-table tr.is-blocked td, .su-table tbody tr:hover td { background: transparent; }
      .su-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #6f8487; margin-bottom: 2px; }
      .su-user { min-width: 0; }
      .su-who { flex: 1 1 auto; }
      .status-badge.su-badge-phone { display: inline-flex !important; }
      .su-status-cell { display: none !important; }
      .su-contact, .su-screens { min-width: 0; }
      .su-login { white-space: normal; }
    }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class SubUsersPage {
  private readonly http = inject(HttpClient);
  private readonly toast = inject(ToastService);

  protected readonly accountType = signal('Sub-User');
  /** "Operation Admins", "Sub-Users": the server's account type made plural (the Admin can change the wording). */
  protected readonly typePlural = computed(() => t('staff.subUsers.typePlural', '{type}s', { type: this.accountType() }));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.typePlural() }));
  /** "an operation admin", "a sub-user" (the pop-up's note). */
  protected readonly whoWord = computed(() => {
    const type = this.accountType().toLowerCase();
    return /^[aeiou]/i.test(type) ? t('staff.subUsers.whoAn', 'an {type}', { type }) : t('staff.subUsers.whoA', 'a {type}', { type });
  });
  protected readonly options = signal<PermissionOption[]>([]);
  protected readonly stateOptions = signal<MultiSelectOption[]>([]);
  /** Master Admin only: null for an agency's sub-users. */
  protected readonly agencyOptions = signal<MultiSelectOption[] | null>(null);
  protected readonly scopeNote = computed(() =>
    this.agencyOptions()
      ? this.consultancy
        ? t('staff.subUsers.form.consultancy.scopeNoteOperation', 'The operation admin sees only the units whose plant is in these states and the handholding cases of these consultant organisations, on every screen given.')
        : t('staff.subUsers.form.scopeNoteOperation', 'The operation admin sees only the units whose plant is in these states and the applications these agencies assess, on every screen given.')
      : t('staff.subUsers.form.scopeNote', 'The sub-user sees only your units whose plant is in these states, on every screen given.'));
  /** The scope's second list: assessment agencies, or (Consultancy) consultant organisations. */
  protected agenciesLabel(): string {
    return this.consultancy ? t('staff.subUsers.form.consultancy.agenciesLabel', 'Consultant organisations') : t('staff.subUsers.form.agenciesLabel', 'Assessment agencies');
  }
  protected readonly users = signal<SubUser[]>([]);
  /** The tile chosen above the list. */
  protected readonly status = signal<'all' | LoginStatus>('all');
  /** The search box above the list (any column). */
  protected readonly search = signal('');
  /** The tiles: all, active, locked and blocked logins; a click filters by status. */
  protected readonly tiles = computed<ListCount[]>(() => {
    const count = (s: LoginStatus) => this.users().filter((u) => this.statusOf(u) === s).length;
    return [
      { key: 'all', label: t('staff.subUsers.count.all', 'All logins'), value: this.users().length },
      { key: 'active', label: t('staff.subUsers.count.active', 'Active'), value: count('active'), tone: 'good' },
      { key: 'locked', label: t('staff.subUsers.count.locked', 'Locked'), value: count('locked'), tone: 'warn' },
      { key: 'blocked', label: t('staff.subUsers.count.blocked', 'Blocked'), value: count('blocked'), tone: 'bad' },
    ];
  });
  /** "3 of 5 logins", "1 of 5 logins · locked only". */
  protected readonly showingText = computed(() => {
    const v = { shown: this.view.total(), total: this.users().length };
    switch (this.status()) {
      case 'active': return t('staff.subUsers.showingActive', '{shown} of {total} logins · active only', v);
      case 'locked': return t('staff.subUsers.showingLocked', '{shown} of {total} logins · locked only', v);
      case 'blocked': return t('staff.subUsers.showingBlocked', '{shown} of {total} logins · blocked only', v);
      default: return t('staff.subUsers.showing', '{shown} of {total} logins', v);
    }
  });
  /** Paged as the old list pages (10 per page, back to page 1 when the list changes). */
  protected readonly view = new PagedView(() =>
    searchRows(this.users().filter((u) => this.status() === 'all' || this.statusOf(u) === this.status()), this.search()),
  );
  protected readonly form = signal<SubUserForm | null>(null);
  protected readonly editing = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly formError = signal('');
  /**
   * 2026-11-21 (Assessment Agency UI audit, item 6): each field's problem, checked in the browser before the form is sent (as
   * the server checks them: name, e-mail, optional 10-digit mobile, at least one screen), so every wrong field is marked.
   */
  protected readonly fieldErrors = signal<Partial<Record<'userName' | 'email' | 'mobileNo' | 'permissions', string>>>({});
  protected readonly consultancy = inject(STAFF_SYSTEM) === 'consultancy';
  /** The row menu action waiting for its confirmation, and the server's refusal shown in it. */
  protected readonly pending = signal<PendingAction | null>(null);
  protected readonly pendingError = signal('');

  constructor() {
    // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the tab names the page ("ZED | Operation Admins").
    const title = inject(Title);
    effect(() => title.setTitle(`ZED | ${this.typePlural()}`));
    void this.load();
  }

  protected label(key: string): string {
    const p = this.options().find((o) => o.key === key);
    return p ? this.screenName(p) : key;
  }

  /**
   * A screen's name as the owner reads it, editable in Admin → Texts and worded for this portal (2026-11-21, audit item 6: the
   * main portal's agency read "Assessors / consult…"); a screen added later on the server keeps the server's name.
   */
  protected screenName(p: PermissionOption): string {
    const c = this.consultancy;
    switch (p.key) {
      case 'assessors': return c ? t('staff.subUsers.screen.consultants', 'Consultants') : t('staff.subUsers.screen.assessors', 'Assessors');
      case 'sa-allotment': return c ? t('staff.subUsers.screen.consultancyAllotment', 'Consultancy allotment') : t('staff.subUsers.screen.siteAllotment', 'Site assessment allotment');
      case 'da-allotment': return t('staff.subUsers.screen.desktopAllotment', 'Desktop allotment');
      case 'users': return c ? t('staff.subUsers.screen.consultantOrganisations', 'Consultant organisations and their consultants') : t('staff.subUsers.screen.agencies', 'Agencies and their assessors');
      case 'monitoring': return t('staff.subUsers.screen.monitoring', 'Monitoring');
      case 'results': return c ? t('staff.subUsers.screen.consultancyCompleted', 'Consultancy completed') : t('staff.subUsers.screen.results', 'Completed and rejected');
      case 'reports': return t('staff.subUsers.screen.reports', 'Reports');
      case 'payments': return t('staff.subUsers.screen.payments', 'Payment Received');
      case 'allot': return c ? t('staff.subUsers.screen.allotConsultancy', 'Allot consultancy') : t('staff.subUsers.screen.allot', 'Allotment');
      case 'password-reset': return t('staff.subUsers.screen.passwordReset', 'Password Reset Link');
      default: return p.label;
    }
  }

  /** Every screen there is to give (shown as one chip). */
  protected hasAll(u: SubUser): boolean {
    return this.options().length > 1 && this.options().every((p) => u.permissions.includes(p.key));
  }

  /** The screens behind "+N more" (its tooltip). */
  protected moreLabels(u: SubUser): string {
    return u.permissions.slice(4).map((p) => this.label(p)).join(', ');
  }

  protected allKeys(): string[] {
    return this.options().map((p) => p.key);
  }

  protected statusOf(u: SubUser): LoginStatus {
    return !u.isActive ? 'blocked' : u.locked ? 'locked' : 'active';
  }

  protected statusLabel(u: SubUser): string {
    return u.isActive ? (u.locked ? t('staff.subUsers.status.locked', 'Locked') : t('staff.subUsers.status.active', 'Active')) : t('staff.subUsers.status.blocked', 'Blocked');
  }

  protected mobileOf(u: SubUser): string {
    return plain(u.mobileNo);
  }

  protected mailOf(u: SubUser): string {
    return plain(u.email);
  }

  /** Two letters of the name (or of the user ID) for the round badge. */
  protected initials(u: SubUser): string {
    // 2026-11-22: each word's first letter or digit ("Surveillance OA (test)" gave "S(").
    const words = (u.userName ?? '').trim().split(/\s+/).map((w) => w.replace(/[^A-Za-z0-9]/g, '')).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? u.userId).slice(0, 2);
    return letters.toUpperCase();
  }

  protected pickStatus(key: string | undefined): void {
    this.status.set(key === 'active' || key === 'locked' || key === 'blocked' ? key : 'all');
  }

  protected clearFilters(): void {
    this.status.set('all');
    this.search.set('');
  }

  /**
   * The row menu: a new password (on a locked login "Unlock": there is no separate unlock, the new password lifts the lock),
   * then Block (red) or Unblock.
   */
  protected menuOf(u: SubUser): RowMenuItem[] {
    return [
      this.statusOf(u) === 'locked'
        ? { key: 'reset', label: t('staff.subUsers.menu.unlock', 'Unlock (send new password)'), icon: 'unlock' }
        : { key: 'reset', label: t('staff.subUsers.menu.reset', 'Send new password'), icon: 'mail' },
      u.isActive ? { key: 'block', label: t('staff.subUsers.menu.block', 'Block login'), icon: 'lock', danger: true }
        : { key: 'unblock', label: t('staff.subUsers.menu.unblock', 'Unblock login'), icon: 'refresh' },
    ];
  }

  protected picked(u: SubUser, key: string): void {
    const v = { name: u.userName, id: u.userId, email: plain(u.email) || t('staff.subUsers.toast.sentToFallback', 'the registered e-mail address') };
    let ask: ConfirmAsk;
    if (key === 'reset' && this.statusOf(u) === 'locked') {
      ask = {
        title: t('staff.subUsers.unlock.title', 'Unlock {name}?', v),
        message: t('staff.subUsers.unlock.message', 'The lock is lifted at once and {name} ({id}) gets a new password by e-mail at {email}. The current password stops working.', v),
        confirmLabel: t('staff.subUsers.unlock.confirmButton', 'Unlock and send password'),
      };
    } else if (key === 'reset') {
      ask = {
        title: t('staff.subUsers.reset.title', 'Send a new password?'),
        message: t('staff.subUsers.reset.message', '{name} ({id}) gets a new password by e-mail at {email}. The current password stops working at once.', v),
        confirmLabel: t('staff.subUsers.reset.confirmButton', 'Send new password'),
      };
    } else if (key === 'block') {
      ask = {
        title: t('staff.subUsers.block.title', 'Block {name}?', v),
        message: t('staff.subUsers.block.message', '{name} ({id}) cannot sign in until you unblock the login. Its screens and scope are kept; nothing is deleted.', v),
        confirmLabel: t('staff.subUsers.block.confirmButton', 'Block login'),
        danger: true,
      };
    } else if (key === 'unblock') {
      ask = {
        title: t('staff.subUsers.unblock.title', 'Unblock {name}?', v),
        message: t('staff.subUsers.unblock.message', '{name} ({id}) can sign in again with the current password, on the same screens.', v),
        confirmLabel: t('staff.subUsers.unblock.confirmButton', 'Unblock login'),
      };
    } else {
      return;
    }
    this.pendingError.set('');
    this.pending.set({ key, user: u, ask });
  }

  /** The confirmed row action: a new password (reset-password), or Block / Unblock (the same update as Edit's Active switch). */
  protected async confirmed(p: PendingAction): Promise<void> {
    const u = p.user;
    const id = encodeURIComponent(u.userId);
    this.busy.set(true);
    this.error.set('');
    try {
      if (p.key === 'reset') {
        await firstValueFrom(this.http.post<MessageResponse>(`${API}/${id}/reset-password`, null));
        this.toast.success(this.statusOf(u) === 'locked' ? t('staff.subUsers.toast.unlocked', 'Login unlocked') : t('staff.subUsers.toast.passwordSent', 'New password sent'),
          t('staff.subUsers.toast.sentTo', 'New password e-mailed to {to}', { to: plain(u.email) || t('staff.subUsers.toast.sentToFallback', 'the registered e-mail address') }));
      } else {
        const body: SubUserForm = {
          userName: u.userName, email: u.email ?? '', mobileNo: u.mobileNo ?? '', permissions: [...u.permissions], isActive: p.key === 'unblock',
          states: [...(u.states ?? [])], agencies: this.agencyOptions() ? [...(u.agencies ?? [])] : [],
        };
        await firstValueFrom(this.http.put<MessageResponse>(`${API}/${id}`, body));
        const v = { name: u.userName, id: u.userId };
        if (p.key === 'block') this.toast.success(t('staff.subUsers.toast.blocked', 'Login blocked'), t('staff.subUsers.toast.blockedText', '{name} ({id}) can no longer sign in.', v));
        else this.toast.success(t('staff.subUsers.toast.unblocked', 'Login unblocked'), t('staff.subUsers.toast.unblockedText', '{name} ({id}) can sign in again.', v));
      }
      this.pending.set(null);
      await this.load();
    } catch (err) {
      this.pendingError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected add(): void {
    this.editing.set(null);
    this.formError.set('');
    this.fieldErrors.set({});
    this.form.set({ userName: '', email: '', mobileNo: '', permissions: [], isActive: true, states: [], agencies: [] });
  }

  protected edit(u: SubUser): void {
    this.editing.set(u.userId);
    this.formError.set('');
    this.fieldErrors.set({});
    this.form.set({
      userName: u.userName, email: u.email ?? '', mobileNo: u.mobileNo ?? '', permissions: [...u.permissions], isActive: u.isActive,
      states: [...(u.states ?? [])], agencies: [...(u.agencies ?? [])],
    });
  }

  /** The list's Scope chip: "2 states · 1 agency", "All states". */
  protected scopeText(u: SubUser): string {
    const s = u.states?.length ?? 0;
    const a = u.agencies?.length ?? 0;
    const states = s === 0 ? t('staff.subUsers.row.allStates', 'All states') : s === 1 ? this.stateName(u.states![0]) : t('staff.subUsers.row.statesCount', '{count} states', { count: s });
    if (!this.agencyOptions()) return states;
    const agencies = this.consultancy
      ? a === 0 ? t('staff.subUsers.row.consultancy.allAgencies', 'all consultant organisations') : a === 1 ? t('staff.subUsers.row.consultancy.agencyCount', '{count} consultant organisation', { count: a })
        : t('staff.subUsers.row.consultancy.agenciesCount', '{count} consultant organisations', { count: a })
      : a === 0 ? t('staff.subUsers.row.allAgencies', 'all agencies') : a === 1 ? t('staff.subUsers.row.agencyCount', '{count} agency', { count: a })
        : t('staff.subUsers.row.agenciesCount', '{count} agencies', { count: a });
    return `${states} · ${agencies}`;
  }

  private stateName(code: string): string {
    return this.stateOptions().find((o) => o.value === code)?.label ?? code;
  }

  protected close(): void {
    this.form.set(null);
    this.editing.set(null);
  }

  protected patch<K extends keyof SubUserForm>(key: K, value: SubUserForm[K]): void {
    this.form.update((f) => (f ? { ...f, [key]: value } : f));
    // A corrected field loses its mark at once (the others keep theirs until the next Add / Save).
    if (key in this.fieldErrors()) this.fieldErrors.update((e) => { const next = { ...e }; delete next[key as keyof typeof e]; return next; });
  }

  /** The form's problems, field by field (empty when it can be sent). */
  private validate(f: SubUserForm): Partial<Record<'userName' | 'email' | 'mobileNo' | 'permissions', string>> {
    const errors: Partial<Record<'userName' | 'email' | 'mobileNo' | 'permissions', string>> = {};
    if (!f.userName.trim()) errors.userName = t('staff.subUsers.form.nameRequired', 'Please enter the name.');
    if (!f.email.trim()) errors.email = t('staff.subUsers.form.emailRequired', 'Please enter the e-mail address.');
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email.trim())) errors.email = t('staff.subUsers.form.emailInvalid', 'Please enter a valid e-mail address.');
    if (f.mobileNo.trim() && !/^\d{10}$/.test(f.mobileNo.trim())) errors.mobileNo = t('staff.subUsers.form.mobileInvalid', 'Please enter a valid 10 digit mobile number.');
    if (!f.permissions.length) errors.permissions = t('staff.subUsers.form.screensRequired', 'Please select at least one screen.');
    return errors;
  }

  protected toggle(key: string): void {
    this.form.update((f) =>
      f ? { ...f, permissions: f.permissions.includes(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key] } : f,
    );
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const id = this.editing();
    this.error.set('');
    this.formError.set('');
    const errors = this.validate(f);
    this.fieldErrors.set(errors);
    if (Object.keys(errors).length) {
      this.formError.set(t('staff.subUsers.form.fixFields', 'Please correct the marked fields.'));
      const first = errors.userName ? 'sub-name' : errors.email ? 'sub-email' : errors.mobileNo ? 'sub-mobile' : null;
      if (first) document.getElementById(first)?.focus();
      return;
    }
    this.busy.set(true);
    try {
      // 2026-11-25: no agency list where the scope has none (the Incentives Master Admin's Operation Admins: an older saved list is cleared).
      const body: SubUserForm = this.agencyOptions() ? f : { ...f, agencies: [] };
      const r = await firstValueFrom(id ? this.http.put<MessageResponse>(`${API}/${encodeURIComponent(id)}`, body) : this.http.post<MessageResponse>(API, body));
      this.close();
      // 2026-11-21 (UI audit): the success message once the list is loaded again (the loading veil hid it while the list
      // reloaded), and for 8 seconds; with the user's name when the API sends no message.
      await this.load();
      this.toast.success(id ? t('staff.subUsers.toast.updated', '{type} updated', { type: this.accountType() })
        : t('staff.subUsers.toast.added', '{type} added', { type: this.accountType() }), r?.message || f.userName, 8000);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await firstValueFrom(this.http.get<SubUsersResponse>(API));
      this.accountType.set(r.accountType);
      this.options.set(r.permissions);
      this.stateOptions.set((r.states ?? []).map((o) => ({ value: o.code, label: o.name })));
      this.agencyOptions.set(r.agencies ? r.agencies.map((o) => ({ value: o.code, label: o.name })) : null);
      this.users.set(r.users);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
