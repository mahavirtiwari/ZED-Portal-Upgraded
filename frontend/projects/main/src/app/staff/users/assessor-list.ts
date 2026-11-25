import { ContentService } from '../../content/content-text';
import { TextPipe, t } from '../../content/page-text';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ReasonAsk, ReasonDialog } from './reason-dialog';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { LABELS } from '../../portal-labels';
import { STAFF_SYSTEM } from '../staff-menu';
import { AssessorRow, SECTOR_ACTIVITIES, SectorActivity, UsersApi } from './users.api';
import { ClientPager, PagerComponent } from '../pager';
import { ScopeItem } from './assessor-scope';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ListCount, ListCounts } from '../list-counts';
import { ChipFilter, FilterChip } from '../chip-filter';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { ToastService } from '../toast';
import { plain, resetLinkAsk, sentTo } from './user-display';
import { HistoryItem, UserHistoryPanel, blockHistoryItems } from './history-panel';
import { PhoneChip, PhoneSummary, hasPhone, loadPhones, phonesById, releaseMobileAsk, releasePhone } from './assessor-phone';
import { canSeeAssessorMobile } from './assessor-mobile';
import { LevelCounts } from './level-counts';

/** Which assessors the list shows: the status tiles, the type chips and the sector type / agency drop-downs. */
type StatusFilter = 'all' | 'active' | 'blocked';
type SectorFilter = '' | SectorActivity | 'none';

/** Two letters for the round badge beside a name (first and last word). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return '?';
  return (words[0][0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
}

/** The stored assessor / user type as people read it (BronzeAssessor → Bronze Assessor). */
export function assessorTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case 'BronzeAssessor': return t('staff.assessors.type.bronzeAssessor', 'Bronze Assessor');
    case 'TechnicalExpert': return t('staff.assessors.type.technicalExpert', 'Technical Expert');
    default: return type ?? '';
  }
}

/** The levels of an assessor as medals (Bronze, Silver, Gold, ZED-X) with the modes beneath ("Desktop · Onsite"). */
export interface LevelMedals {
  items: { code: string; title: string }[];
  /** 2026-11-22: the level names as text ("Bronze · Silver"; the medal icons were removed). */
  names: string;
  modes: string;
  /** "Bronze: Desktop; Silver: Desktop, Onsite" for screen readers. */
  aria: string;
}

/** 2026-11-17 (approved staff-04): "levels show as medal icons with the modes beneath". */
export function levelMedals(v: unknown): LevelMedals {
  const list = (Array.isArray(v) ? (v as ScopeItem[]) : []).filter((x) => x.modes?.length);
  const order = ['Desktop', 'Remote', 'Onsite'];
  const modes = new Set(list.flatMap((x) => x.modes));
  const items = list.map((x) => {
    const name = x.level === 'ZEDX' ? 'ZED-X' : x.level;
    const code = x.level.toLowerCase().replace(/[^a-z]/g, '');
    return { code: ['bronze', 'silver', 'gold', 'zedx'].includes(code) ? code : 'other', title: `${name}: ${x.modes.join(', ')}`, name };
  });
  return {
    items: items.map(({ code, title }) => ({ code, title })),
    names: items.map((i) => i.name).join(' · '),
    modes: [...order.filter((m) => modes.has(m)), ...[...modes].filter((m) => !order.includes(m))].join(' · '),
    aria: items.map((i) => i.title).join('; '),
  };
}

const BLOCK_NOTE_KEY = 'staff.users.assessorBlock.note';

/**
 * The block notice of the Admin's Texts (Admin → Texts, `staff.users.assessorBlock.note`) as plain text for the block
 * confirmation; the standard wording until the texts arrive, '' when the Admin hid it.
 */
export function assessorBlockNote(content: ContentService, consultancy: boolean): string {
  const t = content.text(BLOCK_NOTE_KEY);
  if (t && !t.enabled) return '';
  if (t?.html) {
    const plain = typeof DOMParser !== 'undefined'
      ? new DOMParser().parseFromString(t.html, 'text/html').body.textContent ?? ''
      : t.html.replace(/<[^>]*>/g, ' ');
    return plain.replace(/\s+/g, ' ').trim();
  }
  return `The login can't sign in on the web or the app, and can't be allotted or carry out any ${consultancy ? 'consultancy' : 'assessment'} until unblocked.`;
}

/**
 * The "Block …?" confirmation of an assessor / consultant (popup-03): what blocking does, the open assessments it leaves
 * (`assessorOpenAssessments`; "not known" when the count could not be read) and a required reason (kept in the history and
 * e-mailed; the server always sends the mail).
 */
export function assessorBlockAsk(name: string, userId: string, open: number | null, note: string, consultancy: boolean, reAllotBy: string | null): ConfirmAsk {
  // Whole sentences for assessor / consultant and one / many (plural forms differ); the re-allot sentence is the second one.
  // `reAllotBy`: the agency word ("agency", "organisation") of whoever re-allots, null when it is the reader ("You").
  const reAllot = open === 1
    ? (reAllotBy === null ? t('staff.assessors.block.reAllotYouIt', 'You will need to re-allot it.') : t('staff.assessors.block.reAllotIt', 'The {agency} will need to re-allot it.', { agency: reAllotBy }))
    : (reAllotBy === null ? t('staff.assessors.block.reAllotYouThem', 'You will need to re-allot them.') : t('staff.assessors.block.reAllotThem', 'The {agency} will need to re-allot them.', { agency: reAllotBy }));
  const openLine = consultancy
    ? (open === null ? t('staff.assessors.block.consultant.openUnknown', 'Open cases allotted to this consultant: not known.')
      : open === 0 ? t('staff.assessors.block.consultant.openNone', 'No case allotted to this consultant is open.')
      : (open === 1 ? t('staff.assessors.block.consultant.openOne', '{count} case allotted to this consultant is still open.', { count: open })
        : t('staff.assessors.block.consultant.openMany', '{count} cases allotted to this consultant are still open.', { count: open })) + ' ' + reAllot)
    : (open === null ? t('staff.assessors.block.assessor.openUnknown', 'Open assessments allotted to this assessor: not known.')
      : open === 0 ? t('staff.assessors.block.assessor.openNone', 'No assessment allotted to this assessor is open.')
      : (open === 1 ? t('staff.assessors.block.assessor.openOne', '{count} assessment allotted to this assessor is still open.', { count: open })
        : t('staff.assessors.block.assessor.openMany', '{count} assessments allotted to this assessor are still open.', { count: open })) + ' ' + reAllot);
  // 2026-11-18 (the user: staff pages 'not aligned with SVG files'): popup-03: a lock tile, the ID under the title, the effects
  // as red bullets.
  return {
    title: t('staff.assessors.block.title', 'Block {name}?', { name: name || userId }),
    subtitle: userId,
    icon: 'lock',
    points: [note, openLine, consultancy
      ? t('staff.assessors.block.consultant.point3', 'Nothing is deleted; the reason is kept in the history and e-mailed to the consultant.')
      : t('staff.assessors.block.assessor.point3', 'Nothing is deleted; the reason is kept in the history and e-mailed to the assessor.')].filter(Boolean),
    confirmLabel: consultancy ? t('staff.assessors.block.consultant.confirmButton', 'Block consultant') : t('staff.assessors.block.assessor.confirmButton', 'Block assessor'),
    danger: true,
    reason: {
      label: t('staff.assessors.block.reasonLabel', 'Reason for blocking'),
      placeholder: t('staff.assessors.block.reasonPlaceholder', 'Shown in the history and e-mailed'), maxLength: 2000,
      requiredMessage: t('staff.assessors.block.reasonRequired', 'Please enter the reason for blocking.'),
    },
  };
}

/**
 * MasterAdmin list of all assessors (optionally of one agency, `?agencyId=`, and verification type, `?type=DA|SA|FA`).
 * Port of Views/User/AssessorList.cshtml: search, page size and paging in the page. 2026-11-17 (approved staff-04): the
 * shared head and counts (all, active, blocked; a click filters), the search with the sector type and agency drop-downs
 * (and type chips when the list has more than one type), a row per assessor with its levels as medals, the sector, the
 * contact in full (2026-11-18, the user: never masked; no PAN), the agency and status, View plus a row menu (Send reset link, View history, Block / Unblock)
 * whose actions confirm first and end with a toast; the block history opens in the side panel. Cards on phones.
 */
@Component({
  selector: 'zed-staff-assessor-list',
  imports: [
    FormsModule, RouterLink, PagerComponent, DatePipe, PageHead, ReasonDialog, ListCounts, ChipFilter, RowMenu, ConfirmDialog, UserHistoryPanel, PhoneChip, LevelCounts, TextPipe,
  ],
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="agencyId ? ('{noun} of {agency}' | t: 'staff.assessors.titleOfAgency' : { noun: noun(), agency: agencyId }) : noun()" />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <zed-list-counts [counts]="tiles()" [selected]="status()" [label]="'{noun} by status' | t: 'staff.assessors.countsLabel' : { noun: noun() }" (pick)="setStatus($any($event.key))" />

    <div class="zed-card as-bar">
      <label class="as-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
        <input type="search" class="form-control" maxlength="50" [placeholder]="consultancy ? ('Search ID, name, mobile, e-mail or organisation' | t: 'staff.assessors.search.consultancy.placeholder') : ('Search ID, name, mobile, e-mail or agency' | t: 'staff.assessors.search.placeholder')" [attr.aria-label]="consultancy ? ('Search consultants' | t: 'staff.assessors.search.consultancy.aria') : ('Search assessors' | t: 'staff.assessors.search.aria')"
               [ngModel]="search()" (ngModelChange)="pager.setSearch($event)" />
      </label>
      @if (!consultancy) {
        <select class="form-select as-select" [attr.aria-label]="'Sector type' | t: 'staff.assessors.filter.sector'" [ngModel]="sector()" (ngModelChange)="setSector($event)">
          <option value="">{{ 'All sector types' | t: 'staff.assessors.filter.allSectors' }}</option>
          @for (s of sectorOptions(); track s.value) { <option [value]="s.value">{{ s.label }} ({{ s.count }})</option> }
        </select>
      }
      @if (agencies().length > 1) {
        <select class="form-select as-select as-agency" [attr.aria-label]="labels.agency" [ngModel]="agency()" (ngModelChange)="setAgency($event)">
          <option value="">{{ 'All {agencies}' | t: 'staff.assessors.filter.allAgencies' : { agencies: labels.agencies.toLowerCase() } }}</option>
          @for (a of agencies(); track a.id) { <option [value]="a.id">{{ a.name }} ({{ a.count }})</option> }
        </select>
      }
      <span class="as-showing">{{ '{shown} of {total} {noun}' | t: 'staff.assessors.showing' : { shown: pager.total(), total: rows().length, noun: noun().toLowerCase() } }}</span>
      @if (!consultancy && types().length > 1) {
        <zed-chip-filter class="as-types" [label]="'Type' | t: 'staff.assessors.filter.type'" [chips]="typeChips()" [value]="level()" (valueChange)="setLevel($event)" />
      }
    </div>

    <div class="zed-card as-list">
      <div class="table-responsive">
        <table class="table table-zed as-table" [class.is-main]="!consultancy">
          <thead>
            <tr>
              @if (consultancy) {
                <!-- ZEDCS_CONSULTANCY Frontend/User/AssessorList.cshtml -->
                <th class="text-center" style="width: 56px">{{ 'S.No' | t: 'staff.assessors.column.sno' }}</th>
                <th>{{ 'Consultant Details' | t: 'staff.assessors.column.consultant' }}</th>
                <th>{{ 'Consultant Organisation Details' | t: 'staff.assessors.column.organisation' }}</th>
                <th class="text-center">{{ 'No. Of Consulting Completed' | t: 'staff.assessors.column.completed' }}</th>
                <th class="text-center">{{ 'Status' | t: 'staff.assessors.column.status' }}</th>
                <th class="text-end">{{ 'Action(s)' | t: 'staff.assessors.column.consultancyActions' }}</th>
              } @else {
                <th class="c-who">{{ 'Assessor' | t: 'staff.assessors.column.assessor' }}</th>
                <th class="c-lv">{{ 'Levels and modes' | t: 'staff.assessors.column.levels' }}</th>
                <th class="c-alloc">{{ 'Allocated' | t: 'staff.assessors.column.allocated' }}</th>
                <th class="c-sec">{{ 'Sector' | t: 'staff.assessors.column.sector' }}</th>
                <th class="c-con">{{ 'Contact' | t: 'staff.assessors.column.contact' }}</th>
                <th class="c-ag">{{ 'Agency' | t: 'staff.assessors.column.agency' }}</th>
                <th class="text-center c-st">{{ 'Status' | t: 'staff.assessors.column.status' }}</th>
                <th class="text-end c-act">{{ 'Actions' | t: 'staff.assessors.column.actions' }}</th>
              }
            </tr>
          </thead>
          <tbody>
            @for (s of page(); track s.UserId) {
              <tr [class.is-blocked]="!s.IsActive">
                @if (consultancy) { <td class="text-center as-sno">{{ s.RowNumber }}</td> }
                <td class="as-person">
                  <div class="as-user">
                    <span class="as-avatar" aria-hidden="true">{{ initials(s.UserName) }}</span>
                    <span class="as-who"><span class="as-name">{{ s.UserName }}</span><span class="as-id">{{ s.UserId }}</span></span>
                  </div>
                  @if (consultancy) {
                    <div class="as-contact as-under">
                      <span [class.no-mobile]="!s.MobileNo">{{ s.MobileNo ? mobile(s.MobileNo) : ('Mobile not saved' | t: 'staff.assessors.row.noMobile') }}</span>
                      @if (s.Email) { <span class="as-sub" [title]="s.Email">{{ email(s.Email) }}</span> }
                    </div>
                  }
                </td>
                @if (!consultancy) {
                  <td class="as-levels" [attr.data-label]="'Levels and modes' | t: 'staff.assessors.column.levels'">
                    @let m = medals(s.Assessments);
                    @if (m.items.length) {
                      <span class="lv-names" [title]="m.aria">{{ m.names }}</span>
                      <span class="as-sub">{{ m.modes }}</span>
                    } @else {
                      <span class="as-type">{{ typeLabel(s.AssessorType) }}</span>
                    }
                  </td>
                  <!-- 2026-11-18 (the user): assessments allocated per certification level (desktop, lead or co-assessor). -->
                  <td [attr.data-label]="'Allocated' | t: 'staff.assessors.column.allocated'"><zed-level-counts [counts]="s.LevelCounts" [label]="'Assessments allocated to {name}' | t: 'staff.assessors.row.allocatedAria' : { name: s.UserName || s.UserId }" /></td>
                  <td [attr.data-label]="'Sector' | t: 'staff.assessors.column.sector'"><span class="as-pill" [class.is-none]="!s.SectorActivity">{{ s.SectorActivity || ('Not set' | t: 'staff.assessors.row.sectorNotSet') }}</span></td>
                  <!-- 2026-11-18 (the user: staff pages 'not aligned with SVG files'): the flex column on an inner div; a flex td is
                       no table cell, so the browser merged Contact and Agency and every later column moved one header left. -->
                  <td class="as-contact-td" [attr.data-label]="'Contact' | t: 'staff.assessors.column.contact'">
                    <div class="as-contact">
                      <span [class.no-mobile]="!s.MobileNo">{{ s.MobileNo ? mobile(s.MobileNo) : ('Mobile not saved' | t: 'staff.assessors.row.noMobile') }}</span>
                      @if (s.Email) { <span class="as-sub" [title]="s.Email">{{ email(s.Email) }}</span> }
                    </div>
                  </td>
                }
                <td class="as-agency-td" [attr.data-label]="consultancy ? ('Consultant Organisation' | t: 'staff.assessors.row.organisationLabel') : labels.agency">
                  <div class="as-agency">
                    <span class="as-agency-name">{{ s.AgencyUserName }}</span>
                    <span class="as-id">{{ s.AgencyUserId }}</span>
                  </div>
                </td>
                @if (consultancy) {
                  <!-- 2026-11-21 (UI audit): the consultant's milestones completed (the live page printed a fixed 0), and those in progress. -->
                  <td class="text-center as-milestones" [attr.data-label]="'No. Of Consulting Completed' | t: 'staff.assessors.column.completed'">
                    @let mc = milestonesOf(s);
                    <div>{{ 'Milestone 1:' | t: 'staff.assessors.row.milestone1' }} <strong>{{ mc.m1 }}</strong></div><div>{{ 'Milestone 2:' | t: 'staff.assessors.row.milestone2' }} <strong>{{ mc.m2 }}</strong></div><div>{{ 'Milestone 3:' | t: 'staff.assessors.row.milestone3' }} <strong>{{ mc.m3 }}</strong></div>
                    @if (mc.inProgress) { <small class="as-sub" data-in-progress>{{ '{count} in progress' | t: 'staff.assessors.row.milestonesInProgress' : { count: mc.inProgress } }}</small> }
                  </td>
                }
                <td class="text-center as-status" [attr.data-label]="'Status' | t: 'staff.assessors.column.status'">
                  <!-- 2026-11-21 (UI audit): one word with the status tiles (Active / Blocked), not the procedure's ACTIVE / IN-ACTIVE. -->
                  <span class="status-badge" [class.is-active]="s.IsActive" [class.is-rejected]="!s.IsActive">{{ s.IsActive ? ('Active' | t: 'staff.assessors.count.active') : ('Blocked' | t: 'staff.assessors.count.blocked') }}</span>
                  <!-- 2026-11-18: the registered phone of the app (one phone per user), for the Admin and the Master Admin. -->
                  @if (showsPhone) { <zed-phone-chip class="as-phone" [phone]="phoneOf(s)" /> }
                  @if (!s.IsActive && (s.BlockReason || s.BlockedOn)) {
                    <small class="as-block-note" data-block-note>
                      @if (s.BlockReason) { “{{ s.BlockReason }}” }
                      @if (s.BlockedOn) { <span class="text-nowrap">· {{ s.BlockedOn | date: 'dd MMM yyyy' }}</span> }
                    </small>
                  }
                </td>
                <td class="as-actions text-end">
                  <div class="as-btns">
                    <a [routerLink]="['/staff/users/assessors', s.UserId]" class="btn btn-outline-primary">{{ 'View' | t: 'staff.assessors.row.viewButton' }}</a>
                    <zed-row-menu [items]="menuOf(s)" [label]="'More actions for {name}' | t: 'staff.assessors.row.menuAria' : { name: s.UserName || s.UserId }" (picked)="pick($event, s)" />
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row">
                <td [attr.colspan]="consultancy ? 6 : 8" style="padding: 0">
                  @if (rows().length) {
                    <div class="no-data">
                      {{ consultancy ? ('No consultant matches the filters.' | t: 'staff.assessors.noMatchConsultant') : ('No {assessor} matches the filters.' | t: 'staff.assessors.noMatch' : { assessor: labels.assessor.toLowerCase() }) }}
                      <button type="button" class="btn btn-link p-0 ms-1" (click)="clearFilters()">{{ 'Show all' | t: 'staff.assessors.showAllButton' }}</button>
                    </div>
                  } @else {
                    <div class="no-data">{{ 'No Data Entered' | t: 'staff.assessors.empty' }}</div>
                  }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>

    @if (resetFor(); as r) {
      <zed-confirm-dialog [ask]="r.ask" [busy]="busy()" [failed]="dialogError()" (confirmed)="sendReset(r.row)" (cancel)="closeDialogs()" />
    }
    @if (blockFor(); as b) {
      <zed-confirm-dialog [ask]="b.ask" [busy]="busy()" [failed]="dialogError()" inputId="as-block-reason" (confirmed)="block(b.row, $event)" (cancel)="closeDialogs()" />
    }
    @if (releaseFor(); as m) {
      <zed-confirm-dialog [ask]="m.ask" [busy]="busy()" [failed]="dialogError()" inputId="as-release-reason" (confirmed)="releaseMobile(m.row, $event)" (cancel)="closeDialogs()" />
    }
    @if (reasonAsk(); as r) {
      <zed-reason-dialog [ask]="r" [busy]="busy()" [failed]="dialogError()" (confirmed)="unblockWithReason(r, $event)" (cancel)="closeDialogs()" />
    }
    @if (historyFor(); as h) {
      <zed-user-history [subtitle]="(h.row.UserName || h.row.UserId) + ' · ' + h.row.UserId" [items]="h.items" [error]="h.error"
                        [fileName]="'history-' + h.row.UserId" (closed)="historyFor.set(null)" />
    }
    @if (loading()) {
      <div class="loadingdiv" role="status" aria-live="polite"><div class="spinner-border text-light"></div><span class="visually-hidden">{{ 'Loading…' | t: 'staff.assessors.loading' }}</span></div>
    }
  `,
  styles: `
    /* 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-04: 380px search, 210 / 250px drop-downs, fixed
       columns that line up with their heads, the skin's avatar tint, pills and buttons. */
    .as-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px 12px; min-height: 62px; padding: 12px 16px; margin-bottom: 16px; }
    .as-search { position: relative; flex: 0 1 380px; margin: 0; }
    .as-search svg { position: absolute; left: 12px; top: 50%; width: 16px; height: 16px; transform: translateY(-50%); fill: none; stroke: #6f8487; stroke-width: 2; }
    .as-search input { height: 38px; padding-left: 36px; border-radius: 9px; background-image: none; }
    .as-select { flex: 0 1 210px; width: auto; min-width: 0; height: 38px; border-radius: 9px; }
    select.as-agency { flex-basis: 250px; }
    .as-showing { margin-left: auto; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .as-types { flex-basis: 100%; }

    .as-list { padding: 0; overflow: hidden; }
    .as-table { margin: 0; }
    /* The assessor's name has its own width: with only the other columns sized it got what was left (64px on a laptop). */
    .as-table.is-main { min-width: 1440px; table-layout: fixed; }
    .as-table .c-who { width: 264px; }
    .as-table .c-lv { width: 230px; }
    .as-table .c-alloc { width: 190px; }
    .as-table .c-sec { width: 140px; }
    .as-table .c-con { width: 190px; }
    .as-table .c-ag { width: 170px; }
    .as-table .c-st { width: 140px; }
    .as-table .c-act { width: 116px; }
    .as-table td { vertical-align: middle; font-size: 13.5px; }
    .as-sno { color: #6f8487; }
    .as-user { display: flex; align-items: center; gap: 10px; min-width: 0; }
    .as-who, div.as-agency, div.as-contact { min-width: 0; display: flex; flex-direction: column; }
    .as-who > *, div.as-agency > *, div.as-contact > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .as-avatar { flex: 0 0 34px; height: 34px; border-radius: 50%; display: grid; place-items: center; background: #e6f2f3; color: #24666b; font-weight: 800; font-size: 11.5px; }
    tr.is-blocked .as-avatar { background: #fbe9e7; color: #c8473c; }
    .as-name, .as-agency-name { font-size: 13.5px; font-weight: 700; color: #17373b; }
    .as-id, .as-sub { font-size: 11.5px; font-weight: 500; color: #6f8487; }
    .as-who .as-id { font-weight: 600; }
    div.as-contact > span:first-child { font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .as-under { margin: 6px 0 0 44px; }
    .lv-names { display: block; font-size: 13px; font-weight: 700; color: #17373b; margin-bottom: 2px; }
    .as-type { font-size: 12.5px; color: #3d5559; }
    .as-pill { display: inline-block; padding: 4px 11px; border-radius: 11px; background: #ecf0f0; color: #6f8487; font-size: 10.5px; font-weight: 700; letter-spacing: 0.4px; white-space: nowrap; }
    .no-mobile { color: #9a5f06; }
    .as-phone { display: block; margin-top: 6px; }
    .as-block-note { display: block; margin-top: 4px; font-size: 11.5px; color: #6f8487; overflow-wrap: anywhere; }
    .as-btns { display: flex; justify-content: flex-end; align-items: center; gap: 8px; }
    .as-btns .btn { white-space: nowrap; }
    .no-data .btn-link { font-weight: 600; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }

    @media (max-width: 767.98px) {
      .as-search, .as-select { flex: 1 1 100%; max-width: none; }
      .as-table.is-main { min-width: 0; table-layout: auto; }
      .as-who > *, div.as-agency > *, div.as-contact > * { white-space: normal; }
      .as-showing { margin-left: 0; }
      .as-list { background: none; border: 0; box-shadow: none; }
      .as-table thead { display: none; }
      .as-table, .as-table tbody, .as-table tr, .as-table td { display: block; width: 100%; }
      .as-table tr { position: relative; background: #fff; border: 1px solid #e1eaea; border-radius: 12px; margin-bottom: 12px; padding: 8px 14px; }
      .as-table tr.empty-row { border: 0; padding: 0; }
      .as-table td, .as-table td:first-child { border: 0; padding: 5px 0; text-align: left !important; }
      .as-table tbody tr:hover td { background: transparent; }
      .as-table td[data-label]::before { content: attr(data-label); display: block; font-size: 11.5px; font-weight: 700; color: #5f6f70; text-transform: uppercase; }
      .as-sno { display: none !important; }
      .as-user { min-width: 0; padding-right: 44px; }
      .as-under { margin-left: 0; }
      .as-btns { justify-content: flex-start; }
      .as-btns zed-row-menu { position: absolute; top: 12px; right: 12px; }
    }
  `,
})
export class AssessorListPage {
  private readonly system = inject(STAFF_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly labels = LABELS[this.system];
  protected readonly noun = computed(() => (this.consultancy ? t('staff.assessors.consultantsNoun', 'Consultants') : this.labels.assessors));
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.noun() }));
  private readonly api = inject(UsersApi);
  private readonly toast = inject(ToastService);
  private readonly content = inject(ContentService);
  private readonly query = inject(ActivatedRoute).snapshot.queryParamMap;

  protected readonly agencyId = this.query.get('agencyId') ?? '';
  protected readonly type = this.query.get('type') ?? '';
  /** Every assessor the server sent; the filters below pick the rows the pager gets. */
  protected readonly rows = signal<AssessorRow[]>([]);
  protected readonly status = signal<StatusFilter>('all');
  protected readonly level = signal('');
  protected readonly sector = signal<SectorFilter>('');
  protected readonly agency = signal('');
  /** Paged and searched (any value of the row) in the browser; 2026-11-21 (UI audit C4): 10 per page, as the other lists. */
  protected readonly pager = new ClientPager<AssessorRow>(10);
  protected readonly search = this.pager.search;
  protected readonly page = this.pager.page;
  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  /** The server's refusal, shown in the open confirmation. */
  protected readonly dialogError = signal('');
  protected readonly resetFor = signal<{ row: AssessorRow; ask: ConfirmAsk } | null>(null);
  protected readonly blockFor = signal<{ row: AssessorRow; ask: ConfirmAsk } | null>(null);
  /** 2026-11-16 (the user): an unblock asks for its reason (recorded and e-mailed to the user). */
  protected readonly reasonAsk = signal<ReasonAsk | null>(null);
  protected readonly historyFor = signal<{ row: AssessorRow; items: HistoryItem[] | null; error: string } | null>(null);
  protected readonly initials = initialsOf;
  protected readonly typeLabel = assessorTypeLabel;
  protected readonly medals = levelMedals;
  protected readonly mobile = plain;
  protected readonly email = plain;

  private readonly word = computed(() => (this.consultancy ? t('staff.assessors.word.consultant', 'consultant') : t('staff.assessors.word.assessor', 'assessor')));
  protected readonly menuActive = computed<RowMenuItem[]>(() => [
    { key: 'reset', label: t('staff.assessors.menu.reset', 'Send reset link'), icon: 'mail' },
    { key: 'history', label: t('staff.assessors.menu.history', 'View history'), icon: 'history' },
    { key: 'block', label: t('staff.assessors.menu.block', 'Block {word}', { word: this.word() }), icon: 'lock', danger: true },
  ]);
  protected readonly menuBlocked = computed<RowMenuItem[]>(() => [
    { key: 'history', label: t('staff.assessors.menu.history', 'View history'), icon: 'history' },
    { key: 'unblock', label: t('staff.assessors.menu.unblock', 'Unblock {word}', { word: this.word() }), icon: 'unlock' },
  ]);
  /** 2026-11-18: "Release mobile" for a user with a registered phone (Admin and Master Admin; the API refuses others). */
  private readonly releaseItem = computed<RowMenuItem>(() => ({ key: 'release', label: t('staff.assessors.menu.release', 'Release mobile'), icon: 'refresh' }));
  private readonly menuActivePhone = computed(() => [...this.menuActive().slice(0, 2), this.releaseItem(), ...this.menuActive().slice(2)]);
  private readonly menuBlockedPhone = computed(() => [...this.menuBlocked(), this.releaseItem()]);
  protected readonly showsPhone = canSeeAssessorMobile(inject(AuthService).currentUser()?.roleId);
  private readonly http = inject(HttpClient);
  /** The registered phones of this portal's app, by user id (upper case). */
  protected readonly phones = signal<Map<string, PhoneSummary>>(new Map());
  protected readonly releaseFor = signal<{ row: AssessorRow; ask: ConfirmAsk } | null>(null);

  protected phoneOf(s: AssessorRow): PhoneSummary | undefined {
    return this.phones().get((s.UserId ?? '').trim().toUpperCase());
  }

  protected menuOf(s: AssessorRow): RowMenuItem[] {
    const phone = this.showsPhone && hasPhone(this.phoneOf(s));
    return s.IsActive ? (phone ? this.menuActivePhone() : this.menuActive()) : phone ? this.menuBlockedPhone() : this.menuBlocked();
  }

  protected readonly tiles = computed<ListCount[]>(() => {
    const rows = this.rows();
    const active = rows.filter((r) => r.IsActive).length;
    return [
      { key: 'all', label: t('staff.assessors.count.all', 'All {noun}', { noun: this.noun().toLowerCase() }), value: rows.length },
      { key: 'active', label: t('staff.assessors.count.active', 'Active'), value: active, tone: 'good' },
      { key: 'blocked', label: t('staff.assessors.count.blocked', 'Blocked'), value: rows.length - active, tone: 'bad' },
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
  protected readonly typeChips = computed<FilterChip[]>(() => [
    { key: '', label: t('staff.assessors.chip.allTypes', 'All types'), count: this.rows().length },
    ...this.types().map((x) => ({ key: x.value, label: x.label, count: x.count })),
  ]);

  protected readonly sectorOptions = computed(() => {
    const rows = this.rows();
    const options: { value: SectorFilter; label: string; count: number }[] = SECTOR_ACTIVITIES.map((a) => ({
      value: a.value, label: a.label, count: rows.filter((r) => r.SectorActivity === a.value).length,
    }));
    const none = rows.filter((r) => !r.SectorActivity).length;
    if (none) options.push({ value: 'none', label: t('staff.assessors.filter.sectorNotSet', 'Not set'), count: none });
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
    void this.loadPhones();
    void this.loadMilestones();
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

  /** A row menu choice: each one confirms first (reset link, block, unblock) or opens the history panel. */
  protected pick(key: string, s: AssessorRow): void {
    if (this.busy()) return;
    this.dialogError.set('');
    switch (key) {
      case 'reset': this.resetFor.set({ row: s, ask: resetLinkAsk(s.UserName, s.UserId, s.Email, this.consultancy ? t('staff.assessors.reset.consultant', 'Consultant') : this.labels.assessor) }); break;
      case 'block': void this.openBlock(s); break;
      case 'unblock': this.reasonAsk.set({ action: 'unblock', userId: s.UserId, userName: s.UserName ?? null }); break;
      case 'history': void this.openHistory(s); break;
      case 'release': this.releaseFor.set({ row: s, ask: releaseMobileAsk(s.UserName, s.UserId, this.phoneOf(s)?.model, this.word()) }); break;
    }
  }

  protected closeDialogs(): void {
    if (this.busy()) return;
    this.resetFor.set(null);
    this.blockFor.set(null);
    this.reasonAsk.set(null);
    this.releaseFor.set(null);
    this.dialogError.set('');
  }

  /** Releases the user's registered phone with the reason; the next sign-in registers the new phone. */
  protected async releaseMobile(s: AssessorRow, reason: string): Promise<void> {
    await this.act(releasePhone(this.http, s.UserId, reason), (m) => {
      this.toast.success(t('staff.assessors.toast.released', 'Mobile released'), m);
      void this.loadPhones();
      return false;
    });
  }

  /** 2026-11-21: Consultancy, the milestones each consultant completed and has in progress, by user id (upper case). */
  private readonly milestoneCounts = signal<Map<string, { m1: number; m2: number; m3: number; inProgress: number }>>(new Map());
  private static readonly NoMilestones = { m1: 0, m2: 0, m3: 0, inProgress: 0 };

  protected milestonesOf(s: AssessorRow): { m1: number; m2: number; m3: number; inProgress: number } {
    return this.milestoneCounts().get((s.UserId ?? '').trim().toUpperCase()) ?? AssessorListPage.NoMilestones;
  }

  private async loadMilestones(): Promise<void> {
    if (!this.consultancy) return;
    try {
      const rows = await firstValueFrom(this.http.get<{ userId: string; m1: number; m2: number; m3: number; inProgress: number }[]>('/api/staff/dashboard/consultant-milestones'));
      this.milestoneCounts.set(new Map(rows.map((r) => [(r.userId ?? '').trim().toUpperCase(), { m1: r.m1 ?? 0, m2: r.m2 ?? 0, m3: r.m3 ?? 0, inProgress: r.inProgress ?? 0 }])));
    } catch {
      /* the list works without the counts (0) */
    }
  }

  /** The Phone chips (Admin and Master Admin only; a failure leaves them "Not registered" rather than failing the list). */
  private async loadPhones(): Promise<void> {
    if (!this.showsPhone) return;
    try {
      this.phones.set(phonesById(await firstValueFrom(loadPhones(this.http))));
    } catch {
      /* the list works without the chips */
    }
  }

  /** E-mails the assessor a link to set a new password. */
  protected async sendReset(s: AssessorRow): Promise<void> {
    await this.act(this.api.passwordReset('assessors', s.UserId), (m) => {
      this.toast.success(t('staff.assessors.toast.resetSent', 'Reset link sent'), t('staff.assessors.toast.resetTo', 'E-mailed to {to}', { to: sentTo(m, s.Email) }));
      return false;
    });
  }

  /** The block confirmation, with the open assessments it leaves (read first; "not known" when it cannot be). */
  private async openBlock(s: AssessorRow): Promise<void> {
    this.busy.set(true);
    assessorBlockNote(this.content, this.consultancy); // starts loading the Admin's texts while the count is read
    let open: number | null = null;
    try {
      open = (await firstValueFrom(this.api.assessorOpenAssessments(s.UserId))).count ?? null;
    } catch {
      /* shown as "not known" */
    } finally {
      this.busy.set(false);
    }
    const reAllotBy = this.consultancy ? t('staff.assessors.block.organisationWord', 'organisation') : this.labels.agency.toLowerCase();
    this.blockFor.set({ row: s, ask: assessorBlockAsk(s.UserName, s.UserId, open, assessorBlockNote(this.content, this.consultancy), this.consultancy, reAllotBy) });
  }

  protected async block(s: AssessorRow, reason: string): Promise<void> {
    await this.act(this.api.block('assessors', s.UserId, reason), (m) => {
      this.toast.success(t('staff.assessors.toast.blocked', '{who} blocked', { who: this.consultancy ? t('staff.assessors.toast.consultant', 'Consultant') : this.labels.assessor }), m);
      return true;
    });
  }

  protected async unblockWithReason(r: ReasonAsk, reason: string): Promise<void> {
    await this.act(this.api.unblock('assessors', r.userId, reason), (m) => {
      this.toast.success(t('staff.assessors.toast.unblocked', '{who} unblocked', { who: this.consultancy ? t('staff.assessors.toast.consultant', 'Consultant') : this.labels.assessor }), m);
      return true;
    });
  }

  private async openHistory(s: AssessorRow): Promise<void> {
    this.historyFor.set({ row: s, items: null, error: '' });
    try {
      const entries = await firstValueFrom(this.api.assessorHistory(s.UserId));
      if (this.historyFor()?.row === s) this.historyFor.set({ row: s, items: blockHistoryItems(entries, this.consultancy ? t('staff.assessors.history.organisationWord', 'organisation') : t('staff.assessors.history.agencyWord', 'agency')), error: '' });
    } catch (err) {
      if (this.historyFor()?.row === s) this.historyFor.set({ row: s, items: [], error: apiErrorMessage(err) });
    }
  }

  /** Runs a confirmed action: done → the toast (and a reload when `done` says so), the pop-up closes; refused → in the pop-up. */
  private async act(call: ReturnType<UsersApi['unblock']>, done: (message: string) => boolean): Promise<void> {
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
