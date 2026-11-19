import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ClientConfigService, apiErrorMessage } from '@zed/shared';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { firstValueFrom } from 'rxjs';
import { MastersApi, Parameter, ParameterLevel } from './masters.api';
import { MultiSelect, MultiSelectOption } from '../users/multi-select';
import { ClientPager, PagerComponent } from '../pager';
import { ExcelToolsComponent } from '../excel-tools';
import { PORTAL_SYSTEM } from '../../portal-system';
import { PortalSwitchComponent, QUESTIONNAIRE_PORTALS } from '../admin-portal';
import { TextPipe, t } from '../../content/page-text';

/** Which parameters the list shows (the buttons beside the search box). */
type ParameterFilter = 'all' | 'surveillance' | 'notSurveillance' | 'notConsultancy' | 'sectors' | 'disabled';

/**
 * Questionnaire parameters of a certification level (Admin landing page). Port of
 * Views/Questionaire/Index.cshtml (Questionaire/Index?SectionType=Bronze). The description used to be
 * rendered as raw HTML; it is shown as text now. "Requirements" opens staff/questionnaire/{level}/{code}. V4: one tab per
 * level of Administration → Certification Levels (ZED-X included), the level's counts, the add and edit forms in pop-ups,
 * the description under the parameter's name (folded to two lines), a search box with the surveillance / sector filter
 * and the list paged (Show N Entries); a card per parameter on phones. A parameter can be limited to NIC sectors (all
 * sectors when none is chosen).
 */
@Component({
  selector: 'zed-staff-parameters',
  imports: [FormsModule, PagerComponent, MultiSelect, ExcelToolsComponent, PortalSwitchComponent, TextPipe],
  template: `
    <!-- 2026-11-08: the Admin edits Surveillance's questionnaire from here too. -->
    <zed-portal-switch [portals]="questionnairePortals" [title]="'Questionnaire of' | t: 'staff.parameters.portalSwitch.label'" />
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ 'Parameters ({level})' | t: 'staff.parameters.title' : { level: levelName() } }}</h3>
        <p class="page-sub">{{ onMain
          ? ('The {level} questionnaire: each parameter, the NIC sectors it applies to, whether surveillance assesses it again and whether consultancy uses it. Requirements opens its questions.' | t: 'staff.parameters.main.sub' : { level: levelName() })
          : ('The {level} questionnaire: each parameter, the NIC sectors it applies to, whether surveillance assesses it again. Requirements opens its questions.' | t: 'staff.parameters.sub' : { level: levelName() }) }}</p>
      </div>
      <div class="page-actions">
        <span class="xl-group"><span class="xl-group-label">{{ 'Parameters' | t: 'staff.parameters.excel.parameters.label' }}</span>
          <zed-excel-tools [api]="'/api/staff/masters/parameters/' + sectionType()" [title]="'{level} parameters' | t: 'staff.parameters.excel.parameters.title' : { level: levelName() }"
                           [fileName]="'parameters-' + sectionType().toLowerCase()" (applied)="load(true)" /></span>
        <!-- 2026-11-13: the requirements of every parameter of the level in one sheet (a Parameter column first). -->
        <span class="xl-group xl-group-all"><span class="xl-group-label">{{ 'Requirements of all parameters' | t: 'staff.parameters.excel.requirements.label' }}</span>
          <zed-excel-tools [api]="'/api/staff/questionnaire/' + sectionType() + '/all-requirements'" [title]="'Requirements of all {level} parameters' | t: 'staff.parameters.excel.requirements.title' : { level: levelName() }"
                           [fileName]="'requirements-' + sectionType().toLowerCase() + '-all-parameters'" /></span>
        <button type="button" class="btn btn-primary" (click)="openAdd()">{{ '+ Add parameter' | t: 'staff.parameters.add.button' }}</button>
      </div>
    </div>

    @if (levels().length) {
      <nav class="level-tabs" [attr.aria-label]="'Certification level' | t: 'staff.parameters.levels.aria'">
        @for (l of levels(); track l.code) {
          <button type="button" class="level-tab" [class.active]="isLevel(l.code)" [attr.aria-current]="isLevel(l.code) ? 'page' : null" (click)="pickLevel(l.code)">
            {{ l.name }}
            @if (!l.isEnabled) { <span class="tab-note">{{ 'Not open to MSMEs yet' | t: 'staff.parameters.levels.notOpen.label' }}</span> }
          </button>
        }
      </nav>
    }

    <div class="param-stats">
      <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">{{ 'Parameters' | t: 'staff.parameters.count.total' }}</span></div>
      <div class="stat"><span class="stat-value">{{ stats().surveillance }}</span><span class="stat-label">{{ 'Assessed again in surveillance' | t: 'staff.parameters.count.surveillance' }}</span></div>
      @if (onMain) {
        <div class="stat"><span class="stat-value">{{ stats().consultancy }}</span><span class="stat-label">{{ 'Used in consultancy' | t: 'staff.parameters.count.consultancy' }}</span></div>
      }
      <div class="stat"><span class="stat-value">{{ stats().sectorSpecific }}</span><span class="stat-label">{{ 'Limited to NIC sectors' | t: 'staff.parameters.count.sectors' }}</span></div>
      <div class="stat stat-off" data-disabled-count><span class="stat-value">{{ stats().disabled }}</span><span class="stat-label">{{ 'Disabled (left out of new applications)' | t: 'staff.parameters.count.disabled' }}</span></div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="zed-card list-card">
      <div class="list-toolbar">
        <input type="search" class="form-control search" [placeholder]="'Search code, name or description' | t: 'staff.parameters.search.placeholder'"
               [attr.aria-label]="'Search parameters' | t: 'staff.parameters.search.aria'"
               [ngModel]="pager.search()" (ngModelChange)="pager.setSearch($event)" />
        <div class="seg" role="group" [attr.aria-label]="'Show' | t: 'staff.parameters.filter.aria'">
          @for (f of filters(); track f.key) {
            <button type="button" [class.active]="filter() === f.key" [attr.aria-pressed]="filter() === f.key" (click)="setFilter(f.key)">{{ f.label }}</button>
          }
        </div>
      </div>

      <div class="table-responsive">
        <table class="table table-zed param-table">
          <colgroup>
            <col style="width: 84px" />
            <col />
            <col style="width: 170px" />
            <col style="width: 116px" />
            @if (onMain) { <col style="width: 116px" /> }
            <col style="width: 290px" />
          </colgroup>
          <thead>
            <tr>
              <th class="text-center">{{ 'Code' | t: 'staff.parameters.column.code' }}</th>
              <th>{{ 'Parameter' | t: 'staff.parameters.column.parameter' }}</th>
              <th>{{ 'NIC Sectors' | t: 'staff.parameters.column.sectors' }}</th>
              <th class="text-center">{{ 'Surveillance' | t: 'staff.parameters.column.surveillance' }}</th>
              @if (onMain) { <th class="text-center">{{ 'Consultancy' | t: 'staff.parameters.column.consultancy' }}</th> }
              <th class="text-center">{{ 'Actions' | t: 'staff.parameters.column.actions' }}</th>
            </tr>
          </thead>
          <tbody>
            @for (s of pager.page(); track s.id) {
              <tr [class.row-off]="s.disabled">
                <td class="text-center code-cell" [attr.data-label]="'Code' | t: 'staff.parameters.column.code'"><span class="code-badge">{{ s.sectionCode }}</span></td>
                <td [attr.data-label]="'Parameter' | t: 'staff.parameters.column.parameter'">
                  <div class="param-name">{{ s.sectionName }} @if (s.disabled) { <span class="off-badge" [title]="'Left out of new applications; the ones already paid keep it' | t: 'staff.parameters.row.disabled.tooltip'">{{ 'Disabled' | t: 'staff.parameters.row.disabled.label' }}</span> }</div>
                  @if (s.description) {
                    <pre [class.clamp-2]="!expanded().has(s.id)" [title]="s.description">{{ s.description }}</pre>
                    @if (isLong(s.description)) {
                      <button type="button" class="btn btn-link btn-sm p-0 more" (click)="toggle(s.id)">{{ expanded().has(s.id) ? ('Show less' | t: 'staff.parameters.row.less.button') : ('Show more' | t: 'staff.parameters.row.more.button') }}</button>
                    }
                  }
                </td>
                <td [attr.data-label]="'NIC Sectors' | t: 'staff.parameters.column.sectors'">
                  @if (s.nicSectors?.length) {
                    @for (c of s.nicSectors; track c) { <span class="zed-chip" [title]="sectorName(c)">{{ c }}</span> }
                  } @else {
                    <span class="muted all-sectors">{{ 'All sectors' | t: 'staff.parameters.row.allSectors.label' }}</span>
                  }
                </td>
                <td class="text-center" [attr.data-label]="'Surveillance' | t: 'staff.parameters.column.surveillance'">
                  <span class="status-badge" [class.is-success]="s.inSurveillance" [class.is-inactive]="!s.inSurveillance">{{ s.inSurveillance ? ('Yes' | t: 'staff.parameters.row.yes.label') : ('No' | t: 'staff.parameters.row.no.label') }}</span>
                </td>
                @if (onMain) {
                  <td class="text-center" [attr.data-label]="'Consultancy' | t: 'staff.parameters.column.consultancy'">
                    <span class="status-badge consultancy-badge" [class.is-success]="s.inConsultancy !== false" [class.is-inactive]="s.inConsultancy === false">{{ s.inConsultancy === false ? ('No' | t: 'staff.parameters.row.no.label') : ('Yes' | t: 'staff.parameters.row.yes.label') }}</span>
                  </td>
                }
                <td [attr.data-label]="'Actions' | t: 'staff.parameters.column.actions'">
                  <div class="row-actions justify-content-center">
                    <button type="button" class="btn btn-outline-primary" (click)="edit(s)">{{ 'Edit' | t: 'staff.parameters.row.edit.button' }}</button>
                    <a class="btn btn-primary" [href]="requirementsUrl(s)">{{ 'Requirements' | t: 'staff.parameters.row.requirements.link' }}</a>
                    <button type="button" class="btn btn-toggle-off" [class.btn-outline-danger]="!s.disabled" [class.btn-outline-success]="s.disabled" [disabled]="toggling() === s.id"
                            [attr.aria-label]="s.disabled ? ('Enable {code}' | t: 'staff.parameters.row.enable.aria' : { code: s.sectionCode }) : ('Disable {code}' | t: 'staff.parameters.row.disable.aria' : { code: s.sectionCode })"
                            (click)="toggleDisabled(s)">{{ s.disabled ? ('Enable' | t: 'staff.parameters.row.enable.button') : ('Disable' | t: 'staff.parameters.row.disable.button') }}</button>
                  </div>
                </td>
              </tr>
            } @empty {
              <tr class="empty-row"><td [attr.colspan]="onMain ? 6 : 5" style="padding: 0"><div class="no-data">{{ pager.search() || filter() !== 'all' ? ('No parameter matches the search' | t: 'staff.parameters.noMatch.empty') : ('No Data' | t: 'staff.parameters.empty') }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      <zed-pager [pager]="pager" />
    </div>

    @if (adding()) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="add-parameter-title">
        <div class="modal-dialog modal-popup modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="add-parameter-title">{{ 'Add Parameter ({level})' | t: 'staff.parameters.addDialog.title' : { level: levelName() } }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.parameters.dialog.close.aria'" (click)="adding.set(false)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form class="add-form" (ngSubmit)="add()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="sectionCode">{{ 'Parameter Code' | t: 'staff.parameters.form.code.label' }}<span class="req">*</span></label>
                  <div>
                    <!-- 2026-11-13: a number only (the legacy procedures sort parameters by CAST(SectionCode AS int)). -->
                    <input id="sectionCode" name="sectionCode" class="form-control" maxlength="9" inputmode="numeric" [placeholder]="'e.g. 1' | t: 'staff.parameters.form.code.placeholder'" [(ngModel)]="code" />
                    @if (submitted() && !code.trim()) { <span class="help-block">{{ 'Parameter Code required.' | t: 'staff.parameters.form.code.error' }}</span> }
                    @else if (submitted() && !codeIsNumber()) { <span class="help-block">{{ 'The parameter code must be a number, e.g. 1.' | t: 'staff.parameters.form.code.number.error' }}</span> }
                  </div>
                  <label for="sectionName">{{ 'Parameter Name' | t: 'staff.parameters.form.name.label' }}<span class="req">*</span></label>
                  <div>
                    <input id="sectionName" name="sectionName" class="form-control" maxlength="200" [(ngModel)]="name" />
                    @if (submitted() && !name.trim()) { <span class="help-block">{{ 'Parameter Name required.' | t: 'staff.parameters.form.name.error' }}</span> }
                  </div>
                  <label for="description" class="top">{{ 'Description' | t: 'staff.parameters.form.description.label' }}</label>
                  <textarea id="description" name="description" rows="4" class="form-control" maxlength="1990" [(ngModel)]="description"></textarea>
                  <label for="nicSectors" class="top">{{ 'NIC Sectors' | t: 'staff.parameters.form.sectors.label' }}</label>
                  <div>
                    <zed-multi-select inputId="nicSectors" [label]="'NIC Sectors' | t: 'staff.parameters.form.sectors.label'" [options]="sectorOptions()" [(value)]="nicSectors" />
                    <small class="muted d-block mt-1">{{ 'None chosen: the parameter applies to every sector.' | t: 'staff.parameters.addDialog.sectors.note' }}</small>
                  </div>
                  <span class="label-like">{{ 'Surveillance' | t: 'staff.parameters.form.surveillance.label' }}</span>
                  <div class="form-check">
                    <input id="inSurveillance" name="inSurveillance" type="checkbox" class="form-check-input" [(ngModel)]="inSurveillance" />
                    <label for="inSurveillance" class="form-check-label">{{ 'Assessed again in surveillance' | t: 'staff.parameters.form.surveillance.tick.label' }}</label>
                  </div>
                  @if (onMain) {
                    <span class="label-like">{{ 'Consultancy' | t: 'staff.parameters.form.consultancy.label' }}</span>
                    <div class="form-check">
                      <input id="inConsultancy" name="inConsultancy" type="checkbox" class="form-check-input" [(ngModel)]="inConsultancy" />
                      <label for="inConsultancy" class="form-check-label">{{ 'Used in consultancy (handholding)' | t: 'staff.parameters.form.consultancy.tick.label' }}</label>
                    </div>
                  }
                </div>
                @if (addError()) { <span class="help-block" role="alert">{{ addError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="adding.set(false)">{{ 'Cancel' | t: 'staff.parameters.dialog.cancel.button' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ 'Save' | t: 'staff.parameters.dialog.save.button' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="edit-parameter-title">
        <div class="modal-dialog modal-popup modal-lg modal-dialog-scrollable">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="edit-parameter-title">{{ 'Edit Parameter {code}' | t: 'staff.parameters.editDialog.title' : { code: e.code } }}</h3>
                <button type="button" class="btn btn-link p-0" [attr.aria-label]="'Close' | t: 'staff.parameters.dialog.close.aria'" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="update()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="edit-name">{{ 'Parameter Name' | t: 'staff.parameters.form.name.label' }}<span class="req">*</span></label>
                  <input id="edit-name" name="editName" class="form-control" maxlength="200" [(ngModel)]="e.sectionName" />
                  <label for="edit-description" class="top">{{ 'Description' | t: 'staff.parameters.form.description.label' }}</label>
                  <textarea id="edit-description" name="editDescription" rows="5" class="form-control" maxlength="1990" [(ngModel)]="e.description"></textarea>
                  <label for="edit-nicSectors" class="top">{{ 'NIC Sectors' | t: 'staff.parameters.form.sectors.label' }}</label>
                  <div>
                    <zed-multi-select inputId="edit-nicSectors" [label]="'NIC Sectors' | t: 'staff.parameters.form.sectors.label'" [options]="sectorOptions()" [(value)]="e.nicSectors" />
                    <small class="muted d-block mt-1">{{ 'None chosen: every sector.' | t: 'staff.parameters.editDialog.sectors.note' }}</small>
                  </div>
                  <span class="label-like">{{ 'Surveillance' | t: 'staff.parameters.form.surveillance.label' }}</span>
                  <div class="form-check">
                    <input id="edit-inSurveillance" name="editInSurveillance" type="checkbox" class="form-check-input" [(ngModel)]="e.inSurveillance" />
                    <label for="edit-inSurveillance" class="form-check-label">{{ 'Assessed again in surveillance' | t: 'staff.parameters.form.surveillance.tick.label' }}</label>
                  </div>
                  @if (onMain) {
                    <span class="label-like">{{ 'Consultancy' | t: 'staff.parameters.form.consultancy.label' }}</span>
                    <div class="form-check">
                      <input id="edit-inConsultancy" name="editInConsultancy" type="checkbox" class="form-check-input" [(ngModel)]="e.inConsultancy" />
                      <label for="edit-inConsultancy" class="form-check-label">{{ 'Used in consultancy (handholding)' | t: 'staff.parameters.form.consultancy.tick.label' }}</label>
                    </div>
                  }
                </div>
                @if (editError()) { <span class="help-block" role="alert">{{ editError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.parameters.dialog.cancel.button' }}</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving()">{{ 'Save' | t: 'staff.parameters.dialog.save.button' }}</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .page-head { align-items: flex-end; }

    /* One tab per level of Administration → Certification Levels. */
    .level-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 16px; }
    .level-tab {
      display: inline-flex; align-items: center; gap: 8px; padding: 7px 18px; border-radius: 6px; border: 1px solid #cbd9da;
      background: #fff; color: var(--zt-mid2, #2f7c83); font-weight: 600; font-size: 14px; cursor: pointer;
    }
    .level-tab:hover { background: #eef6f6; border-color: #45a5ad; }
    .level-tab.active { background: var(--zt-dark, #23656b); border-color: var(--zt-dark, #23656b); color: #fff; }
    .tab-note { font-size: 11px; font-weight: 600; padding: 1px 8px; border-radius: 10px; background: #fff4d6; color: #8a6100; }

    /* The level's counts. */
    .param-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; }
    .stat-off .stat-value { color: #7a7a7a; }
    tr.row-off > td { background: #f6f7f7; }
    tr.row-off .param-name, tr.row-off pre { color: #8a9496; }
    .off-badge { display: inline-block; margin-left: 6px; font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 10px; background: #e7eaeb; color: #5f6f70; vertical-align: middle; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    .list-card { padding: 16px; }
    .list-toolbar { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; justify-content: space-between; margin-bottom: 12px; }
    .list-toolbar .search { flex: 1 1 260px; max-width: 420px; }
    /* The pop-ups: header and footer stay, the body scrolls (the form sits between the content and the body). */
    .modal-content > form { display: flex; flex-direction: column; min-height: 0; flex: 1 1 auto; }

    .param-table { table-layout: fixed; width: 100%; min-width: 900px; margin-bottom: 8px; }
    .param-table td { vertical-align: top; overflow-wrap: break-word; padding-top: 14px; padding-bottom: 14px; }
    .param-table .status-badge, .off-badge { white-space: nowrap; overflow-wrap: normal; }
    .param-table .row-actions { flex-direction: row; flex-wrap: nowrap; align-items: center; gap: 6px; }
    .param-table tbody tr:hover { background: var(--zt-pale, #f7fbfb); }
    .code-badge {
      display: inline-flex; align-items: center; justify-content: center; min-width: 36px; height: 36px; padding: 0 8px; border-radius: 18px;
      background: #eef6f6; color: #23474a; font-weight: 700; font-size: 14px;
    }
    .param-name { font-weight: 700; color: #232527; font-size: 15px; margin-bottom: 4px; }
    .clamp-2 { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .more { font-size: 13px; }
    .all-sectors { font-size: 13px; }
    pre { width: auto; max-width: 100%; color: #5f6f70; font-size: 13.5px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: break-word; background-color: transparent; font-family: inherit; margin: 0; }

    /* Phones: a card per parameter. */
    @media (max-width: 767.98px) {
      .param-stats { grid-template-columns: minmax(0, 1fr); }
      .list-toolbar .search { max-width: none; }
      .param-table { min-width: 0; table-layout: auto; }
      .param-table colgroup, .param-table thead { display: none; }
      .param-table, .param-table tbody, .param-table tr, .param-table td { display: block; width: 100%; box-sizing: border-box; }
      .param-table tr { border: 1px solid #dfe9ea; border-radius: 12px; margin-bottom: 12px; padding: 4px 12px; }
      .param-table tr.empty-row { border: 0; padding: 0; }
      .param-table td { border: 0; padding: 6px 0; text-align: left !important; }
      .param-table td[data-label]::before { content: attr(data-label); display: block; font-size: 12px; font-weight: 600; color: #5f6f70; margin-bottom: 2px; }
      .param-table td.code-cell::before { display: none; }
      .param-table .row-actions { justify-content: flex-start !important; flex-wrap: wrap; }
    }
  `,
})
export class ParametersPage {
  protected readonly questionnairePortals = QUESTIONNAIRE_PORTALS;
  private readonly api = inject(MastersApi);
  private readonly legacyUrl = signal('');

  private readonly router = inject(Router);

  /** The level's code (Bronze, Silver, Gold, ZEDX, ...); the page reloads when the menu or a level tab switches level. */
  protected readonly sectionType = signal('Bronze');
  protected readonly levels = signal<ParameterLevel[]>([]);
  protected readonly levelName = computed(() => this.levels().find((l) => this.isLevel(l.code))?.name ?? this.sectionType());
  protected readonly sectorOptions = signal<MultiSelectOption[]>([]);
  protected nicSectors: string[] = [];
  /** Every parameter of the level; the pager holds those the filter lets through. */
  private readonly rows = signal<Parameter[]>([]);
  protected readonly filters = computed((): readonly { key: ParameterFilter; label: string }[] => [
    { key: 'all', label: t('staff.parameters.filter.all', 'All') },
    { key: 'surveillance', label: t('staff.parameters.filter.surveillance', 'In surveillance') },
    { key: 'notSurveillance', label: t('staff.parameters.filter.notSurveillance', 'Not in surveillance') },
    ...(PORTAL_SYSTEM === 'main' ? [{ key: 'notConsultancy' as const, label: t('staff.parameters.filter.notConsultancy', 'Not in consultancy') }] : []),
    { key: 'sectors', label: t('staff.parameters.filter.sectors', 'Sector-specific') },
    { key: 'disabled', label: t('staff.parameters.filter.disabled', 'Disabled') },
  ]);
  protected readonly filter = signal<ParameterFilter>('all');
  protected readonly stats = computed(() => {
    const rows = this.rows();
    return {
      total: rows.length,
      surveillance: rows.filter((r) => r.inSurveillance).length,
      consultancy: rows.filter((r) => r.inConsultancy !== false).length,
      sectorSpecific: rows.filter((r) => r.nicSectors?.length).length,
      disabled: rows.filter((r) => r.disabled).length,
    };
  });
  protected readonly pager = new ClientPager<Parameter>(10);
  protected readonly adding = signal(false);
  protected readonly editing = signal<{
    id: number; code: string; sectionName: string; description: string; nicSectors: string[]; inSurveillance: boolean; inConsultancy: boolean;
  } | null>(null);
  /** Main portal: whether a parameter is used in consultancy (the handholding questionnaire is copied from main's). */
  protected readonly onMain = PORTAL_SYSTEM === 'main';
  protected readonly expanded = signal<ReadonlySet<number>>(new Set());
  protected readonly submitted = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly addError = signal('');
  protected readonly editError = signal('');
  protected readonly success = signal('');
  protected code = '';
  protected name = '';
  protected description = '';
  /** A new parameter is assessed in surveillance unless unticked (the surveillance copies only these). */
  protected inSurveillance = true;
  /** A new parameter is used in consultancy unless unticked. */
  protected inConsultancy = true;

  constructor() {
    inject(ClientConfigService).get().then((c) => this.legacyUrl.set(c.legacyPortalUrl)).catch(() => undefined);
    firstValueFrom(this.api.parameterLevels()).then((l) => this.levels.set(l)).catch(() => undefined);
    firstValueFrom(this.api.list('sectors'))
      // 2026-11-16: a disabled sector is not offered (a parameter that has it keeps it).
      .then((list) => this.sectorOptions.set(list.filter((s) => !s.disabled).map((s) => ({ value: s.code, label: `${s.code} - ${s.name}` }))))
      .catch(() => undefined);
    inject(ActivatedRoute).paramMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      this.sectionType.set(params.get('sectionType') ?? 'Bronze');
      this.editing.set(null);
      this.adding.set(false);
      this.success.set('');
      this.error.set('');
      this.filter.set('all');
      this.pager.setSearch('');
      void this.load(true);
    });
  }

  protected isLevel(code: string): boolean {
    return code.toLowerCase() === this.sectionType().toLowerCase();
  }

  protected pickLevel(code: string): void {
    if (!this.isLevel(code)) void this.router.navigate(['/staff/masters/parameters', code]);
  }

  protected setFilter(f: ParameterFilter): void {
    this.filter.set(f);
    this.pager.set(this.filtered());
  }

  private filtered(): Parameter[] {
    const rows = this.rows();
    switch (this.filter()) {
      case 'surveillance': return rows.filter((r) => r.inSurveillance);
      case 'notSurveillance': return rows.filter((r) => !r.inSurveillance);
      case 'notConsultancy': return rows.filter((r) => r.inConsultancy === false);
      case 'sectors': return rows.filter((r) => r.nicSectors?.length);
      case 'disabled': return rows.filter((r) => r.disabled);
      default: return rows;
    }
  }

  protected sectorName(code: string): string {
    return this.sectorOptions().find((o) => o.value === code)?.label ?? code;
  }

  protected requirementsUrl(p: Parameter): string {
    return `/staff/questionnaire/${encodeURIComponent(p.sectionType || this.sectionType())}/${encodeURIComponent(p.sectionCode)}`;
  }

  /** Descriptions over about two lines get the Show more / less link. */
  protected isLong(text: string): boolean {
    return text.length > 110 || text.split('\n').length > 2;
  }

  protected toggle(id: number): void {
    this.expanded.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  /** <paramref name="fresh"/>: another level, so page 1; otherwise (after a save) the same page. */
  protected async load(fresh = false): Promise<void> {
    try {
      this.rows.set(await firstValueFrom(this.api.parameters(this.sectionType())));
      if (fresh) this.pager.set(this.filtered());
      else this.pager.refresh(this.filtered());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected openAdd(): void {
    this.code = this.name = this.description = '';
    this.inSurveillance = true;
    this.inConsultancy = true;
    this.nicSectors = [];
    this.submitted.set(false);
    this.addError.set('');
    this.success.set('');
    this.adding.set(true);
  }

  /** A parameter's code is a number (2026-11-13): "P1" breaks the legacy procedures and the ZED MSME app. */
  protected codeIsNumber(): boolean {
    return /^[0-9]{1,9}$/.test(this.code.trim());
  }

  protected async add(): Promise<void> {
    this.submitted.set(true);
    this.addError.set('');
    this.success.set('');
    if (!this.code.trim() || !this.name.trim() || !this.codeIsNumber()) {
      this.addError.set(t('staff.parameters.add.invalid.error', 'Please enter valid data.'));
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.addParameter(this.sectionType(), this.code.trim(), this.name.trim(), this.description, this.nicSectors, this.inSurveillance, this.onMain ? this.inConsultancy : undefined))).message);
      this.adding.set(false);
      await this.load();
    } catch (err) {
      this.addError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected edit(p: Parameter): void {
    this.editError.set('');
    this.success.set('');
    this.editing.set({ id: p.id, code: p.sectionCode, sectionName: p.sectionName, description: p.description ?? '', nicSectors: [...(p.nicSectors ?? [])], inSurveillance: !!p.inSurveillance, inConsultancy: p.inConsultancy !== false });
  }

  /** The parameter whose Disable / Enable is being saved. */
  protected readonly toggling = signal<number | null>(null);

  /** 2026-11-16: Disable (left out of the applications paid from now on) or Enable a parameter. */
  protected async toggleDisabled(s: Parameter): Promise<void> {
    this.error.set('');
    this.success.set('');
    this.toggling.set(s.id);
    try {
      this.success.set((await firstValueFrom(this.api.setParameterDisabled(this.sectionType(), s.id, !s.disabled))).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.toggling.set(null);
    }
  }

  protected async update(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    if (!e.sectionName.trim()) {
      this.editError.set(t('staff.parameters.edit.invalid.error', 'Enter the valid data.'));
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.updateParameter(this.sectionType(), e.id, e.sectionName.trim(), e.description, e.nicSectors, e.inSurveillance, this.onMain ? e.inConsultancy : undefined))).message);
      this.editing.set(null);
      await this.load();
    } catch (err) {
      this.editError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
