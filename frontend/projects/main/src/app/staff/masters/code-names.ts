import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';
import { ExcelToolsComponent } from '../excel-tools';
import { AdminPortal, AdminPortalService } from '../admin-portal';
import { CodeName, CodeNameKind, MastersApi, SECTOR_ACTIVITIES, SectorActivity } from './masters.api';
import { TextPipe, t } from '../../content/page-text';

/** The page's words for the list (read in templates / computed, so the Admin's wording shows). */
function labelsOf(kind: CodeNameKind): { title: string; one: string; sub: string } {
  return kind === 'categories'
    ? { title: t('staff.sectorsAndCategories.categories.title', 'Categories'), one: t('staff.sectorsAndCategories.categories.one.label', 'Category'),
        sub: t('staff.sectorsAndCategories.categories.sub', 'Categories the technologies are grouped under.') }
    : { title: t('staff.sectorsAndCategories.sectors.title', 'Sectors'), one: t('staff.sectorsAndCategories.sectors.one.label', 'Sector'),
        sub: t('staff.sectorsAndCategories.sectors.sub', 'NIC sectors used to classify the MSMEs and the technologies.') };
}

/** A sector type as shown (the code value stays 'Manufacturing' / 'Services'). */
function activityLabel(a: SectorActivity | string): string {
  return a === 'Services' ? t('staff.sectorsAndCategories.activity.services.label', 'Services')
    : a === 'Manufacturing' ? t('staff.sectorsAndCategories.activity.manufacturing.label', 'Manufacturing') : a;
}

/** The one-line explanation of each sector type on its choice card. */
function activityNote(a: SectorActivity): string {
  return a === 'Services' ? t('staff.sectorsAndCategories.activity.services.note', 'Provides services')
    : t('staff.sectorsAndCategories.activity.manufacturing.note', 'Makes or processes goods');
}

/** A portal's name as shown. */
function portalName(p: OtherPortal): string {
  return p === 'consultancy' ? t('staff.sectorsAndCategories.portal.consultancy.label', 'Consultancy') : t('staff.sectorsAndCategories.portal.surveillance.label', 'Surveillance');
}

/** Which sectors the list shows (the buttons beside the search box). */
type SectorFilter = 'all' | SectorActivity | 'unset';

/** V4 one Admin: the portals whose sector list the main Admin keeps the same as main's. */
type OtherPortal = Exclude<AdminPortal, 'main'>;
const OTHER_PORTALS: readonly { key: OtherPortal }[] = [{ key: 'consultancy' }, { key: 'surveillance' }];

/** A sector on another portal: the same as main's, different (name or type), missing, or not known (portal not reached). */
type PortalState = 'same' | 'differs' | 'missing' | 'unknown';

interface OtherList {
  rows: CodeName[] | null;
  error: string;
}

/**
 * NIC sectors and categories (Admin). Port of Views/Sector/List.cshtml and Views/Category/List.cshtml
 * (same page; the route's `data.kind` picks the list): add a code and name, rename in a pop-up. Sectors also say whether
 * they are Manufacturing or Services (V4, required). V4 layout: for sectors the counts (all, Manufacturing, Services,
 * type not set) and a filter by type beside the search; the code as a badge; add and edit in pop-ups, the sector type
 * as choice cards; a card per row on phones.
 * <p>One Admin (V4, main portal): the sector list is kept the same on the three portals. The list says, per sector,
 * whether the Consultancy and Surveillance portals have it (and with the same name and type); an add or edit here is
 * saved on them too, through their own APIs; "Make all portals the same" adds or corrects what differs. Nothing is
 * deleted on another portal; sectors only another portal has are named above the list.</p>
 */
@Component({
  selector: 'zed-staff-code-names',
  imports: [FormsModule, PagerComponent, ExcelToolsComponent, TextPipe],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ labels().title }}</h3>
        <p class="page-sub">{{ labels().sub }}</p>
      </div>
      <div class="page-actions">
        <zed-excel-tools [api]="'/api/staff/masters/' + kind" [title]="labels().title" [fileName]="kind" (applied)="load(true)" />
        <button type="button" class="btn btn-primary" (click)="openAdd()">{{ '+ Add {word}' | t: 'staff.sectorsAndCategories.add.button' : { word: labels().one.toLowerCase() } }}</button>
      </div>
    </div>

    @if (isSectors) {
      <div class="cn-stats">
        <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">{{ 'Sectors' | t: 'staff.sectorsAndCategories.count.sectors' }}</span></div>
        <div class="stat"><span class="stat-value">{{ stats().manufacturing }}</span><span class="stat-label">{{ 'Manufacturing' | t: 'staff.sectorsAndCategories.count.manufacturing' }}</span></div>
        <div class="stat"><span class="stat-value">{{ stats().services }}</span><span class="stat-label">{{ 'Services' | t: 'staff.sectorsAndCategories.count.services' }}</span></div>
        <div class="stat" [class.stat-warn]="stats().unset > 0"><span class="stat-value">{{ stats().unset }}</span><span class="stat-label">{{ 'Type not set' | t: 'staff.sectorsAndCategories.count.unset' }}</span></div>
        <div class="stat stat-off"><span class="stat-value">{{ stats().disabled }}</span><span class="stat-label">{{ 'Disabled' | t: 'staff.sectorsAndCategories.count.disabled' }}</span></div>
      </div>
    }

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (syncing()) {
      @for (o of otherPortals; track o.key) {
        @if (others()[o.key].error; as e) { <div class="alert alert-warning" role="status">{{ '{portal} portal: {error}' | t: 'staff.sectorsAndCategories.sync.portalError.message' : { portal: portalName(o.key), error: e } }}</div> }
      }
      @if (outOfStep() > 0) {
        <div class="alert alert-info sync-bar" role="status">
          <span>{{ outOfStep() === 1 ? ('{count} sector is missing or different on the other portals.' | t: 'staff.sectorsAndCategories.sync.outOfStep.one.message' : { count: outOfStep() })
            : ('{count} sectors are missing or different on the other portals.' | t: 'staff.sectorsAndCategories.sync.outOfStep.many.message' : { count: outOfStep() }) }}</span>
          <button type="button" class="btn btn-primary btn-sm" [disabled]="saving()" (click)="syncAll()">{{ 'Make all portals the same' | t: 'staff.sectorsAndCategories.sync.button' }}</button>
        </div>
      }
      @for (o of otherPortals; track o.key) {
        @if (onlyOn(o.key); as only) {
          @if (only.length) { <p class="only-on">{{ 'Only on the {portal} portal (kept there): {codes}' | t: 'staff.sectorsAndCategories.sync.onlyOn.note' : { portal: portalName(o.key), codes: only.join(', ') } }}</p> }
        }
      }
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="zed-card list-card">
      <div class="list-toolbar">
        <input type="search" class="form-control search" [placeholder]="'Search code or name' | t: 'staff.sectorsAndCategories.search.placeholder'"
               [attr.aria-label]="'Search {list}' | t: 'staff.sectorsAndCategories.search.aria' : { list: labels().title.toLowerCase() }"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        @if (isSectors) {
          <div class="seg" role="group" [attr.aria-label]="'Sector type' | t: 'staff.sectorsAndCategories.filter.aria'">
            @for (f of filters(); track f.key) {
              <button type="button" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="setFilter(f.key)">{{ f.label }}</button>
            }
          </div>
        } @else {
          <span class="zed-chip">{{ rows().length === 1 ? ('{count} {one}' | t: 'staff.sectorsAndCategories.total.one.chip' : { count: rows().length, one: labels().one.toLowerCase() })
            : ('{count} {many}' | t: 'staff.sectorsAndCategories.total.many.chip' : { count: rows().length, many: labels().title.toLowerCase() }) }}</span>
        }
      </div>
      <div class="table-responsive">
        <table class="table table-zed cn-table">
          <thead>
            <tr>
              <th class="text-center" style="width: 140px">{{ '{word} Code' | t: 'staff.sectorsAndCategories.column.code' : { word: labels().one } }}</th>
              <th>{{ '{word} Name' | t: 'staff.sectorsAndCategories.column.name' : { word: labels().one } }}</th>
              @if (isSectors) { <th style="width: 170px">{{ 'Sector Type' | t: 'staff.sectorsAndCategories.column.type' }}</th> }
              @if (syncing()) { <th style="width: 210px">{{ 'Other portals' | t: 'staff.sectorsAndCategories.column.portals' }}</th> }
              <th class="text-center" [style.width.px]="isSectors ? 220 : 140">{{ 'Actions' | t: 'staff.sectorsAndCategories.column.actions' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of pager.page(); track s.id) {
              <tr [class.row-off]="s.disabled">
                <td class="text-center code-cell"><span class="code-badge">{{ s.code }}</span></td>
                <td class="name-cell"><strong>{{ s.name }}</strong>@if (s.disabled) { <span class="off-badge">{{ 'Disabled' | t: 'staff.sectorsAndCategories.row.disabled.label' }}</span> }</td>
                @if (isSectors) {
                  <td class="type-cell">
                    @if (s.activity) { <span class="activity-badge" [class.services]="s.activity === 'Services'">{{ activityLabel(s.activity) }}</span> }
                    @else { <span class="activity-badge unset">{{ 'Not set' | t: 'staff.sectorsAndCategories.row.unset.label' }}</span> }
                  </td>
                }
                @if (syncing()) {
                  <td class="portals-cell">
                    @for (o of otherPortals; track o.key) {
                      @switch (stateOf(s, o.key)) {
                        @case ('same') { <span class="pchip ok">{{ '{portal} ✓' | t: 'staff.sectorsAndCategories.portalState.same.label' : { portal: portalName(o.key) } }}</span> }
                        @case ('differs') { <span class="pchip warn" [title]="'Different name or type there' | t: 'staff.sectorsAndCategories.portalState.differs.tooltip'">{{ '{portal}: differs' | t: 'staff.sectorsAndCategories.portalState.differs.label' : { portal: portalName(o.key) } }}</span> }
                        @case ('missing') { <span class="pchip miss">{{ '{portal}: missing' | t: 'staff.sectorsAndCategories.portalState.missing.label' : { portal: portalName(o.key) } }}</span> }
                        @default { <span class="pchip">{{ '{portal}: ?' | t: 'staff.sectorsAndCategories.portalState.unknown.label' : { portal: portalName(o.key) } }}</span> }
                      }
                    }
                  </td>
                }
                <td class="actions-cell">
                  <div class="row-actions justify-content-center">
                    <button type="button" class="btn btn-outline-primary" [attr.aria-label]="'Edit {code}' | t: 'staff.sectorsAndCategories.row.edit.aria' : { code: s.code }" (click)="edit(s)">{{ 'Edit' | t: 'staff.sectorsAndCategories.row.edit.button' }}</button>
                    @if (isSectors) {
                      <!-- 2026-11-16 (approved): a disabled sector leaves the pick-lists; units and records keep it. -->
                      <button type="button" class="btn" [class.btn-outline-danger]="!s.disabled" [class.btn-outline-success]="s.disabled" [disabled]="saving()"
                              [attr.aria-label]="s.disabled ? ('Enable {code}' | t: 'staff.sectorsAndCategories.row.enable.aria' : { code: s.code }) : ('Disable {code}' | t: 'staff.sectorsAndCategories.row.disable.aria' : { code: s.code })"
                              (click)="toggleDisabled(s)">{{ s.disabled ? ('Enable' | t: 'staff.sectorsAndCategories.row.enable.button') : ('Disable' | t: 'staff.sectorsAndCategories.row.disable.button') }}</button>
                    }
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row"><td [attr.colspan]="(isSectors ? 4 : 3) + (syncing() ? 1 : 0)" style="padding: 0"><div class="no-data">{{ emptyText() }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>

    @if (adding()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="add-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="add-title">{{ 'Add {word}' | t: 'staff.sectorsAndCategories.addDialog.title' : { word: labels().one } }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.sectorsAndCategories.dialog.close.aria'" (click)="adding.set(false)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form class="add-form" (ngSubmit)="add()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="code">{{ '{word} Code' | t: 'staff.sectorsAndCategories.form.code.label' : { word: labels().one } }}<span class="req">*</span></label>
                  <div>
                    <input id="code" name="code" class="form-control code-input" maxlength="50" [(ngModel)]="code" />
                    @if (submitted() && !code.trim()) { <span class="help-block">{{ '{word} Code required.' | t: 'staff.sectorsAndCategories.form.code.error' : { word: labels().one } }}</span> }
                    @else { <small class="muted d-block mt-1">{{ 'The code cannot be changed later.' | t: 'staff.sectorsAndCategories.form.code.note' }}</small> }
                  </div>
                  <label for="name">{{ '{word} Name' | t: 'staff.sectorsAndCategories.form.name.label' : { word: labels().one } }}<span class="req">*</span></label>
                  <div>
                    <input id="name" name="name" class="form-control" maxlength="200" [(ngModel)]="name" />
                    @if (submitted() && !name.trim()) { <span class="help-block">{{ '{word} Name required.' | t: 'staff.sectorsAndCategories.form.name.error' : { word: labels().one } }}</span> }
                  </div>
                  @if (isSectors) {
                    <span class="label-like top" id="activity-label">{{ 'Sector Type' | t: 'staff.sectorsAndCategories.form.type.label' }}<span class="req">*</span></span>
                    <div>
                      <div class="activity-choice" role="radiogroup" aria-labelledby="activity-label">
                        @for (a of activities; track a) {
                          <label class="choice-card" [class.active]="activity === a"><input type="radio" class="form-check-input" name="activity" [value]="a" [(ngModel)]="activity" />
                            <span><strong>{{ activityLabel(a) }}</strong> <small class="muted d-block">{{ activityNote(a) }}</small></span></label>
                        }
                      </div>
                      @if (submitted() && !activity) { <span class="help-block">{{ 'Please select Manufacturing or Services.' | t: 'staff.sectorsAndCategories.form.type.error' }}</span> }
                    </div>
                  }
                </div>
                @if (addError()) { <span class="help-block d-block mt-2" role="alert">{{ addError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="adding.set(false)">{{ 'Cancel' | t: 'staff.sectorsAndCategories.dialog.cancel.button' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ 'Save' | t: 'staff.sectorsAndCategories.dialog.save.button' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="edit-title">{{ 'Edit {word}' | t: 'staff.sectorsAndCategories.editDialog.title' : { word: labels().one } }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.sectorsAndCategories.dialog.close.aria'" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="update()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <span class="label-like">{{ '{word} Code' | t: 'staff.sectorsAndCategories.form.code.label' : { word: labels().one } }}</span>
                  <span><span class="code-badge">{{ e.code }}</span> <small class="muted ms-1">{{ 'Cannot be changed' | t: 'staff.sectorsAndCategories.editDialog.code.note' }}</small></span>
                  <label for="edit-name">{{ '{word} Name' | t: 'staff.sectorsAndCategories.form.name.label' : { word: labels().one } }}<span class="req">*</span></label>
                  <input id="edit-name" name="editName" class="form-control" maxlength="200" [(ngModel)]="e.name" />
                  @if (isSectors) {
                    <span class="label-like top" id="edit-activity-label">{{ 'Sector Type' | t: 'staff.sectorsAndCategories.form.type.label' }}<span class="req">*</span></span>
                    <div class="activity-choice" role="radiogroup" aria-labelledby="edit-activity-label">
                      @for (a of activities; track a) {
                        <label class="choice-card" [class.active]="e.activity === a"><input type="radio" class="form-check-input" name="editActivity" [value]="a" [(ngModel)]="e.activity" />
                          <span><strong>{{ activityLabel(a) }}</strong> <small class="muted d-block">{{ activityNote(a) }}</small></span></label>
                      }
                    </div>
                  }
                </div>
                @if (editError()) { <span class="help-block d-block mt-2" role="alert">{{ editError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.sectorsAndCategories.dialog.cancel.button' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ 'Save' | t: 'staff.sectorsAndCategories.dialog.save.button' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .page-head { align-items: flex-end; }
    .help-block { color: #a94442; font-size: 13px; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; align-self: center; }
    .label-like.top { align-self: start; padding-top: 10px; }

    /* The counts (sectors). */
    .cn-stats { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat.stat-off .stat-value { color: #6b7280; }
    .row-off td { background: #f6f7f7; }
    .row-off .name-cell strong { color: #6b7280; }
    .off-badge { display: inline-block; margin-left: 8px; font-size: 11.5px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: #e5e7eb; color: #4b5563; vertical-align: middle; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }
    .stat.stat-warn { background: #fff4d6; border-color: #f3e1a6; }
    .sync-bar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
    .only-on { font-size: 13px; color: #5f6f70; margin: -4px 0 12px; }
    .portals-cell { white-space: normal; }
    .pchip { display: inline-block; font-size: 11.5px; font-weight: 700; border-radius: 10px; padding: 1px 8px; margin: 2px 4px 2px 0; background: #f2f4f4; color: #5f6f70; }
    .pchip.ok { background: #e6f6ec; color: #1e7a3c; } .pchip.warn { background: #fff4d6; color: #8a6100; } .pchip.miss { background: #fdeef0; color: #a8303a; }
    .stat.stat-warn .stat-value, .stat.stat-warn .stat-label { color: #8a6100; }

    .list-card { padding: 16px; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }

    .cn-table { width: 100%; margin-bottom: 8px; }
    .cn-table td { vertical-align: middle; }
    .cn-table .name-cell { overflow-wrap: break-word; }
    .cn-table .code-cell, .cn-table .type-cell, .cn-table .actions-cell { white-space: nowrap; }
    .activity-badge, .off-badge, .pchip { white-space: nowrap; }
    .cn-table tbody tr:hover { background: var(--zt-pale, #f7fbfb); }
    .name-cell strong { color: #232527; font-weight: 600; }
    .code-badge {
      display: inline-flex; align-items: center; justify-content: center; min-width: 36px; height: 30px; padding: 0 10px; border-radius: 15px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 14px;
    }
    .activity-badge { display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 13px; font-weight: 600; background: #e3f1f2; color: #23474a; }
    .activity-badge.services { background: #f1f0fb; color: #3f3a7a; }
    .activity-badge.unset { background: #fff4d6; color: #8a6100; }

    .activity-choice { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    .choice-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; }
    .choice-card.active { border-color: #45a5ad; background: #f4fafa; }
    /* The skin makes pop-up labels bold; on these cards only the option's name is. */
    .modal .modal-popup label.choice-card { font-weight: 400; color: #232527; }
    .choice-card .form-check-input { flex: none; margin: 3px 0 0; float: none; border: 1.5px solid #6f8f92; }
    .choice-card strong { color: #23474a; }

    /* Phones: a card per row. */
    @media (max-width: 767.98px) {
      .cn-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .list-toolbar .search { max-width: none; flex-basis: 100%; }
      .cn-table thead { display: none; }
      .cn-table, .cn-table tbody { display: block; width: 100%; }
      /* Two columns (code | name, type); the other portals and the actions take a full row below. */
      .cn-table tr { display: grid; grid-template-columns: auto minmax(0, 1fr); gap: 6px 12px; align-items: center;
        border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 10px; padding: 10px 12px; }
      .cn-table tr.empty-row { display: block; border: 0; padding: 0; }
      .cn-table td { display: block; border: 0; padding: 0; text-align: left !important; min-width: 0; width: auto !important; }
      .cn-table .code-cell { grid-column: 1; align-self: start; }
      .cn-table tr:has(.type-cell) .code-cell { grid-row: 1 / span 2; }
      .cn-table .code-badge { min-width: 48px; }
      .cn-table .name-cell, .cn-table .type-cell { grid-column: 2; }
      .cn-table .portals-cell, .cn-table .actions-cell { grid-column: 1 / -1; }
      .cn-table .actions-cell { border-top: 1px solid #eef3f3; padding-top: 8px; }
      .cn-table .actions-cell .row-actions { flex-direction: row; justify-content: flex-start !important; flex-wrap: wrap; }
      .activity-choice { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class CodeNamesPage {
  private readonly api = inject(MastersApi);
  private readonly portals = inject(AdminPortalService);

  protected readonly kind: CodeNameKind = inject(ActivatedRoute).snapshot.data['kind'] === 'categories' ? 'categories' : 'sectors';
  protected readonly labels = computed(() => labelsOf(this.kind));
  protected readonly isSectors = this.kind === 'sectors';
  protected readonly activities = SECTOR_ACTIVITIES;
  protected readonly activityLabel = activityLabel;
  protected readonly activityNote = activityNote;
  protected readonly portalName = portalName;
  /** Every row; the pager holds those the sector type filter lets through. */
  protected readonly rows = signal<CodeName[]>([]);
  protected readonly filter = signal<SectorFilter>('all');
  protected readonly stats = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      manufacturing: rows.filter((r) => r.activity === 'Manufacturing').length,
      services: rows.filter((r) => r.activity === 'Services').length,
      unset: rows.filter((r) => !r.activity).length,
      disabled: rows.filter((r) => r.disabled).length,
    };
  });
  /** "Not set" is offered only while some sector has no type. */
  protected readonly filters = computed(() => {
    const list: { key: SectorFilter; label: string }[] = [{ key: 'all', label: t('staff.sectorsAndCategories.filter.all', 'All') },
      ...SECTOR_ACTIVITIES.map((a) => ({ key: a, label: activityLabel(a) }))];
    if (this.stats().unset || this.filter() === 'unset') list.push({ key: 'unset', label: t('staff.sectorsAndCategories.filter.unset', 'Not set') });
    return list;
  });
  protected readonly pager = new ClientPager<CodeName>(10);
  protected readonly adding = signal(false);
  protected readonly editing = signal<CodeName | null>(null);
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly addError = signal('');
  protected readonly editError = signal('');
  protected readonly success = signal('');
  protected code = '';
  protected name = '';
  protected activity: SectorActivity | null = null;

  /** One Admin: the sectors are kept the same on the other portals (main portal's sectors page only). */
  protected readonly syncing = signal(this.isSectors && this.portals.enabled);
  protected readonly otherPortals = OTHER_PORTALS;
  protected readonly others = signal<Record<OtherPortal, OtherList>>({ consultancy: { rows: null, error: '' }, surveillance: { rows: null, error: '' } });
  /** Main's sectors that some other portal lacks or has differently. */
  protected readonly outOfStep = computed(() =>
    this.rows().filter((r) => OTHER_PORTALS.some((o) => ['differs', 'missing'].includes(this.stateOf(r, o.key)))).length);

  constructor() {
    void this.load(true);
  }

  protected emptyText(): string {
    const l = this.labels();
    if (this.pager.search() || this.filter() !== 'all') return t('staff.sectorsAndCategories.noMatch.empty', 'No {word} matches the search', { word: l.one.toLowerCase() });
    return this.rows().length ? t('staff.sectorsAndCategories.noData.empty', 'No Data')
      : t('staff.sectorsAndCategories.empty', 'No {list} yet. Use + Add {word} to add the first one.', { list: l.title.toLowerCase(), word: l.one });
  }

  protected setFilter(f: SectorFilter): void {
    this.filter.set(f);
    this.pager.set(this.filtered());
  }

  private filtered(): CodeName[] {
    const f = this.filter();
    const rows = this.rows();
    if (f === 'all') return rows;
    return rows.filter((r) => (f === 'unset' ? !r.activity : r.activity === f));
  }

  /** <paramref name="fresh"/>: page 1; otherwise (after a save) the same page. */
  protected async load(fresh = false): Promise<void> {
    const others = this.loadOthers();
    try {
      this.rows.set(await firstValueFrom(this.api.list(this.kind)));
      if (fresh) this.pager.set(this.filtered());
      else this.pager.refresh(this.filtered());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
    await others;
  }

  /** The other portals' sector lists (a portal that cannot be reached is named, the rest still works). */
  private async loadOthers(): Promise<void> {
    if (!this.syncing()) return;
    const loaded = await Promise.all(OTHER_PORTALS.map(async (o): Promise<[OtherPortal, OtherList]> => {
      try {
        return [o.key, { rows: await firstValueFrom(this.api.list('sectors', o.key)), error: '' }];
      } catch (err) {
        return [o.key, { rows: null, error: apiErrorMessage(err) }];
      }
    }));
    this.others.set(Object.fromEntries(loaded) as Record<OtherPortal, OtherList>);
  }

  private find(portal: OtherPortal, code: string): CodeName | undefined {
    return this.others()[portal].rows?.find((r) => r.code.trim().toLowerCase() === code.trim().toLowerCase());
  }

  protected stateOf(row: CodeName, portal: OtherPortal): PortalState {
    if (!this.others()[portal].rows) return 'unknown';
    const there = this.find(portal, row.code);
    if (!there) return 'missing';
    return there.name.trim() === row.name.trim() && (there.activity ?? null) === (row.activity ?? null) && !!there.disabled === !!row.disabled
      ? 'same' : 'differs';
  }

  /** Codes another portal has that main does not. */
  protected onlyOn(portal: OtherPortal): string[] {
    const mine = new Set(this.rows().map((r) => r.code.trim().toLowerCase()));
    return (this.others()[portal].rows ?? []).filter((r) => !mine.has(r.code.trim().toLowerCase())).map((r) => r.code.trim());
  }

  /** Saves main's sector on the other portals that lack it or differ; returns what failed ("Consultancy: ..."). */
  private async pushToOthers(code: string, name: string, activity: SectorActivity | null, disabled = false): Promise<string[]> {
    if (!this.syncing() || !activity) return [];
    const failed: string[] = [];
    for (const o of OTHER_PORTALS) {
      if (!this.others()[o.key].rows) {
        failed.push(t('staff.sectorsAndCategories.sync.notReached.error', '{portal}: not reached', { portal: portalName(o.key) }));
        continue;
      }
      let there = this.find(o.key, code);
      try {
        if (!there || there.name.trim() !== name || there.activity !== activity) {
          await firstValueFrom(there ? this.api.rename('sectors', there.id, name, activity, o.key) : this.api.add('sectors', code, name, activity, o.key));
        }
        // 2026-11-16: the same disabled state there (a sector just added there: read its id first).
        if (!!there?.disabled !== disabled && (there || disabled)) {
          there ??= (await firstValueFrom(this.api.list('sectors', o.key))).find((r) => r.code.trim().toLowerCase() === code.trim().toLowerCase());
          if (there && !!there.disabled !== disabled) await firstValueFrom(this.api.setSectorDisabled(there.id, disabled, o.key));
        }
      } catch (err) {
        failed.push(t('staff.sectorsAndCategories.sync.failed.error', '{portal}: {error}', { portal: portalName(o.key), error: apiErrorMessage(err) }));
      }
    }
    return failed;
  }

  /** 2026-11-16 (approved): Disable / Enable a sector here and, on the main portal, on the other portals too. */
  protected async toggleDisabled(row: CodeName): Promise<void> {
    const disabled = !row.disabled;
    this.error.set('');
    this.success.set('');
    this.saving.set(true);
    try {
      const message = (await firstValueFrom(this.api.setSectorDisabled(row.id, disabled))).message;
      this.success.set(this.withOthers(message, await this.pushToOthers(row.code, row.name.trim(), row.activity ?? null, disabled)));
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  private withOthers(message: string, failed: string[]): string {
    if (!this.syncing()) return message;
    return failed.length ? t('staff.sectorsAndCategories.sync.partly.message', '{message} Not saved on every portal: {failed}', { message, failed: failed.join('; ') })
      : t('staff.sectorsAndCategories.sync.allSaved.message', '{message} Saved on all three portals.', { message });
  }

  /** Adds or corrects, on the other portals, every sector of main's list that is missing or different there. */
  protected async syncAll(): Promise<void> {
    this.error.set('');
    this.success.set('');
    this.saving.set(true);
    const failed: string[] = [];
    let done = 0;
    try {
      for (const row of this.rows()) {
        if (!OTHER_PORTALS.some((o) => ['differs', 'missing'].includes(this.stateOf(row, o.key)))) continue;
        if (!row.activity) {
          failed.push(t('staff.sectorsAndCategories.sync.noType.error', '{code}: set its type here first', { code: row.code }));
          continue;
        }
        const f = await this.pushToOthers(row.code, row.name.trim(), row.activity, !!row.disabled);
        if (f.length) failed.push(...f.map((x) => `${row.code} ${x}`));
        else done++;
      }
      await this.loadOthers();
      if (failed.length) this.error.set(t('staff.sectorsAndCategories.syncAll.partly.error', '{count} sector(s) made the same; not done: {failed}', { count: done, failed: failed.join('; ') }));
      else this.success.set(t('staff.sectorsAndCategories.syncAll.done.toast', '{count} sector(s) made the same on all three portals.', { count: done }));
    } finally {
      this.saving.set(false);
    }
  }

  protected openAdd(): void {
    this.code = this.name = '';
    this.activity = null;
    this.submitted.set(false);
    this.addError.set('');
    this.success.set('');
    this.adding.set(true);
  }

  protected async add(): Promise<void> {
    this.submitted.set(true);
    this.addError.set('');
    this.success.set('');
    if (!this.code.trim() || !this.name.trim() || (this.isSectors && !this.activity)) {
      this.addError.set(t('staff.sectorsAndCategories.add.invalid.error', 'Please enter valid data.'));
      return;
    }
    this.saving.set(true);
    try {
      const message = (await firstValueFrom(this.api.add(this.kind, this.code.trim(), this.name.trim(), this.activity))).message;
      this.success.set(this.withOthers(message, await this.pushToOthers(this.code.trim(), this.name.trim(), this.activity)));
      this.code = this.name = '';
      this.activity = null;
      this.submitted.set(false);
      this.adding.set(false);
      await this.load();
    } catch (err) {
      this.addError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected edit(row: CodeName): void {
    this.editError.set('');
    this.success.set('');
    this.editing.set({ ...row });
  }

  protected async update(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!e.name.trim()) {
      this.editError.set(t('staff.sectorsAndCategories.edit.invalid.error', 'Enter the valid data.'));
      return;
    }
    if (this.isSectors && !e.activity) {
      this.editError.set(t('staff.sectorsAndCategories.form.type.error', 'Please select Manufacturing or Services.'));
      return;
    }
    this.saving.set(true);
    try {
      const message = (await firstValueFrom(this.api.rename(this.kind, e.id, e.name.trim(), e.activity))).message;
      this.success.set(this.withOthers(message, await this.pushToOthers(e.code, e.name.trim(), e.activity ?? null, !!e.disabled)));
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
